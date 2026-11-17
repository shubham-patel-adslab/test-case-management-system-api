// Test cases (PRD Features §3): the contract the UI's test case screens rely on, the full-replacement rules
// for steps and suites, and project scoping — a test case is only ever reached through a project the caller
// may see, and only with that project's id. Which roles may do what at all is the TEST_CASE permission
// matrix (authorization.test.ts checks the grants).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pool } from '../src/app/database.js';
import {
    testCaseBulkResponseSchema,
    testCaseDetailsResponseSchema,
    testCasePageResponseSchema,
    type TestCaseDetailsResponseDto,
} from '../src/features/test-case/test-case.response.dto.js';
import {
    createTestProject,
    createTestSuite,
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

type TestCaseBody = {
    title: string;
    description: string;
    priority: string;
    type: string;
    preConditions: string;
    postConditions: string;
    tags: string[];
    steps: { action: string; expectedResult: string }[];
    suiteIds: number[];
};

function testCaseBody(overrides: Partial<TestCaseBody> = {}): TestCaseBody {
    return {
        title: 'Sign in with a valid password',
        description: '',
        priority: 'HIGH',
        type: 'FUNCTIONAL',
        preConditions: '',
        postConditions: '',
        tags: [],
        steps: [{ action: 'Open the sign-in page', expectedResult: 'The form is shown' }],
        suiteIds: [],
        ...overrides,
    };
}

function casesPath(projectId: number): string {
    return `/projects/${projectId}/test-cases`;
}

async function createTestCase(caller: TestUser, projectId: number, overrides: Partial<TestCaseBody> = {}): Promise<TestCaseDetailsResponseDto> {
    const response = await request('POST', casesPath(projectId), { token: caller.token, body: testCaseBody(overrides) });

    return expectBody(response, 201, testCaseDetailsResponseSchema);
}

function updateTestCase(caller: TestUser, testCase: TestCaseDetailsResponseDto, overrides: Partial<TestCaseBody>) {
    const body = { ...testCaseBody(), id: testCase.id, ...overrides };

    return request('PUT', `${casesPath(testCase.projectId)}/${testCase.id}`, { token: caller.token, body });
}

async function countTestCasesByTitle(projectId: number, title: string): Promise<number> {
    const result = await pool.query<{ total: number }>('SELECT COUNT(*)::int AS total FROM test_cases WHERE project_id = $1 AND title = $2', [projectId, title]);

    return result.rows[0]?.total ?? 0;
}

async function listIds(caller: TestUser, projectId: number, query = ''): Promise<number[]> {
    const page = expectBody(await request('GET', `${casesPath(projectId)}?pageSize=100&${query}`, { token: caller.token }), 200, testCasePageResponseSchema);

    return page.items.map((item) => item.id);
}

describe('POST /projects/:projectId/test-cases', () => {
    // The details page and the form read back exactly what was saved: trimmed text, normalized tags, steps in
    // the order sent, and the suites it joined.
    it('creates a test case with steps and suites: 201, Location, trimmed values, lowercased unique tags', async () => {
        const project = await createTestProject(admin);
        const suiteId = await createTestSuite(project.id);
        const body = testCaseBody({
            title: '  Checkout  ',
            tags: ['Payments', 'payments ', 'SMOKE'],
            steps: [
                { action: 'Add an item', expectedResult: 'Cart shows 1 item' },
                { action: 'Pay', expectedResult: 'Order confirmed' },
            ],
            suiteIds: [suiteId],
        });

        const response = await request('POST', casesPath(project.id), { token: admin.token, body: { ...body, createdBy: 'someone' } });
        const testCase = expectBody(response, 201, testCaseDetailsResponseSchema.strict());

        expect(response.headers.get('location')).toBe(`/api${casesPath(project.id)}/${testCase.id}`);
        expect(testCase).toMatchObject({ projectId: project.id, title: 'Checkout', tags: ['payments', 'smoke'], suiteIds: [suiteId], createdBy: admin.id });
        expect(testCase.steps.map((step) => [step.order, step.action])).toEqual([[1, 'Add an item'], [2, 'Pay']]);

        const fetched = expectBody(await request('GET', `${casesPath(project.id)}/${testCase.id}`, { token: admin.token }), 200, testCaseDetailsResponseSchema);
        expect(fetched).toEqual(testCase);
    });

    // A rejected request must not leave a half-created test case behind, and the error must point at the
    // exact field the UI marks.
    it('rejects a missing step, a tag with a comma, or another project\'s suite with 400 on the field — nothing is created', async () => {
        const project = await createTestProject(admin);
        const ownSuiteId = await createTestSuite(project.id);
        const foreignSuiteId = await createTestSuite((await createTestProject(admin)).id);
        const cases = [
            { overrides: { steps: [] }, field: 'steps' },
            { overrides: { tags: ['ui,smoke'] }, field: 'tags[0]' },
            { overrides: { suiteIds: [ownSuiteId, foreignSuiteId] }, field: 'suiteIds[1]' },
            { overrides: { suiteIds: [ownSuiteId, ownSuiteId] }, field: 'suiteIds' },
            { overrides: { priority: 'URGENT' }, field: 'priority' },
        ];

        for (const { overrides, field } of cases) {
            const body = testCaseBody({ title: `Rejected ${field}`, ...overrides });
            const error = expectError(await request('POST', casesPath(project.id), { token: admin.token, body }), 400, 'VALIDATION_ERROR');

            expect(error.details?.map((detail) => detail.field)).toEqual([field]);
            expect(await countTestCasesByTitle(project.id, body.title)).toBe(0);
        }
    });

    // New test cases join a suite at the end, in order.
    it('appends to the end of a suite', async () => {
        const project = await createTestProject(admin);
        const suiteId = await createTestSuite(project.id);
        const first = await createTestCase(admin, project.id, { suiteIds: [suiteId] });
        const second = await createTestCase(admin, project.id, { suiteIds: [suiteId] });

        const order = await pool.query<{ test_case_id: number }>('SELECT test_case_id FROM test_suite_cases WHERE test_suite_id = $1 ORDER BY sequence_order', [suiteId]);
        expect(order.rows.map((row) => row.test_case_id)).toEqual([first.id, second.id]);
    });
});

describe('PUT /projects/:projectId/test-cases/:testCaseId', () => {
    // PUT is a full replacement: the steps and suites in the body are the steps and suites afterwards. Leaving
    // a suite only removes the link; a suite it stays in keeps its position.
    it('replaces steps and suites; staying in a suite keeps the position, leaving one keeps the suite', async () => {
        const project = await createTestProject(admin);
        const [kept, left, joined] = [await createTestSuite(project.id), await createTestSuite(project.id), await createTestSuite(project.id)];
        const other = await createTestCase(admin, project.id, { suiteIds: [kept] });
        const testCase = await createTestCase(admin, project.id, { suiteIds: [kept, left] });

        const response = await updateTestCase(admin, testCase, {
            steps: [{ action: 'New first', expectedResult: 'A' }, { action: 'New second', expectedResult: 'B' }],
            suiteIds: [kept, joined],
        });
        const updated = expectBody(response, 200, testCaseDetailsResponseSchema);

        expect(updated.steps.map((step) => [step.order, step.action])).toEqual([[1, 'New first'], [2, 'New second']]);
        expect(updated.suiteIds).toEqual([kept, joined].sort((a, b) => a - b));
        expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(testCase.updatedAt));

        const keptOrder = await pool.query<{ test_case_id: number }>('SELECT test_case_id FROM test_suite_cases WHERE test_suite_id = $1 ORDER BY sequence_order', [kept]);
        expect(keptOrder.rows.map((row) => row.test_case_id)).toEqual([other.id, testCase.id]);
        expect((await pool.query('SELECT 1 FROM test_suites WHERE id = $1', [left])).rowCount).toBe(1);
    });

    it('rejects a body id that differs from the URL id (400) and answers 404 for an unknown test case', async () => {
        const project = await createTestProject(admin);
        const testCase = await createTestCase(admin, project.id);

        const mismatch = await request('PUT', `${casesPath(project.id)}/${testCase.id}`, { token: admin.token, body: { ...testCaseBody(), id: testCase.id + 1 } });
        expect(expectError(mismatch, 400, 'VALIDATION_ERROR').details?.[0]?.field).toBe('id');

        expectError(await updateTestCase(admin, { ...testCase, id: 2147483647 }, {}), 404, 'NOT_FOUND');
    });
});

