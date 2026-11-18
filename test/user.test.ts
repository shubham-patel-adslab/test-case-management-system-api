// User management rules (as an admin): the create transaction, unique emails, mass assignment, and input
// validation that keeps bad ids away from Postgres. The invitation emails are covered in invitation.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pool } from '../src/app/database.js';
import { userDetailsResponseSchema, userPageResponseSchema } from '../src/features/user/user.response.dto.js';
import {
    countUsersByEmail,
    createTestUser,
    deleteTestEmails,
    deleteTestUsers,
    expectBody,
    expectError,
    request,
    startTestServer,
    stopTestServer,
    testEmail,
    type TestUser,
} from './support/test-api.js';

const UNKNOWN_USER_ID = '00000000-0000-4000-8000-000000000000';

let admin: TestUser;

beforeAll(async () => {
    await startTestServer();
    admin = await createTestUser('ADMIN');
});
afterAll(async () => {
    await deleteTestEmails();
    await deleteTestUsers();
    await stopTestServer();
});

function createBody(overrides: Record<string, unknown> = {}) {
    return { firstName: 'Ana', lastName: 'Silva', email: testEmail('created'), roleCode: 'TESTER', ...overrides };
}

describe('POST /users', () => {
    // Creates the user with exactly one role; nothing the client sends beyond the allowed fields (status,
    // id, a password, …) may take effect — the user sets their own password through the invitation.
    it('creates an INVITED user with the role and no password; ignores client-set fields', async () => {
        const body = createBody({
            firstName: '  Ana ',
            id: UNKNOWN_USER_ID,
            status: 'ACTIVE',
            password: 'Temp-Pass-123',
        });
        const response = await request('POST', '/users', { token: admin.token, body });
        const user = expectBody(response, 201, userDetailsResponseSchema);

        expect(response.headers.get('location')).toBe(`/api/users/${user.id}`);
        expect(user.id).not.toBe(UNKNOWN_USER_ID);
        expect(user.firstName).toBe('Ana');
        expect(user.status).toBe('INVITED');
        expect(user.role).toEqual({ code: 'TESTER', name: 'Tester' });
        expect(response.text).not.toMatch(/password|Temp-Pass-123/i);

        const assignment = await pool.query<{ created_by: string }>('SELECT created_by FROM user_roles WHERE user_id = $1', [user.id]);
        expect(assignment.rows[0]?.created_by).toBe(admin.id);

        const stored = await pool.query<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
        expect(stored.rows[0]?.password_hash).toBe(null);
    });

    // User and role are one transaction: a failed role assignment must leave no role-less user behind.
    it('rejects an unknown role with 400 and leaves no user row (transaction rolled back)', async () => {
        const body = createBody({ roleCode: 'SUPERUSER' });
        const error = expectError(await request('POST', '/users', { token: admin.token, body }), 400, 'VALIDATION_ERROR');

        expect(error.details?.[0]?.field).toBe('roleCode');
        expect(await countUsersByEmail(body.email)).toBe(0);
    });

    // Emails are unique case-insensitively, enforced by the database (no check-then-insert race).
    it('rejects a duplicate email in another case with 409 on field email', async () => {
        const body = createBody();
        expect((await request('POST', '/users', { token: admin.token, body })).status).toBe(201);

        const duplicate = await request('POST', '/users', { token: admin.token, body: { ...body, email: body.email.toUpperCase() } });
        expect(expectError(duplicate, 409, 'CONFLICT').details?.[0]?.field).toBe('email');
    });

    it('rejects an invalid body with 400 and a detail per field', async () => {
        const response = await request('POST', '/users', {
            token: admin.token,
            body: { firstName: '', email: 'nope', roleCode: 'tester' },
        });
        const fields = (expectError(response, 400, 'VALIDATION_ERROR').details ?? []).map((detail) => detail.field);

        expect(fields).toEqual(expect.arrayContaining(['firstName', 'email', 'roleCode']));
        expect(fields).not.toContain('lastName');
    });

    // Last name is optional; missing, null and blank are one state (null), whatever the form sends.
    it('accepts a missing, null or blank last name and returns it as null', async () => {
        for (const lastName of [undefined, null, '', '   ']) {
            const response = await request('POST', '/users', { token: admin.token, body: createBody({ lastName }) });

            expect(expectBody(response, 201, userDetailsResponseSchema).lastName, `lastName ${JSON.stringify(lastName)}`).toBeNull();
        }
    });
});

