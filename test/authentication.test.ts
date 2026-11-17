// Authentication: who is calling? Sign-in (httpOnly cookie), token validation, account status and
// sign-out. Each test protects a behavior the UI or a security rule depends on (see the
// comment above each group).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import jwt from 'jsonwebtoken';

import { env } from '../src/app/env.js';
import { authUserResponseSchema } from '../src/features/authentication/authentication.response.dto.js';
import { signAccessToken } from '../src/features/authentication/authentication.token.js';
import { userDetailsResponseSchema } from '../src/features/user/user.response.dto.js';
import {
    accessTokenFromSetCookie,
    createTestUser,
    deleteTestUsers,
    expectBody,
    expectError,
    request,
    setCookieHeader,
    startTestServer,
    stopTestServer,
    type TestUser,
} from './support/test-api.js';

const UNKNOWN_USER_ID = '00000000-0000-4000-8000-000000000000';

beforeAll(startTestServer);
afterAll(async () => {
    await deleteTestUsers();
    await stopTestServer();
});

describe('POST /auth/sign-in', () => {
    let tester: TestUser;

    beforeAll(async () => {
        tester = await createTestUser('TESTER');
    });

    // The token must live where page scripts can't read it (XSS), never travel to another site (CSRF),
    // and expire with the token.
    it('sets the token in an HttpOnly, SameSite=Strict cookie on /api and returns only the user', async () => {
        const response = await request('POST', '/auth/sign-in', { body: { email: tester.email, password: tester.password } });
        const user = expectBody(response, 200, authUserResponseSchema.strict());
        const cookie = setCookieHeader(response);

        expect(user.id).toBe(tester.id);
        expect(response.text).not.toMatch(/accessToken|eyJ/); // no token in the body
        expect(cookie).toMatch(/; HttpOnly/);
        expect(cookie).toMatch(/; SameSite=Strict/);
        expect(cookie).toMatch(/; Path=\/api/);
        expect(cookie).toMatch(new RegExp(`; Max-Age=${env.JWT_EXPIRES_IN_SECONDS}`));
    });

    // The token identifies the user and nothing more, so role changes apply without signing in again.
    it('issues a token carrying only sub, jti, iat, exp — and it authenticates /auth/me', async () => {
        const response = await request('POST', '/auth/sign-in', { body: { email: tester.email, password: tester.password } });
        const token = accessTokenFromSetCookie(response);
        const claims = jwt.decode(token ?? '', { json: true });

        expect(Object.keys(claims ?? {}).sort()).toEqual(['exp', 'iat', 'jti', 'sub']);
        expect(claims?.sub).toBe(tester.id);
        expect(expectBody(await request('GET', '/auth/me', { token }), 200, authUserResponseSchema.strict()).id).toBe(tester.id);
    });

    // Users type emails in any case and with stray spaces; they must still reach their one account.
    it('accepts the email trimmed and in any case', async () => {
        const response = await request('POST', '/auth/sign-in', {
            body: { email: `  ${tester.email.toUpperCase()} `, password: tester.password },
        });

        expectBody(response, 200, authUserResponseSchema);
    });

    // One code and message for both cases, so the response doesn't reveal which emails exist.
    it('rejects a wrong password and an unknown email identically (401 INVALID_CREDENTIALS), setting no cookie', async () => {
        const wrongPassword = await request('POST', '/auth/sign-in', { body: { email: tester.email, password: 'wrong-password' } });
        const unknownEmail = await request('POST', '/auth/sign-in', { body: { email: 'nobody@tcms-test.example', password: 'wrong-password' } });

        const wrongPasswordError = expectError(wrongPassword, 401, 'INVALID_CREDENTIALS');
        const unknownEmailError = expectError(unknownEmail, 401, 'INVALID_CREDENTIALS');

        expect(wrongPasswordError.message).toBe(unknownEmailError.message);
        expect(accessTokenFromSetCookie(wrongPassword)).toBe(undefined);
    });

    it('rejects an invalid body with 400 VALIDATION_ERROR', async () => {
        expectError(await request('POST', '/auth/sign-in', { body: { email: 'not-an-email' } }), 400, 'VALIDATION_ERROR');
    });
});

