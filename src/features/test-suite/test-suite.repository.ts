import { pool, toOrderBy, type Queryable } from '../../app/database.js';
import type { TestCasePriority, TestCaseType } from '../test-case/test-case.constant.js';
import type { TestSuiteSortField } from './test-suite.constant.js';
import type { TestSuiteCreateRequestDto, TestSuiteSort } from './test-suite.request.dto.js';

// A test_suites row with its number of test cases, as `pg` returns it.
export type TestSuiteRow = {
    id: number;
    project_id: number;
    name: string;
    description: string;
    test_case_count: number;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
};

// A test case inside a suite, at its 1-based position (row_number over sequence_order, so no gaps).
export type TestSuiteCaseRow = {
    id: number;
    position: number;
    title: string;
    priority: TestCasePriority;
    type: TestCaseType;
};

export type SuiteCaseLink = {
    suiteId: number;
    testCaseId: number;
};

type TestSuiteFields = Pick<TestSuiteCreateRequestDto, 'name' | 'description'>;

// Suite names are unique per project, ignoring case (a unique index on (project_id, lower(name))).
export const TEST_SUITE_NAME_UNIQUE_INDEX = 'uq_test_suites_project_id_lower_name';

// Fixed SQL fragments (never request input), so interpolating them is safe. The count is one indexed
// lookup per suite (uq_test_suite_cases_test_suite_id_test_case_id), inside the same query.
const TEST_SUITE_COLUMNS = `s.id, s.project_id, s.name, s.description,
       (SELECT COUNT(*)::int FROM test_suite_cases c WHERE c.test_suite_id = s.id) AS test_case_count,
       s.created_by, s.created_at, s.updated_at`;

// Names compare case-insensitively; name order is served by the unique index on (project_id, lower(name)).
const SORT_EXPRESSIONS: Record<TestSuiteSortField, string> = {
    name: 'lower(s.name)',
    createdAt: 's.created_at',
    updatedAt: 's.updated_at',
};

// INSERT … RETURNING id always yields the row unless ON CONFLICT skipped it.
function firstRowOrThrow<TRow>(rows: TRow[], operation: string): TRow {
    const row = rows[0];

    if (!row) {
        throw new Error(`${operation} returned no row`);
    }

    return row;
}

