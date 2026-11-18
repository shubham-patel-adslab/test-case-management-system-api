// Test executions (PRD Features §4): assigning, running and recording results, the snapshot that keeps history
// unchanged, the audit trail, progress, and the rules around them — results are immutable, any project member
// who may execute can record, a read-only user can't, and deleting a test case never deletes recorded history.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testCaseDetailsResponseSchema, testCasePageResponseSchema, type TestCaseDetailsResponseDto } from '../src/features/test-case/test-case.response.dto.js';
import {
    testExecutionAssignResponseSchema,
    testExecutionAuditLogListResponseSchema,
    testExecutionDetailsResponseSchema,
    testExecutionPageResponseSchema,
    testExecutionProgressResponseSchema,
} from '../src/features/test-execution/test-execution.response.dto.js';
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

const TWO_STEPS = [
    { action: 'Open the sign-in page', expectedResult: 'The form is shown' },
    { action: 'Submit valid credentials', expectedResult: 'The dashboard opens' },
];

function executionsPath(projectId: number): string {
    return `/projects/${projectId}/test-executions`;
}

async function createCase(projectId: number, title = 'Sign in'): Promise<TestCaseDetailsResponseDto> {
    const body = {
        title, description: '', priority: 'HIGH', type: 'FUNCTIONAL', preConditions: '', postConditions: '', tags: [],
        steps: TWO_STEPS, suiteIds: [],
    };

    return expectBody(await request('POST', `/projects/${projectId}/test-cases`, { token: admin.token, body }), 201, testCaseDetailsResponseSchema);
}

function assign(caller: TestUser, projectId: number, testCaseIds: number[], assigneeId: string) {
    return request('POST', `${executionsPath(projectId)}/assignments`, { token: caller.token, body: { testCaseIds, assigneeId } });
}

async function pendingIdsOf(projectId: number, assigneeId: string): Promise<number[]> {
    const page = expectBody(
        await request('GET', `${executionsPath(projectId)}?status=PENDING&assigneeId=${assigneeId}`, { token: admin.token }),
        200,
        testExecutionPageResponseSchema,
    );

    return page.items.map((item) => item.id);
}

function record(caller: TestUser, projectId: number, executionId: number, body: unknown) {
    return request('PUT', `${executionsPath(projectId)}/${executionId}`, { token: caller.token, body });
}

// A project with a tester and a test lead on the team, one test case assigned to the tester.
async function assignedSetup() {
    const [tester, lead] = await Promise.all([createTestUser('TESTER'), createTestUser('TEST_LEAD')]);
    const project = await createTestProject(admin, [tester.id, lead.id]);
    const testCase = await createCase(project.id);
    expectBody(await assign(lead, project.id, [testCase.id], tester.id), 201, testExecutionAssignResponseSchema);
    const [executionId] = await pendingIdsOf(project.id, tester.id);

    if (executionId === undefined) {
        throw new Error('assignment created no execution');
    }

    return { tester, lead, project, testCase, executionId };
}