describe('Account status', () => {
    let admin: TestUser;
    let tester: TestUser;

    beforeAll(async () => {
        admin = await createTestUser('ADMIN');
        tester = await createTestUser('TESTER');
    });

    // Deactivation must cut access immediately — not when the token expires — and tell a user with the
    // right password why they can't sign in, without telling anyone else.
    it('deactivation rejects the existing token (401) and sign-in (403 ACCOUNT_INACTIVE); reactivation restores access', async () => {
        const deactivate = await request('PATCH', `/users/${tester.id}/status`, { token: admin.token, body: { status: 'INACTIVE' } });

        expectBody(deactivate, 200, userDetailsResponseSchema);
        expectError(await request('GET', '/auth/me', { token: tester.token }), 401, 'UNAUTHORIZED');
        expectError(await request('POST', '/auth/sign-in', { body: { email: tester.email, password: tester.password } }), 403, 'ACCOUNT_INACTIVE');
        expectError(await request('POST', '/auth/sign-in', { body: { email: tester.email, password: 'wrong-password' } }), 401, 'INVALID_CREDENTIALS');

        await request('PATCH', `/users/${tester.id}/status`, { token: admin.token, body: { status: 'ACTIVE' } });

        expectBody(await request('GET', '/auth/me', { token: tester.token }), 200, authUserResponseSchema);
    });
});

describe('authenticate (access-token cookie)', () => {
    let tester: TestUser;

    beforeAll(async () => {
        tester = await createTestUser('TESTER');
    });

    // Protected by default: a route can't be left open by forgetting a middleware. The cookie is the only
    // way in — an Authorization header is ignored.
    it('rejects no cookie, a Bearer header instead of the cookie, and a garbage cookie with 401', async () => {
        expectError(await request('GET', '/users'), 401, 'UNAUTHORIZED');
        expectError(await request('GET', '/auth/me', { headers: { authorization: `Bearer ${tester.token}` } }), 401, 'UNAUTHORIZED');
        expectError(await request('GET', '/auth/me', { token: 'garbage' }), 401, 'UNAUTHORIZED');
    });

    it('rejects an expired token, a token signed with another secret and an alg:none token', async () => {
        const expired = jwt.sign({}, env.JWT_SECRET, { algorithm: 'HS256', subject: tester.id, expiresIn: -10 });
        const otherSecret = jwt.sign({}, 'another-secret-that-is-at-least-32-characters', { subject: tester.id });
        const unsigned = jwt.sign({}, '', { algorithm: 'none', subject: tester.id });

        expect(expectError(await request('GET', '/auth/me', { token: expired }), 401, 'UNAUTHORIZED').message).toBe('Access token has expired');
        expectError(await request('GET', '/auth/me', { token: otherSecret }), 401, 'UNAUTHORIZED');
        expectError(await request('GET', '/auth/me', { token: unsigned }), 401, 'UNAUTHORIZED');
    });

    // A validly signed token for a user that no longer exists must not work.
    it('rejects a valid token for a user that does not exist', async () => {
        expectError(await request('GET', '/auth/me', { token: signAccessToken(UNKNOWN_USER_ID) }), 401, 'UNAUTHORIZED');
    });
});

describe('POST /auth/sign-out', () => {
    // Sign-out must clear the browser's cookie (same attributes, or the browser keeps it) — even when the
    // token inside has already expired, so it needs no authentication.
    it('clears the cookie with 204, also without a valid token', async () => {
        const response = await request('POST', '/auth/sign-out');
        const cookie = setCookieHeader(response);

        expect(response.status).toBe(204);
        expect(accessTokenFromSetCookie(response)).toBe(undefined);
        expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
        expect(cookie).toMatch(/; Path=\/api/);
        expect(cookie).toMatch(/; HttpOnly/);
    });

    // Documents the accepted limitation: without a Redis denylist, a copied token outlives sign-out.
    it('does not revoke the token itself (no server-side denylist yet)', async () => {
        const tester = await createTestUser('TESTER');

        await request('POST', '/auth/sign-out', { token: tester.token });

        expect((await request('GET', '/auth/me', { token: tester.token })).status).toBe(200);
    });
});
