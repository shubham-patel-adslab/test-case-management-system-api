// Authorization: what may the caller do? Permissions come from role_resource_permissions_map_std via the
// user's one role, are enforced on every route regardless of the UI, and change take effect immediately.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authorizationContextResponseSchema } from '../src/features/authorization/authorization.response.dto.js';
import { projectDetailsResponseSchema, projectPageResponseSchema } from '../src/features/project/project.response.dto.js';
import { roleListResponseSchema } from '../src/features/role/role.response.dto.js';
import { userDetailsResponseSchema } from '../src/features/user/user.response.dto.js';
import {
    countProjectsByName,
    countUsersByEmail,
    createTestUser,
    deleteTestEmails,
    deleteTestProjects,
    deleteTestUsers,
    expectBody,
    expectError,
    request,
    startTestServer,
    stopTestServer,
    testEmail,
    testProjectBody,
    type TestUser,
} from './support/test-api.js';

const NON_ADMIN_ROLES = ['TEST_LEAD', 'TESTER', 'READ_ONLY'] as const;

// Seeded grants on PROJECT per role (PRD Features §2: every role views, only admin and test-lead manage).
const PROJECT_PERMISSIONS_BY_ROLE = {
    ADMIN: ['CREATE', 'DELETE', 'READ', 'UPDATE'],
    TEST_LEAD: ['CREATE', 'READ', 'UPDATE'],
    TESTER: ['READ'],
    READ_ONLY: ['READ'],
} as const;

// Execution-related grants per role (PRD Features §1/§4: tester, test-lead and admin execute and raise
// defects; only admin and test-lead assign; read-only views).
const EXECUTION_PERMISSIONS_BY_ROLE = {
    ADMIN: { TEST_EXECUTION: ['CREATE', 'READ', 'UPDATE'], TEST_ASSIGNMENT: ['CREATE'], DEFECT: ['CREATE', 'READ'] },
    TEST_LEAD: { TEST_EXECUTION: ['CREATE', 'READ', 'UPDATE'], TEST_ASSIGNMENT: ['CREATE'], DEFECT: ['CREATE', 'READ'] },
    TESTER: { TEST_EXECUTION: ['CREATE', 'READ', 'UPDATE'], DEFECT: ['CREATE', 'READ'] },
    READ_ONLY: { TEST_EXECUTION: ['READ'], DEFECT: ['READ'] },
} as const;

// Same grants on TEST_CASE and TEST_SUITE (PRD Features §3/§6: admin and test-lead manage, others view).
const TEST_CONTENT_PERMISSIONS_BY_ROLE = {
    ADMIN: ['CREATE', 'DELETE', 'READ', 'UPDATE'],
    TEST_LEAD: ['CREATE', 'DELETE', 'READ', 'UPDATE'],
    TESTER: ['READ'],
    READ_ONLY: ['READ'],
} as const;

let admin: TestUser;
let target: TestUser;

beforeAll(async () => {
    await startTestServer();
    admin = await createTestUser('ADMIN');
    target = await createTestUser('TESTER');
});
afterAll(async () => {
    await deleteTestEmails();
    await deleteTestProjects();
    await deleteTestUsers();
    await stopTestServer();
});

function updateBody(user: TestUser, roleCode: string) {
    return { id: user.id, firstName: 'Test', lastName: 'Updated', email: user.email, roleCode };
}

// Every protected user/role operation, as a caller could send it directly (bypassing the UI), with the
// status an admin gets — past authorization, into the business rules.
function userEndpoints(newUserEmail: string) {
    return [
        { name: 'GET /users', method: 'GET', path: '/users', adminStatus: 200 },
        {
            name: 'POST /users',
            method: 'POST',
            path: '/users',
            body: { firstName: 'X', lastName: 'Y', email: newUserEmail, roleCode: 'ADMIN' },
            adminStatus: 201,
        },
        { name: 'GET /users/:userId', method: 'GET', path: `/users/${target.id}`, adminStatus: 200 },
        { name: 'PUT /users/:userId', method: 'PUT', path: `/users/${target.id}`, body: updateBody(target, 'TESTER'), adminStatus: 200 },
        { name: 'PATCH /users/:userId/status', method: 'PATCH', path: `/users/${target.id}/status`, body: { status: 'ACTIVE' }, adminStatus: 200 },
        // target is ACTIVE, so the admin passes authorization and gets the business rule's 409.
        { name: 'POST /users/:userId/invitation', method: 'POST', path: `/users/${target.id}/invitation`, adminStatus: 409 },
        { name: 'GET /roles', method: 'GET', path: '/roles', adminStatus: 200 },
    ];
}

