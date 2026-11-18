// The demo's execution history: `days` days of recorded results (assigned and ad hoc runs, a weekly regression
// suite run, step results, defects, audit trail) plus the current backlog of pending work.
//
// Written with SQL directly, not through the services: a service always records "now", and history needs past
// timestamps. So every row mirrors what the services write for the same action — the same audit actions and
// details, a step snapshot on every recorded execution, a pending execution without one, the test case's
// last_result — and the whole history goes in inside the caller's transaction.
import type { Queryable } from '../../app/database.js';
import type { TestCasePriority } from '../../features/test-case/test-case.constant.js';
import type { ExecutionResult } from '../../features/test-execution/test-execution.constant.js';
import type { Random } from './demo-random.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60_000;
// Results are recorded between 03:30 and 13:30 UTC (09:00–19:00 in India).
const WORKDAY_START_MS = 3.5 * HOUR_MS;
const WORKDAY_LENGTH_MS = 10 * HOUR_MS;
// Nothing is recorded in the last minutes before the seed runs (or in the future).
const NOW_MARGIN_MS = 5 * MINUTE_MS;
const REGRESSION_RUN_EVERY_DAYS = 7;
// Share of the latest weekly run already recorded; the rest is pending (in-progress run on the dashboard).
const LATEST_RUN_DONE_SHARE = 0.6;
const DEFECT_SHARE_OF_FAILURES = 0.45;
const STEP_RESULTS_SHARE_OF_PASSES = 0.6;

const FAILURE_NOTES = [
    'The result did not match the expected result',
    'Got a 500 error',
    'The screen froze after submitting',
    'An out-of-date value was shown',
    'The button stayed disabled',
    'No validation message was shown',
    'The total was wrong',
    'The request timed out after 30 seconds',
];
const BLOCKED_NOTES = ['Test environment was down', 'Test data missing', 'Blocked by an open defect', 'Third-party sandbox unavailable', 'Build failed to deploy'];
const SKIPPED_NOTES = ['Not in scope for this release', 'Feature flag off in this build', 'Covered by another test today'];
const PASS_NOTES = ['Checked on the release candidate', 'Re-tested after the fix', 'Works as expected'];

const DEFECT_SEVERITIES: Record<TestCasePriority, readonly (readonly [TestCasePriority, number])[]> = {
    CRITICAL: [['CRITICAL', 2], ['HIGH', 1]],
    HIGH: [['HIGH', 2], ['MEDIUM', 1]],
    MEDIUM: [['MEDIUM', 2], ['LOW', 1]],
    LOW: [['LOW', 1]],
};

export type HistoryTestCase = {
    id: number;
    title: string;
    priority: TestCasePriority;
    steps: { order: number; action: string; expectedResult: string }[];
};

export type HistoryInput = {
    projectId: number;
    testCases: HistoryTestCase[];
    regressionSuite: { id: number; name: string; testCaseIds: number[] };
    // User ids with weights: who records results.
    executors: readonly (readonly [string, number])[];
    // Assigns work and starts the suite runs.
    leadId: string;
    dailyResults: number;
    days: number;
    now: Date;
};

export type HistoryCounts = { recorded: number; pending: number; defects: number; suiteRuns: number };

type StepRecord = { order: number; action: string; expectedResult: string; status: ExecutionResult | null; comment: string };
type AuditRecord = { action: 'CREATED' | 'RESULT_RECORDED' | 'DEFECT_CREATED'; actorId: string; details: Record<string, unknown>; at: Date };
type DefectRecord = { title: string; description: string; severity: TestCasePriority; createdBy: string; createdAt: Date };

type ExecutionRecord = {
    testCase: HistoryTestCase;
    suiteRunIndex: number | null;
    assigneeId: string | null;
    status: ExecutionResult | 'PENDING';
    comment: string;
    executedBy: string | null;
    executedAt: Date | null;
    createdBy: string;
    createdAt: Date;
    steps: StepRecord[];
    audits: AuditRecord[];
    defect: DefectRecord | null;
};