describe('POST /projects/:projectId/test-executions/assignments', () => {
    // PRD "Assign test cases to testers": the tester's queue gets one pending execution per test case;
    // assigning again doesn't duplicate the work.
    it('creates one pending execution per test case for the assignee; assigning again skips them', async () => {
        const tester = await createTestUser('TESTER');
        const project = await createTestProject(admin, [tester.id]);
        const [first, second] = [await createCase(project.id, 'First'), await createCase(project.id, 'Second')];

        expect(expectBody(await assign(admin, project.id, [first.id, second.id], tester.id), 201, testExecutionAssignResponseSchema)).toEqual({ createdCount: 2 });
        expect(expectBody(await assign(admin, project.id, [first.id], tester.id), 201, testExecutionAssignResponseSchema)).toEqual({ createdCount: 0 });

        const [executionId] = await pendingIdsOf(project.id, tester.id);
        const execution = expectBody(await request('GET', `${executionsPath(project.id)}/${executionId}`, { token: tester.token }), 200, testExecutionDetailsResponseSchema);
        expect(execution).toMatchObject({ status: 'PENDING', assignee: { id: tester.id }, executedBy: null, executedAt: null });
        // Pending: the steps the tester is about to run, without results.
        expect(execution.steps.map((step) => [step.order, step.status])).toEqual([[1, null], [2, null]]);
    });

    // Work can only go to someone who can do it, inside the project.
    it('rejects a read-only, non-member or inactive assignee (400 on assigneeId) and another project\'s test case', async () => {
        const [readOnly, outsider, inactive, tester] = await Promise.all([
            createTestUser('READ_ONLY'), createTestUser('TESTER'), createTestUser('TESTER'), createTestUser('TESTER'),
        ]);
        const project = await createTestProject(admin, [readOnly.id, inactive.id, tester.id]);
        await request('PATCH', `/users/${inactive.id}/status`, { token: admin.token, body: { status: 'INACTIVE' } });
        const testCase = await createCase(project.id);

        for (const assignee of [readOnly, outsider, inactive]) {
            const error = expectError(await assign(admin, project.id, [testCase.id], assignee.id), 400, 'VALIDATION_ERROR');

            expect(error.details?.[0]?.field).toBe('assigneeId');
        }

        const foreign = await createCase((await createTestProject(admin)).id);
        const error = expectError(await assign(admin, project.id, [testCase.id, foreign.id], tester.id), 400, 'VALIDATION_ERROR');
        expect(error.details?.map((detail) => detail.field)).toEqual(['testCaseIds[1]']);
        expect(await pendingIdsOf(project.id, tester.id)).toEqual([]);
    });

    it('only admin and test-lead assign: a member TESTER gets 403', async () => {
        const tester = await createTestUser('TESTER');
        const project = await createTestProject(admin, [tester.id]);
        const testCase = await createCase(project.id);

        expectError(await assign(tester, project.id, [testCase.id], tester.id), 403, 'FORBIDDEN');
    });
});

