import { pool, toContainsPattern, toOrderBy, type Queryable } from '../../app/database.js';
import {
    TEST_CASE_PRIORITIES,
    type TestCasePriority,
    type TestCaseSortField,
    type TestCaseType,
} from './test-case.constant.js';
import type { ExecutionResult } from '../test-execution/test-execution.constant.js';
import type { TestCaseCreateRequestDto, TestCaseSort } from './test-case.request.dto.js';

// A row exactly as `pg` returns it from the test_cases table.
export type TestCaseRow = {
    id: number;
    project_id: number;
    title: string;
    description: string;
    priority: TestCasePriority;
    type: TestCaseType;
    pre_conditions: string;
    post_conditions: string;
    tags: string[];
    last_result: ExecutionResult | null;
    last_executed_at: Date | null;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
};

export type TestStepRow = {
    id: number;
    test_case_id: number;
    step_order: number;
    action: string;
    expected_result: string;
};

export type TestCaseFields = Pick<
    TestCaseCreateRequestDto,
    'title' | 'description' | 'priority' | 'type' | 'preConditions' | 'postConditions' | 'tags'
>;

export type TestStepFields = TestCaseCreateRequestDto['steps'][number];

// Every filter is optional (undefined = not applied).
export type TestCaseListFilter = {
    search: string | undefined;
    priorities: TestCasePriority[] | undefined;
    types: TestCaseType[] | undefined;
    tags: string[] | undefined;
    suiteId: number | undefined;
    lastResults: ExecutionResult[] | undefined;
};

// Fixed SQL fragments (never request input), so interpolating them is safe.
const TEST_CASE_COLUMNS = `tc.id, tc.project_id, tc.title, tc.description, tc.priority, tc.type,
       tc.pre_conditions, tc.post_conditions, tc.tags, tc.last_result, tc.last_executed_at, tc.created_by,
       tc.created_at, tc.updated_at`;

// NULL parameter = filter not applied: one static statement instead of SQL assembled from strings.
// $1 is the project; filters are $2–$7.
const TEST_CASE_LIST_WHERE = `
     WHERE tc.project_id = $1
       AND ($2::text IS NULL OR tc.title ILIKE $2 OR tc.description ILIKE $2)
       AND ($3::text[] IS NULL OR tc.priority = ANY($3))
       AND ($4::text[] IS NULL OR tc.type = ANY($4))
       AND ($5::text[] IS NULL OR tc.tags && $5)
       AND ($6::int IS NULL
            OR EXISTS (SELECT 1 FROM test_suite_cases tsc WHERE tsc.test_case_id = tc.id AND tsc.test_suite_id = $6))
       AND ($7::text[] IS NULL OR tc.last_result = ANY($7))`;

// Priority sorts by rank (LOW = 1 … CRITICAL = 4), not alphabetically. Built from the constant, not input.
const PRIORITY_RANK = `array_position(ARRAY['${TEST_CASE_PRIORITIES.join("', '")}'], tc.priority)`;

// lastExecutedAt puts never-executed test cases (NULL) last in both directions. Titles compare
// case-insensitively. sort=createdAt:desc is served by idx_test_cases_project_id_created_at_id; title order
// sorts the project's (filtered) rows — cheap at hundreds to a few thousand cases per project.
const SORT_EXPRESSIONS: Record<TestCaseSortField, string> = {
    title: 'lower(tc.title)',
    priority: PRIORITY_RANK,
    type: 'tc.type',
    createdAt: 'tc.created_at',
    updatedAt: 'tc.updated_at',
    lastExecutedAt: 'tc.last_executed_at IS NULL, tc.last_executed_at',
};

function toListParameters(projectId: number, filter: TestCaseListFilter): unknown[] {
    return [
        projectId,
        toContainsPattern(filter.search),
        filter.priorities ?? null,
        filter.types ?? null,
        filter.tags ?? null,
        filter.suiteId ?? null,
        filter.lastResults ?? null,
    ];
}

// INSERT … RETURNING always yields the row.
function firstRowOrThrow<TRow>(rows: TRow[], operation: string): TRow {
    const row = rows[0];

    if (!row) {
        throw new Error(`${operation} returned no row`);
    }

    return row;
}

