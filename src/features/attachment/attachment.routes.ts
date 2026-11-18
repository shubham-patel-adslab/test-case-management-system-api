import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry } from '../../app/openapi.js';
import { authorize } from '../authorization/authorization.middleware.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { attachmentController } from './attachment.controller.js';
import { attachmentExecutionParamsSchema, attachmentIdParamsSchema, attachmentUploadRequestSchema } from './attachment.request.dto.js';
import { attachmentListResponseSchema } from './attachment.response.dto.js';
import { receiveAttachmentFiles } from './attachment.upload.js';

const { TEST_EXECUTION } = RESOURCE_CODE;

// PRD: tester, test-lead and admin add attachments to test runs (TEST_EXECUTION UPDATE); every role may view
// them (READ). authorize runs before the files are read, so a caller who may not upload never makes the server
// buffer anything. The service then checks the project is in the caller's scope. Both routers are mounted in
// api.router.ts behind authenticate, with mergeParams.

// Mounted at /projects/:projectId/test-executions/:executionId/attachments.
export const executionAttachmentRouter = Router({ mergeParams: true });

executionAttachmentRouter.post('/', authorize(TEST_EXECUTION, PERMISSION_CODE.UPDATE), receiveAttachmentFiles, attachmentController.upload);

// Mounted at /projects/:projectId/attachments.
export const attachmentRouter = Router({ mergeParams: true });

attachmentRouter.get('/:attachmentId', authorize(TEST_EXECUTION, PERMISSION_CODE.READ), attachmentController.download);

const TAGS = ['Attachments'];
const unauthorizedResponse = errorResponse('Missing, invalid or expired access-token cookie, or inactive account');

openApiRegistry.registerPath({
    method: 'post',
    path: '/projects/{projectId}/test-executions/{executionId}/attachments',
    tags: TAGS,
    summary: 'Upload attachments to a recorded execution (multipart, field "files")',
    description: '1–5 files, each ≤ 10 MB. The type is detected from the content: PNG, JPEG, GIF, PDF, or text (.txt, .log, .csv '
        + 'that really is UTF-8 text). All-or-nothing: an unsupported file is a 400 on `files[i]` and nothing is saved. '
        + 'Only once the result is recorded (409 while PENDING). The execution\'s audit trail records ATTACHMENT_ADDED.',
    request: {
        params: attachmentExecutionParamsSchema,
        body: { content: { 'multipart/form-data': { schema: attachmentUploadRequestSchema } } },
    },
    responses: {
        201: { description: 'The uploaded attachments', content: jsonContent(attachmentListResponseSchema) },
        400: errorResponse('No file, more than 5, an unexpected field, or an unsupported type'),
        401: unauthorizedResponse,
        403: errorResponse('Missing permission TEST_EXECUTION UPDATE (code FORBIDDEN)'),
        404: errorResponse('Project or test execution not found (or the caller is not a member of the project)'),
        409: errorResponse('The execution is still PENDING'),
        413: errorResponse('A file is larger than 10 MB (code PAYLOAD_TOO_LARGE)'),
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: '/projects/{projectId}/attachments/{attachmentId}',
    tags: TAGS,
    summary: 'Download an attachment',
    description: 'Always served as a download (Content-Disposition: attachment) with the type detected at upload.',
    request: { params: attachmentIdParamsSchema },
    responses: {
        200: { description: 'The file', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
        400: errorResponse('Invalid request'),
        401: unauthorizedResponse,
        403: errorResponse('Missing permission TEST_EXECUTION READ (code FORBIDDEN)'),
        404: errorResponse('Project or attachment not found (or the caller is not a member of the project)'),
    },
});