describe('GET /users', () => {
    // Default order is by name ("first last", ignoring case) when the client sends no sort.
    it('filters by search ("first last" or email) and status, by name by default, paginated; sort=createdAt:desc', async () => {
        const marker = testEmail('search').split('@')[0] ?? '';
        const older = await request('POST', '/users', { token: admin.token, body: createBody({ firstName: 'ana', lastName: marker, email: testEmail('older') }) });
        const newer = await request('POST', '/users', { token: admin.token, body: createBody({ firstName: 'Bea', lastName: marker, email: testEmail('newer') }) });
        const olderId = expectBody(older, 201, userDetailsResponseSchema).id;
        const newerId = expectBody(newer, 201, userDetailsResponseSchema).id;
        const query = `search=${encodeURIComponent(marker)}&status=INVITED&pageSize=1`;

        const page = expectBody(await request('GET', `/users?${query}`, { token: admin.token }), 200, userPageResponseSchema);
        expect(page.totalItems).toBe(2);
        expect(page.totalPages).toBe(2);
        expect(page.items[0]?.id).toBe(olderId);

        const newest = expectBody(await request('GET', `/users?${query}&sort=createdAt:desc`, { token: admin.token }), 200, userPageResponseSchema);
        expect(newest.items[0]?.id).toBe(newerId);

        const byFullName = expectBody(await request('GET', `/users?search=${encodeURIComponent(`bea ${marker}`)}`, { token: admin.token }), 200, userPageResponseSchema);
        expect(byFullName.items.map((user) => user.id)).toEqual([newerId]);
    });

    // In SQL, 'first' || ' ' || NULL is NULL: a user without a last name must still be found by first name.
    it('finds a user without a last name by first name', async () => {
        const firstName = testEmail('solo').split('@')[0] ?? '';
        const created = await request('POST', '/users', { token: admin.token, body: createBody({ firstName, lastName: null }) });
        const userId = expectBody(created, 201, userDetailsResponseSchema).id;

        const page = expectBody(await request('GET', `/users?search=${encodeURIComponent(firstName)}`, { token: admin.token }), 200, userPageResponseSchema);

        expect(page.items.map((user) => user.id)).toEqual([userId]);
    });

    // A user typing "%" searches for the character, not "everything".
    it('treats % in the search as a literal character', async () => {
        const page = expectBody(await request('GET', '/users?search=%25', { token: admin.token }), 200, userPageResponseSchema);

        expect(page.totalItems).toBe(0);
    });

    it('rejects an unknown status value with 400', async () => {
        expectError(await request('GET', '/users?status=active', { token: admin.token }), 400, 'VALIDATION_ERROR');
    });
});

describe('GET/PUT /users/:userId', () => {
    // A malformed UUID must be a 400, never reach Postgres as a 500.
    it('answers 400 for a malformed id, 404 for an unknown one, 200 for an uppercase one', async () => {
        const user = await createTestUser('TESTER');

        expectError(await request('GET', '/users/not-a-uuid', { token: admin.token }), 400, 'VALIDATION_ERROR');
        expectError(await request('GET', `/users/${UNKNOWN_USER_ID}`, { token: admin.token }), 404, 'NOT_FOUND');
        expect(expectBody(await request('GET', `/users/${user.id.toUpperCase()}`, { token: admin.token }), 200, userDetailsResponseSchema).id).toBe(user.id);
    });

    it('PUT can clear the last name', async () => {
        const user = await createTestUser('TESTER');
        const response = await request('PUT', `/users/${user.id}`, {
            token: admin.token,
            body: { id: user.id, firstName: 'Test', lastName: '', email: user.email, roleCode: 'TESTER' },
        });

        expect(expectBody(response, 200, userDetailsResponseSchema).lastName).toBeNull();
    });

    it('rejects a body id that differs from the URL id, and an email used by another user', async () => {
        const user = await createTestUser('TESTER');
        const other = await createTestUser('TESTER');
        const base = { id: user.id, firstName: 'Test', lastName: 'User', email: user.email, roleCode: 'TESTER' };

        const mismatch = await request('PUT', `/users/${user.id}`, { token: admin.token, body: { ...base, id: other.id } });
        expect(expectError(mismatch, 400, 'VALIDATION_ERROR').details?.[0]?.field).toBe('id');

        const taken = await request('PUT', `/users/${user.id}`, { token: admin.token, body: { ...base, email: other.email } });
        expect(expectError(taken, 409, 'CONFLICT').details?.[0]?.field).toBe('email');
    });
});
