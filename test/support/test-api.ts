// Shared setup for the API tests. They run against the dev database (tcms_app_db_dev, user decision
// 2026-11-17), so every row a test creates is marked — test users by an email in TEST_EMAIL_DOMAIN, test
// projects by TEST_PROJECT_NAME_PREFIX — and deleteTestUsers()/deleteTestProjects() remove exactly those.
// Nothing else in the database is created, changed or deleted. Emails go to the local Mailpit (SMTP_URL in
// .env), where the tests read the invitation links; deleteTestEmails() removes the test users' messages.
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect } from 'vitest';
import type { z } from 'zod';

import { app } from '../../src/app/app.js';
import { closeCache, connectCache } from '../../src/app/cache.js';
import { pool } from '../../src/app/database.js';
import { deleteFile } from '../../src/app/file-storage.js';
import { ACCESS_TOKEN_COOKIE_NAME } from '../../src/features/authentication/authentication.constant.js';
import { signAccessToken } from '../../src/features/authentication/authentication.token.js';
import {
    projectDetailsResponseSchema,
    type ProjectDetailsResponseDto,
} from '../../src/features/project/project.response.dto.js';
import { userService } from '../../src/features/user/user.service.js';
import { errorResponseSchema, type ErrorResponseDto } from '../../src/shared/response/error.response.dto.js';

// A reserved TLD (RFC 2606): can't collide with a real user's email.
const TEST_EMAIL_DOMAIN = 'tcms-test.example';
const TEST_PROJECT_NAME_PREFIX = '[tcms-test] ';
// Mailpit's HTTP API (the web UI's port).
const MAILPIT_API_URL = process.env['MAILPIT_API_URL'] ?? 'http://localhost:8025/api/v1';
const MAILPIT_TEST_QUERY = `to:"@${TEST_EMAIL_DOMAIN}"`;
// The SMTP handoff completes before the API responds, but Mailpit indexes the message asynchronously.
const MAILPIT_POLL_ATTEMPTS = 20;
const MAILPIT_POLL_INTERVAL_MS = 100;
// The token in an invitation link: …/set-password#token=<base64url>
const INVITATION_TOKEN_PATTERN = /#token=([A-Za-z0-9_-]+)/;

const TEST_HOST = '127.0.0.1';

export type TestUser = {
    id: string;
    email: string;
    password: string;
    // Signed directly (setup shortcut): the sign-in flow itself is covered in authentication.test.ts.
    token: string;
};

export type TestResponse = {
    status: number;
    headers: Headers;
    text: string;
    json: unknown;
};

let server: Server | undefined;
let baseUrl = '';

export async function startTestServer(): Promise<void> {
    // Like the server: with Redis configured, tests run with caching on, so every test also checks invalidation.
    await connectCache();
    server = app.listen(0, TEST_HOST);
    await new Promise<void>((resolve) => server?.once('listening', resolve));
    baseUrl = `http://${TEST_HOST}:${(server.address() as AddressInfo).port}/api`;
}

export async function stopTestServer(): Promise<void> {
    await new Promise<void>((resolve, reject) => server?.close((error) => (error ? reject(error) : resolve())));
    await pool.end();
    await closeCache();
}

// The full URL of an API path, for requests the JSON helper doesn't cover (uploads, downloads).
export function apiUrl(path: string): string {
    return baseUrl + path;
}

