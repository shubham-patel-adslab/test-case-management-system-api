// Invitation flow: an admin creates a user → the user gets an email with a one-time link → they set their
// own password → they sign in. Each test protects a security property of the link or a state the UI shows.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pool } from '../src/app/database.js';
import { env } from '../src/app/env.js';
import { authUserResponseSchema } from '../src/features/authentication/authentication.response.dto.js';
import { userDetailsResponseSchema, type UserDetailsResponseDto } from '../src/features/user/user.response.dto.js';
import {
    countEmails,
    createTestUser,
    deleteTestEmails,
    deleteTestUsers,
    expectBody,
    expectError,
    readInvitationToken,
    readLatestEmail,
    request,
    startTestServer,
    stopTestServer,
    testEmail,
    type TestUser,
} from './support/test-api.js';

const NEW_PASSWORD = 'My-Own-Pass-123';

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

async function inviteUser(): Promise<UserDetailsResponseDto> {
    const body = { firstName: 'Ivy', lastName: 'Invited', email: testEmail('invited'), roleCode: 'TESTER' };

    return expectBody(await request('POST', '/users', { token: admin.token, body }), 201, userDetailsResponseSchema);
}

function accept(token: string, password = NEW_PASSWORD) {
    return request('POST', '/invitations/accept', { body: { token, password } });
}

function verify(body: unknown) {
    return request('POST', '/invitations/verify', { body });
}

function signIn(email: string, password = NEW_PASSWORD) {
    return request('POST', '/auth/sign-in', { body: { email, password } });
}

describe('Invitation email', () => {
    // The link must lead to the UI's set-password page, and the token must stay out of server logs (fragment)
    // and out of the database (only its hash is stored).
    it('emails a set-password link to the UI with the token in the fragment; stores only its SHA-256 hash', async () => {
        const user = await inviteUser();
        const email = await readLatestEmail(user.email);
        const token = await readInvitationToken(user.email);

        expect(email.Subject).toBe('Set your TCMS password');
        expect(email.Text).toContain(`${new URL('/set-password', env.UI_BASE_URL).toString()}#token=${token}`);

        const stored = await pool.query<{ token_hash: string }>('SELECT token_hash FROM user_invitations WHERE user_id = $1', [user.id]);
        expect(stored.rows[0]?.token_hash).toBe(createHash('sha256').update(token).digest('hex'));
    });
});

describe('POST /invitations/verify', () => {
    // The set-password page checks the link when it opens. The check must not use the link up, or the
    // user could never set their password.
    it('answers 204 for a usable link without consuming it: accept with the same token still works', async () => {
        const user = await inviteUser();
        const token = await readInvitationToken(user.email);

        expect((await verify({ token })).status).toBe(204);
        expect((await verify({ token })).status).toBe(204);
        expect((await accept(token)).status).toBe(204);
    });

    // Every dead link gets the same answer, so the page shows one "ask for a new link" message and the
    // response doesn't reveal why the link is dead.
    it('answers 400 INVALID_INVITATION for a used, replaced, expired, deactivated or unknown link', async () => {
        const used = await inviteUser();
        const usedToken = await readInvitationToken(used.email);
        await accept(usedToken);

        const replaced = await inviteUser();
        const replacedToken = await readInvitationToken(replaced.email);
        await request('POST', `/users/${replaced.id}/invitation`, { token: admin.token });

        const expired = await inviteUser();
        const expiredToken = await readInvitationToken(expired.email);
        await pool.query(
            `UPDATE user_invitations SET created_at = now() - interval '4 days', expires_at = now() - interval '1 hour'
              WHERE user_id = $1`,
            [expired.id],
        );

        // Deactivated directly in SQL, keeping the invitation row: the user-status check in the query is what
        // must reject it (the API's deactivation also deletes the row).
        const deactivated = await inviteUser();
        const deactivatedToken = await readInvitationToken(deactivated.email);
        await pool.query(`UPDATE users SET status = 'INACTIVE' WHERE id = $1`, [deactivated.id]);

        // Deactivated the way an admin does it.
        const deactivatedByAdmin = await inviteUser();
        const deactivatedByAdminToken = await readInvitationToken(deactivatedByAdmin.email);
        await request('PATCH', `/users/${deactivatedByAdmin.id}/status`, { token: admin.token, body: { status: 'INACTIVE' } });

        const deadTokens = [usedToken, replacedToken, expiredToken, deactivatedToken, deactivatedByAdminToken, 'not-a-real-token'];

        for (const token of deadTokens) {
            expectError(await verify({ token }), 400, 'INVALID_INVITATION');
        }
    });

    it('answers 400 VALIDATION_ERROR for an empty or missing token', async () => {
        for (const body of [{ token: '' }, {}]) {
            const error = expectError(await verify(body), 400, 'VALIDATION_ERROR');

            expect(error.details?.[0]?.field).toBe('token');
        }
    });

    // The invited user has no session: the route must be public, and an unknown token must not look like
    // a sign-in problem (401 would make the UI redirect to sign-in).
    it('needs no cookie and never answers 401', async () => {
        const response = await verify({ token: 'not-a-real-token' });

        expect(response.status).not.toBe(401);
        expectError(response, 400, 'INVALID_INVITATION');
    });
});

