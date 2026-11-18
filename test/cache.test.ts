// Redis caching (PRD Backend Req §1): analytics 15 min, test suite lists 30 min, project details 1 hour, with
// invalidation on writes. What's protected: a cached answer is served (X-Cache: HIT), a write is visible on the very
// next read (no stale data after a change), access is still checked on every request, and the metrics count it.
// Needs Redis (REDIS_URL); without it the file is skipped. Caching is turned on here whatever .env says.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { pool } from '../src/app/database.js';
import { analyticsResponseSchema, type AnalyticsResponseDto } from '../src/features/analytics/analytics.response.dto.js';
import { cacheMetricsResponseSchema, type CacheMetricsResponseDto } from '../src/features/metrics/metrics.response.dto.js';
import { projectDetailsResponseSchema, type ProjectDetailsResponseDto } from '../src/features/project/project.response.dto.js';
import { testCaseDetailsResponseSchema } from '../src/features/test-case/test-case.response.dto.js';
import { testSuitePageResponseSchema } from '../src/features/test-suite/test-suite.response.dto.js';
import {
    createTestProject,
    createTestUser,
    deleteTestProjects,
    deleteTestUsers,
    expectBody,
    expectError,
    request,
    startTestServer,
    stopTestServer,
    testProjectBody,
    type TestResponse,
    type TestUser,
} from './support/test-api.js';

// Before the imports above (vi.hoisted), so env.ts reads it when the app loads. Without REDIS_URL, caching must be
// off or the app refuses to start.
const environment = vi.hoisted(() => {
    const previous = process.env['CACHE_ENABLED'];
    const hasRedis = Boolean(process.env['REDIS_URL']);
    process.env['CACHE_ENABLED'] = hasRedis ? 'true' : 'false';

    return { previous, hasRedis };
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

    if (environment.previous === undefined) {
        delete process.env['CACHE_ENABLED'];
    } else {
        process.env['CACHE_ENABLED'] = environment.previous;
    }
});

