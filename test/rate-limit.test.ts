// Rate limits (PRD Backend Req §2, api-requirements §7). The other test files run with RATE_LIMIT_ENABLED=false;
// this one turns the limits on before the app is imported, so it sees them as a server does. What's protected:
// the PRD's numbers, who shares a budget (sign-in and invitation-accept per IP; the rest per user, per group), and
// that a 429 is the standard error envelope with the headers the UI uses to say when to retry.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
    createTestProject,
    createTestUser,
    deleteTestProjects,
    deleteTestUsers,
    expectError,
    request,
    startTestServer,
    stopTestServer,
    type TestResponse,
    type TestUser,
} from './support/test-api.js';

// Runs before the imports above (vi.hoisted), so env.ts reads it when the app loads.
const previousRateLimitEnabled = vi.hoisted(() => {
    const previous = process.env['RATE_LIMIT_ENABLED'];
    process.env['RATE_LIMIT_ENABLED'] = 'true';

    return previous;
});

beforeAll(startTestServer);
afterAll(async () => {
    await deleteTestProjects();
    await deleteTestUsers();
    await stopTestServer();

    if (previousRateLimitEnabled === undefined) {
        delete process.env['RATE_LIMIT_ENABLED'];
    } else {
        process.env['RATE_LIMIT_ENABLED'] = previousRateLimitEnabled;
    }
});

function remaining(response: TestResponse): string | null {
    return response.headers.get('ratelimit-remaining');
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

describe('Sign-in and invitation-accept: 5 per 15 minutes per IP, one shared budget', () => {
    // Brute-forcing passwords or invitation tokens is what this limit stops: every attempt counts, wrong or right,
    // and once spent even the right password waits. Signed-in routes like /auth/me aren't part of it.
    it('the 6th attempt is a 429 with Retry-After, whichever of the two routes it hits', async () => {
        const user = await createTestUser('TESTER');
        const signIn = (password: string) => request('POST', '/auth/sign-in', { body: { email: user.email, password } });
        const accept = () => request('POST', '/invitations/accept', { body: { token: 'not-a-real-token', password: 'Password-123' } });

        const first = await signIn('wrong-password');
        expect(first.status).toBe(401);
        expect(first.headers.get('ratelimit-limit')).toBe('5');
        expect(first.headers.get('ratelimit-policy')).toBe('5;w=900');
        expect(remaining(first)).toBe('4');

        expect(remaining(await signIn('wrong-password'))).toBe('3');
        expect(remaining(await signIn(user.password))).toBe('2');
        expect(remaining(await accept())).toBe('1');
        expect(remaining(await accept())).toBe('0');

        const limited = await signIn(user.password);
        expectError(limited, 429, 'TOO_MANY_REQUESTS');
        const retryAfterSeconds = Number(limited.headers.get('retry-after'));
        expect(retryAfterSeconds).toBeGreaterThan(0);
        expect(retryAfterSeconds).toBeLessThanOrEqual(900);
        expectError(await accept(), 429, 'TOO_MANY_REQUESTS');

        const me = await request('GET', '/auth/me', { token: user.token });
        expect(me.status).toBe(200);
        expect(me.headers.get('ratelimit-limit')).toBeNull();
    });
});

describe('Signed-in groups: per user', () => {
    // Per user, not per IP: one heavy user (or a script) can't use up a whole office's budget behind one NAT.
    it('analytics: the 51st request in an hour is a 429 for that user only; other groups are separate budgets', async () => {
        const [heavy, colleague] = await Promise.all([createTestUser('ADMIN'), createTestUser('ADMIN')]);
        const project = await createTestProject(heavy);
        const analytics = (caller: TestUser) => request('GET', `/analytics?from=${today()}&to=${today()}`, { token: caller.token });

        for (let count = 1; count <= 50; count++) {
            const response = await analytics(heavy);
            expect(response.status, `request ${count}`).toBe(200);
        }

        expectError(await analytics(heavy), 429, 'TOO_MANY_REQUESTS');

        const colleagueResponse = await analytics(colleague);
        expect(colleagueResponse.status).toBe(200);
        expect(remaining(colleagueResponse)).toBe('49');

        const testCases = await request('GET', `/projects/${project.id}/test-cases`, { token: heavy.token });
        expect(testCases.status).toBe(200);
        expect(testCases.headers.get('ratelimit-limit')).toBe('100');
    });

    // Which routes belong to which PRD group: test cases 100/h; executions, their defects and attachments, suite
    // runs and downloads share 200/h; projects and suites have no limit. Each request counts once.
    it('routes count toward the right group; unlimited routes carry no RateLimit headers', async () => {
        const user = await createTestUser('ADMIN');
        const project = await createTestProject(user);
        const suite = await request('POST', `/projects/${project.id}/test-suites`, { token: user.token, body: { name: 'Smoke', description: '' } });
        expect(suite.status).toBe(201);
        const suiteId = (suite.json as { id: number }).id;
        const get = (path: string) => request('GET', `/projects/${project.id}${path}`, { token: user.token });

        const testCases = await get('/test-cases');
        expect([testCases.headers.get('ratelimit-limit'), remaining(testCases)]).toEqual(['100', '99']);

        const executions = await get('/test-executions');
        expect([executions.headers.get('ratelimit-limit'), remaining(executions)]).toEqual(['200', '199']);
        expect(remaining(await get(`/test-suites/${suiteId}/runs`))).toBe('198');
        expect(remaining(await get('/suite-runs/2147483647'))).toBe('197');
        expect(remaining(await get('/attachments/2147483647'))).toBe('196');
        expect(remaining(await get('/test-executions/2147483647/audit'))).toBe('195');

        for (const path of ['', '/test-suites', `/test-suites/${suiteId}`]) {
            const response = await get(path);
            expect(response.status, path).toBe(200);
            expect(response.headers.get('ratelimit-limit'), path).toBeNull();
        }

        // Not signed in: rejected by authentication before it can count against anyone.
        const anonymous = await request('GET', `/analytics?from=${today()}&to=${today()}`);
        expect(anonymous.status).toBe(401);
        expect(anonymous.headers.get('ratelimit-limit')).toBeNull();
    });
});