type SuiteRunRecord = { createdAt: Date };

// Pass rate climbs over the period (fewer failures as releases stabilize), so the trend chart has a shape.
function pickResult(random: Random, progress: number, priority: TestCasePriority): ExecutionResult {
    const pass = 0.66 + 0.22 * progress - (priority === 'CRITICAL' ? 0.04 : 0);
    const fail = 0.17 - 0.09 * progress;
    const blocked = 0.09 - 0.05 * progress;

    return random.weighted([['PASS', pass], ['FAIL', fail], ['BLOCKED', blocked], ['SKIPPED', Math.max(0.02, 1 - pass - fail - blocked)]] as const);
}

// The step snapshot as recorded, with per-step results where a tester would give them, the execution's comment,
// and the defect a failure may raise.
function recordResult(random: Random, testCase: HistoryTestCase, status: ExecutionResult, executedBy: string, executedAt: Date, now: Date) {
    const failedOrder = status === 'FAIL' ? random.int(Math.min(2, testCase.steps.length), testCase.steps.length) : 0;
    const failureNote = random.pick(FAILURE_NOTES);
    const hasPassResults = status === 'PASS' && random.chance(STEP_RESULTS_SHARE_OF_PASSES);
    const blockedNote = random.pick(BLOCKED_NOTES);

    const steps = testCase.steps.map((step): StepRecord => {
        const snapshot = { order: step.order, action: step.action, expectedResult: step.expectedResult };

        if (status === 'FAIL') {
            if (step.order < failedOrder) {
                return { ...snapshot, status: 'PASS', comment: '' };
            }

            return step.order === failedOrder ? { ...snapshot, status: 'FAIL', comment: failureNote } : { ...snapshot, status: null, comment: '' };
        }

        if (status === 'BLOCKED' && step.order === 1) {
            return { ...snapshot, status: 'BLOCKED', comment: blockedNote };
        }

        return { ...snapshot, status: hasPassResults ? 'PASS' : null, comment: '' };
    });

    const comment = {
        PASS: random.chance(0.1) ? random.pick(PASS_NOTES) : '',
        FAIL: `Step ${failedOrder}: ${failureNote}.`,
        BLOCKED: `${blockedNote}.`,
        SKIPPED: `${random.pick(SKIPPED_NOTES)}.`,
    }[status];

    const failedStep = testCase.steps.find((step) => step.order === failedOrder);
    const defect: DefectRecord | null = status === 'FAIL' && failedStep && random.chance(DEFECT_SHARE_OF_FAILURES)
        ? {
            title: `${failureNote}: ${testCase.title}`.slice(0, 255),
            description: `Found while running "${testCase.title}".\n\nStep ${failedOrder}: ${failedStep.action}\n`
                + `Expected: ${failedStep.expectedResult}\nActual: ${failureNote}.`,
            severity: random.weighted(DEFECT_SEVERITIES[testCase.priority]),
            createdBy: executedBy,
            createdAt: new Date(Math.min(executedAt.getTime() + random.int(2, 30) * MINUTE_MS, now.getTime() - MINUTE_MS)),
        }
        : null;

    return { steps, comment, defect };
}

function recorded(
    random: Random,
    base: Pick<ExecutionRecord, 'testCase' | 'suiteRunIndex' | 'assigneeId' | 'createdBy' | 'createdAt' | 'audits'>,
    status: ExecutionResult,
    executedBy: string,
    executedAt: Date,
    now: Date,
): ExecutionRecord {
    const { steps, comment, defect } = recordResult(random, base.testCase, status, executedBy, executedAt, now);

    return {
        ...base,
        status,
        comment,
        executedBy,
        executedAt,
        steps,
        defect,
        audits: [...base.audits, { action: 'RESULT_RECORDED', actorId: executedBy, details: { status }, at: executedAt }],
    };
}

