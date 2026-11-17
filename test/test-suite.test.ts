// Test suites (PRD Features §6): the contract the UI's suite screens rely on, the rules that protect test
// cases (removing or deleting never deletes a test case), ordering, and project scoping — a suite and the
// test cases put into it always belong to the project in the URL.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pool } from '../src/app/database.js';
import { testCaseDetailsResponseSchema, type TestCaseDetailsResponseDto } from '../src/features/test-case/test-case.response.dto.js';
import {
    testSuiteDetailsResponseSchema,
    testSuitePageResponseSchema,
    type TestSuiteDetailsResponseDto,
} from '../src/features/test-suite/test-suite.response.dto.js';
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

function suitesPath(projectId: number): string {
    return `/projects/${projectId}/test-suites`;
}

async function createSuite(caller: TestUser, projectId: number, name = 'Smoke'): Promise<TestSuiteDetailsResponseDto> {
    const response = await request('POST', suitesPath(projectId), { token: caller.token, body: { name, description: '' } });

    return expectBody(response, 201, testSuiteDetailsResponseSchema);
}

async function createCase(projectId: number, title: string): Promise<TestCaseDetailsResponseDto> {
    const body = {
        title, description: '', priority: 'MEDIUM', type: 'FUNCTIONAL', preConditions: '', postConditions: '', tags: [],
        steps: [{ action: 'Do it', expectedResult: 'It works' }], suiteIds: [],
    };

    return expectBody(await request('POST', `/projects/${projectId}/test-cases`, { token: admin.token, body }), 201, testCaseDetailsResponseSchema);
}

function addCases(caller: TestUser, suite: TestSuiteDetailsResponseDto, testCaseIds: number[]) {
    return request('POST', `${suitesPath(suite.projectId)}/${suite.id}/test-cases`, { token: caller.token, body: { testCaseIds } });
}

function reorder(caller: TestUser, suite: TestSuiteDetailsResponseDto, testCaseIds: number[]) {
    return request('PATCH', `${suitesPath(suite.projectId)}/${suite.id}/test-cases/reorder`, { token: caller.token, body: { testCaseIds } });
}

function caseOrder(suite: TestSuiteDetailsResponseDto): [number, number][] {
    return suite.testCases.map((testCase) => [testCase.order, testCase.id]);
}

async function testCaseExists(id: number): Promise<boolean> {
    return (await pool.query('SELECT 1 FROM test_cases WHERE id = $1', [id])).rowCount === 1;
}

