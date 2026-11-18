import type { Server } from 'node:http';

import { app } from './app/app.js';
import { closeCache, connectCache } from './app/cache.js';
import { checkDatabaseConnection, pool } from './app/database.js';
import { env } from './app/env.js';
import { authorizationService } from './features/authorization/authorization.service.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

// A bug escaped every handler: the process may be in an inconsistent state, so log and exit rather
// than keep serving.
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection', reason);
    process.exit(1);
});
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception', error);
    process.exit(1);
});

try {
    await checkDatabaseConnection();
} catch (error) {
    console.error('Cannot connect to the database — check DATABASE_URL and that PostgreSQL is running.', error);
    process.exit(1);
}

try {
    await authorizationService.assertCodesExist();
} catch (error) {
    console.error('Authorization data is incomplete — run `npm run migrate:up`.', error);
    process.exit(1);
}

// Not fatal: without Redis every request reads the database (X-Cache: BYPASS), and ioredis keeps reconnecting.
const cacheState = await connectCache();
const CACHE_STATE_MESSAGE = {
    disabled: 'OFF (CACHE_ENABLED=false)',
    connected: 'on (Redis connected)',
    unreachable: 'on, but Redis is unreachable — requests read the database until it is back',
};

const server = app.listen(env.PORT, (error) => {
    if (error) {
        console.error(`Cannot listen on port ${env.PORT}`, error);
        process.exit(1);
    }

    const baseUrl = `http://localhost:${env.PORT}/api`;
    console.info(`TCMS API listening on port ${env.PORT} (${env.NODE_ENV})`);
    console.info(`  Docs:   ${baseUrl}/docs`);
    console.info(`  Health: ${baseUrl}/health`);
    console.info(`  Rate limiting: ${env.RATE_LIMIT_ENABLED ? 'on' : 'OFF (RATE_LIMIT_ENABLED=false)'}`);
    console.info(`  Caching: ${CACHE_STATE_MESSAGE[cacheState]}`);
});

function closeServer(httpServer: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
    });
}

let isShuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (isShuttingDown) {
        return;
    }
    isShuttingDown = true;

    console.info(`${signal} received — shutting down`);

    // A stuck request or connection must not keep the process alive forever. unref() lets the process
    // exit normally before the timer fires.
    setTimeout(() => {
        console.error(`Shutdown did not finish within ${SHUTDOWN_TIMEOUT_MS} ms — forcing exit`);
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    try {
        await closeServer(server); // stops new connections, waits for in-flight requests
        await pool.end();
        await closeCache();
        console.info('Shutdown complete');
    } catch (error) {
        console.error('Error during shutdown', error);
        process.exit(1);
    }
}

// Fire-and-forget on purpose: shutdown() handles its own errors and exits on failure.
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