describe('POST /invitations/accept', () => {
    // An invited user has no password, so sign-in must fail exactly like a wrong password (nothing revealed).
    it('an invited user cannot sign in before accepting', async () => {
        const user = await inviteUser();

        expectError(await signIn(user.email), 401, 'INVALID_CREDENTIALS');
    });

    // The happy path the UI depends on, and the one-time property of the link.
    it('sets the password (bcrypt), makes the user ACTIVE so they can sign in; the link works only once', async () => {
        const user = await inviteUser();
        const token = await readInvitationToken(user.email);

        expect((await accept(token)).status).toBe(204);

        const stored = await pool.query<{ status: string; password_hash: string }>('SELECT status, password_hash FROM users WHERE id = $1', [user.id]);
        expect(stored.rows[0]?.status).toBe('ACTIVE');
        expect(stored.rows[0]?.password_hash ?? '').toMatch(/^\$2[ab]\$12\$/);

        expectBody(await signIn(user.email), 200, authUserResponseSchema);
        expectError(await accept(token, 'Another-Pass-456'), 400, 'INVALID_INVITATION');
        expectBody(await signIn(user.email), 200, authUserResponseSchema);
    });

    it('rejects an unknown token and an expired link with 400 INVALID_INVITATION', async () => {
        const user = await inviteUser();
        const token = await readInvitationToken(user.email);

        expectError(await accept('not-a-real-token'), 400, 'INVALID_INVITATION');

        await pool.query(
            `UPDATE user_invitations SET created_at = now() - interval '4 days', expires_at = now() - interval '1 hour'
              WHERE user_id = $1`,
            [user.id],
        );

        expectError(await accept(token), 400, 'INVALID_INVITATION');
    });

    // A rejected password must not burn the link.
    it('rejects a too-short password with 400 VALIDATION_ERROR and keeps the link usable', async () => {
        const user = await inviteUser();
        const token = await readInvitationToken(user.email);

        const error = expectError(await accept(token, 'short'), 400, 'VALIDATION_ERROR');
        expect(error.details?.[0]?.field).toBe('password');
        expect((await accept(token)).status).toBe(204);
    });
});

describe('Invitation lifecycle', () => {
    // A re-sent link replaces the old one, so a forwarded or leaked earlier email is useless.
    it('resend issues a new link and kills the old one; only for INVITED users (409 otherwise)', async () => {
        const user = await inviteUser();
        const oldToken = await readInvitationToken(user.email);

        expect((await request('POST', `/users/${user.id}/invitation`, { token: admin.token })).status).toBe(204);
        expect(await countEmails(user.email)).toBe(2);

        const newToken = await readInvitationToken(user.email);
        expect(newToken).not.toBe(oldToken);
        expectError(await accept(oldToken), 400, 'INVALID_INVITATION');
        expect((await accept(newToken)).status).toBe(204);

        expectError(await request('POST', `/users/${user.id}/invitation`, { token: admin.token }), 409, 'CONFLICT');
    });

    // Deactivation must stop a pending link; reactivation can't make a password-less user ACTIVE.
    it('deactivating kills the link; reactivating a user without a password makes them INVITED again', async () => {
        const user = await inviteUser();
        const token = await readInvitationToken(user.email);

        await request('PATCH', `/users/${user.id}/status`, { token: admin.token, body: { status: 'INACTIVE' } });
        expectError(await accept(token), 400, 'INVALID_INVITATION');

        const reactivated = await request('PATCH', `/users/${user.id}/status`, { token: admin.token, body: { status: 'ACTIVE' } });
        expect(expectBody(reactivated, 200, userDetailsResponseSchema).status).toBe('INVITED');
        expectError(await accept(token), 400, 'INVALID_INVITATION');
    });

    // Fixing a mistyped email must not leave a working link in the wrong person's inbox.
    it('changing an invited user\'s email kills the old link and sends a new one to the new address', async () => {
        const user = await inviteUser();
        const oldToken = await readInvitationToken(user.email);
        const newEmail = testEmail('corrected');

        const updated = await request('PUT', `/users/${user.id}`, {
            token: admin.token,
            body: { id: user.id, firstName: user.firstName, lastName: user.lastName, email: newEmail, roleCode: 'TESTER' },
        });
        expectBody(updated, 200, userDetailsResponseSchema);

        expectError(await accept(oldToken), 400, 'INVALID_INVITATION');
        expect((await accept(await readInvitationToken(newEmail))).status).toBe(204);
        expectBody(await signIn(newEmail), 200, authUserResponseSchema);
    });

    it('PATCH status rejects INVITED as a value (it is never set directly)', async () => {
        const user = await inviteUser();

        expectError(await request('PATCH', `/users/${user.id}/status`, { token: admin.token, body: { status: 'INVITED' } }), 400, 'VALIDATION_ERROR');
    });
});
