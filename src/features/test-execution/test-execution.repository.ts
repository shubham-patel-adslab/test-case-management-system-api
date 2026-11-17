import { pool, type Queryable } from '../../app/database.js';
import type { DefectSeverity } from '../defect/defect.constant.js';
import {
    EXECUTION_STATUS,
    type ExecutionAuditAction,
    type ExecutionResult,
    type ExecutionStatus,
} from './test-execution.constant.js';

// An execution with the names of its assignee and executor, as `pg` returns it.
export type TestExecutionRow = {
    id: number;
    project_id: number;
    test_case_id: number | null;
    suite_run_id: number | null;
    test_case_title: string;
    status: ExecutionStatus;
    comment: string;
    assignee_id: string | null;
    assignee_first_name: string | null;
    assignee_last_name: string | null;
    executor_id: string | null;
    executor_first_name: string | null;
    executor_last_name: string | null;
    defect_id: number | null;
    defect_title: string | null;
    defect_severity: DefectSeverity | null;
    executed_at: Date | null;
    created_at: Date;
    updated_at: Date;
};

// The execution's own copy of a step, with its optional per-step result.
export type TestExecutionStepRow = {
    step_order: number;
    action: string;
    expected_result: string;
    status: ExecutionResult | null;
    comment: string;
};

export type TestExecutionAuditLogRow = {
    id: number;
    action: ExecutionAuditAction;
    actor_id: string | null;
    actor_first_name: string | null;
    actor_last_name: string | null;
    details: Record<string, unknown>;
    created_at: Date;
};

export type ExecutionProgressRow = {
    total: number;
    pending: number;
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
};

export type TestExecutionListFilter = {
    statuses: ExecutionStatus[] | undefined;
    assigneeId: string | undefined;
    testCaseId: number | undefined;
    suiteRunId: number | undefined;
};

export type RecordedResult = {
    status: ExecutionResult;
    comment: string;
};

export type ExecutionStepSnapshot = {
    order: number;
    action: string;
    expectedResult: string;
    status: ExecutionResult | null;
    comment: string;
};

// Fixed SQL fragments (never request input), so interpolating them is safe. LEFT JOIN: assignee, executor and
// defect are optional (users are NULL once their row is removed); at most one defect per execution
// (uq_defects_test_execution_id), so the join never multiplies rows.
const EXECUTION_SELECT = `
    SELECT e.id, e.project_id, e.test_case_id, e.suite_run_id, e.test_case_title, e.status, e.comment,
           a.id AS assignee_id, a.first_name AS assignee_first_name, a.last_name AS assignee_last_name,
           x.id AS executor_id, x.first_name AS executor_first_name, x.last_name AS executor_last_name,
           d.id AS defect_id, d.title AS defect_title, d.severity AS defect_severity,
           e.executed_at, e.created_at, e.updated_at
      FROM test_executions e
      LEFT JOIN users a ON a.id = e.assignee_id
      LEFT JOIN users x ON x.id = e.executed_by
      LEFT JOIN defects d ON d.test_execution_id = e.id`;

// NULL parameter = filter not applied. $1 is the project; filters are $2–$5.
const EXECUTION_LIST_WHERE = `
     WHERE e.project_id = $1
       AND ($2::text[] IS NULL OR e.status = ANY($2))
       AND ($3::uuid IS NULL OR e.assignee_id = $3)
       AND ($4::int IS NULL OR e.test_case_id = $4)
       AND ($5::int IS NULL OR e.suite_run_id = $5)`;

function toListParameters(projectId: number, filter: TestExecutionListFilter): unknown[] {
    return [projectId, filter.statuses ?? null, filter.assigneeId ?? null, filter.testCaseId ?? null, filter.suiteRunId ?? null];
}

function firstRowOrThrow<TRow>(rows: TRow[], operation: string): TRow {
    const row = rows[0];

    if (!row) {
        throw new Error(`${operation} returned no row`);
    }

    return row;
}

