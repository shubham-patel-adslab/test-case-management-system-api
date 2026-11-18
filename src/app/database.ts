import pg from 'pg';

import type { Sort, SortDirection } from '../shared/request/sort.schema.js';
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

// A read-only transaction whose queries all see the same snapshot (REPEATABLE READ): several aggregates read
// one after another still add up, even while results are being recorded. SET TRANSACTION must come first.
export async function withSnapshot<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    return withTransaction(async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');

        return work(client);
    });
}

const PG_UNIQUE_VIOLATION = '23505';
const PG_FOREIGN_KEY_VIOLATION = '23503';

// For UPDATEs, where ON CONFLICT isn't available: lets a repository's caller turn a specific UNIQUE
// constraint violation into a 409 instead of a 500.
export function isUniqueViolation(error: unknown, constraintName: string): boolean {
    return error instanceof pg.DatabaseError
        && error.code === PG_UNIQUE_VIOLATION
        && error.constraint === constraintName;
}

// A DELETE refused by an ON DELETE RESTRICT foreign key (other rows still reference the row): lets the
// caller answer 409 for a specific constraint instead of 500.
export function isForeignKeyViolation(error: unknown, constraintNames: readonly string[]): boolean {
    return error instanceof pg.DatabaseError
        && error.code === PG_FOREIGN_KEY_VIOLATION
        && error.constraint !== undefined
        && constraintNames.includes(error.constraint);
}

// An ILIKE pattern matching `search` anywhere, or null when there is no search (the "NULL = filter not
// applied" convention of the list queries). `%` and `_` typed by the user are literal characters, not
// wildcards.
export function toContainsPattern(search: string | undefined): string | null {
    return search === undefined ? null : `%${search.replace(/[\\%_]/g, '\\$&')}%`;
}

const SORT_KEYWORDS: Record<SortDirection, string> = { asc: 'ASC', desc: 'DESC' };

// A list's ORDER BY from its fixed map of SQL expressions — never request input. The direction applies to the
// expression's last term (so 'x IS NULL, x' keeps NULLs last both ways). `tieBreaker` (a unique column, same
// direction) makes the order total, so a page boundary never repeats or skips a row.
export function toOrderBy<TField extends string>(expressions: Record<TField, string>, sort: Sort<TField>, tieBreaker: string): string {
    const direction = SORT_KEYWORDS[sort.direction];

    return `ORDER BY ${expressions[sort.field]} ${direction}, ${tieBreaker} ${direction}`;
}

