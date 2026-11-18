// Defects (PRD Features §4 "Create defects/bugs directly from failed tests"): only from a FAIL, one per
// execution, linked from the execution and recorded in its audit trail; created by tester, test-lead and admin
// members only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defectDetailsResponseSchema } from '../src/features/defect/defect.response.dto.js';
import { testCaseDetailsResponseSchema } from '../src/features/test-case/test-case.response.dto.js';
import {
    testExecutionAuditLogListResponseSchema,
    testExecutionDetailsResponseSchema,
    testExecutionPageResponseSchema,
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

const DEFECT = { title: 'Dashboard is blank after sign-in', description: '1. Sign in\n2. See a blank page', severity: 'HIGH' };

// A project with a tester on the team and one ad hoc execution with the given result.
async function executionWith(status: string) {
    const tester = await createTestUser('TESTER');
    const project = await createTestProject(admin, [tester.id]);
    const caseBody = {
        title: 'Sign in', description: '', priority: 'HIGH', type: 'FUNCTIONAL', preConditions: '', postConditions: '', tags: [],
        steps: [{ action: 'Sign in', expectedResult: 'Dashboard' }], suiteIds: [],
    };
    const testCase = expectBody(await request('POST', `/projects/${project.id}/test-cases`, { token: admin.token, body: caseBody }), 201, testCaseDetailsResponseSchema);
    const execution = expectBody(
        await request('POST', `/projects/${project.id}/test-executions`, { token: tester.token, body: { testCaseId: testCase.id, status } }),
        201,
        testExecutionDetailsResponseSchema,
    );

    return { tester, project, execution };
}

function createDefect(caller: TestUser, projectId: number, executionId: number, body: unknown = DEFECT) {
    return request('POST', `/projects/${projectId}/test-executions/${executionId}/defects`, { token: caller.token, body });
}

describe('POST /projects/:projectId/test-executions/:executionId/defects', () => {
    // The PRD flow: a failed run → a defect, visible on the execution (details and history) and in its trail.
    it('creates a defect from a FAIL: 201, linked from the execution, audit DEFECT_CREATED', async () => {
        const { tester, project, execution } = await executionWith('FAIL');

        const defect = expectBody(await createDefect(tester, project.id, execution.id), 201, defectDetailsResponseSchema.strict());
        expect(defect).toMatchObject({ ...DEFECT, projectId: project.id, executionId: execution.id, createdBy: { id: tester.id } });

        const details = expectBody(await request('GET', `/projects/${project.id}/test-executions/${execution.id}`, { token: tester.token }), 200, testExecutionDetailsResponseSchema);
        expect(details.defect).toEqual(defect);

        const history = expectBody(await request('GET', `/projects/${project.id}/test-executions?testCaseId=${execution.testCaseId}`, { token: tester.token }), 200, testExecutionPageResponseSchema);
        expect(history.items[0]?.defect).toEqual({ id: defect.id, title: DEFECT.title, severity: 'HIGH' });

        const audit = expectBody(await request('GET', `/projects/${project.id}/test-executions/${execution.id}/audit`, { token: tester.token }), 200, testExecutionAuditLogListResponseSchema);
        expect(audit.map((entry) => [entry.action, entry.details])).toEqual([
            ['RESULT_RECORDED', { status: 'FAIL' }],
            ['DEFECT_CREATED', { defectId: defect.id }],
        ]);
    });

    // One per execution, even when two requests race (the unique constraint decides, atomically).
    it('allows one defect per execution: a second one, even concurrent, gets 409', async () => {
        const { tester, project, execution } = await executionWith('FAIL');

        const responses = await Promise.all([createDefect(tester, project.id, execution.id), createDefect(admin, project.id, execution.id)]);
        expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);

        expectError(await createDefect(tester, project.id, execution.id), 409, 'CONFLICT');
    });

    // "Directly from failed tests": a passed, blocked or pending execution has nothing to report.
    it('rejects a defect on an execution that did not fail (409)', async () => {
        for (const status of ['PASS', 'BLOCKED']) {
            const { tester, project, execution } = await executionWith(status);

            expectError(await createDefect(tester, project.id, execution.id), 409, 'CONFLICT');
        }
    });

    it('validates the body: blank title, unknown severity (400 on the field)', async () => {
        const { tester, project, execution } = await executionWith('FAIL');

        for (const [body, field] of [[{ ...DEFECT, title: '  ' }, 'title'], [{ ...DEFECT, severity: 'BLOCKER' }, 'severity']] as const) {
            const error = expectError(await createDefect(tester, project.id, execution.id, body), 400, 'VALIDATION_ERROR');

            expect(error.details?.[0]?.field).toBe(field);
        }
    });

    // Read-only views only; the project boundary holds as everywhere else.
    it('a member READ_ONLY gets 403; a non-member and another project\'s URL get 404', async () => {
        const { project, execution } = await executionWith('FAIL');
        const [readOnly, outsider] = await Promise.all([createTestUser('READ_ONLY'), createTestUser('TESTER')]);
        await request('PUT', `/projects/${project.id}`, {
            token: admin.token,
            body: { id: project.id, name: project.name, description: '', version: project.version, status: project.status, memberIds: [...project.members.map((m) => m.id), readOnly.id] },
        });

        expectError(await createDefect(readOnly, project.id, execution.id), 403, 'FORBIDDEN');
        expectError(await createDefect(outsider, project.id, execution.id), 404, 'NOT_FOUND');
        expectError(await createDefect(admin, (await createTestProject(admin)).id, execution.id), 404, 'NOT_FOUND');
    });
});
