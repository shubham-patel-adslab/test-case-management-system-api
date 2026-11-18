import { pool, type Queryable } from '../../app/database.js';
import type { ExecutionStatus } from '../test-execution/test-execution.constant.js';
import type { TestCasePriority, TestCaseType } from '../test-case/test-case.constant.js';
import type { ProjectScope } from '../project/project.repository.js';

// What every analytics query is filtered by. Each query takes the same five parameters, in this order.
export type AnalyticsFilter = {
    scope: ProjectScope;
    projectId: number | undefined;
    from: string;
    to: string;
    timeZone: string;
};

// Executions in the range or pending, grouped by status and the test case's current priority/type (both null
// when the test case was deleted — the execution kept its history).
export type ExecutionBreakdownRow = {
    status: ExecutionStatus;
    priority: TestCasePriority | null;
    type: TestCaseType | null;
    count: number;
};

export type ResultCountsRow = {
    passed: number;
    failed: number;
    blocked: number;
    skipped: number;
};

export type TrendRow = ResultCountsRow & {
    // 'YYYY-MM-DD' (cast to text: pg would turn a date into a local-midnight Date).
    date: string;
};

export type TesterRow = ResultCountsRow & {
    id: string;
    first_name: string;
    last_name: string | null;
    pending: number;
    executed: number;
};

export type TotalsRow = {
    total_cases: number;
    executed_cases: number;
    defects: number;
};

// $1 scope (null = every project), $2 one project or null — on any table with project_id. `alias` is a fixed
// table alias, never input. Membership is served by uq_project_members_project_id_user_id.
function isInScope(alias: string): string {
    return `($1::uuid IS NULL OR ${alias}.project_id IN (SELECT pm.project_id FROM project_members pm WHERE pm.user_id = $1))
            AND ($2::int IS NULL OR ${alias}.project_id = $2)`;
}

// $3..$4 are calendar dates in time zone $5, inclusive: from local midnight of `from` to local midnight after
// `to`. Comparing the column itself (not a function of it) lets idx_*_project_id_executed_at/created_at serve it.
function isInRange(column: string): string {
    return `${column} >= ($3::date::timestamp AT TIME ZONE $5)
            AND ${column} < (($4::date + 1)::timestamp AT TIME ZONE $5)`;
}

const RESULT_COUNTS = `
    COUNT(*) FILTER (WHERE e.status = 'PASS')::int AS passed,
    COUNT(*) FILTER (WHERE e.status = 'FAIL')::int AS failed,
    COUNT(*) FILTER (WHERE e.status = 'BLOCKED')::int AS blocked,
    COUNT(*) FILTER (WHERE e.status = 'SKIPPED')::int AS skipped`;

function toParameters(filter: AnalyticsFilter): unknown[] {
    return [filter.scope, filter.projectId ?? null, filter.from, filter.to, filter.timeZone];
}

// Aggregates only — every result set is bounded (statuses × priorities × types, days in the range, people),
// however many executions there are. Run them on one snapshot (withSnapshot) so the numbers add up.
export const analyticsRepository = {
    // One scan for the summary, by priority and by type (≤ 5 statuses × 5 priorities × 7 types rows).
    async selectExecutionBreakdown(filter: AnalyticsFilter, db: Queryable): Promise<ExecutionBreakdownRow[]> {
        const result = await db.query<ExecutionBreakdownRow>(
            `SELECT e.status, tc.priority, tc.type, COUNT(*)::int AS count
               FROM test_executions e
               LEFT JOIN test_cases tc ON tc.id = e.test_case_id
              WHERE ${isInScope('e')}
                AND (e.status = 'PENDING' OR (${isInRange('e.executed_at')}))
              GROUP BY e.status, tc.priority, tc.type`,
            toParameters(filter),
        );

        return result.rows;
    },

    // Results per day of the range, days without results included.
    async selectTrend(filter: AnalyticsFilter, db: Queryable): Promise<TrendRow[]> {
        const result = await db.query<TrendRow>(
            `WITH daily AS (
                 SELECT (e.executed_at AT TIME ZONE $5)::date AS day, ${RESULT_COUNTS}
                   FROM test_executions e
                  WHERE ${isInScope('e')} AND ${isInRange('e.executed_at')}
                  GROUP BY 1
             )
             SELECT d.day::date::text AS date,
                    COALESCE(daily.passed, 0) AS passed, COALESCE(daily.failed, 0) AS failed,
                    COALESCE(daily.blocked, 0) AS blocked, COALESCE(daily.skipped, 0) AS skipped
               FROM generate_series($3::date::timestamp, $4::date::timestamp, interval '1 day') AS d (day)
               LEFT JOIN daily ON daily.day = d.day::date
              ORDER BY d.day`,
            toParameters(filter),
        );

        return result.rows;
    },

    // Per person: pending work assigned to them (now) and results they recorded (in the range). One row per
    // execution and role it plays, then grouped — a result someone recorded on a case assigned to someone else
    // counts for whoever ran it.
    async selectTesters(filter: AnalyticsFilter, db: Queryable): Promise<TesterRow[]> {
        const result = await db.query<TesterRow>(
            `WITH activity AS (
                 SELECT e.assignee_id AS user_id, e.status
                   FROM test_executions e
                  WHERE ${isInScope('e')} AND e.status = 'PENDING' AND e.assignee_id IS NOT NULL
                 UNION ALL
                 SELECT e.executed_by, e.status
                   FROM test_executions e
                  WHERE ${isInScope('e')} AND ${isInRange('e.executed_at')} AND e.executed_by IS NOT NULL
             )
             SELECT u.id, u.first_name, u.last_name,
                    COUNT(*) FILTER (WHERE e.status = 'PENDING')::int AS pending,
                    COUNT(*) FILTER (WHERE e.status <> 'PENDING')::int AS executed,
                    ${RESULT_COUNTS}
               FROM activity e
               JOIN users u ON u.id = e.user_id
              GROUP BY u.id
              ORDER BY lower(concat_ws(' ', u.first_name, u.last_name)), u.id`,
            toParameters(filter),
        );

        return result.rows;
    },

    // Coverage (test cases that exist now; those of them with a result in the range — a deleted test case's
    // executions have test_case_id NULL) and defects raised in the range.
    async selectTotals(filter: AnalyticsFilter, db: Queryable): Promise<TotalsRow> {
        const result = await db.query<TotalsRow>(
            `SELECT (SELECT COUNT(*)::int FROM test_cases tc WHERE ${isInScope('tc')}) AS total_cases,
                    (SELECT COUNT(DISTINCT e.test_case_id)::int
                       FROM test_executions e
                      WHERE ${isInScope('e')} AND ${isInRange('e.executed_at')}) AS executed_cases,
                    (SELECT COUNT(*)::int
                       FROM defects d
                      WHERE ${isInScope('d')} AND ${isInRange('d.created_at')}) AS defects`,
            toParameters(filter),
        );
        const row = result.rows[0];

        if (!row) {
            throw new Error('Analytics totals returned no row');
        }

        return row;
    },

    // The time zone names this server's AT TIME ZONE accepts — Postgres reads them from its zoneinfo, which
    // differs by host. Without the zoneinfo files that aren't zones: localtime (the host's own zone, so results
    // would depend on the machine), posixrules and Factory.
    async selectTimeZoneNames(db: Queryable = pool): Promise<string[]> {
        const result = await db.query<{ name: string }>(
            `SELECT name FROM pg_timezone_names WHERE name NOT IN ('localtime', 'posixrules', 'Factory')`,
        );

        return result.rows.map((row) => row.name);
    },
};