function generate(input: HistoryInput, random: Random): { runs: SuiteRunRecord[]; executions: ExecutionRecord[] } {
    const { now, days, leadId } = input;
    const latestRecordable = now.getTime() - NOW_MARGIN_MS;
    const todayStart = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
    const executions: ExecutionRecord[] = [];
    const runs: SuiteRunRecord[] = [];
    const pendingCaseIds = new Set<number>();
    const testCaseById = new Map(input.testCases.map((testCase) => [testCase.id, testCase]));
    const testers = input.executors.filter(([userId]) => userId !== leadId).map(([userId]) => userId);

    for (let daysAgo = days - 1; daysAgo >= 0; daysAgo--) {
        const dayStart = todayStart - daysAgo * DAY_MS;
        const progress = (days - 1 - daysAgo) / Math.max(1, days - 1);
        const weekday = new Date(dayStart).getUTCDay();
        const isWeekend = weekday === 0 || weekday === 6;
        const resultCount = isWeekend
            ? random.int(0, 2)
            : random.int(Math.round(input.dailyResults * 0.6), Math.round(input.dailyResults * 1.4));

        // Day-to-day work: half assigned by the lead beforehand, half run ad hoc.
        for (let count = 0; count < resultCount; count++) {
            const executedAt = dayStart + WORKDAY_START_MS + random.next() * WORKDAY_LENGTH_MS;

            if (executedAt > latestRecordable) {
                continue;
            }

            const testCase = random.pick(input.testCases);
            const executedBy = random.weighted(input.executors);
            const status = pickResult(random, progress, testCase.priority);
            const isAssigned = random.chance(0.5);
            const createdAt = new Date(isAssigned ? executedAt - random.int(1, 36) * HOUR_MS : executedAt);

            executions.push(recorded(random, {
                testCase,
                suiteRunIndex: null,
                assigneeId: isAssigned ? executedBy : null,
                createdBy: isAssigned ? leadId : executedBy,
                createdAt,
                // An ad hoc run is created already recorded: only RESULT_RECORDED, as the service writes it.
                audits: isAssigned ? [{ action: 'CREATED', actorId: leadId, details: { assigneeId: executedBy }, at: createdAt }] : [],
            }, status, executedBy, new Date(executedAt), now));
        }

        // The weekly regression run: every case of the suite, in suite order, for one tester. The latest one is
        // still in progress.
        const runCreatedAt = dayStart + WORKDAY_START_MS;

        if (daysAgo % REGRESSION_RUN_EVERY_DAYS !== 2 || runCreatedAt > latestRecordable) {
            continue;
        }

        const runIndex = runs.push({ createdAt: new Date(runCreatedAt) }) - 1;
        const assigneeId = testers.length > 0 ? testers[runIndex % testers.length] ?? leadId : leadId;
        const isLatestRun = daysAgo < REGRESSION_RUN_EVERY_DAYS;
        let runClock = runCreatedAt;

        for (const testCaseId of input.regressionSuite.testCaseIds) {
            const testCase = testCaseById.get(testCaseId);

            if (!testCase) {
                throw new Error(`Regression suite case ${testCaseId} is not in the project's test cases`);
            }

            runClock += random.int(5, 40) * MINUTE_MS;
            const base = {
                testCase,
                suiteRunIndex: runIndex,
                assigneeId,
                createdBy: leadId,
                createdAt: new Date(runCreatedAt),
                audits: [{ action: 'CREATED' as const, actorId: leadId, details: { suiteRunId: runIndex, assigneeId }, at: new Date(runCreatedAt) }],
            };

            if (runClock > latestRecordable || (isLatestRun && !random.chance(LATEST_RUN_DONE_SHARE))) {
                pendingCaseIds.add(testCase.id);
                executions.push({ ...base, status: 'PENDING', comment: '', executedBy: null, executedAt: null, steps: [], defect: null });
                continue;
            }

            executions.push(recorded(random, base, pickResult(random, progress, testCase.priority), assigneeId, new Date(runClock), now));
        }
    }

    // Today's backlog: work the lead assigned in the last two days, not started yet. One pending execution per test
    // case at most, as the assignment endpoint allows.
    const backlogSize = input.dailyResults * 2;
    const backlogCandidates = input.testCases.filter((testCase) => !pendingCaseIds.has(testCase.id));

    for (let count = 0; count < backlogSize && backlogCandidates.length > 0; count++) {
        const [testCase] = backlogCandidates.splice(random.int(0, backlogCandidates.length - 1), 1);

        if (!testCase) {
            break;
        }

        const assigneeId = random.weighted(input.executors);
        const createdAt = new Date(now.getTime() - random.int(1, 47) * HOUR_MS);
        executions.push({
            testCase, suiteRunIndex: null, assigneeId, status: 'PENDING', comment: '', executedBy: null, executedAt: null,
            createdBy: leadId, createdAt, steps: [], defect: null,
            audits: [{ action: 'CREATED', actorId: leadId, details: { assigneeId }, at: createdAt }],
        });
    }

    return { runs, executions };
}