describe('DELETE /projects/:projectId/test-cases/:testCaseId', () => {
    // Deleting a test case removes its steps and suite links but never the suite.
    it('deletes the test case with its steps and suite links (204); the suite stays; a second delete is 404', async () => {
        const project = await createTestProject(admin);
        const suiteId = await createTestSuite(project.id);
        const testCase = await createTestCase(admin, project.id, { suiteIds: [suiteId] });
        const path = `${casesPath(project.id)}/${testCase.id}`;

        expect((await request('DELETE', path, { token: admin.token })).status).toBe(204);
        expectError(await request('GET', path, { token: admin.token }), 404, 'NOT_FOUND');

        expect((await pool.query('SELECT 1 FROM test_steps WHERE test_case_id = $1', [testCase.id])).rowCount).toBe(0);
        expect((await pool.query('SELECT 1 FROM test_suite_cases WHERE test_case_id = $1', [testCase.id])).rowCount).toBe(0);
        expect((await pool.query('SELECT 1 FROM test_suites WHERE id = $1', [suiteId])).rowCount).toBe(1);

        expectError(await request('DELETE', path, { token: admin.token }), 404, 'NOT_FOUND');
    });
});

describe('Project scoping and roles', () => {
    // A test case id is only valid together with its own project: reaching it through another project the
    // caller can see must not work.
    it('a test case is 404 through another project\'s URL, for reading, updating and deleting', async () => {
        const project = await createTestProject(admin);
        const otherProject = await createTestProject(admin);
        const testCase = await createTestCase(admin, project.id);
        const wrongPath = `${casesPath(otherProject.id)}/${testCase.id}`;

        expectError(await request('GET', wrongPath, { token: admin.token }), 404, 'NOT_FOUND');
        expectError(await request('PUT', wrongPath, { token: admin.token, body: { ...testCaseBody(), id: testCase.id } }), 404, 'NOT_FOUND');
        expectError(await request('DELETE', wrongPath, { token: admin.token }), 404, 'NOT_FOUND');
        expect(await countTestCasesByTitle(project.id, testCase.title)).toBe(1);
    });

    // Membership, not the role, decides which projects' test cases a user sees and changes.
    it('a non-member gets 404 on the list and on create, even with the TEST_CASE permission', async () => {
        const lead = await createTestUser('TEST_LEAD');
        const project = await createTestProject(admin);
        const body = testCaseBody({ title: 'Not my project' });

        expectError(await request('GET', casesPath(project.id), { token: lead.token }), 404, 'NOT_FOUND');
        expectError(await request('POST', casesPath(project.id), { token: lead.token, body }), 404, 'NOT_FOUND');
        expect(await countTestCasesByTitle(project.id, body.title)).toBe(0);
    });

    // PRD: test-lead manages test cases in their projects; tester and read-only only view them.
    it('a member TEST_LEAD creates, updates and deletes; a member TESTER or READ_ONLY reads but gets 403 on writes', async () => {
        const [lead, tester, readOnly] = await Promise.all([createTestUser('TEST_LEAD'), createTestUser('TESTER'), createTestUser('READ_ONLY')]);
        const project = await createTestProject(admin, [lead.id, tester.id, readOnly.id]);

        const testCase = await createTestCase(lead, project.id);
        expectBody(await updateTestCase(lead, testCase, { title: 'Edited by the lead' }), 200, testCaseDetailsResponseSchema);

        for (const viewer of [tester, readOnly]) {
            const path = `${casesPath(project.id)}/${testCase.id}`;

            expectBody(await request('GET', path, { token: viewer.token }), 200, testCaseDetailsResponseSchema);
            expectError(await request('POST', casesPath(project.id), { token: viewer.token, body: testCaseBody() }), 403, 'FORBIDDEN');
            expectError(await updateTestCase(viewer, testCase, { title: 'Hijacked' }), 403, 'FORBIDDEN');
            expectError(await request('DELETE', path, { token: viewer.token }), 403, 'FORBIDDEN');
        }

        expect((await request('DELETE', `${casesPath(project.id)}/${testCase.id}`, { token: lead.token })).status).toBe(204);
    });
});

