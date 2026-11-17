import { pool, type Queryable } from '../../app/database.js';

// A suite run with its creator's name, as `pg` returns it.
export type SuiteRunRow = {
    id: number;
    project_id: number;
    test_suite_id: number | null;
    suite_name: string;
    creator_id: string | null;
    creator_first_name: string | null;
    creator_last_name: string | null;
    created_at: Date;
};

// Fixed SQL fragment (never request input). LEFT JOIN: the creator is NULL once their user row is removed.
const SUITE_RUN_SELECT = `
    SELECT r.id, r.project_id, r.test_suite_id, r.suite_name,
           u.id AS creator_id, u.first_name AS creator_first_name, u.last_name AS creator_last_name, r.created_at
      FROM suite_runs r
      LEFT JOIN users u ON u.id = r.created_by`;

function firstRowOrThrow<TRow>(rows: TRow[], operation: string): TRow {
    const row = rows[0];

    if (!row) {
        throw new Error(`${operation} returned no row`);
    }

    return row;
}

// Every statement is scoped by project. `db` defaults to the pool; pass the transaction's client inside
// withTransaction().
export const suiteRunRepository = {
    // The suite's name is snapshotted, so the run keeps it after the suite is renamed or deleted.
    async insert(projectId: number, suite: { id: number; name: string }, createdById: string, db: Queryable): Promise<number> {
        const result = await db.query<{ id: number }>(
            `INSERT INTO suite_runs (project_id, test_suite_id, suite_name, created_by)
             VALUES ($1, $2, $3, $4)
             RETURNING id`,
            [projectId, suite.id, suite.name, createdById],
        );

        return firstRowOrThrow(result.rows, 'INSERT suite_run').id;
    },

    async selectById(projectId: number, id: number, db: Queryable = pool): Promise<SuiteRunRow | undefined> {
        const result = await db.query<SuiteRunRow>(`${SUITE_RUN_SELECT} WHERE r.project_id = $1 AND r.id = $2`, [projectId, id]);

        return result.rows[0];
    },

    // A suite's runs, newest first (idx_suite_runs_test_suite_id_created_at).
    async selectPageBySuite(projectId: number, suiteId: number, limit: number, offset: number): Promise<SuiteRunRow[]> {
        const result = await pool.query<SuiteRunRow>(
            `${SUITE_RUN_SELECT}
              WHERE r.project_id = $1 AND r.test_suite_id = $2
              ORDER BY r.created_at DESC, r.id DESC
              LIMIT $3 OFFSET $4`,
            [projectId, suiteId, limit, offset],
        );

        return result.rows;
    },

    async countBySuite(projectId: number, suiteId: number): Promise<number> {
        const result = await pool.query<{ total: number }>(
            'SELECT COUNT(*)::int AS total FROM suite_runs WHERE project_id = $1 AND test_suite_id = $2',
            [projectId, suiteId],
        );

        return firstRowOrThrow(result.rows, 'COUNT suite_runs').total;
    },
};
