// Analytics (PRD Features §5): the dashboard numbers. What they mean is the contract the UI's charts are built on —
// results count by when they were recorded, pending is the current backlog, deleted test cases keep their results
// in the summary — and they only ever cover projects the caller may read.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { analyticsResponseSchema, type AnalyticsResponseDto } from '../src/features/analytics/analytics.response.dto.js';
import { testCaseDetailsResponseSchema, type TestCaseDetailsResponseDto } from '../src/features/test-case/test-case.response.dto.js';
import { testExecutionDetailsResponseSchema, testExecutionPageResponseSchema } from '../src/features/test-execution/test-execution.response.dto.js';
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
    type TestUser,
} from './support/test-api.js';

let admin: TestUser;

beforeAll(async () => {
    await startTestServer();
    admin = await createTestUser('ADMIN');
});
afterAll(async () => {
    await deleteTestProjects();
    await deleteTestUsers();
    await stopTestServer();
});

const MILLISECONDS_PER_DAY = 86_400_000;
const ZERO_COUNTS = { passed: 0, failed: 0, blocked: 0, skipped: 0, pending: 0 };

// Today's calendar date in `timeZone`, as the UI would send it.
function today(timeZone = 'UTC'): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(date: string, days: number): string {
    return new Date(Date.parse(date) + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

async function createCase(projectId: number, title: string, priority: string, type: string): Promise<TestCaseDetailsResponseDto> {
    const body = {
        title, description: '', priority, type, preConditions: '', postConditions: '', tags: [],
        steps: [{ action: 'Do it', expectedResult: 'It works' }], suiteIds: [],
    };

    return expectBody(await request('POST', `/projects/${projectId}/test-cases`, { token: admin.token, body }), 201, testCaseDetailsResponseSchema);
}

async function runAdHoc(caller: TestUser, projectId: number, testCaseId: number, status: string): Promise<number> {
    const response = await request('POST', `/projects/${projectId}/test-executions`, { token: caller.token, body: { testCaseId, status } });

    return expectBody(response, 201, testExecutionDetailsResponseSchema).id;
}

async function assign(projectId: number, testCaseIds: number[], assigneeId: string): Promise<void> {
    const response = await request('POST', `/projects/${projectId}/test-executions/assignments`, { token: admin.token, body: { testCaseIds, assigneeId } });

    expect(response.status, response.text).toBe(201);
}

async function recordPending(caller: TestUser, projectId: number, testCaseId: number, status: string): Promise<void> {
    const page = expectBody(
        await request('GET', `/projects/${projectId}/test-executions?status=PENDING&testCaseId=${testCaseId}`, { token: caller.token }),
        200,
        testExecutionPageResponseSchema,
    );
    const executionId = page.items[0]?.id ?? 0;

    expect((await request('PUT', `/projects/${projectId}/test-executions/${executionId}`, { token: caller.token, body: { status } })).status).toBe(200);
}

async function analytics(caller: TestUser, query: string): Promise<AnalyticsResponseDto> {
    return expectBody(await request('GET', `/analytics?${query}`, { token: caller.token }), 200, analyticsResponseSchema);
}

describe('GET /analytics — the numbers', () => {
    // One project with every kind of data the dashboard counts: assigned and ad hoc runs, each result, a defect,
    // a never-executed case, and a deleted case whose result stays in history.
    it('summary, coverage, by priority/type/tester, defects and the trend agree for one project', async () => {
        const [tester, other] = await Promise.all([createTestUser('TESTER'), createTestUser('TESTER')]);
        const project = await createTestProject(admin, [tester.id, other.id]);
        const critical = await createCase(project.id, 'Critical smoke', 'CRITICAL', 'SMOKE');
        const low = await createCase(project.id, 'Low api', 'LOW', 'API');
        const deleted = await createCase(project.id, 'High ui', 'HIGH', 'UI');
        await createCase(project.id, 'Never run', 'MEDIUM', 'FUNCTIONAL');

        await assign(project.id, [critical.id, low.id], tester.id);
        await recordPending(tester, project.id, critical.id, 'PASS');
        const failedId = await runAdHoc(other, project.id, low.id, 'FAIL');
        await runAdHoc(tester, project.id, deleted.id, 'BLOCKED');
        expect((await request('POST', `/projects/${project.id}/test-executions/${failedId}/defects`, {
            token: other.token,
            body: { title: 'Broken', description: '', severity: 'HIGH' },
        })).status).toBe(201);
        expect((await request('DELETE', `/projects/${project.id}/test-cases/${deleted.id}`, { token: admin.token })).status).toBe(204);

        const date = today();
        const result = await analytics(tester, `from=${date}&to=${date}&projectId=${project.id}`);

        expect(result.range).toEqual({ from: date, to: date, timeZone: 'UTC' });
        expect(result.projectId).toBe(project.id);
        // The deleted case's BLOCKED result is history: it stays in the summary and the trend.
        expect(result.summary).toEqual({ passed: 1, failed: 1, blocked: 1, skipped: 0, pending: 1, total: 4 });
        expect(result.trend).toEqual([{ date, passed: 1, failed: 1, blocked: 1, skipped: 0 }]);
        // Coverage is over test cases that exist: 3 cases, 2 of them with a result.
        expect(result.coverage).toEqual({ totalCases: 3, executedCases: 2 });
        // Every priority and type is listed (stable chart categories); the deleted case has none any more.
        expect(result.byPriority).toEqual([
            { priority: 'LOW', ...ZERO_COUNTS, failed: 1, pending: 1 },
            { priority: 'MEDIUM', ...ZERO_COUNTS },
            { priority: 'HIGH', ...ZERO_COUNTS },
            { priority: 'CRITICAL', ...ZERO_COUNTS, passed: 1 },
        ]);
        expect(result.byType.map((entry) => entry.type)).toEqual(['FUNCTIONAL', 'INTEGRATION', 'REGRESSION', 'SMOKE', 'UI', 'API']);
        expect(result.byType.find((entry) => entry.type === 'API')).toEqual({ type: 'API', ...ZERO_COUNTS, failed: 1, pending: 1 });
        expect(result.byType.find((entry) => entry.type === 'UI')).toEqual({ type: 'UI', ...ZERO_COUNTS });
        // Results count for whoever ran them; pending for whoever it's assigned to.
        expect(result.byTester.find((entry) => entry.user.id === tester.id)).toEqual({
            user: { id: tester.id, firstName: 'Test', lastName: 'TESTER' },
            pending: 1, executed: 2, passed: 1, failed: 0, blocked: 1, skipped: 0,
        });
        expect(result.byTester.find((entry) => entry.user.id === other.id)).toMatchObject({ pending: 0, executed: 1, failed: 1 });
        expect(result.byTester).toHaveLength(2);
        expect(result.defects).toEqual({ total: 1 });
    });

    // The range is calendar days in the caller's time zone. +14 h and −11 h are 25 hours apart, so "today" is
    // always a different date in the two zones: a result recorded now is on Kiritimati's today, not Pago Pago's.
    it('counts results by the day they were recorded in `timeZone`; pending is the backlog, whatever the range', async () => {
        const tester = await createTestUser('TESTER');
        const project = await createTestProject(admin, [tester.id]);
        const [ran, waiting] = [await createCase(project.id, 'Ran', 'LOW', 'API'), await createCase(project.id, 'Waiting', 'LOW', 'API')];
        await runAdHoc(tester, project.id, ran.id, 'PASS');
        await assign(project.id, [waiting.id], tester.id);

        const kiritimati = today('Pacific/Kiritimati');
        const query = (timeZone: string) => `from=${kiritimati}&to=${kiritimati}&timeZone=${timeZone}&projectId=${project.id}`;

        const local = await analytics(tester, query('Pacific/Kiritimati'));
        expect(local.summary).toMatchObject({ passed: 1, pending: 1 });
        expect(local.trend).toEqual([{ date: kiritimati, passed: 1, failed: 0, blocked: 0, skipped: 0 }]);

        const elsewhere = await analytics(tester, query('Pacific/Pago_Pago'));
        expect(elsewhere.summary).toMatchObject({ passed: 0, pending: 1 });
        expect(elsewhere.coverage).toEqual({ totalCases: 2, executedCases: 0 });

        // Every day of the range is a point on the line chart, days without results included.
        const week = await analytics(tester, `from=${addDays(today(), -6)}&to=${today()}&projectId=${project.id}`);
        expect(week.trend.map((point) => point.date)).toEqual([6, 5, 4, 3, 2, 1, 0].map((daysAgo) => addDays(today(), -daysAgo)));
        expect(week.trend.reduce((total, point) => total + point.passed, 0)).toBe(1);
    });

    // Browsers report the zone ICU knows, which can be an old IANA name (Chrome in India: Asia/Calcutta). The
    // database may not have the old names (Ubuntu ships them separately), so the API resolves them itself: the same
    // numbers as the current name, and the response echoes what was sent.
    it('accepts old time zone names browsers send, with the same numbers as their current name; no zone is UTC', async () => {
        const tester = await createTestUser('TESTER');
        const project = await createTestProject(admin, [tester.id]);
        const [ran, waiting] = [await createCase(project.id, 'Ran', 'LOW', 'API'), await createCase(project.id, 'Waiting', 'LOW', 'API')];
        await runAdHoc(tester, project.id, ran.id, 'FAIL');
        await assign(project.id, [waiting.id], tester.id);

        // Yesterday to tomorrow (UTC) holds "now" in every zone.
        const range = `from=${addDays(today(), -1)}&to=${addDays(today(), 1)}&projectId=${project.id}`;
        const withoutEcho = ({ generatedAt: _generatedAt, range: _range, ...numbers }: AnalyticsResponseDto) => numbers;
        const pairs = [
            ['Asia/Calcutta', 'Asia/Kolkata'],
            ['US/Eastern', 'America/New_York'],
            ['Asia/Saigon', 'Asia/Ho_Chi_Minh'],
            ['asia/calcutta', 'Asia/Kolkata'],
        ];

        for (const [oldName = '', currentName = ''] of pairs) {
            const old = await analytics(tester, `${range}&timeZone=${oldName}`);
            const current = await analytics(tester, `${range}&timeZone=${currentName}`);

            expect(old.range.timeZone).toBe(oldName);
            expect(old.summary).toMatchObject({ failed: 1, pending: 1 });
            expect(withoutEcho(old), oldName).toEqual(withoutEcho(current));
        }

        const defaultZone = await analytics(tester, range);
        expect(defaultZone.range.timeZone).toBe('UTC');
        expect(withoutEcho(defaultZone)).toEqual(withoutEcho(await analytics(tester, `${range}&timeZone=Etc/UTC`)));
    });
});

describe('GET /analytics — scope and access', () => {
    // Without projectId the dashboard covers every project the caller may read — for a non-admin only their own,
    // so nobody learns another team's numbers. A project outside the scope is a 404, as everywhere.
    it('covers only the caller\'s projects; another project is a 404; ADMIN sees it; every role may view', async () => {
        const [tester, readOnly] = await Promise.all([createTestUser('TESTER'), createTestUser('READ_ONLY')]);
        const own = await createTestProject(admin, [tester.id, readOnly.id]);
        const foreign = await createTestProject(admin);
        await runAdHoc(tester, own.id, (await createCase(own.id, 'Own', 'LOW', 'API')).id, 'PASS');
        await runAdHoc(admin, foreign.id, (await createCase(foreign.id, 'Foreign', 'LOW', 'API')).id, 'FAIL');

        const range = `from=${today()}&to=${today()}`;

        const mine = await analytics(tester, range);
        expect(mine.projectId).toBeNull();
        expect(mine.summary).toMatchObject({ passed: 1, failed: 0, total: 1 });
        expect(mine.coverage.totalCases).toBe(1);

        expectError(await request('GET', `/analytics?${range}&projectId=${foreign.id}`, { token: tester.token }), 404, 'NOT_FOUND');
        expect((await analytics(admin, `${range}&projectId=${foreign.id}`)).summary).toMatchObject({ failed: 1, total: 1 });
        expect((await analytics(readOnly, range)).summary.total).toBe(1);
    });

    it('400 on a bad range, time zone or project id, on the exact field', async () => {
        const date = today();
        const cases = [
            { query: `to=${date}`, field: 'from' },
            { query: `from=${date}&to=${addDays(date, -1)}`, field: 'to' },
            { query: `from=${addDays(date, -366)}&to=${date}`, field: 'to' },
            { query: `from=${date}&to=${date}&timeZone=%2B05:30`, field: 'timeZone' },
            // Well-formed but unknown to the database — a 400, not the query's "time zone not recognized" 500.
            { query: `from=${date}&to=${date}&timeZone=Mars/Base`, field: 'timeZone' },
            // A zoneinfo file, not a zone: the database host's own zone.
            { query: `from=${date}&to=${date}&timeZone=localtime`, field: 'timeZone' },
            { query: `from=${date}&to=${date}&projectId=abc`, field: 'projectId' },
        ];

        for (const { query, field } of cases) {
            const error = expectError(await request('GET', `/analytics?${query}`, { token: admin.token }), 400, 'VALIDATION_ERROR');
            expect(error.details?.map((detail) => detail.field), query).toEqual([field]);
        }

        // 366 days, a leap year's worth, is the longest range allowed.
        expect((await request('GET', `/analytics?from=${addDays(date, -365)}&to=${date}`, { token: admin.token })).status).toBe(200);
    });
});
