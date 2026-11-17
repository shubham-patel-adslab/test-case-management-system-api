// Suite runs (PRD Features §6 "Execute entire test suites", "Suite-level reporting"): running a suite creates one
// pending execution per test case in suite order; the report shows progress and every execution, and keeps
// working after the suite changes or is deleted.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { suiteRunDetailsResponseSchema, suiteRunPageResponseSchema, type SuiteRunDetailsResponseDto } from '../src/features/suite-run/suite-run.response.dto.js';
import { testCaseDetailsResponseSchema, type TestCaseDetailsResponseDto } from '../src/features/test-case/test-case.response.dto.js';
import {
    testExecutionAuditLogListResponseSchema,
    testExecutionDetailsResponseSchema,
    testExecutionPageResponseSchema,
} from '../src/features/test-execution/test-execution.response.dto.js';
import { testSuiteDetailsResponseSchema, type TestSuiteDetailsResponseDto } from '../src/features/test-suite/test-suite.response.dto.js';
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

async function createCase(projectId: number, title: string): Promise<TestCaseDetailsResponseDto> {
    const body = {
        title, description: '', priority: 'MEDIUM', type: 'FUNCTIONAL', preConditions: '', postConditions: '', tags: [],
        steps: [{ action: 'Do it', expectedResult: 'It works' }], suiteIds: [],
    };

    return expectBody(await request('POST', `/projects/${projectId}/test-cases`, { token: admin.token, body }), 201, testCaseDetailsResponseSchema);
}

// A suite holding the given test cases, in that order.
async function createSuite(projectId: number, testCaseIds: number[], name = 'Smoke'): Promise<TestSuiteDetailsResponseDto> {
    const suite = expectBody(await request('POST', `/projects/${projectId}/test-suites`, { token: admin.token, body: { name, description: '' } }), 201, testSuiteDetailsResponseSchema);

    if (testCaseIds.length === 0) {
        return suite;
    }

    return expectBody(await request('POST', `/projects/${projectId}/test-suites/${suite.id}/test-cases`, { token: admin.token, body: { testCaseIds } }), 200, testSuiteDetailsResponseSchema);
}

function runSuite(caller: TestUser, projectId: number, suiteId: number, body?: unknown) {
    return request('POST', `/projects/${projectId}/test-suites/${suiteId}/runs`, { token: caller.token, body });
}

function getRun(caller: TestUser, projectId: number, runId: number) {
    return request('GET', `/projects/${projectId}/suite-runs/${runId}`, { token: caller.token });
}

function executionIdAt(run: SuiteRunDetailsResponseDto, index: number): number {
    const execution = run.executions[index];

    if (!execution) {
        throw new Error(`run has no execution at ${index}`);
    }

    return execution.id;
}

describe('POST /projects/:projectId/test-suites/:suiteId/runs', () => {
    // "Execute entire test suites": every test case of the suite, in the suite's order, ready to be run.
    it('creates one pending execution per test case in suite order: 201, Location, progress, audit', async () => {
        const tester = await createTestUser('TESTER');
        const project = await createTestProject(admin, [tester.id]);
        const [a, b, c] = [await createCase(project.id, 'A'), await createCase(project.id, 'B'), await createCase(project.id, 'C')];
        const suite = await createSuite(project.id, [c.id, a.id, b.id]);

        const response = await runSuite(tester, project.id, suite.id);
        const run = expectBody(response, 201, suiteRunDetailsResponseSchema.strict());

        expect(response.headers.get('location')).toBe(`/api/projects/${project.id}/suite-runs/${run.id}`);
        expect(run).toMatchObject({ suiteId: suite.id, suiteName: 'Smoke', createdBy: { id: tester.id } });
        expect(run.progress).toEqual({ total: 3, pending: 3, passed: 0, failed: 0, blocked: 0, skipped: 0 });
        expect(run.executions.map((execution) => [execution.testCaseId, execution.status, execution.suiteRunId, execution.assignee])).toEqual([
            [c.id, 'PENDING', run.id, null],
            [a.id, 'PENDING', run.id, null],
            [b.id, 'PENDING', run.id, null],
        ]);

        const audit = expectBody(await request('GET', `/projects/${project.id}/test-executions/${executionIdAt(run, 0)}/audit`, { token: tester.token }), 200, testExecutionAuditLogListResponseSchema);
        expect(audit.map((entry) => [entry.action, entry.details])).toEqual([['CREATED', { suiteRunId: run.id, assigneeId: null }]]);
    });

    // Running for yourself is executing; giving the work to someone else is assigning (admin/test-lead).
    it('assigns the run: a lead to a tester, a tester to themselves; a tester to someone else gets 403', async () => {
        const [lead, tester, other] = await Promise.all([createTestUser('TEST_LEAD'), createTestUser('TESTER'), createTestUser('TESTER')]);
        const project = await createTestProject(admin, [lead.id, tester.id, other.id]);
        const suite = await createSuite(project.id, [(await createCase(project.id, 'A')).id]);

        const byLead = expectBody(await runSuite(lead, project.id, suite.id, { assigneeId: tester.id }), 201, suiteRunDetailsResponseSchema);
        expect(byLead.executions.map((execution) => execution.assignee?.id)).toEqual([tester.id]);

        const forSelf = expectBody(await runSuite(tester, project.id, suite.id, { assigneeId: tester.id }), 201, suiteRunDetailsResponseSchema);
        expect(forSelf.executions.map((execution) => execution.assignee?.id)).toEqual([tester.id]);

        expectError(await runSuite(tester, project.id, suite.id, { assigneeId: other.id }), 403, 'FORBIDDEN');
    });

    it('rejects an empty suite (409), a read-only member (403), a non-member or another project\'s suite (404)', async () => {
        const [readOnly, outsider] = await Promise.all([createTestUser('READ_ONLY'), createTestUser('TESTER')]);
        const project = await createTestProject(admin, [readOnly.id]);
        const empty = await createSuite(project.id, []);
        const suite = await createSuite(project.id, [(await createCase(project.id, 'A')).id], 'Full');
        const otherProject = await createTestProject(admin);

        expectError(await runSuite(admin, project.id, empty.id), 409, 'CONFLICT');
        expectError(await runSuite(readOnly, project.id, suite.id), 403, 'FORBIDDEN');
        expectError(await runSuite(outsider, project.id, suite.id), 404, 'NOT_FOUND');
        expectError(await runSuite(admin, otherProject.id, suite.id), 404, 'NOT_FOUND');
    });
});