// Ids taken from the table's identity sequence up front, so related rows (steps, audit entries, defects) can point
// at them in the same batch; the inserts then use OVERRIDING SYSTEM VALUE with exactly these ids.
async function allocateIds(table: string, count: number, db: Queryable): Promise<number[]> {
    if (count === 0) {
        return [];
    }

    const result = await db.query<{ id: number }>(
        `SELECT nextval(pg_get_serial_sequence($1, 'id'))::int AS id FROM generate_series(1, $2)`,
        [table, count],
    );

    return result.rows.map((row) => row.id);
}

function idAt(ids: number[], index: number): number {
    const id = ids[index];

    if (id === undefined) {
        throw new Error(`No id allocated for row ${index}`);
    }

    return id;
}

export async function insertHistory(input: HistoryInput, random: Random, db: Queryable): Promise<HistoryCounts> {
    const { runs, executions } = generate(input, random);
    const runIds = await allocateIds('suite_runs', runs.length, db);
    const executionIds = await allocateIds('test_executions', executions.length, db);
    const defectExecutions = executions.flatMap((execution, index) => (execution.defect ? [{ execution, defect: execution.defect, index }] : []));
    const defectIds = await allocateIds('defects', defectExecutions.length, db);

    await db.query(
        `INSERT INTO suite_runs (id, project_id, test_suite_id, suite_name, created_by, created_at) OVERRIDING SYSTEM VALUE
         SELECT r.id, $2, $3, $4, $5, r.created_at FROM unnest($1::int[], $6::timestamptz[]) AS r (id, created_at)`,
        [runIds, input.projectId, input.regressionSuite.id, input.regressionSuite.name, input.leadId, runs.map((run) => run.createdAt.toISOString())],
    );

    // The audit entry of a suite run names the run's real id.
    const runIdOf = (runIndex: number | null) => (runIndex === null ? null : idAt(runIds, runIndex));

    await db.query(
        `INSERT INTO test_executions (id, project_id, test_case_id, suite_run_id, test_case_title, assignee_id, status, comment,
                                      executed_by, executed_at, created_by, created_at, updated_at) OVERRIDING SYSTEM VALUE
         SELECT e.id, $1, e.test_case_id, e.suite_run_id, e.title, e.assignee_id, e.status, e.comment,
                e.executed_by, e.executed_at, e.created_by, e.created_at, COALESCE(e.executed_at, e.created_at)
           FROM unnest($2::int[], $3::int[], $4::int[], $5::text[], $6::uuid[], $7::text[], $8::text[], $9::uuid[],
                       $10::timestamptz[], $11::uuid[], $12::timestamptz[])
                AS e (id, test_case_id, suite_run_id, title, assignee_id, status, comment, executed_by, executed_at, created_by, created_at)`,
        [
            input.projectId,
            executionIds,
            executions.map((execution) => execution.testCase.id),
            executions.map((execution) => runIdOf(execution.suiteRunIndex)),
            executions.map((execution) => execution.testCase.title),
            executions.map((execution) => execution.assigneeId),
            executions.map((execution) => execution.status),
            executions.map((execution) => execution.comment),
            executions.map((execution) => execution.executedBy),
            executions.map((execution) => execution.executedAt?.toISOString() ?? null),
            executions.map((execution) => execution.createdBy),
            executions.map((execution) => execution.createdAt.toISOString()),
        ],
    );

    const steps = executions.flatMap((execution, index) => execution.steps.map((step) => ({ executionId: idAt(executionIds, index), ...step })));
    await db.query(
        `INSERT INTO test_execution_steps (test_execution_id, step_order, action, expected_result, status, comment)
         SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::text[], $5::text[], $6::text[])`,
        [
            steps.map((step) => step.executionId),
            steps.map((step) => step.order),
            steps.map((step) => step.action),
            steps.map((step) => step.expectedResult),
            steps.map((step) => step.status),
            steps.map((step) => step.comment),
        ],
    );

    await db.query(
        `INSERT INTO defects (id, project_id, test_execution_id, title, description, severity, created_by, created_at, updated_at)
         OVERRIDING SYSTEM VALUE
         SELECT d.id, $1, d.execution_id, d.title, d.description, d.severity, d.created_by, d.created_at, d.created_at
           FROM unnest($2::int[], $3::int[], $4::text[], $5::text[], $6::text[], $7::uuid[], $8::timestamptz[])
                AS d (id, execution_id, title, description, severity, created_by, created_at)`,
        [
            input.projectId,
            defectIds,
            defectExecutions.map(({ index }) => idAt(executionIds, index)),
            defectExecutions.map(({ defect }) => defect.title),
            defectExecutions.map(({ defect }) => defect.description),
            defectExecutions.map(({ defect }) => defect.severity),
            defectExecutions.map(({ defect }) => defect.createdBy),
            defectExecutions.map(({ defect }) => defect.createdAt.toISOString()),
        ],
    );

    const audits = [
        ...executions.flatMap((execution, index) => execution.audits.map((audit) => ({
            executionId: idAt(executionIds, index),
            ...audit,
            // A suite run's CREATED entry was generated with the run's index.
            details: 'suiteRunId' in audit.details ? { ...audit.details, suiteRunId: runIdOf(execution.suiteRunIndex) } : audit.details,
        }))),
        ...defectExecutions.map(({ defect, index }, defectIndex) => ({
            executionId: idAt(executionIds, index),
            action: 'DEFECT_CREATED' as const,
            actorId: defect.createdBy,
            details: { defectId: idAt(defectIds, defectIndex) },
            at: defect.createdAt,
        })),
    ];
    await db.query(
        `INSERT INTO test_execution_audit_logs (test_execution_id, action, actor_id, details, created_at)
         SELECT * FROM unnest($1::int[], $2::text[], $3::uuid[], $4::jsonb[], $5::timestamptz[])`,
        [
            audits.map((audit) => audit.executionId),
            audits.map((audit) => audit.action),
            audits.map((audit) => audit.actorId),
            audits.map((audit) => JSON.stringify(audit.details)),
            audits.map((audit) => audit.at.toISOString()),
        ],
    );

    // Each test case's latest result, as recording a result keeps it (test_cases.last_result).
    await db.query(
        `UPDATE test_cases tc
            SET last_result = latest.status, last_executed_at = latest.executed_at
           FROM (SELECT DISTINCT ON (test_case_id) test_case_id, status, executed_at
                   FROM test_executions
                  WHERE project_id = $1 AND status <> 'PENDING'
                  ORDER BY test_case_id, executed_at DESC, id DESC) AS latest
          WHERE tc.id = latest.test_case_id`,
        [input.projectId],
    );

    const pending = executions.filter((execution) => execution.status === 'PENDING').length;

    return { recorded: executions.length - pending, pending, defects: defectIds.length, suiteRuns: runIds.length };
}
