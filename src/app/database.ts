import pg from 'pg';

import { env } from './env.js';

// All TCMS tables live in the `tcms` schema, not `public`. Setting search_path on every pooled connection
// keeps SQL unqualified (`FROM projects`). Must match `--schema` in package.json's migrate script.
const DATABASE_SCHEMA = 'tcms';

export const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    options: `-c search_path=${DATABASE_SCHEMA}`,
});

// An idle pooled client can lose its connection (e.g. Postgres restarts). Without a listener, pg
// re-emits that as an unhandled 'error' event and crashes the process; the pool already discards the
// broken client, so logging is enough.
pool.on('error', (error) => {
    console.error('Unexpected error on idle PostgreSQL client', error);
});

export async function checkDatabaseConnection(): Promise<void> {
    await pool.query('SELECT 1');
}

// Anything repositories can run SQL on: the pool, or the client of an open transaction.
export type Queryable = Pick<pg.PoolClient, 'query'>;

// Runs `work` in one transaction on one pooled client: COMMIT if it resolves, ROLLBACK if it throws (the
// error is rethrown). Repository calls inside must receive `client`, or they'd run outside the transaction.
export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    // A client whose ROLLBACK failed is in an unknown state: passing the error to release() destroys it
    // instead of returning it to the pool.
    let brokenClientError: Error | undefined;

    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');

        return result;
    } catch (error) {
        try {
            await client.query('ROLLBACK');
        } catch (rollbackError) {
            brokenClientError = rollbackError instanceof Error ? rollbackError : new Error('ROLLBACK failed');
        }

        throw error;
    } finally {
        client.release(brokenClientError);
    }
}

const PG_UNIQUE_VIOLATION = '23505';

// For UPDATEs, where ON CONFLICT isn't available: lets a repository's caller turn a specific UNIQUE
// constraint violation into a 409 instead of a 500.
export function isUniqueViolation(error: unknown, constraintName: string): boolean {
    return error instanceof pg.DatabaseError
        && error.code === PG_UNIQUE_VIOLATION
        && error.constraint === constraintName;
}