// Suites and their content (test_suite_cases: which test cases, in which order). Every statement is scoped
// by project as well as the suite id. The link functions are also used by the test case feature (a test
// case's suiteIds, bulk assign). `db` defaults to the pool; pass the transaction's client inside
// withTransaction().
export const testSuiteRepository = {
    async selectPage(projectId: number, sort: TestSuiteSort, limit: number, offset: number): Promise<TestSuiteRow[]> {
        const result = await pool.query<TestSuiteRow>(
            `SELECT ${TEST_SUITE_COLUMNS}
               FROM test_suites s
              WHERE s.project_id = $1
              ${toOrderBy(SORT_EXPRESSIONS, sort, 's.id')}
              LIMIT $2 OFFSET $3`,
            [projectId, limit, offset],
        );

        return result.rows;
    },

    async count(projectId: number): Promise<number> {
        const result = await pool.query<{ total: number }>('SELECT COUNT(*)::int AS total FROM test_suites WHERE project_id = $1', [projectId]);

        return firstRowOrThrow(result.rows, 'COUNT test_suites').total;
    },

    async selectById(projectId: number, id: number, db: Queryable = pool): Promise<TestSuiteRow | undefined> {
        const result = await db.query<TestSuiteRow>(
            `SELECT ${TEST_SUITE_COLUMNS} FROM test_suites s WHERE s.project_id = $1 AND s.id = $2`,
            [projectId, id],
        );

        return result.rows[0];
    },

    // Returns the new id, or undefined when the project already has a suite with that name (ignoring case).
    // ON CONFLICT makes the uniqueness check and the insert one atomic statement: no check-then-insert race.
    async insert(projectId: number, suite: TestSuiteFields, createdById: string, db: Queryable = pool): Promise<number | undefined> {
        const result = await db.query<{ id: number }>(
            `INSERT INTO test_suites (project_id, name, description, created_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (project_id, lower(name)) DO NOTHING
             RETURNING id`,
            [projectId, suite.name, suite.description, createdById],
        );

        return result.rows[0]?.id;
    },

    // false = no such suite in this project. A name taken by another suite of the project throws a unique
    // violation on TEST_SUITE_NAME_UNIQUE_INDEX (UPDATE has no ON CONFLICT).
    async updateById(projectId: number, id: number, suite: TestSuiteFields, db: Queryable = pool): Promise<boolean> {
        const result = await db.query(
            `UPDATE test_suites SET name = $3, description = $4, updated_at = now()
              WHERE project_id = $1 AND id = $2`,
            [projectId, id, suite.name, suite.description],
        );

        return result.rowCount === 1;
    },

    // false = no such suite in this project. Its links go with it (ON DELETE CASCADE); the test cases stay.
    async deleteById(projectId: number, id: number, db: Queryable = pool): Promise<boolean> {
        const result = await db.query('DELETE FROM test_suites WHERE project_id = $1 AND id = $2', [projectId, id]);

        return result.rowCount === 1;
    },

    // Which of `suiteIds` are suites of this project, locking them until the transaction ends. The lock
    // serializes everything that changes a suite's content, so two concurrent appends can't both compute the
    // same next sequence_order. Locked in id order, so two transactions locking overlapping sets can't
    // deadlock.
    async lockIdsInProject(projectId: number, suiteIds: number[], db: Queryable): Promise<number[]> {
        const result = await db.query<{ id: number }>(
            `SELECT id FROM test_suites
              WHERE project_id = $1 AND id = ANY($2::int[])
              ORDER BY id
                FOR UPDATE`,
            [projectId, suiteIds],
        );

        return result.rows.map((row) => row.id);
    },

    // The suite's test cases in order.
    async selectCases(suiteId: number, db: Queryable = pool): Promise<TestSuiteCaseRow[]> {
        const result = await db.query<TestSuiteCaseRow>(
            `SELECT tc.id, row_number() OVER (ORDER BY c.sequence_order)::int AS position, tc.title, tc.priority, tc.type
               FROM test_suite_cases c
               JOIN test_cases tc ON tc.id = c.test_case_id
              WHERE c.test_suite_id = $1
              ORDER BY c.sequence_order`,
            [suiteId],
        );

        return result.rows;
    },

    async selectCaseIds(suiteId: number, db: Queryable): Promise<number[]> {
        const result = await db.query<{ test_case_id: number }>(
            'SELECT test_case_id FROM test_suite_cases WHERE test_suite_id = $1',
            [suiteId],
        );

        return result.rows.map((row) => row.test_case_id);
    },

    // Appends each test case to the end of its suite (sequence_order = current last + 1, in the order given).
    // Pairs that already exist are skipped, so they keep their position. The composite foreign keys reject a
    // suite or test case of another project, whatever the caller checked. Lock the suites first
    // (lockIdsInProject). Returns how many links were added.
    async insertLinks(projectId: number, links: SuiteCaseLink[], createdById: string, db: Queryable): Promise<number> {
        const result = await db.query(
            `INSERT INTO test_suite_cases (project_id, test_suite_id, test_case_id, sequence_order, created_by)
             SELECT $1, l.suite_id, l.test_case_id,
                    COALESCE((SELECT max(x.sequence_order) FROM test_suite_cases x WHERE x.test_suite_id = l.suite_id), 0)
                      + row_number() OVER (PARTITION BY l.suite_id ORDER BY l.position),
                    $4
               FROM unnest($2::int[], $3::int[]) WITH ORDINALITY AS l (suite_id, test_case_id, position)
              WHERE NOT EXISTS (
                        SELECT 1 FROM test_suite_cases e
                         WHERE e.test_suite_id = l.suite_id AND e.test_case_id = l.test_case_id)`,
            [projectId, links.map((link) => link.suiteId), links.map((link) => link.testCaseId), createdById],
        );

        return result.rowCount ?? 0;
    },

    // Removes one test case from the suite (the test case itself stays). false = it wasn't in the suite. The
    // gap it leaves in sequence_order is harmless: positions are computed from the order.
    async deleteLink(suiteId: number, testCaseId: number, db: Queryable = pool): Promise<boolean> {
        const result = await db.query(
            'DELETE FROM test_suite_cases WHERE test_suite_id = $1 AND test_case_id = $2',
            [suiteId, testCaseId],
        );

        return result.rowCount === 1;
    },

    // Removes the test case from every suite not in `keepSuiteIds`. The test case itself is untouched.
    async deleteLinksOfCaseExcept(testCaseId: number, keepSuiteIds: number[], db: Queryable): Promise<void> {
        await db.query(
            'DELETE FROM test_suite_cases WHERE test_case_id = $1 AND NOT (test_suite_id = ANY($2::int[]))',
            [testCaseId, keepSuiteIds],
        );
    },

    // Renumbers the suite 1..n in the order given (which must be exactly the suite's test cases). One
    // statement: the deferrable unique constraint on (suite, sequence_order) is checked at its end, so
    // positions can swap.
    async reorder(suiteId: number, testCaseIds: number[], db: Queryable): Promise<void> {
        await db.query(
            `UPDATE test_suite_cases c
                SET sequence_order = o.position
               FROM unnest($2::int[]) WITH ORDINALITY AS o (test_case_id, position)
              WHERE c.test_suite_id = $1 AND c.test_case_id = o.test_case_id`,
            [suiteId, testCaseIds],
        );
    },

    // Suite ids per test case, ascending — one query for a whole page of test cases (no N+1). Test cases in
    // no suite are absent from the map.
    async selectSuiteIdsByCase(testCaseIds: number[], db: Queryable = pool): Promise<Map<number, number[]>> {
        const result = await db.query<{ test_case_id: number; suite_ids: number[] }>(
            `SELECT test_case_id, array_agg(test_suite_id ORDER BY test_suite_id) AS suite_ids
               FROM test_suite_cases
              WHERE test_case_id = ANY($1::int[])
              GROUP BY test_case_id`,
            [testCaseIds],
        );

        return new Map(result.rows.map((row) => [row.test_case_id, row.suite_ids]));
    },
};
