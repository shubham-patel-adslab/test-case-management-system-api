// Redis down (PRD: the cache is an optimization): caching is on, but Redis can't be reached — here a closed port.
// What's protected: every cached endpoint still answers from the database (X-Cache: BYPASS), writes still succeed
// although their invalidation can't reach Redis, and the metrics show the failures instead of hiding them.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { cacheMetricsResponseSchema } from '../src/features/metrics/metrics.response.dto.js';
import {
    createTestProject,
    createTestUser,
    deleteTestProjects,
    deleteTestUsers,
    expectBody,
    request,
    startTestServer,
    stopTestServer,
    testProjectBody,
    type TestUser,
} from './support/test-api.js';

// Before the imports above (vi.hoisted), so env.ts reads them when the app loads. Port 1: nothing listens there.
const previous = vi.hoisted(() => {
    const saved = { CACHE_ENABLED: process.env['CACHE_ENABLED'], REDIS_URL: process.env['REDIS_URL'] };
    process.env['CACHE_ENABLED'] = 'true';
    process.env['REDIS_URL'] = 'redis://127.0.0.1:1';

    return saved;
});

let admin: TestUser;

beforeAll(async () => {
    await startTestServer();
    admin = await createTestUser('ADMIN');
});
afterAll(async () => {
    await deleteTestProjects();
    await deleteTestUsers();
    await stopTestServer();

    for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = value;
        }
    }
});

describe('Redis unreachable', () => {
    it('cached endpoints answer from the database (BYPASS), writes succeed, and the metrics show the errors', async () => {
        const project = await createTestProject(admin);
        const today = new Date().toISOString().slice(0, 10);

        for (const path of [`/projects/${project.id}`, `/projects/${project.id}/test-suites`, `/analytics?from=${today}&to=${today}`]) {
            const response = await request('GET', path, { token: admin.token });

            expect(response.status, path).toBe(200);
            expect(response.headers.get('x-cache'), path).toBe('BYPASS');
        }

        const renamed = { ...testProjectBody('renamed'), id: project.id };
        const updated = await request('PUT', `/projects/${project.id}`, { token: admin.token, body: renamed });
        expect(updated.status).toBe(200);
        expect((await request('GET', `/projects/${project.id}`, { token: admin.token })).json).toMatchObject({ name: renamed.name });

        const metrics = expectBody(await request('GET', '/metrics/cache', { token: admin.token }), 200, cacheMetricsResponseSchema);
        expect(metrics.enabled).toBe(true);
        expect(metrics.redisStatus).not.toBe('ready');
        expect(metrics.lastError).not.toBeNull();
        expect(metrics.caches.find((cache) => cache.name === 'project')).toMatchObject({ hits: 0, misses: 0 });
        expect(metrics.caches.find((cache) => cache.name === 'project')?.errors).toBeGreaterThan(0);
        expect(metrics.caches.find((cache) => cache.name === 'project')?.bypasses).toBeGreaterThan(0);
    });
});