describe('Suite CRUD', () => {
    it('creates a suite: 201, Location, trimmed values, no test cases yet', async () => {
        const project = await createTestProject(admin);

        const response = await request('POST', suitesPath(project.id), { token: admin.token, body: { name: '  Regression  ', description: ' Nightly ', testCaseCount: 9 } });
        const suite = expectBody(response, 201, testSuiteDetailsResponseSchema.strict());

        expect(response.headers.get('location')).toBe(`/api${suitesPath(project.id)}/${suite.id}`);
        expect(suite).toMatchObject({ projectId: project.id, name: 'Regression', description: 'Nightly', testCaseCount: 0, testCases: [], createdBy: admin.id });
    });

    // Suite names are unique per project, ignoring case — but two projects may both have a "Smoke" suite.
    it('rejects a duplicate name in the same project, ignoring case (409 on name, create and rename); allows it in another project', async () => {
        const project = await createTestProject(admin);
        await createSuite(admin, project.id, 'Smoke');
        const other = await createSuite(admin, project.id, 'Sanity');

        const duplicate = await request('POST', suitesPath(project.id), { token: admin.token, body: { name: 'SMOKE', description: '' } });
        expect(expectError(duplicate, 409, 'CONFLICT').details?.[0]?.field).toBe('name');

        const rename = await request('PUT', `${suitesPath(project.id)}/${other.id}`, { token: admin.token, body: { id: other.id, name: 'smoke', description: '' } });
        expectError(rename, 409, 'CONFLICT');

        await createSuite(admin, (await createTestProject(admin)).id, 'Smoke');
    });

    it('lists suites by name (default) with their test case counts, paginated; sort=createdAt:asc', async () => {
        const project = await createTestProject(admin);
        const beta = await createSuite(admin, project.id, 'beta');
        const alpha = await createSuite(admin, project.id, 'Alpha');
        await addCases(admin, beta, [(await createCase(project.id, 'One')).id, (await createCase(project.id, 'Two')).id]);

        const page = expectBody(await request('GET', `${suitesPath(project.id)}?pageSize=1&page=2`, { token: admin.token }), 200, testSuitePageResponseSchema);
        expect(page).toMatchObject({ page: 2, pageSize: 1, totalItems: 2, totalPages: 2 });
        expect(page.items.map((suite) => [suite.id, suite.testCaseCount])).toEqual([[beta.id, 2]]);

        const first = expectBody(await request('GET', `${suitesPath(project.id)}?pageSize=1`, { token: admin.token }), 200, testSuitePageResponseSchema);
        expect(first.items.map((suite) => suite.id)).toEqual([alpha.id]);

        const oldest = expectBody(await request('GET', `${suitesPath(project.id)}?sort=createdAt:asc`, { token: admin.token }), 200, testSuitePageResponseSchema);
        expect(oldest.items.map((suite) => suite.id)).toEqual([beta.id, alpha.id]);
    });

    it('updates name and description; rejects a body id that differs from the URL (400); 404 for an unknown suite', async () => {
        const project = await createTestProject(admin);
        const suite = await createSuite(admin, project.id);
        const path = `${suitesPath(project.id)}/${suite.id}`;

        const updated = expectBody(await request('PUT', path, { token: admin.token, body: { id: suite.id, name: 'Smoke v2', description: 'Fast' } }), 200, testSuiteDetailsResponseSchema);
        expect(updated).toMatchObject({ name: 'Smoke v2', description: 'Fast' });

        const mismatch = await request('PUT', path, { token: admin.token, body: { id: suite.id + 1, name: 'x', description: '' } });
        expect(expectError(mismatch, 400, 'VALIDATION_ERROR').details?.[0]?.field).toBe('id');
        expectError(await request('GET', `${suitesPath(project.id)}/2147483647`, { token: admin.token }), 404, 'NOT_FOUND');
    });

    // PRD rule: deleting a suite must never delete its test cases.
    it('deletes a suite (204) but keeps its test cases', async () => {
        const project = await createTestProject(admin);
        const suite = await createSuite(admin, project.id);
        const testCase = await createCase(project.id, 'Survives');
        await addCases(admin, suite, [testCase.id]);

        expect((await request('DELETE', `${suitesPath(project.id)}/${suite.id}`, { token: admin.token })).status).toBe(204);
        expectError(await request('GET', `${suitesPath(project.id)}/${suite.id}`, { token: admin.token }), 404, 'NOT_FOUND');
        expect(await testCaseExists(testCase.id)).toBe(true);
    });
});

describe('Suite test cases', () => {
    // Several at once, appended in the order given; re-adding one doesn't move it or duplicate it.
    it('adds several test cases in order; one already in the suite keeps its position', async () => {
        const project = await createTestProject(admin);
        const suite = await createSuite(admin, project.id);
        const [a, b, c] = [await createCase(project.id, 'A'), await createCase(project.id, 'B'), await createCase(project.id, 'C')];

        await addCases(admin, suite, [b.id]);
        const updated = expectBody(await addCases(admin, suite, [c.id, b.id, a.id]), 200, testSuiteDetailsResponseSchema);

        expect(caseOrder(updated)).toEqual([[1, b.id], [2, c.id], [3, a.id]]);
        expect(updated.testCaseCount).toBe(3);
    });

    // A test case can only join a suite of its own project — rejected as a whole, nothing added.
    it('rejects another project\'s test case (400 on testCaseIds[i]) and adds nothing', async () => {
        const project = await createTestProject(admin);
        const suite = await createSuite(admin, project.id);
        const own = await createCase(project.id, 'Own');
        const foreign = await createCase((await createTestProject(admin)).id, 'Foreign');

        const error = expectError(await addCases(admin, suite, [own.id, foreign.id]), 400, 'VALIDATION_ERROR');

        expect(error.details?.map((detail) => detail.field)).toEqual(['testCaseIds[1]']);
        expect((expectBody(await request('GET', `${suitesPath(project.id)}/${suite.id}`, { token: admin.token }), 200, testSuiteDetailsResponseSchema)).testCases).toEqual([]);
    });

    // PRD rule: removing a test case from a suite deletes only the link. Positions stay gap-free.
    it('removes one test case from the suite (204): the test case stays, positions close up; removing again is 404', async () => {
        const project = await createTestProject(admin);
        const suite = await createSuite(admin, project.id);
        const [a, b, c] = [await createCase(project.id, 'A'), await createCase(project.id, 'B'), await createCase(project.id, 'C')];
        await addCases(admin, suite, [a.id, b.id, c.id]);
        const path = `${suitesPath(project.id)}/${suite.id}/test-cases/${b.id}`;

        expect((await request('DELETE', path, { token: admin.token })).status).toBe(204);
        expect(await testCaseExists(b.id)).toBe(true);

        const after = expectBody(await request('GET', `${suitesPath(project.id)}/${suite.id}`, { token: admin.token }), 200, testSuiteDetailsResponseSchema);
        expect(caseOrder(after)).toEqual([[1, a.id], [2, c.id]]);

        expectError(await request('DELETE', path, { token: admin.token }), 404, 'NOT_FOUND');
    });

    // Reorder renumbers the whole suite in one statement (swaps included); it must name exactly the suite's
    // test cases, so nothing is lost or smuggled in.
    it('reorders the suite; rejects a list that misses, adds or repeats a test case (400)', async () => {
        const project = await createTestProject(admin);
        const suite = await createSuite(admin, project.id);
        const [a, b, c] = [await createCase(project.id, 'A'), await createCase(project.id, 'B'), await createCase(project.id, 'C')];
        const outsider = await createCase(project.id, 'Not in suite');
        await addCases(admin, suite, [a.id, b.id, c.id]);

        const reordered = expectBody(await reorder(admin, suite, [c.id, a.id, b.id]), 200, testSuiteDetailsResponseSchema);
        expect(caseOrder(reordered)).toEqual([[1, c.id], [2, a.id], [3, b.id]]);

        for (const ids of [[c.id, a.id], [c.id, a.id, b.id, outsider.id], [c.id, a.id, a.id]]) {
            const error = expectError(await reorder(admin, suite, ids), 400, 'VALIDATION_ERROR');

            expect(error.details?.[0]?.field).toBe('testCaseIds');
        }

        const unchanged = expectBody(await request('GET', `${suitesPath(project.id)}/${suite.id}`, { token: admin.token }), 200, testSuiteDetailsResponseSchema);
        expect(caseOrder(unchanged)).toEqual([[1, c.id], [2, a.id], [3, b.id]]);
    });
});

