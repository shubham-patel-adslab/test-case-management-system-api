// Attachments (PRD "Add comments and attachments to test runs", "Secure file upload for test attachments"):
// the type is decided by the file's content, not its name; limits are enforced; a rejected upload leaves
// nothing behind; files are only downloadable through the authorized route, always as a download.
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../src/app/env.js';
import { attachmentListResponseSchema } from '../src/features/attachment/attachment.response.dto.js';
import { ACCESS_TOKEN_COOKIE_NAME } from '../src/features/authentication/authentication.constant.js';
import { testCaseDetailsResponseSchema } from '../src/features/test-case/test-case.response.dto.js';
import {
    testExecutionAuditLogListResponseSchema,
    testExecutionDetailsResponseSchema,
    type TestExecutionDetailsResponseDto,
} from '../src/features/test-execution/test-execution.response.dto.js';
import {
    apiUrl,
    createTestProject,
    createTestUser,
    deleteTestProjects,
    deleteTestUsers,
    expectBody,
    expectError,
    request,
    startTestServer,
    stopTestServer,
    type TestResponse,
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

// Real file contents: a 1×1 PNG, the start of a PDF, a Windows executable header, plain text.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const PDF = Buffer.from('%PDF-1.4\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]);
const TEXT = Buffer.from('2026-11-17 ERROR dashboard empty\nstack: …\n', 'utf8');

type UploadFile = { name: string; content: Buffer };

async function upload(caller: TestUser, projectId: number, executionId: number, files: UploadFile[], field = 'files'): Promise<TestResponse> {
    const form = new FormData();

    for (const file of files) {
        form.append(field, new Blob([new Uint8Array(file.content)]), file.name);
    }

    const response = await fetch(apiUrl(`/projects/${projectId}/test-executions/${executionId}/attachments`), {
        method: 'POST',
        headers: { cookie: `${ACCESS_TOKEN_COOKIE_NAME}=${caller.token}` },
        body: form,
    });
    const text = await response.text();

    return { status: response.status, headers: response.headers, text, json: text ? JSON.parse(text) : undefined };
}

async function download(caller: TestUser, url: string): Promise<{ status: number; headers: Headers; body: Buffer }> {
    // url is the API's own link: /api/projects/…; apiUrl expects the path after /api.
    const response = await fetch(apiUrl(url.replace(/^\/api/, '')), { headers: { cookie: `${ACCESS_TOKEN_COOKIE_NAME}=${caller.token}` } });

    return { status: response.status, headers: response.headers, body: Buffer.from(await response.arrayBuffer()) };
}

async function storedFiles(): Promise<string[]> {
    try {
        return await readdir(path.resolve(env.UPLOAD_DIR));
    } catch {
        return [];
    }
}

// A project with a tester (and the given extra members), one execution with the given result.
async function executionWith(status: string, extraMemberIds: string[] = []) {
    const tester = await createTestUser('TESTER');
    const project = await createTestProject(admin, [tester.id, ...extraMemberIds]);
    const caseBody = {
        title: 'Sign in', description: '', priority: 'HIGH', type: 'FUNCTIONAL', preConditions: '', postConditions: '', tags: [],
        steps: [{ action: 'Sign in', expectedResult: 'Dashboard' }], suiteIds: [],
    };
    const testCase = expectBody(await request('POST', `/projects/${project.id}/test-cases`, { token: admin.token, body: caseBody }), 201, testCaseDetailsResponseSchema);

    if (status === 'PENDING') {
        await request('POST', `/projects/${project.id}/test-executions/assignments`, { token: admin.token, body: { testCaseIds: [testCase.id], assigneeId: tester.id } });
        const queue = await request('GET', `/projects/${project.id}/test-executions`, { token: tester.token });
        const id = (queue.json as { items: { id: number }[] }).items[0]?.id ?? 0;

        return { tester, project, executionId: id };
    }

    const execution: TestExecutionDetailsResponseDto = expectBody(
        await request('POST', `/projects/${project.id}/test-executions`, { token: tester.token, body: { testCaseId: testCase.id, status } }),
        201,
        testExecutionDetailsResponseSchema,
    );

    return { tester, project, executionId: execution.id };
}

describe('POST /projects/:projectId/test-executions/:executionId/attachments', () => {
    // The happy path the execute screen relies on: several files at once, typed from content, listed on the
    // execution, in its audit trail, and downloadable byte-for-byte — always as a download.
    it('uploads PNG, PDF and text (UTF-8 name): 201, on the execution and its audit trail; downloads byte-for-byte', async () => {
        const { tester, project, executionId } = await executionWith('FAIL');
        const files = [
            { name: 'screenshot.png', content: PNG },
            { name: 'report.pdf', content: PDF },
            { name: 'résumé of errors.log', content: TEXT },
        ];

        const uploaded = expectBody(await upload(tester, project.id, executionId, files), 201, attachmentListResponseSchema);

        // Listed by file name, like every list of named things.
        expect(uploaded.map((file) => [file.fileName, file.mimeType, file.sizeBytes])).toEqual([
            ['report.pdf', 'application/pdf', PDF.length],
            ['résumé of errors.log', 'text/plain', TEXT.length],
            ['screenshot.png', 'image/png', PNG.length],
        ]);

        const details = expectBody(await request('GET', `/projects/${project.id}/test-executions/${executionId}`, { token: tester.token }), 200, testExecutionDetailsResponseSchema);
        expect(details.attachments).toEqual(uploaded);

        const audit = expectBody(await request('GET', `/projects/${project.id}/test-executions/${executionId}/audit`, { token: tester.token }), 200, testExecutionAuditLogListResponseSchema);
        expect(audit.at(-1)).toMatchObject({ action: 'ATTACHMENT_ADDED', details: { fileNames: files.map((file) => file.name) } });

        const png = await download(tester, uploaded[2]?.url ?? '');
        expect(png.status).toBe(200);
        expect(png.body.equals(PNG)).toBe(true);
        expect(png.headers.get('content-type')).toBe('image/png');
        expect(png.headers.get('content-disposition')).toBe('attachment; filename=screenshot.png');
        expect(png.headers.get('x-content-type-options')).toBe('nosniff');
        expect(png.headers.get('cache-control')).toBe('private, no-store');

        // A non-ASCII name travels encoded (RFC 5987), never as raw bytes in a header.
        const log = await download(tester, uploaded[1]?.url ?? '');
        expect(log.body.equals(TEXT)).toBe(true);
        expect(log.headers.get('content-disposition')).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9%20of%20errors.log");
    });

    // The security property: the name and the browser's Content-Type are never trusted. A renamed executable,
    // a binary file posing as text, a text file posing as an image — all rejected, and nothing is saved.
    it('rejects by content, not name: exe renamed .pdf, binary renamed .txt, text renamed .png (400 per file; nothing saved)', async () => {
        const { tester, project, executionId } = await executionWith('FAIL');
        const before = await storedFiles();
        const files = [
            { name: 'fine.png', content: PNG },
            { name: 'invoice.pdf', content: EXE },
            { name: 'notes.txt', content: Buffer.from([0x68, 0x00, 0x69]) },
            { name: 'photo.png', content: TEXT },
        ];

        const error = expectError(await upload(tester, project.id, executionId, files), 400, 'VALIDATION_ERROR');

        expect(error.details?.map((detail) => detail.field)).toEqual(['files[1]', 'files[2]', 'files[3]']);
        expect(await storedFiles()).toEqual(before);

        const details = expectBody(await request('GET', `/projects/${project.id}/test-executions/${executionId}`, { token: tester.token }), 200, testExecutionDetailsResponseSchema);
        expect(details.attachments).toEqual([]);
    });

    it('enforces the limits: over 10 MB → 413; more than 5 files, no file, or another field name → 400', async () => {
        const { tester, project, executionId } = await executionWith('FAIL');
        const oversized = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 1 - PNG.length)]);

        expectError(await upload(tester, project.id, executionId, [{ name: 'big.png', content: oversized }]), 413, 'PAYLOAD_TOO_LARGE');

        const six = Array.from({ length: 6 }, (_, index) => ({ name: `shot-${index}.png`, content: PNG }));
        expectError(await upload(tester, project.id, executionId, six), 400, 'VALIDATION_ERROR');
        expectError(await upload(tester, project.id, executionId, []), 400, 'VALIDATION_ERROR');
        expectError(await upload(tester, project.id, executionId, [{ name: 'a.png', content: PNG }], 'file'), 400, 'VALIDATION_ERROR');
    });

    // Attachments document a run that happened.
    it('rejects attachments on a PENDING execution (409)', async () => {
        const { tester, project, executionId } = await executionWith('PENDING');

        expectError(await upload(tester, project.id, executionId, [{ name: 'a.png', content: PNG }]), 409, 'CONFLICT');
    });
});

describe('Who can upload and download', () => {
    // PRD: read-only views attachments but doesn't add them; the project boundary holds for files too.
    it('a member READ_ONLY downloads but gets 403 on upload; a non-member and another project\'s URL get 404', async () => {
        const [readOnly, outsider] = await Promise.all([createTestUser('READ_ONLY'), createTestUser('TESTER')]);
        const { tester, project, executionId } = await executionWith('FAIL', [readOnly.id]);
        const [file] = expectBody(await upload(tester, project.id, executionId, [{ name: 'shot.png', content: PNG }]), 201, attachmentListResponseSchema);
        const url = file?.url ?? '';

        expect((await download(readOnly, url)).status).toBe(200);
        expectError(await upload(readOnly, project.id, executionId, [{ name: 'a.png', content: PNG }]), 403, 'FORBIDDEN');

        expect((await download(outsider, url)).status).toBe(404);
        const otherProject = await createTestProject(admin);
        expect((await download(admin, url.replace(`/projects/${project.id}/`, `/projects/${otherProject.id}/`))).status).toBe(404);
    });
});