describe('PUT /projects/:projectId/test-executions/:executionId — record a result', () => {
    // The core flow: the result, who ran it, the steps as run with their results, the test case's last result,
    // and the audit trail.
    it('records the result once: snapshot with step results, executor, lastResult, audit trail', async () => {
        const { tester, lead, project, testCase, executionId } = await assignedSetup();
        const body = { status: 'FAIL', comment: '  Dashboard empty  ', stepResults: [{ order: 2, status: 'FAIL', comment: 'Blank page' }] };

        const recorded = expectBody(await record(tester, project.id, executionId, body), 200, testExecutionDetailsResponseSchema);

        expect(recorded).toMatchObject({ status: 'FAIL', comment: 'Dashboard empty', executedBy: { id: tester.id }, assignee: { id: tester.id } });
        expect(recorded.executedAt).not.toBeNull();
        expect(recorded.steps.map((step) => [step.order, step.action, step.status, step.comment])).toEqual([
            [1, 'Open the sign-in page', null, ''],
            [2, 'Submit valid credentials', 'FAIL', 'Blank page'],
        ]);

        const updatedCase = expectBody(await request('GET', `/projects/${project.id}/test-cases/${testCase.id}`, { token: tester.token }), 200, testCaseDetailsResponseSchema);
        expect(updatedCase.lastResult).toBe('FAIL');
        expect(updatedCase.lastExecutedAt).toBe(recorded.executedAt);

        const audit = expectBody(await request('GET', `${executionsPath(project.id)}/${executionId}/audit`, { token: tester.token }), 200, testExecutionAuditLogListResponseSchema);
        expect(audit.map((entry) => [entry.action, entry.actor?.id, entry.details])).toEqual([
            ['CREATED', lead.id, { assigneeId: tester.id }],
            ['RESULT_RECORDED', tester.id, { status: 'FAIL' }],
        ]);
    });

    // Results are immutable: history is never rewritten; a correction is a new run.
    it('answers 409 when the result is already recorded, and keeps the first result', async () => {
        const { tester, project, executionId } = await assignedSetup();

        expectBody(await record(tester, project.id, executionId, { status: 'PASS' }), 200, testExecutionDetailsResponseSchema);
        expectError(await record(tester, project.id, executionId, { status: 'FAIL' }), 409, 'CONFLICT');

        const execution = expectBody(await request('GET', `${executionsPath(project.id)}/${executionId}`, { token: tester.token }), 200, testExecutionDetailsResponseSchema);
        expect(execution.status).toBe('PASS');
    });

    // Two people submitting at the same moment: the row lock lets exactly one win.
    it('two concurrent recordings: exactly one succeeds, the other gets 409', async () => {
        const { tester, lead, project, executionId } = await assignedSetup();

        const responses = await Promise.all([
            record(tester, project.id, executionId, { status: 'PASS' }),
            record(lead, project.id, executionId, { status: 'FAIL' }),
        ]);

        expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    });

    // History must not change when the test case changes later (api-requirements §9).
    it('a recorded execution keeps its snapshot when the test case is edited', async () => {
        const { tester, project, testCase, executionId } = await assignedSetup();
        expectBody(await record(tester, project.id, executionId, { status: 'PASS' }), 200, testExecutionDetailsResponseSchema);

        const editBody = {
            id: testCase.id, title: 'Renamed', description: '', priority: 'LOW', type: 'UI', preConditions: '', postConditions: '',
            tags: [], steps: [{ action: 'Completely new step', expectedResult: 'New result' }], suiteIds: [],
        };
        expectBody(await request('PUT', `/projects/${project.id}/test-cases/${testCase.id}`, { token: admin.token, body: editBody }), 200, testCaseDetailsResponseSchema);

        const execution = expectBody(await request('GET', `${executionsPath(project.id)}/${executionId}`, { token: tester.token }), 200, testExecutionDetailsResponseSchema);
        expect(execution.testCaseTitle).toBe('Sign in');
        expect(execution.steps.map((step) => step.action)).toEqual(TWO_STEPS.map((step) => step.action));
    });

    it('rejects a result for a step that does not exist, a repeated step, and PASS with a failed step (400) — still pending', async () => {
        const { tester, project, executionId } = await assignedSetup();
        const cases: [unknown, string][] = [
            [{ status: 'FAIL', stepResults: [{ order: 3, status: 'FAIL' }] }, 'stepResults[0].order'],
            [{ status: 'FAIL', stepResults: [{ order: 1, status: 'FAIL' }, { order: 1, status: 'PASS' }] }, 'stepResults'],
            [{ status: 'PASS', stepResults: [{ order: 1, status: 'FAIL' }] }, 'status'],
            [{ status: 'PENDING' }, 'status'],
        ];

        for (const [body, field] of cases) {
            const error = expectError(await record(tester, project.id, executionId, body), 400, 'VALIDATION_ERROR');

            expect(error.details?.[0]?.field, JSON.stringify(body)).toBe(field);
        }

        expect(await pendingIdsOf(project.id, tester.id)).toEqual([executionId]);
    });

    // PRD §4: tester, test-lead and admin execute — not only the assignee; read-only and non-members can't.
    it('another member who may execute can record it; a member READ_ONLY gets 403 and a non-member 404', async () => {
        const { lead, project, executionId } = await assignedSetup();
        const [readOnly, outsider] = await Promise.all([createTestUser('READ_ONLY'), createTestUser('TESTER')]);
        const team = [...project.members.map((member) => member.id), readOnly.id];
        await request('PUT', `/projects/${project.id}`, {
            token: admin.token,
            body: { id: project.id, name: project.name, description: '', version: project.version, status: project.status, memberIds: team },
        });

        expectError(await record(readOnly, project.id, executionId, { status: 'PASS' }), 403, 'FORBIDDEN');
        expectError(await record(outsider, project.id, executionId, { status: 'PASS' }), 404, 'NOT_FOUND');

        const recorded = expectBody(await record(lead, project.id, executionId, { status: 'BLOCKED' }), 200, testExecutionDetailsResponseSchema);
        expect(recorded.executedBy?.id).toBe(lead.id);
    });
});

