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