function cacheStatus(response: TestResponse): string | null {
    return response.headers.get('x-cache');
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

async function getProject(caller: TestUser, projectId: number): Promise<{ status: string | null; project: ProjectDetailsResponseDto }> {
    const response = await request('GET', `/projects/${projectId}`, { token: caller.token });

    return { status: cacheStatus(response), project: expectBody(response, 200, projectDetailsResponseSchema) };
}

async function getAnalytics(caller: TestUser, query: string): Promise<{ status: string | null; analytics: AnalyticsResponseDto }> {
    const response = await request('GET', `/analytics?from=${today()}&to=${today()}${query}`, { token: caller.token });

    return { status: cacheStatus(response), analytics: expectBody(response, 200, analyticsResponseSchema) };
}

async function getMetrics(): Promise<CacheMetricsResponseDto> {
    return expectBody(await request('GET', '/metrics/cache', { token: admin.token }), 200, cacheMetricsResponseSchema);
}

async function createCase(projectId: number, suiteIds: number[] = []): Promise<number> {
    const body = {
        title: 'Cached case', description: '', priority: 'HIGH', type: 'API', preConditions: '', postConditions: '', tags: [],
        steps: [{ action: 'Do it', expectedResult: 'It works' }], suiteIds,
    };

    return expectBody(await request('POST', `/projects/${projectId}/test-cases`, { token: admin.token, body }), 201, testCaseDetailsResponseSchema).id;
}

async function runAdHoc(caller: TestUser, projectId: number, testCaseId: number, status: string): Promise<void> {
    const response = await request('POST', `/projects/${projectId}/test-executions`, { token: caller.token, body: { testCaseId, status } });
    expect(response.status, response.text).toBe(201);
}

describe.skipIf(!environment.hasRedis)(environment.hasRedis ? 'Redis caching' : 'Redis caching (skipped: REDIS_URL not set)', () => {
    // The team shows each member's name and status, so the project's entry depends on its users too.
    it('project details: MISS then HIT; a project update and a member\'s change are visible on the next read', async () => {
        const tester = await createTestUser('TESTER');
        const project = await createTestProject(admin, [tester.id]);

        expect((await getProject(admin, project.id)).status).toBe('MISS');
        const cached = await getProject(admin, project.id);
        expect(cached.status).toBe('HIT');
        // Another reader with access gets the same entry.
        expect((await getProject(tester, project.id)).status).toBe('HIT');

        const renamed = { ...testProjectBody('renamed', [tester.id]), id: project.id };
        expect((await request('PUT', `/projects/${project.id}`, { token: admin.token, body: renamed })).status).toBe(200);
        const afterUpdate = await getProject(admin, project.id);
        expect(afterUpdate).toMatchObject({ status: 'MISS', project: { name: renamed.name } });

        const userBody = { id: tester.id, firstName: 'Renamed', lastName: 'Tester', email: tester.email, roleCode: 'TESTER' };
        expect((await request('PUT', `/users/${tester.id}`, { token: admin.token, body: userBody })).status).toBe(200);
        const afterRename = await getProject(admin, project.id);
        expect(afterRename.status).toBe('MISS');
        expect(afterRename.project.members.find((member) => member.id === tester.id)?.firstName).toBe('Renamed');

        expect((await request('PATCH', `/users/${tester.id}/status`, { token: admin.token, body: { status: 'INACTIVE' } })).status).toBe(200);
        expect((await getProject(admin, project.id)).project.members.find((member) => member.id === tester.id)?.status).toBe('INACTIVE');
    });

    // The cache holds data, never decisions: who may read is checked before it on every request. (The team is
    // changed in SQL here, past the API, so the entry is still there.)
    it('access is checked on every request: a removed member gets 404 although the entry is cached', async () => {
        const tester = await createTestUser('TESTER');
        const project = await createTestProject(admin, [tester.id]);
        await getProject(tester, project.id);
        expect((await getProject(tester, project.id)).status).toBe('HIT');

        await pool.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [project.id, tester.id]);

        expectError(await request('GET', `/projects/${project.id}`, { token: tester.token }), 404, 'NOT_FOUND');
        expect((await getProject(admin, project.id)).status).toBe('HIT');
    });

    // One entry per page and sort; suite writes and test case writes (counts) invalidate the project's lists.
    it('test suite lists: cached per page; a new suite and a test case joining it are visible on the next read', async () => {
        const project = await createTestProject(admin);
        const listPath = `/projects/${project.id}/test-suites`;
        const list = async (query = '') => {
            const response = await request('GET', `${listPath}${query}`, { token: admin.token });

            return { status: cacheStatus(response), page: expectBody(response, 200, testSuitePageResponseSchema) };
        };

        expect((await list()).status).toBe('MISS');
        expect((await list()).status).toBe('HIT');
        expect((await list('?pageSize=1')).status).toBe('MISS');

        const suite = await request('POST', listPath, { token: admin.token, body: { name: 'Smoke', description: '' } });
        const suiteId = (suite.json as { id: number }).id;
        expect(await list()).toMatchObject({ status: 'MISS', page: { totalItems: 1, items: [{ name: 'Smoke', testCaseCount: 0 }] } });

        const testCaseId = await createCase(project.id, [suiteId]);
        expect((await list()).page.items[0]?.testCaseCount).toBe(1);

        expect((await request('DELETE', `/projects/${project.id}/test-cases/${testCaseId}`, { token: admin.token })).status).toBe(204);
        expect(await list()).toMatchObject({ status: 'MISS', page: { items: [{ testCaseCount: 0 }] } });
    });

    // The dashboard spans every project the caller may read: a result in any of them, or joining a team, changes
    // which numbers are right — and the next read shows them.
    it('analytics: one entry per range and resolved time zone; a new result or a new project is visible on the next read', async () => {
        const tester = await createTestUser('TESTER');
        const own = await createTestProject(admin, [tester.id]);
        const testCaseId = await createCase(own.id);
        await runAdHoc(tester, own.id, testCaseId, 'PASS');

        const first = await getAnalytics(tester, '&timeZone=Asia/Kolkata');
        expect(first.status).toBe('MISS');
        expect(first.analytics.summary).toMatchObject({ passed: 1, failed: 0 });

        // The old name of the same zone shares the entry, and the answer still echoes the name sent.
        const alias = await getAnalytics(tester, '&timeZone=Asia/Calcutta');
        expect(alias.status).toBe('HIT');
        expect(alias.analytics.range.timeZone).toBe('Asia/Calcutta');
        expect(alias.analytics.generatedAt).toBe(first.analytics.generatedAt);

        await runAdHoc(tester, own.id, testCaseId, 'FAIL');
        expect(await getAnalytics(tester, '&timeZone=Asia/Kolkata')).toMatchObject({ status: 'MISS', analytics: { summary: { passed: 1, failed: 1 } } });

        // Joining another project's team: a different set of projects, a different entry.
        const other = await createTestProject(admin);
        await runAdHoc(admin, other.id, await createCase(other.id), 'BLOCKED');
        expect((await getAnalytics(tester, '')).analytics.summary.blocked).toBe(0);
        const joined = { ...testProjectBody('joined', [tester.id]), id: other.id };
        expect((await request('PUT', `/projects/${other.id}`, { token: admin.token, body: joined })).status).toBe(200);
        expect(await getAnalytics(tester, '')).toMatchObject({ status: 'MISS', analytics: { summary: { blocked: 1 } } });

        // The admin's dashboard covers every project, so a result in any of them invalidates it.
        await getAnalytics(admin, '');
        expect((await getAnalytics(admin, '')).status).toBe('HIT');
        await runAdHoc(tester, own.id, testCaseId, 'SKIPPED');
        expect((await getAnalytics(admin, '')).status).toBe('MISS');
    });

    // PRD Live Demo: "performance metrics showing caching effectiveness".
    it('metrics: hits and misses per cache, with times; admins only', async () => {
        const project = await createTestProject(admin);
        const before = await getMetrics();
        await getProject(admin, project.id);
        await getProject(admin, project.id);
        const after = await getMetrics();

        expect(after).toMatchObject({ enabled: true, redisStatus: 'ready' });
        expect(after.caches.map((cache) => [cache.name, cache.ttlSeconds])).toEqual([['analytics', 900], ['test-suite-list', 1800], ['project', 3600]]);
        const [projectBefore, projectAfter] = [before, after].map((metrics) => metrics.caches.find((cache) => cache.name === 'project'));
        expect(projectAfter?.hits).toBe((projectBefore?.hits ?? 0) + 1);
        expect(projectAfter?.misses).toBe((projectBefore?.misses ?? 0) + 1);
        expect(projectAfter?.hitRate).toBeGreaterThan(0);
        expect(projectAfter?.averageHitMs).not.toBeNull();
        expect(projectAfter?.averageMissMs).not.toBeNull();

        expectError(await request('GET', '/metrics/cache', { token: (await createTestUser('TEST_LEAD')).token }), 403, 'FORBIDDEN');
    });
});