describe('GET /authorization/me — role and permissions from the database', () => {
    // The UI's can(resource, permission) reads this map; it must match the seeded grants exactly.
    it('ADMIN gets every USER, PROJECT, TEST_CASE and TEST_SUITE permission, and ALL_PROJECTS (no membership needed)', async () => {
        const context = expectBody(await request('GET', '/authorization/me', { token: admin.token }), 200, authorizationContextResponseSchema.strict());

        expect(context.role).toEqual({ code: 'ADMIN', name: 'Admin' });
        expect(context.permissions).toEqual({
            ALL_PROJECTS: ['DELETE', 'READ', 'UPDATE'],
            PROJECT: PROJECT_PERMISSIONS_BY_ROLE.ADMIN,
            TEST_CASE: TEST_CONTENT_PERMISSIONS_BY_ROLE.ADMIN,
            TEST_SUITE: TEST_CONTENT_PERMISSIONS_BY_ROLE.ADMIN,
            ...EXECUTION_PERMISSIONS_BY_ROLE.ADMIN,
            USER: ['CREATE', 'DELETE', 'READ', 'UPDATE'],
        });
    });

    for (const roleCode of NON_ADMIN_ROLES) {
        it(`${roleCode} gets its PROJECT, TEST_CASE and TEST_SUITE permissions, no ALL_PROJECTS and no USER permission (least privilege)`, async () => {
            const user = await createTestUser(roleCode);
            const context = expectBody(await request('GET', '/authorization/me', { token: user.token }), 200, authorizationContextResponseSchema);

            expect(context.role.code).toBe(roleCode);
            expect(context.permissions).toEqual({
                PROJECT: PROJECT_PERMISSIONS_BY_ROLE[roleCode],
                TEST_CASE: TEST_CONTENT_PERMISSIONS_BY_ROLE[roleCode],
                TEST_SUITE: TEST_CONTENT_PERMISSIONS_BY_ROLE[roleCode],
                ...EXECUTION_PERMISSIONS_BY_ROLE[roleCode],
            });
        });
    }
});

describe('Role × endpoint matrix', () => {
    // The backend is the security boundary: hiding a button in the UI is not enough.
    for (const roleCode of NON_ADMIN_ROLES) {
        it(`${roleCode} gets 403 FORBIDDEN on every user/role endpoint, and nothing is written`, async () => {
            const caller = await createTestUser(roleCode);
            const newUserEmail = testEmail('forbidden');

            for (const endpoint of userEndpoints(newUserEmail)) {
                const response = await request(endpoint.method, endpoint.path, { token: caller.token, body: endpoint.body });

                expect(response.status, `${roleCode} ${endpoint.name}: ${response.text}`).toBe(403);
                expectError(response, 403, 'FORBIDDEN');
            }

            expect(await countUsersByEmail(newUserEmail)).toBe(0);
        });
    }

    it('ADMIN is allowed on every user/role endpoint', async () => {
        for (const endpoint of userEndpoints(testEmail('allowed'))) {
            const response = await request(endpoint.method, endpoint.path, { token: admin.token, body: endpoint.body });

            expect(response.status, `ADMIN ${endpoint.name}: ${response.text}`).toBe(endpoint.adminStatus);
        }
    });
});

