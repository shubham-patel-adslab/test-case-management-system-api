// Projects: the contract the UI's project screens rely on (validation, pagination, the team set with the
// project) and membership scoping — TEST_LEAD, TESTER and READ_ONLY see and change only the projects they
// are members of; ADMIN (ALL_PROJECTS grants) reaches every project. Which roles may do what at all is the
// permission matrix in authorization.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pool } from '../src/app/database.js';
import {
    projectDetailsResponseSchema,
    projectMemberCandidatePageResponseSchema,
    projectPageResponseSchema,
    type ProjectDetailsResponseDto,
} from '../src/features/project/project.response.dto.js';
import { userDetailsResponseSchema } from '../src/features/user/user.response.dto.js';
import {
    countProjectsByName,
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

let admin: TestUser;

beforeAll(async () => {
    await startTestServer();
    admin = await createTestUser('ADMIN');
});
afterAll(async () => {
    await deleteTestEmails();
    await deleteTestProjects();
    await deleteTestUsers();
    await stopTestServer();
});

async function createProject(caller: TestUser, memberIds: string[] = [], label = 'project'): Promise<ProjectDetailsResponseDto> {
    const response = await request('POST', '/projects', { token: caller.token, body: testProjectBody(label, memberIds) });

    return expectBody(response, 201, projectDetailsResponseSchema);
}

function updateProject(caller: TestUser, project: ProjectDetailsResponseDto, memberIds: string[]) {
    const body = { id: project.id, name: project.name, description: project.description, version: project.version, status: project.status, memberIds };

    return request('PUT', `/projects/${project.id}`, { token: caller.token, body });
}

function memberIdsOf(project: ProjectDetailsResponseDto): string[] {
    return project.members.map((member) => member.id).sort();
}

function deactivate(user: TestUser) {
    return request('PATCH', `/users/${user.id}/status`, { token: admin.token, body: { status: 'INACTIVE' } });
}

describe('POST /projects', () => {
    // The UI reads the created project from the response and navigates with the Location header.
    it('creates the project with its team: 201, Location, trimmed values, members with role and status', async () => {
        const tester = await createTestUser('TESTER');
        const body = { ...testProjectBody('created', [tester.id]), description: '  Payments  ', createdAt: '2000-01-01T00:00:00Z' };

        const response = await request('POST', '/projects', { token: admin.token, body });
        const project = expectBody(response, 201, projectDetailsResponseSchema.strict());

        expect(response.headers.get('location')).toBe(`/api/projects/${project.id}`);
        expect(project.description).toBe('Payments');
        expect(project.createdAt).not.toBe(body.createdAt);
        expect(project.members).toEqual([
            { id: tester.id, firstName: 'Test', lastName: 'TESTER', email: tester.email, status: 'ACTIVE', role: { code: 'TESTER', name: 'Tester' } },
        ]);
    });

    // An invalid team must not leave a half-created project behind (one transaction), and the error must
    // point at the exact entry so the UI can mark it.
    it('rejects an unknown user, a duplicate or a missing memberIds with 400 on the field — nothing is created', async () => {
        const tester = await createTestUser('TESTER');
        const unknownUserId = '00000000-0000-4000-8000-000000000000';
        const cases = [
            { memberIds: [tester.id, unknownUserId], field: 'memberIds[1]' },
            { memberIds: [tester.id, tester.id], field: 'memberIds' },
            { memberIds: undefined, field: 'memberIds' },
        ];

        for (const { memberIds, field } of cases) {
            const body = { ...testProjectBody('rejected'), memberIds };
            const error = expectError(await request('POST', '/projects', { token: admin.token, body }), 400, 'VALIDATION_ERROR');

            expect(error.details?.map((detail) => detail.field)).toEqual([field]);
            expect(await countProjectsByName(body.name)).toBe(0);
        }
    });

    // Otherwise a test lead would create a project and immediately lose sight of it.
    it('a TEST_LEAD creator always joins the team; an ADMIN creator does not need to', async () => {
        const lead = await createTestUser('TEST_LEAD');

        expect(memberIdsOf(await createProject(lead))).toEqual([lead.id]);
        expect((await createProject(admin)).members).toEqual([]);
    });
});

describe('PUT /projects/:projectId', () => {
    // PUT is a full replacement: the team in the body is the team afterwards.
    it('replaces the team: removes members not sent, adds new ones', async () => {
        const [first, second, third] = await Promise.all([createTestUser('TESTER'), createTestUser('TESTER'), createTestUser('READ_ONLY')]);
        const project = await createProject(admin, [first.id, second.id]);

        const updated = expectBody(await updateProject(admin, project, [second.id, third.id]), 200, projectDetailsResponseSchema);

        expect(memberIdsOf(updated)).toEqual([second.id, third.id].sort());
    });

    // A deactivated member stays on the team (history), and saving the project unchanged must still work;
    // but nobody can newly add an inactive user.
    it('keeps a member deactivated after joining, but rejects adding an inactive user', async () => {
        const [member, outsider] = await Promise.all([createTestUser('TESTER'), createTestUser('TESTER')]);
        const project = await createProject(admin, [member.id]);
        await deactivate(member);
        await deactivate(outsider);

        const saved = expectBody(await updateProject(admin, project, [member.id]), 200, projectDetailsResponseSchema);
        expect(saved.members.map((m) => m.status)).toEqual(['INACTIVE']);

        const error = expectError(await updateProject(admin, project, [member.id, outsider.id]), 400, 'VALIDATION_ERROR');
        expect(error.details?.[0]?.field).toBe('memberIds[1]');
    });

    it('rejects a body id that differs from the URL id (400), and answers 404 for an unknown project', async () => {
        const project = await createProject(admin);
        const other = { ...project, id: project.id + 1 };

        const mismatch = await request('PUT', `/projects/${project.id}`, { token: admin.token, body: { ...testProjectBody('x'), id: other.id } });
        expect(expectError(mismatch, 400, 'VALIDATION_ERROR').details?.[0]?.field).toBe('id');

        const unknown = await request('PUT', '/projects/2147483647', { token: admin.token, body: { ...testProjectBody('x'), id: 2147483647 } });
        expectError(unknown, 404, 'NOT_FOUND');
    });
});

describe('Membership scoping', () => {
    // The core RBAC rule beyond roles: a non-member must not learn a project exists (404, not 403).
    it('a non-member gets 404 and does not see the project in the list; membership grants and removal revokes access', async () => {
        const tester = await createTestUser('TESTER');
        const project = await createProject(admin);

        expectError(await request('GET', `/projects/${project.id}`, { token: tester.token }), 404, 'NOT_FOUND');
        expect(expectBody(await request('GET', '/projects', { token: tester.token }), 200, projectPageResponseSchema).totalItems).toBe(0);

        await updateProject(admin, project, [tester.id]);
        expectBody(await request('GET', `/projects/${project.id}`, { token: tester.token }), 200, projectDetailsResponseSchema);
        expect(expectBody(await request('GET', '/projects', { token: tester.token }), 200, projectPageResponseSchema).items.map((p) => p.id)).toEqual([project.id]);

        await updateProject(admin, project, []);
        expectError(await request('GET', `/projects/${project.id}`, { token: tester.token }), 404, 'NOT_FOUND');
    });

    // UPDATE permission alone isn't enough: a test lead edits only their own projects.
    it('a TEST_LEAD cannot update a project they are not a member of (404, unchanged), but can update their own', async () => {
        const lead = await createTestUser('TEST_LEAD');
        const foreign = await createProject(admin);

        expectError(await updateProject(lead, { ...foreign, name: `${foreign.name}-hijacked` }, [lead.id]), 404, 'NOT_FOUND');
        expect(await countProjectsByName(foreign.name)).toBe(1);

        const own = await createProject(admin, [lead.id]);
        expectBody(await updateProject(lead, own, [lead.id]), 200, projectDetailsResponseSchema);
    });

    // Removing yourself would lock you out of a project you manage.
    it('a TEST_LEAD who leaves themselves out of memberIds stays on the team', async () => {
        const [lead, tester] = await Promise.all([createTestUser('TEST_LEAD'), createTestUser('TESTER')]);
        const project = await createProject(lead);

        const updated = expectBody(await updateProject(lead, project, [tester.id]), 200, projectDetailsResponseSchema);

        expect(memberIdsOf(updated)).toEqual([lead.id, tester.id].sort());
    });

    it('ADMIN reads and updates a project without being a member', async () => {
        const project = await createProject(admin);

        expectBody(await request('GET', `/projects/${project.id}`, { token: admin.token }), 200, projectDetailsResponseSchema);
        expectBody(await updateProject(admin, project, []), 200, projectDetailsResponseSchema);
    });
});

describe('GET /projects', () => {
    // The UI's table relies on the envelope, newest-first order and an honest total on a page past the end.
    it('paginates the caller\'s projects newest first, with members; a page past the end is empty with real totals', async () => {
        const tester = await createTestUser('TESTER');
        const first = await createProject(admin, [tester.id], 'first');
        const second = await createProject(admin, [tester.id], 'second');
        const third = await createProject(admin, [tester.id], 'third');

        const page1 = expectBody(await request('GET', '/projects?page=1&pageSize=2', { token: tester.token }), 200, projectPageResponseSchema);
        expect(page1).toMatchObject({ page: 1, pageSize: 2, totalItems: 3, totalPages: 2 });
        expect(page1.items.map((p) => p.id)).toEqual([third.id, second.id]);
        expect(page1.items[0]?.members.map((m) => m.id)).toEqual([tester.id]);

        const page2 = expectBody(await request('GET', '/projects?page=2&pageSize=2', { token: tester.token }), 200, projectPageResponseSchema);
        expect(page2.items.map((p) => p.id)).toEqual([first.id]);

        const past = expectBody(await request('GET', '/projects?page=5&pageSize=2', { token: tester.token }), 200, projectPageResponseSchema);
        expect(past).toMatchObject({ items: [], totalItems: 3, totalPages: 2 });
    });

    it('rejects out-of-range paging with 400 on the field', async () => {
        for (const [query, field] of [['pageSize=101', 'pageSize'], ['page=0', 'page'], ['pageSize=abc', 'pageSize']]) {
            const error = expectError(await request('GET', `/projects?${query}`, { token: admin.token }), 400, 'VALIDATION_ERROR');

            expect(error.details?.[0]?.field).toBe(field);
        }
    });
});

describe('GET /projects/:projectId', () => {
    // An id beyond Postgres integer must be a 400, not a database "out of range" 500.
    it('answers 400 for a non-numeric or oversized id and 404 for an unknown one', async () => {
        expectError(await request('GET', '/projects/abc', { token: admin.token }), 400, 'VALIDATION_ERROR');
        expectError(await request('GET', '/projects/2147483648', { token: admin.token }), 400, 'VALIDATION_ERROR');
        expectError(await request('GET', '/projects/2147483647', { token: admin.token }), 404, 'NOT_FOUND');
    });
});

describe('DELETE /projects/:projectId', () => {
    it('deletes the project and its memberships (204); a second delete is 404', async () => {
        const tester = await createTestUser('TESTER');
        const project = await createProject(admin, [tester.id]);

        expect((await request('DELETE', `/projects/${project.id}`, { token: admin.token })).status).toBe(204);
        expectError(await request('GET', `/projects/${project.id}`, { token: admin.token }), 404, 'NOT_FOUND');

        const memberships = await pool.query('SELECT 1 FROM project_members WHERE project_id = $1', [project.id]);
        expect(memberships.rowCount).toBe(0);

        expectError(await request('DELETE', `/projects/${project.id}`, { token: admin.token }), 404, 'NOT_FOUND');
    });
});

describe('GET /projects/member-candidates', () => {
    // The member picker: test leads can't call GET /users, so this is their only user search. It must
    // offer invited users (they join before their first sign-in) and never inactive ones.
    it('a TEST_LEAD finds active and invited users, not inactive ones; a TESTER gets 403', async () => {
        const [lead, active, inactive, tester] = await Promise.all([
            createTestUser('TEST_LEAD'),
            createTestUser('TESTER'),
            createTestUser('TESTER'),
            createTestUser('TESTER'),
        ]);
        await deactivate(inactive);
        const invitedBody = { firstName: 'Ivy', lastName: null, email: testEmail('candidate'), roleCode: 'TESTER' };
        const invited = expectBody(await request('POST', '/users', { token: admin.token, body: invitedBody }), 201, userDetailsResponseSchema);

        for (const user of [active, inactive, invited]) {
            const query = `search=${encodeURIComponent(user.email)}`;
            const page = expectBody(await request('GET', `/projects/member-candidates?${query}`, { token: lead.token }), 200, projectMemberCandidatePageResponseSchema.strict());
            const expected = user === inactive ? [] : [user.id];

            expect(page.items.map((candidate) => candidate.id)).toEqual(expected);
        }

        expectError(await request('GET', '/projects/member-candidates', { token: tester.token }), 403, 'FORBIDDEN');
    });
});