describe('Suite report', () => {
    // "Suite-level reporting": results recorded on the run's executions show up in its progress, in the list of
    // the suite's runs, and in the queue filtered by run.
    it('progress follows recorded results; the suite lists its runs newest first', async () => {
        const tester = await createTestUser('TESTER');
        const project = await createTestProject(admin, [tester.id]);
        const suite = await createSuite(project.id, [(await createCase(project.id, 'A')).id, (await createCase(project.id, 'B')).id]);
        const older = expectBody(await runSuite(tester, project.id, suite.id), 201, suiteRunDetailsResponseSchema);
        const run = expectBody(await runSuite(tester, project.id, suite.id), 201, suiteRunDetailsResponseSchema);

        await request('PUT', `/projects/${project.id}/test-executions/${executionIdAt(run, 0)}`, { token: tester.token, body: { status: 'PASS' } });
        await request('PUT', `/projects/${project.id}/test-executions/${executionIdAt(run, 1)}`, { token: tester.token, body: { status: 'FAIL' } });

        const report = expectBody(await getRun(tester, project.id, run.id), 200, suiteRunDetailsResponseSchema);
        expect(report.progress).toEqual({ total: 2, pending: 0, passed: 1, failed: 1, blocked: 0, skipped: 0 });
        expect(report.executions.map((execution) => execution.status)).toEqual(['PASS', 'FAIL']);

        const runs = expectBody(await request('GET', `/projects/${project.id}/test-suites/${suite.id}/runs`, { token: tester.token }), 200, suiteRunPageResponseSchema);
        expect(runs.items.map((item) => [item.id, item.progress.pending])).toEqual([[run.id, 0], [older.id, 2]]);

        const queue = expectBody(await request('GET', `/projects/${project.id}/test-executions?suiteRunId=${run.id}`, { token: tester.token }), 200, testExecutionPageResponseSchema);
        expect(queue.totalItems).toBe(2);
    });

    // History outlives the suite: the run keeps its name and results after the suite is deleted.
    it('stays available after the suite is deleted (suiteId null, name as it was)', async () => {
        const tester = await createTestUser('TESTER');
        const project = await createTestProject(admin, [tester.id]);
        const suite = await createSuite(project.id, [(await createCase(project.id, 'A')).id], 'Nightly');
        const run = expectBody(await runSuite(tester, project.id, suite.id), 201, suiteRunDetailsResponseSchema);
        await request('PUT', `/projects/${project.id}/test-executions/${executionIdAt(run, 0)}`, { token: tester.token, body: { status: 'PASS' } });

        expect((await request('DELETE', `/projects/${project.id}/test-suites/${suite.id}`, { token: admin.token })).status).toBe(204);

        const report = expectBody(await getRun(tester, project.id, run.id), 200, suiteRunDetailsResponseSchema);
        expect(report).toMatchObject({ suiteId: null, suiteName: 'Nightly', progress: { total: 1, passed: 1 } });
    });

    // A pending execution of a run goes with its deleted test case; the rest of the run is unaffected.
    it('deleting a test case removes its pending execution from the run', async () => {
        const project = await createTestProject(admin);
        const [a, b] = [await createCase(project.id, 'A'), await createCase(project.id, 'B')];
        const run = expectBody(await runSuite(admin, project.id, (await createSuite(project.id, [a.id, b.id])).id), 201, suiteRunDetailsResponseSchema);

        await request('DELETE', `/projects/${project.id}/test-cases/${a.id}`, { token: admin.token });

        const report = expectBody(await getRun(admin, project.id, run.id), 200, suiteRunDetailsResponseSchema);
        expect(report.executions.map((execution) => execution.testCaseId)).toEqual([b.id]);
        expect(report.progress.total).toBe(1);
        expectBody(await request('GET', `/projects/${project.id}/test-executions/${executionIdAt(report, 0)}`, { token: admin.token }), 200, testExecutionDetailsResponseSchema);
    });

    it('a run is 404 through another project\'s URL and for a non-member', async () => {
        const outsider = await createTestUser('TESTER');
        const project = await createTestProject(admin);
        const run = expectBody(await runSuite(admin, project.id, (await createSuite(project.id, [(await createCase(project.id, 'A')).id])).id), 201, suiteRunDetailsResponseSchema);

        expectError(await getRun(admin, (await createTestProject(admin)).id, run.id), 404, 'NOT_FOUND');
        expectError(await getRun(outsider, project.id, run.id), 404, 'NOT_FOUND');
    });
});