describe('Project permissions', () => {
    // Every role reads projects; only ADMIN and TEST_LEAD create and update them; only ADMIN deletes —
    // enforced by the API, not just hidden in the UI. The caller is a member of the project, so membership
    // isn't what decides here (project.test.ts covers membership).
    for (const roleCode of Object.keys(PROJECT_PERMISSIONS_BY_ROLE) as (keyof typeof PROJECT_PERMISSIONS_BY_ROLE)[]) {
        const permissions: readonly string[] = PROJECT_PERMISSIONS_BY_ROLE[roleCode];
        const canCreate = permissions.includes('CREATE');
        const canUpdate = permissions.includes('UPDATE');
        const canDelete = permissions.includes('DELETE');

        it(`${roleCode} ${canCreate ? 'reads, creates and updates' : 'only reads'} projects${canDelete ? ', and deletes them' : ''}`, async () => {
            const caller = await createTestUser(roleCode);
            const existing = expectBody(
                await request('POST', '/projects', { token: admin.token, body: testProjectBody('existing', [caller.id]) }),
                201,
                projectDetailsResponseSchema,
            );

            expectBody(await request('GET', '/projects', { token: caller.token }), 200, projectPageResponseSchema);
            expectBody(await request('GET', `/projects/${existing.id}`, { token: caller.token }), 200, projectDetailsResponseSchema);

            const createBody = testProjectBody('created');
            const create = await request('POST', '/projects', { token: caller.token, body: createBody });
            const update = await request('PUT', `/projects/${existing.id}`, {
                token: caller.token,
                body: { ...testProjectBody('updated', [caller.id]), id: existing.id },
            });

            if (canCreate) {
                expectBody(create, 201, projectDetailsResponseSchema);
            } else {
                expectError(create, 403, 'FORBIDDEN');
                expect(await countProjectsByName(createBody.name)).toBe(0);
            }

            if (canUpdate) {
                expectBody(update, 200, projectDetailsResponseSchema);
            } else {
                expectError(update, 403, 'FORBIDDEN');
                expect(await countProjectsByName(existing.name)).toBe(1);
            }

            const remove = await request('DELETE', `/projects/${existing.id}`, { token: caller.token });

            if (canDelete) {
                expect(remove.status).toBe(204);
            } else {
                expectError(remove, 403, 'FORBIDDEN');
                expectBody(await request('GET', `/projects/${existing.id}`, { token: admin.token }), 200, projectDetailsResponseSchema);
            }
        });
    }
});

describe('Permissions are resolved per request', () => {
    // The role is not in the token, so a role change must apply to the user's existing token at once.
    it('a promotion and a demotion apply to the same token immediately', async () => {
        const lead = await createTestUser('TEST_LEAD');

        expectError(await request('GET', '/users', { token: lead.token }), 403, 'FORBIDDEN');

        expectBody(await request('PUT', `/users/${lead.id}`, { token: admin.token, body: updateBody(lead, 'ADMIN') }), 200, userDetailsResponseSchema);
        expect((await request('GET', '/users', { token: lead.token })).status).toBe(200);
        expect(expectBody(await request('GET', '/authorization/me', { token: lead.token }), 200, authorizationContextResponseSchema).role.code).toBe('ADMIN');

        expectBody(await request('PUT', `/users/${lead.id}`, { token: admin.token, body: updateBody(lead, 'TEST_LEAD') }), 200, userDetailsResponseSchema);
        expectError(await request('GET', '/users', { token: lead.token }), 403, 'FORBIDDEN');
    });
});

describe('No self-elevation', () => {
    // Nobody changes their own role or status: no privilege escalation, no admin lock-out.
    it('an admin cannot change their own role or status, but can edit their own name', async () => {
        expectError(await request('PUT', `/users/${admin.id}`, { token: admin.token, body: updateBody(admin, 'TESTER') }), 403, 'FORBIDDEN');
        expectError(await request('PATCH', `/users/${admin.id}/status`, { token: admin.token, body: { status: 'INACTIVE' } }), 403, 'FORBIDDEN');

        const renamed = expectBody(await request('PUT', `/users/${admin.id}`, { token: admin.token, body: updateBody(admin, 'ADMIN') }), 200, userDetailsResponseSchema);
        expect(renamed.lastName).toBe('Updated');
        expect(renamed.role.code).toBe('ADMIN');
    });

    // The id is compared as a string; an uppercase UUID must not slip past the "own account" check.
    it('the self-check also holds for an uppercase user id in the URL', async () => {
        const response = await request('PATCH', `/users/${admin.id.toUpperCase()}/status`, { token: admin.token, body: { status: 'INACTIVE' } });

        expectError(response, 403, 'FORBIDDEN');
    });
});

describe('GET /roles', () => {
    it('lists the four active roles by name', async () => {
        const roles = expectBody(await request('GET', '/roles', { token: admin.token }), 200, roleListResponseSchema);

        // The database's locale collation ignores spaces at the first level, so "Tester" sorts before "Test lead".
        expect(roles.map((role) => role.code)).toEqual(['ADMIN', 'READ_ONLY', 'TESTER', 'TEST_LEAD']);
    });
});