describe('POST /projects/:projectId/test-executions — ad hoc run', () => {
    it('runs a test case without an assignment: 201, Location, recorded with its snapshot', async () => {
        const tester = await createTestUser('TESTER');
        const project = await createTestProject(admin, [tester.id]);
        const testCase = await createCase(project.id);

        const response = await request('POST', executionsPath(project.id), { token: tester.token, body: { testCaseId: testCase.id, status: 'SKIPPED' } });
        const execution = expectBody(response, 201, testExecutionDetailsResponseSchema);

        expect(response.headers.get('location')).toBe(`/api${executionsPath(project.id)}/${execution.id}`);
        expect(execution).toMatchObject({ testCaseId: testCase.id, status: 'SKIPPED', assignee: null, executedBy: { id: tester.id }, suiteRunId: null });
        expect(execution.steps).toHaveLength(2);
    });

    it('rejects another project\'s test case (400 on testCaseId); a READ_ONLY member gets 403', async () => {
        const readOnly = await createTestUser('READ_ONLY');
        const project = await createTestProject(admin, [readOnly.id]);
        const own = await createCase(project.id);
        const foreign = await createCase((await createTestProject(admin)).id);

        const error = expectError(await request('POST', executionsPath(project.id), { token: admin.token, body: { testCaseId: foreign.id, status: 'PASS' } }), 400, 'VALIDATION_ERROR');
        expect(error.details?.[0]?.field).toBe('testCaseId');
        expectError(await request('POST', executionsPath(project.id), { token: readOnly.token, body: { testCaseId: own.id, status: 'PASS' } }), 403, 'FORBIDDEN');
    });
});

describe('Deleting a test case with executions', () => {
    // History is never deleted: recorded executions survive with their snapshot; pending ones (nothing happened
    // yet) go with the test case.
    it('removes pending executions, keeps recorded ones with testCaseId null and their title and steps', async () => {
        const { tester, project, testCase, executionId: recordedId } = await assignedSetup();
        expectBody(await record(tester, project.id, recordedId, { status: 'PASS' }), 200, testExecutionDetailsResponseSchema);
        await assign(admin, project.id, [testCase.id], tester.id);
        const [pendingId] = await pendingIdsOf(project.id, tester.id);

        expect((await request('DELETE', `/projects/${project.id}/test-cases/${testCase.id}`, { token: admin.token })).status).toBe(204);

        expectError(await request('GET', `${executionsPath(project.id)}/${pendingId}`, { token: admin.token }), 404, 'NOT_FOUND');
        const recorded = expectBody(await request('GET', `${executionsPath(project.id)}/${recordedId}`, { token: admin.token }), 200, testExecutionDetailsResponseSchema);
        expect(recorded).toMatchObject({ testCaseId: null, testCaseTitle: 'Sign in', status: 'PASS' });
        expect(recorded.steps).toHaveLength(2);
    });

    it('bulk delete does the same', async () => {
        const { project, testCase, tester } = await assignedSetup();

        const response = await request('POST', `/projects/${project.id}/test-cases/bulk`, { token: admin.token, body: { action: 'DELETE', testCaseIds: [testCase.id] } });
        expect(response.status).toBe(200);
        expect(await pendingIdsOf(project.id, tester.id)).toEqual([]);
    });
});