// Every statement is scoped by project as well as the execution id. `db` defaults to the pool; pass the
// transaction's client inside withTransaction().
export const testExecutionRepository = {
    // Newest first; `id` breaks ties so a page boundary never repeats or skips a row.
    async selectPage(projectId: number, filter: TestExecutionListFilter, limit: number, offset: number): Promise<TestExecutionRow[]> {
        const result = await pool.query<TestExecutionRow>(
            `${EXECUTION_SELECT}
             ${EXECUTION_LIST_WHERE}
             ORDER BY e.created_at DESC, e.id DESC
             LIMIT $6 OFFSET $7`,
            [...toListParameters(projectId, filter), limit, offset],
        );

        return result.rows;
    },

    async count(projectId: number, filter: TestExecutionListFilter): Promise<number> {
        const result = await pool.query<{ total: number }>(
            `SELECT COUNT(*)::int AS total FROM test_executions e ${EXECUTION_LIST_WHERE}`,
            toListParameters(projectId, filter),
        );

        return firstRowOrThrow(result.rows, 'COUNT test_executions').total;
    },

    // Counts per status in one pass (PRD "Track execution progress"), optionally for one assignee.
    async selectProgress(projectId: number, assigneeId: string | undefined): Promise<ExecutionProgressRow> {
        const result = await pool.query<ExecutionProgressRow>(
            `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
                    COUNT(*) FILTER (WHERE status = 'PASS')::int AS passed,
                    COUNT(*) FILTER (WHERE status = 'FAIL')::int AS failed,
                    COUNT(*) FILTER (WHERE status = 'BLOCKED')::int AS blocked,
                    COUNT(*) FILTER (WHERE status = 'SKIPPED')::int AS skipped
               FROM test_executions
              WHERE project_id = $1 AND ($2::uuid IS NULL OR assignee_id = $2)`,
            [projectId, assigneeId ?? null],
        );

        return firstRowOrThrow(result.rows, 'progress');
    },

    async selectById(projectId: number, id: number, db: Queryable = pool): Promise<TestExecutionRow | undefined> {
        const result = await db.query<TestExecutionRow>(`${EXECUTION_SELECT} WHERE e.project_id = $1 AND e.id = $2`, [projectId, id]);

        return result.rows[0];
    },

    // Locks the execution until the transaction ends, so two people recording a result for it run one after
    // the other — the second then sees it is no longer PENDING.
    async lockById(projectId: number, id: number, db: Queryable): Promise<{ status: ExecutionStatus; test_case_id: number | null } | undefined> {
        const result = await db.query<{ status: ExecutionStatus; test_case_id: number | null }>(
            'SELECT status, test_case_id FROM test_executions WHERE project_id = $1 AND id = $2 FOR UPDATE',
            [projectId, id],
        );

        return result.rows[0];
    },

    // Assignment: one PENDING execution per test case (title snapshot from the test case). A test case that
    // already has a pending, non-suite-run execution for this assignee is skipped, so assigning twice doesn't
    // duplicate the work. Returns the new ids.
    async insertPendingForCases(projectId: number, testCaseIds: number[], assigneeId: string, createdById: string, db: Queryable): Promise<number[]> {
        const result = await db.query<{ id: number }>(
            `INSERT INTO test_executions (project_id, test_case_id, test_case_title, assignee_id, created_by)
             SELECT tc.project_id, tc.id, tc.title, $3, $4
               FROM test_cases tc
              WHERE tc.project_id = $1 AND tc.id = ANY($2::int[])
                AND NOT EXISTS (
                        SELECT 1 FROM test_executions e
                         WHERE e.test_case_id = tc.id AND e.assignee_id = $3
                           AND e.status = '${EXECUTION_STATUS.PENDING}' AND e.suite_run_id IS NULL)
              ORDER BY array_position($2::int[], tc.id)
             RETURNING id`,
            [projectId, testCaseIds, assigneeId, createdById],
        );

        return result.rows.map((row) => row.id);
    },

    // Suite run: one PENDING execution per test case, inserted in the order given (the suite's order), so
    // their ids follow it — a run's executions are listed by id. Returns the new ids.
    async insertPendingForRun(
        projectId: number,
        suiteRunId: number,
        testCaseIds: number[],
        assigneeId: string | null,
        createdById: string,
        db: Queryable,
    ): Promise<number[]> {
        const result = await db.query<{ id: number }>(
            `INSERT INTO test_executions (project_id, test_case_id, suite_run_id, test_case_title, assignee_id, created_by)
             SELECT tc.project_id, tc.id, $2, tc.title, $4, $5
               FROM unnest($3::int[]) WITH ORDINALITY AS c (test_case_id, position)
               JOIN test_cases tc ON tc.id = c.test_case_id AND tc.project_id = $1
              ORDER BY c.position
             RETURNING id`,
            [projectId, suiteRunId, testCaseIds, assigneeId, createdById],
        );

        return result.rows.map((row) => row.id);
    },

    // A suite run's executions in suite order (see insertPendingForRun).
    async selectByRun(suiteRunId: number, db: Queryable = pool): Promise<TestExecutionRow[]> {
        const result = await db.query<TestExecutionRow>(`${EXECUTION_SELECT} WHERE e.suite_run_id = $1 ORDER BY e.id`, [suiteRunId]);

        return result.rows;
    },

    // Counts per status for several suite runs in one query (a page of runs — no N+1). Runs without
    // executions are absent from the map.
    async selectProgressByRun(suiteRunIds: number[], db: Queryable = pool): Promise<Map<number, ExecutionProgressRow>> {
        const result = await db.query<ExecutionProgressRow & { suite_run_id: number }>(
            `SELECT suite_run_id,
                    COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
                    COUNT(*) FILTER (WHERE status = 'PASS')::int AS passed,
                    COUNT(*) FILTER (WHERE status = 'FAIL')::int AS failed,
                    COUNT(*) FILTER (WHERE status = 'BLOCKED')::int AS blocked,
                    COUNT(*) FILTER (WHERE status = 'SKIPPED')::int AS skipped
               FROM test_executions
              WHERE suite_run_id = ANY($1::int[])
              GROUP BY suite_run_id`,
            [suiteRunIds],
        );

        return new Map(result.rows.map(({ suite_run_id, ...progress }) => [suite_run_id, progress]));
    },

    // Ad hoc run: an execution created with its result already recorded.
    async insertRecorded(projectId: number, testCase: { id: number; title: string }, result: RecordedResult, actorId: string, db: Queryable): Promise<number> {
        const inserted = await db.query<{ id: number }>(
            `INSERT INTO test_executions
                    (project_id, test_case_id, test_case_title, status, comment, executed_by, executed_at, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, now(), $6)
             RETURNING id`,
            [projectId, testCase.id, testCase.title, result.status, result.comment, actorId],
        );

        return firstRowOrThrow(inserted.rows, 'INSERT test_execution').id;
    },

    // PENDING → result, once (results are immutable). The title snapshot is refreshed to the version run.
    // false = no longer PENDING (the caller locked the row, so this only guards against misuse).
    async recordResult(id: number, testCaseTitle: string, result: RecordedResult, actorId: string, db: Queryable): Promise<boolean> {
        const updated = await db.query(
            `UPDATE test_executions
                SET status = $3, comment = $4, test_case_title = $2, executed_by = $5, executed_at = now(), updated_at = now()
              WHERE id = $1 AND status = '${EXECUTION_STATUS.PENDING}'`,
            [id, testCaseTitle, result.status, result.comment, actorId],
        );

        return updated.rowCount === 1;
    },

    // The steps as run, with their optional results (snapshot).
    async insertSteps(executionId: number, steps: ExecutionStepSnapshot[], db: Queryable): Promise<void> {
        await db.query(
            `INSERT INTO test_execution_steps (test_execution_id, step_order, action, expected_result, status, comment)
             SELECT $1, s.step_order, s.action, s.expected_result, s.status, s.comment
               FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[])
                    AS s (step_order, action, expected_result, status, comment)`,
            [
                executionId,
                steps.map((step) => step.order),
                steps.map((step) => step.action),
                steps.map((step) => step.expectedResult),
                steps.map((step) => step.status),
                steps.map((step) => step.comment),
            ],
        );
    },

    async selectSteps(executionId: number, db: Queryable = pool): Promise<TestExecutionStepRow[]> {
        const result = await db.query<TestExecutionStepRow>(
            `SELECT step_order, action, expected_result, status, comment
               FROM test_execution_steps
              WHERE test_execution_id = $1
              ORDER BY step_order`,
            [executionId],
        );

        return result.rows;
    },

    // One audit entry per execution, all with the same action and details — written in the caller's
    // transaction, so the trail can't miss or invent a change.
    async insertAuditLogs(executionIds: number[], action: ExecutionAuditAction, actorId: string, details: Record<string, unknown>, db: Queryable): Promise<void> {
        await db.query(
            `INSERT INTO test_execution_audit_logs (test_execution_id, action, actor_id, details)
             SELECT id, $2, $3, $4::jsonb FROM unnest($1::int[]) AS e (id)`,
            [executionIds, action, actorId, JSON.stringify(details)],
        );
    },

    async selectAuditLogs(executionId: number): Promise<TestExecutionAuditLogRow[]> {
        const result = await pool.query<TestExecutionAuditLogRow>(
            `SELECT l.id, l.action, u.id AS actor_id, u.first_name AS actor_first_name, u.last_name AS actor_last_name,
                    l.details, l.created_at
               FROM test_execution_audit_logs l
               LEFT JOIN users u ON u.id = l.actor_id
              WHERE l.test_execution_id = $1
              ORDER BY l.created_at, l.id`,
            [executionId],
        );

        return result.rows;
    },

    // Before test cases are deleted: their pending executions go (nothing happened yet). Recorded ones stay
    // and keep their snapshot (ON DELETE SET NULL (test_case_id)). A pending row locked by someone recording
    // its result is re-checked after the lock is released, so a just-recorded result is never deleted.
    async deletePendingOfCases(projectId: number, testCaseIds: number[], db: Queryable): Promise<void> {
        await db.query(
            `DELETE FROM test_executions
              WHERE project_id = $1 AND test_case_id = ANY($2::int[]) AND status = '${EXECUTION_STATUS.PENDING}'`,
            [projectId, testCaseIds],
        );
    },
};