describe('Project scoping and roles', () => {
    // A suite id is only valid together with its own project.
    it('a suite is 404 through another project\'s URL, for reading, changing and deleting', async () => {
        const project = await createTestProject(admin);
        const otherProject = await createTestProject(admin);
        const suite = await createSuite(admin, project.id);
        const testCase = await createCase(otherProject.id, 'Other project case');
        const wrongPath = `${suitesPath(otherProject.id)}/${suite.id}`;

        expectError(await request('GET', wrongPath, { token: admin.token }), 404, 'NOT_FOUND');
        expectError(await request('PUT', wrongPath, { token: admin.token, body: { id: suite.id, name: 'Moved', description: '' } }), 404, 'NOT_FOUND');
        expectError(await request('POST', `${wrongPath}/test-cases`, { token: admin.token, body: { testCaseIds: [testCase.id] } }), 404, 'NOT_FOUND');
        expectError(await request('DELETE', wrongPath, { token: admin.token }), 404, 'NOT_FOUND');
        expectBody(await request('GET', `${suitesPath(project.id)}/${suite.id}`, { token: admin.token }), 200, testSuiteDetailsResponseSchema);
    });

    // PRD: test-lead manages suites in their projects; tester and read-only only view; non-members see nothing.
    it('a member TEST_LEAD manages suites; a member TESTER reads but gets 403 on writes; a non-member gets 404', async () => {
        const [lead, tester, outsider] = await Promise.all([createTestUser('TEST_LEAD'), createTestUser('TESTER'), createTestUser('TEST_LEAD')]);
        const project = await createTestProject(admin, [lead.id, tester.id]);
        const suite = await createSuite(lead, project.id);
        const testCase = await createCase(project.id, 'Case');
        expectBody(await addCases(lead, suite, [testCase.id]), 200, testSuiteDetailsResponseSchema);

        const suitePath = `${suitesPath(project.id)}/${suite.id}`;
        expectBody(await request('GET', suitePath, { token: tester.token }), 200, testSuiteDetailsResponseSchema);
        expectError(await request('POST', suitesPath(project.id), { token: tester.token, body: { name: 'Nope', description: '' } }), 403, 'FORBIDDEN');
        expectError(await reorder(tester, suite, [testCase.id]), 403, 'FORBIDDEN');
        expectError(await request('DELETE', `${suitePath}/test-cases/${testCase.id}`, { token: tester.token }), 403, 'FORBIDDEN');
        expectError(await request('DELETE', suitePath, { token: tester.token }), 403, 'FORBIDDEN');

        expectError(await request('GET', suitesPath(project.id), { token: outsider.token }), 404, 'NOT_FOUND');
        expectError(await request('DELETE', suitePath, { token: outsider.token }), 404, 'NOT_FOUND');

        expect((await request('DELETE', suitePath, { token: lead.token })).status).toBe(204);
    });
});