describe('GET /projects/:projectId/test-cases', () => {
    // PRD: search and filter test cases by multiple criteria; the UI's list depends on each filter and on
    // filters combining with AND.
    it('filters by search, priority, type, tags and suite, combined with AND', async () => {
        const project = await createTestProject(admin);
        const suiteId = await createTestSuite(project.id);
        const login = await createTestCase(admin, project.id, { title: 'Login works', priority: 'CRITICAL', type: 'SMOKE', tags: ['auth'], suiteIds: [suiteId] });
        const logout = await createTestCase(admin, project.id, { title: 'Logout', description: 'Ends the session', priority: 'LOW', type: 'UI', tags: ['auth', 'session'] });
        const report = await createTestCase(admin, project.id, { title: 'Report export 100%', priority: 'HIGH', type: 'API', tags: ['reports'] });

        expect(await listIds(admin, project.id, 'search=SESSION')).toEqual([logout.id]);
        // % is a literal character, not a wildcard.
        expect(await listIds(admin, project.id, `search=${encodeURIComponent('100%')}`)).toEqual([report.id]);
        expect((await listIds(admin, project.id, 'priority=CRITICAL,HIGH')).sort()).toEqual([login.id, report.id].sort());
        expect(await listIds(admin, project.id, 'type=UI')).toEqual([logout.id]);
        expect((await listIds(admin, project.id, 'tags=Session,reports')).sort()).toEqual([logout.id, report.id].sort());
        expect(await listIds(admin, project.id, `suiteId=${suiteId}`)).toEqual([login.id]);
        expect(await listIds(admin, project.id, 'tags=auth&priority=LOW')).toEqual([logout.id]);
    });

    // Priority sorts by rank, not alphabetically ("CRITICAL" < "HIGH" < "LOW" < "MEDIUM" as text).
    it('sorts by title (default, ignoring case), priority rank and creation; paginates with real totals', async () => {
        const project = await createTestProject(admin);
        const medium = await createTestCase(admin, project.id, { title: 'b', priority: 'MEDIUM' });
        const critical = await createTestCase(admin, project.id, { title: 'C', priority: 'CRITICAL' });
        const low = await createTestCase(admin, project.id, { title: 'a', priority: 'LOW' });

        expect(await listIds(admin, project.id)).toEqual([low.id, medium.id, critical.id]);
        expect(await listIds(admin, project.id, 'sort=priority:desc')).toEqual([critical.id, medium.id, low.id]);
        expect(await listIds(admin, project.id, 'sort=createdAt:desc')).toEqual([low.id, critical.id, medium.id]);

        const page = expectBody(await request('GET', `${casesPath(project.id)}?page=2&pageSize=2`, { token: admin.token }), 200, testCasePageResponseSchema);
        expect(page).toMatchObject({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
        expect(page.items.map((item) => item.id)).toEqual([critical.id]);
        expect(page.items[0]).not.toHaveProperty('steps');
    });

    it('rejects an unknown sort field or filter value with 400 on the field', async () => {
        const project = await createTestProject(admin);

        for (const [query, field] of [['sort=steps:asc', 'sort'], ['sort=title', 'sort'], ['priority=HIGH,URGENT', 'priority[1]'], ['suiteId=abc', 'suiteId']]) {
            const error = expectError(await request('GET', `${casesPath(project.id)}?${query}`, { token: admin.token }), 400, 'VALIDATION_ERROR');

            expect(error.details?.[0]?.field, query).toBe(field);
        }
    });
});

describe('POST /projects/:projectId/test-cases/bulk', () => {
    function bulk(caller: TestUser, projectId: number, body: unknown) {
        return request('POST', `${casesPath(projectId)}/bulk`, { token: caller.token, body });
    }

    async function prioritiesOf(ids: number[]): Promise<string[]> {
        const result = await pool.query<{ priority: string }>('SELECT priority FROM test_cases WHERE id = ANY($1) ORDER BY id', [ids]);

        return result.rows.map((row) => row.priority);
    }

    // PRD bulk "update priority": only the selected test cases change.
    it('UPDATE_PRIORITY changes exactly the selected test cases', async () => {
        const project = await createTestProject(admin);
        const [first, second, untouched] = [
            await createTestCase(admin, project.id, { priority: 'LOW' }),
            await createTestCase(admin, project.id, { priority: 'MEDIUM' }),
            await createTestCase(admin, project.id, { priority: 'LOW' }),
        ];

        const response = await bulk(admin, project.id, { action: 'UPDATE_PRIORITY', testCaseIds: [first.id, second.id], priority: 'CRITICAL' });

        expect(expectBody(response, 200, testCaseBulkResponseSchema)).toEqual({ affectedCount: 2 });
        expect(await prioritiesOf([first.id, second.id, untouched.id])).toEqual(['CRITICAL', 'CRITICAL', 'LOW']);
    });

    // PRD bulk "delete": the selected test cases go, with their steps and suite links; the rest stays.
    it('DELETE removes the selected test cases with their steps and links; the suite and other cases stay', async () => {
        const project = await createTestProject(admin);
        const suiteId = await createTestSuite(project.id);
        const doomed = await createTestCase(admin, project.id, { suiteIds: [suiteId] });
        const kept = await createTestCase(admin, project.id, { suiteIds: [suiteId] });

        expect(expectBody(await bulk(admin, project.id, { action: 'DELETE', testCaseIds: [doomed.id] }), 200, testCaseBulkResponseSchema)).toEqual({ affectedCount: 1 });
        expect(await listIds(admin, project.id)).toEqual([kept.id]);
        expect((await pool.query('SELECT 1 FROM test_steps WHERE test_case_id = $1', [doomed.id])).rowCount).toBe(0);
        expect(await listIds(admin, project.id, `suiteId=${suiteId}`)).toEqual([kept.id]);
    });

    // PRD bulk "assign to suite": appended in the order selected; already-assigned cases keep their place and
    // aren't counted.
    it('ASSIGN_TO_SUITE appends in the order given; cases already in the suite keep their position', async () => {
        const project = await createTestProject(admin);
        const suiteId = await createTestSuite(project.id);
        const already = await createTestCase(admin, project.id, { suiteIds: [suiteId] });
        const [first, second] = [await createTestCase(admin, project.id), await createTestCase(admin, project.id)];

        const response = await bulk(admin, project.id, { action: 'ASSIGN_TO_SUITE', testCaseIds: [second.id, already.id, first.id], suiteId });
        expect(expectBody(response, 200, testCaseBulkResponseSchema)).toEqual({ affectedCount: 2 });

        const order = await pool.query<{ test_case_id: number }>('SELECT test_case_id FROM test_suite_cases WHERE test_suite_id = $1 ORDER BY sequence_order', [suiteId]);
        expect(order.rows.map((row) => row.test_case_id)).toEqual([already.id, second.id, first.id]);
    });

    // All-or-nothing: one foreign id (another project's test case) must not let the others through — and
    // must not touch the other project.
    it('rejects the whole request when an id is not a test case of the project (400 on testCaseIds[i]); nothing changes', async () => {
        const project = await createTestProject(admin);
        const otherProject = await createTestProject(admin);
        const own = await createTestCase(admin, project.id, { priority: 'LOW' });
        const foreign = await createTestCase(admin, otherProject.id, { priority: 'LOW' });

        for (const body of [
            { action: 'UPDATE_PRIORITY', testCaseIds: [own.id, foreign.id], priority: 'HIGH' },
            { action: 'DELETE', testCaseIds: [own.id, foreign.id] },
        ]) {
            const error = expectError(await bulk(admin, project.id, body), 400, 'VALIDATION_ERROR');

            expect(error.details?.map((detail) => detail.field)).toEqual(['testCaseIds[1]']);
        }

        expect(await prioritiesOf([own.id, foreign.id])).toEqual(['LOW', 'LOW']);
    });

    it('rejects another project\'s suite (400 on suiteId) and malformed bodies', async () => {
        const project = await createTestProject(admin);
        const testCase = await createTestCase(admin, project.id);
        const foreignSuiteId = await createTestSuite((await createTestProject(admin)).id);
        const cases: [unknown, string][] = [
            [{ action: 'ASSIGN_TO_SUITE', testCaseIds: [testCase.id], suiteId: foreignSuiteId }, 'suiteId'],
            [{ action: 'UPDATE_PRIORITY', testCaseIds: [testCase.id] }, 'priority'],
            [{ action: 'DELETE', testCaseIds: [] }, 'testCaseIds'],
            [{ action: 'DELETE', testCaseIds: [testCase.id, testCase.id] }, 'testCaseIds'],
            [{ action: 'ARCHIVE', testCaseIds: [testCase.id] }, 'action'],
        ];

        for (const [body, field] of cases) {
            const error = expectError(await bulk(admin, project.id, body), 400, 'VALIDATION_ERROR');

            expect(error.details?.[0]?.field, JSON.stringify(body)).toBe(field);
        }

        expect(await listIds(admin, project.id)).toEqual([testCase.id]);
    });

    // Same rules as single-case writes: role permission, then project membership.
    it('a member TESTER gets 403 and a non-member TEST_LEAD gets 404; nothing changes', async () => {
        const [tester, outsider] = await Promise.all([createTestUser('TESTER'), createTestUser('TEST_LEAD')]);
        const project = await createTestProject(admin, [tester.id]);
        const testCase = await createTestCase(admin, project.id);
        const body = { action: 'DELETE', testCaseIds: [testCase.id] };

        expectError(await bulk(tester, project.id, body), 403, 'FORBIDDEN');
        expectError(await bulk(outsider, project.id, body), 404, 'NOT_FOUND');
        expect(await listIds(admin, project.id)).toEqual([testCase.id]);
    });
});