export async function request(
    method: string,
    path: string,
    // `token` is sent the way a browser does: as the access-token cookie. `headers` adds raw headers (e.g.
    // an Authorization header, to prove it is ignored).
    options: { token?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<TestResponse> {
    const headers: Record<string, string> = { ...options.headers };

    if (options.token) {
        headers['cookie'] = `${ACCESS_TOKEN_COOKIE_NAME}=${options.token}`;
    }

    if (options.body !== undefined) {
        headers['content-type'] = 'application/json';
    }

    const response = await fetch(baseUrl + path, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();

    return { status: response.status, headers: response.headers, text, json: text ? JSON.parse(text) : undefined };
}

// Asserts the status and parses the body with the endpoint's own response schema — so every test also
// checks the response against the documented contract, and the body comes back typed.
export function expectBody<TSchema extends z.ZodType>(response: TestResponse, status: number, schema: TSchema): z.output<TSchema> {
    expect(response.status, response.text).toBe(status);

    return schema.parse(response.json);
}

export function expectError(response: TestResponse, status: number, code: string): ErrorResponseDto['error'] {
    const { error } = expectBody(response, status, errorResponseSchema);

    expect(error.code, response.text).toBe(code);

    return error;
}

export function testEmail(label: string): string {
    return `${label}-${randomUUID().slice(0, 8)}@${TEST_EMAIL_DOMAIN}`;
}

// An ACTIVE user with a password, through the same service path as the admin script (setup shortcut: the
// invitation flow itself is covered in invitation.test.ts).
export async function createTestUser(roleCode: string): Promise<TestUser> {
    const email = testEmail(roleCode.toLowerCase());
    const password = `Pw-${randomUUID()}`;
    const user = await userService.createWithPassword({ firstName: 'Test', lastName: roleCode, email, roleCode, password }, null);

    return { id: user.id, email, password, token: signAccessToken(user.id) };
}

// The token from a Set-Cookie header, or undefined (cookie absent or cleared).
export function accessTokenFromSetCookie(response: TestResponse): string | undefined {
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${ACCESS_TOKEN_COOKIE_NAME}=`));
    const token = cookie?.slice(ACCESS_TOKEN_COOKIE_NAME.length + 1).split(';')[0];

    return token || undefined;
}

export function setCookieHeader(response: TestResponse): string {
    return response.headers.getSetCookie().find((value) => value.startsWith(`${ACCESS_TOKEN_COOKIE_NAME}=`)) ?? '';
}

export async function countUsersByEmail(email: string): Promise<number> {
    const result = await pool.query<{ total: number }>('SELECT COUNT(*)::int AS total FROM users WHERE email = $1', [email]);

    return result.rows[0]?.total ?? 0;
}

// Also removes leftovers of an earlier run that crashed before its cleanup. user_roles rows go with them
// (ON DELETE CASCADE).
export async function deleteTestUsers(): Promise<void> {
    await pool.query('DELETE FROM users WHERE email LIKE $1', [`%@${TEST_EMAIL_DOMAIN}`]);
}

export function testProjectBody(label: string, memberIds: string[] = []) {
    return { name: `${TEST_PROJECT_NAME_PREFIX}${label}-${randomUUID().slice(0, 8)}`, description: '', version: '1.0', status: 'ACTIVE', memberIds };
}

// A project created through the API by `caller`, with `memberIds` as its team.
export async function createTestProject(caller: TestUser, memberIds: string[] = [], label = 'project'): Promise<ProjectDetailsResponseDto> {
    const response = await request('POST', '/projects', { token: caller.token, body: testProjectBody(label, memberIds) });

    return expectBody(response, 201, projectDetailsResponseSchema);
}

// A suite inserted directly (setup shortcut for test case tests; the suite API is covered in test-suite.test.ts).
// Removed by deleteTestProjects.
export async function createTestSuite(projectId: number, name = `Suite ${randomUUID().slice(0, 8)}`): Promise<number> {
    const result = await pool.query<{ id: number }>('INSERT INTO test_suites (project_id, name) VALUES ($1, $2) RETURNING id', [projectId, name]);
    const id = result.rows[0]?.id;

    if (id === undefined) {
        throw new Error('INSERT test_suites returned no row');
    }

    return id;
}

export async function countProjectsByName(name: string): Promise<number> {
    const result = await pool.query<{ total: number }>('SELECT COUNT(*)::int AS total FROM projects WHERE name = $1', [name]);

    return result.rows[0]?.total ?? 0;
}

// starts_with, not LIKE: the prefix is matched literally. Also removes leftovers of a crashed earlier run.
// Children first, in foreign-key order: attachments and defects block executions, executions block suite
// runs, and all of them block the project (ON DELETE RESTRICT). Steps, audit logs, suite mappings and
// memberships go with their parents (ON DELETE CASCADE).
export async function deleteTestProjects(): Promise<void> {
    const testProjectIds = 'SELECT id FROM projects WHERE starts_with(name, $1)';
    const testExecutionIds = `SELECT id FROM test_executions WHERE project_id IN (${testProjectIds})`;

    // Attachment files on disk too (UPLOAD_DIR), then their rows.
    const attachments = await pool.query<{ stored_name: string }>(
        `DELETE FROM attachments WHERE test_execution_id IN (${testExecutionIds}) RETURNING stored_name`,
        [TEST_PROJECT_NAME_PREFIX],
    );
    await Promise.all(attachments.rows.map((row) => deleteFile(row.stored_name)));
    await pool.query(`DELETE FROM defects WHERE project_id IN (${testProjectIds})`, [TEST_PROJECT_NAME_PREFIX]);
    await pool.query(`DELETE FROM test_executions WHERE project_id IN (${testProjectIds})`, [TEST_PROJECT_NAME_PREFIX]);
    await pool.query(`DELETE FROM suite_runs WHERE project_id IN (${testProjectIds})`, [TEST_PROJECT_NAME_PREFIX]);
    await pool.query(`DELETE FROM test_suites WHERE project_id IN (${testProjectIds})`, [TEST_PROJECT_NAME_PREFIX]);
    await pool.query(`DELETE FROM test_cases WHERE project_id IN (${testProjectIds})`, [TEST_PROJECT_NAME_PREFIX]);
    await pool.query('DELETE FROM projects WHERE starts_with(name, $1)', [TEST_PROJECT_NAME_PREFIX]);
}

type MailpitSearchResponse = { messages: { ID: string }[] };
type MailpitMessage = { Subject: string; Text: string };

async function mailpit<T>(method: string, path: string): Promise<T> {
    const response = await fetch(MAILPIT_API_URL + path, { method });

    if (!response.ok) {
        throw new Error(`Mailpit ${method} ${path}: ${response.status} — is Mailpit running?`);
    }

    return (method === 'DELETE' ? undefined : await response.json()) as T;
}

// The newest email to `email` (waits for it to arrive), or fails the test.
export async function readLatestEmail(email: string): Promise<MailpitMessage> {
    const query = encodeURIComponent(`to:"${email}"`);

    for (let attempt = 0; attempt < MAILPIT_POLL_ATTEMPTS; attempt++) {
        const { messages } = await mailpit<MailpitSearchResponse>('GET', `/search?query=${query}`);
        const newest = messages[0];

        if (newest) {
            return mailpit<MailpitMessage>('GET', `/message/${newest.ID}`);
        }

        await new Promise((resolve) => setTimeout(resolve, MAILPIT_POLL_INTERVAL_MS));
    }

    throw new Error(`No email to ${email} arrived in Mailpit`);
}

export async function countEmails(email: string): Promise<number> {
    const query = encodeURIComponent(`to:"${email}"`);

    return (await mailpit<MailpitSearchResponse>('GET', `/search?query=${query}`)).messages.length;
}

// The token from the newest invitation email to `email`.
export async function readInvitationToken(email: string): Promise<string> {
    const token = INVITATION_TOKEN_PATTERN.exec((await readLatestEmail(email)).Text)?.[1];

    if (!token) {
        throw new Error(`No invitation link in the email to ${email}`);
    }

    return token;
}

export async function deleteTestEmails(): Promise<void> {
    await mailpit<undefined>('DELETE', `/search?query=${encodeURIComponent(MAILPIT_TEST_QUERY)}`);
}