// Every statement is scoped by project_id as well as the test case id: a test case is only ever reached
// through the project in the URL. `db` defaults to the pool; pass the transaction's client inside
// withTransaction().
export const testCaseRepository = {
    async selectPage(projectId: number, filter: TestCaseListFilter, sort: TestCaseSort, limit: number, offset: number): Promise<TestCaseRow[]> {
        const result = await pool.query<TestCaseRow>(
            `SELECT ${TEST_CASE_COLUMNS}
               FROM test_cases tc
             ${TEST_CASE_LIST_WHERE}
             ${toOrderBy(SORT_EXPRESSIONS, sort, 'tc.id')}
              LIMIT $8 OFFSET $9`,
            [...toListParameters(projectId, filter), limit, offset],
        );

        return result.rows;
    },

    async count(projectId: number, filter: TestCaseListFilter): Promise<number> {
        const result = await pool.query<{ total: number }>(
            `SELECT COUNT(*)::int AS total FROM test_cases tc ${TEST_CASE_LIST_WHERE}`,
            toListParameters(projectId, filter),
        );

        return firstRowOrThrow(result.rows, 'COUNT test_cases').total;
    },

    // `isLocked` (inside a transaction): for recording an execution, which snapshots the title and steps and
    // then writes the test case's last result. FOR NO KEY UPDATE is the lock that later UPDATE needs anyway,
    // taken up front: the test case can't be edited or deleted meanwhile, and two recordings for it run one
    // after the other. (FOR SHARE here deadlocked: two transactions each held it and then both needed the
    // stronger lock for the UPDATE.) Unlike FOR UPDATE, it doesn't block foreign key checks of other tables.
    async selectById(projectId: number, id: number, db: Queryable = pool, isLocked = false): Promise<TestCaseRow | undefined> {
        const result = await db.query<TestCaseRow>(
            `SELECT ${TEST_CASE_COLUMNS} FROM test_cases tc WHERE tc.project_id = $1 AND tc.id = $2 ${isLocked ? 'FOR NO KEY UPDATE' : ''}`,
            [projectId, id],
        );

        return result.rows[0];
    },

    async insert(projectId: number, testCase: TestCaseFields, createdById: string, db: Queryable = pool): Promise<TestCaseRow> {
        const result = await db.query<TestCaseRow>(
            `INSERT INTO test_cases AS tc
                    (project_id, title, description, priority, type, pre_conditions, post_conditions, tags, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING ${TEST_CASE_COLUMNS}`,
            [
                projectId,
                testCase.title,
                testCase.description,
                testCase.priority,
                testCase.type,
                testCase.preConditions,
                testCase.postConditions,
                testCase.tags,
                createdById,
            ],
        );

        return firstRowOrThrow(result.rows, 'INSERT test_case');
    },

    // undefined = no such test case in this project. The UPDATE locks the row until the transaction ends, so
    // concurrent edits of one test case (and its steps and suites) run one after the other.
    async updateById(projectId: number, id: number, testCase: TestCaseFields, db: Queryable = pool): Promise<TestCaseRow | undefined> {
        const result = await db.query<TestCaseRow>(
            `UPDATE test_cases AS tc
                SET title = $3, description = $4, priority = $5, type = $6, pre_conditions = $7,
                    post_conditions = $8, tags = $9, updated_at = now()
              WHERE tc.project_id = $1 AND tc.id = $2
             RETURNING ${TEST_CASE_COLUMNS}`,
            [
                projectId,
                id,
                testCase.title,
                testCase.description,
                testCase.priority,
                testCase.type,
                testCase.preConditions,
                testCase.postConditions,
                testCase.tags,
            ],
        );

        return result.rows[0];
    },

    // false = no such test case in this project. Steps and suite memberships go with it (ON DELETE CASCADE).
    async deleteById(projectId: number, id: number, db: Queryable = pool): Promise<boolean> {
        const result = await db.query('DELETE FROM test_cases WHERE project_id = $1 AND id = $2', [projectId, id]);

        return result.rowCount === 1;
    },

    // The latest result, set in the same transaction as the execution that records it. now() is the
    // transaction's start time, the same value the execution's executed_at gets; the guard keeps the latest
    // when two results for one test case commit out of order. Not a change to the test case's definition, so
    // updated_at stays.
    async updateLastResult(testCaseId: number, result: ExecutionResult, db: Queryable): Promise<void> {
        await db.query(
            `UPDATE test_cases SET last_result = $2, last_executed_at = now()
              WHERE id = $1 AND (last_executed_at IS NULL OR last_executed_at <= now())`,
            [testCaseId, result],
        );
    },

    // Bulk operations: which of `ids` are test cases of this project, locking them until the transaction
    // ends (in id order, so overlapping bulk requests can't deadlock). Checked before anything changes, so a
    // bad id rejects the whole request.
    async lockIdsInProject(projectId: number, ids: number[], db: Queryable): Promise<number[]> {
        const result = await db.query<{ id: number }>(
            `SELECT id FROM test_cases
              WHERE project_id = $1 AND id = ANY($2::int[])
              ORDER BY id
                FOR UPDATE`,
            [projectId, ids],
        );

        return result.rows.map((row) => row.id);
    },

    async updatePriorityByIds(projectId: number, ids: number[], priority: TestCasePriority, db: Queryable): Promise<number> {
        const result = await db.query(
            `UPDATE test_cases SET priority = $3, updated_at = now()
              WHERE project_id = $1 AND id = ANY($2::int[])`,
            [projectId, ids, priority],
        );

        return result.rowCount ?? 0;
    },

    // Steps and suite memberships go with them (ON DELETE CASCADE).
    async deleteByIds(projectId: number, ids: number[], db: Queryable): Promise<number> {
        const result = await db.query('DELETE FROM test_cases WHERE project_id = $1 AND id = ANY($2::int[])', [projectId, ids]);

        return result.rowCount ?? 0;
    },

    async selectSteps(testCaseId: number, db: Queryable = pool): Promise<TestStepRow[]> {
        const result = await db.query<TestStepRow>(
            `SELECT id, test_case_id, step_order, action, expected_result
               FROM test_steps
              WHERE test_case_id = $1
              ORDER BY step_order`,
            [testCaseId],
        );

        return result.rows;
    },

    // Steps are replaced as a whole (api-requirements §9: executions will keep their own copy, so this
    // never rewrites history). The array order becomes step_order 1..n.
    async replaceSteps(testCaseId: number, steps: TestStepFields[], db: Queryable = pool): Promise<void> {
        await db.query('DELETE FROM test_steps WHERE test_case_id = $1', [testCaseId]);
        await db.query(
            `INSERT INTO test_steps (test_case_id, step_order, action, expected_result)
             SELECT $1, s.step_order, s.action, s.expected_result
               FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS s (action, expected_result, step_order)`,
            [testCaseId, steps.map((step) => step.action), steps.map((step) => step.expectedResult)],
        );
    },
};
