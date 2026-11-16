import pg from 'pg';

import { env } from './env.js';

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

// An idle pooled client can lose its connection (e.g. Postgres restarts). Without a listener, pg
// re-emits that as an unhandled 'error' event and crashes the process; the pool already discards the
// broken client, so logging is enough.
pool.on('error', (error) => {
    console.error('Unexpected error on idle PostgreSQL client', error);
});

export async function checkDatabaseConnection(): Promise<void> {
    await pool.query('SELECT 1');
}