describe('Queue, history, progress', () => {
    // PRD "Track execution progress" and the UI's queue tabs.
    it('filters by status, assignee and test case; progress counts per status', async () => {
        const [tester, other] = await Promise.all([createTestUser('TESTER'), createTestUser('TESTER')]);
        const project = await createTestProject(admin, [tester.id, other.id]);
        const [first, second] = [await createCase(project.id, 'First'), await createCase(project.id, 'Second')];
        await assign(admin, project.id, [first.id, second.id], tester.id);
        await assign(admin, project.id, [first.id], other.id);
        const [firstPending, secondPending] = await pendingIdsOf(project.id, tester.id);
        await record(tester, project.id, firstPending ?? 0, { status: 'PASS' });
        await request('POST', executionsPath(project.id), { token: other.token, body: { testCaseId: first.id, status: 'FAIL' } });

        const list = async (query: string) => expectBody(await request('GET', `${executionsPath(project.id)}?${query}`, { token: tester.token }), 200, testExecutionPageResponseSchema);

        expect((await list(`assigneeId=${tester.id}&status=PENDING`)).items.map((item) => item.id)).toEqual([secondPending]);
        expect((await list(`testCaseId=${first.id}&status=PASS,FAIL`)).totalItems).toBe(2);
        expect((await list('status=PENDING')).totalItems).toBe(2);

        const progress = expectBody(await request('GET', `${executionsPath(project.id)}/progress`, { token: tester.token }), 200, testExecutionProgressResponseSchema);
        expect(progress).toEqual({ total: 4, pending: 2, passed: 1, failed: 1, blocked: 0, skipped: 0 });

        const mine = expectBody(await request('GET', `${executionsPath(project.id)}/progress?assigneeId=${tester.id}`, { token: tester.token }), 200, testExecutionProgressResponseSchema);
        expect(mine).toMatchObject({ total: 2, pending: 1, passed: 1 });
    });

    // The test case list's "last result" column: filter, and sort with never-executed cases last.
    it('the test case list filters by lastResult and sorts by lastExecutedAt with never-executed last', async () => {
        const tester = await createTestUser('TESTER');
        const project = await createTestProject(admin, [tester.id]);
        const [passed, failed, never] = [await createCase(project.id, 'Passed'), await createCase(project.id, 'Failed'), await createCase(project.id, 'Never')];
        await request('POST', executionsPath(project.id), { token: tester.token, body: { testCaseId: passed.id, status: 'PASS' } });
        await request('POST', executionsPath(project.id), { token: tester.token, body: { testCaseId: failed.id, status: 'FAIL' } });

        const ids = async (query: string) =>
            expectBody(await request('GET', `/projects/${project.id}/test-cases?${query}`, { token: tester.token }), 200, testCasePageResponseSchema).items.map((item) => item.id);

        expect(await ids('lastResult=FAIL')).toEqual([failed.id]);
        expect(await ids('sort=lastExecutedAt:desc')).toEqual([failed.id, passed.id, never.id]);
        expect(await ids('sort=lastExecutedAt:asc')).toEqual([passed.id, failed.id, never.id]);
    });

    // The queue's default order is by test case title (like every list of named things); the UI can still ask
    // for newest first (a history) or by run time, where pending executions (not run yet) come last.
    it('lists executions by test case title by default; sort by createdAt or executedAt on request', async () => {
        const tester = await createTestUser('TESTER');
        const project = await createTestProject(admin, [tester.id]);
        const [charlie, alpha, bravo] = [await createCase(project.id, 'charlie'), await createCase(project.id, 'Alpha'), await createCase(project.id, 'bravo')];
        await assign(admin, project.id, [charlie.id], tester.id);
        await request('POST', executionsPath(project.id), { token: tester.token, body: { testCaseId: alpha.id, status: 'PASS' } });
        await request('POST', executionsPath(project.id), { token: tester.token, body: { testCaseId: bravo.id, status: 'FAIL' } });

        const titles = async (query: string) =>
            expectBody(await request('GET', `${executionsPath(project.id)}?${query}`, { token: tester.token }), 200, testExecutionPageResponseSchema)
                .items.map((item) => item.testCaseTitle);

        expect(await titles('')).toEqual(['Alpha', 'bravo', 'charlie']);
        expect(await titles('sort=createdAt:desc')).toEqual(['bravo', 'Alpha', 'charlie']);
        expect(await titles('sort=executedAt:desc')).toEqual(['bravo', 'Alpha', 'charlie']);
        expect(await titles('sort=executedAt:asc')).toEqual(['Alpha', 'bravo', 'charlie']);

        const invalid = await request('GET', `${executionsPath(project.id)}?sort=status:asc`, { token: tester.token });
        expect(expectError(invalid, 400, 'VALIDATION_ERROR').details?.map((detail) => detail.field)).toEqual(['sort']);
    });
});
