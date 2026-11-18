import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry, tooManyRequestsResponse } from '../../app/openapi.js';
import { RATE_LIMIT } from '../../app/rate-limit.js';
import { authorize } from '../authorization/authorization.middleware.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { testExecutionController } from './test-execution.controller.js';
import {
    testExecutionAssignRequestSchema,
    testExecutionCreateRequestSchema,
    testExecutionIdParamsSchema,
    testExecutionPageRequestSchema,
    testExecutionProgressRequestSchema,
    testExecutionProjectParamsSchema,
    testExecutionResultRequestSchema,
} from './test-execution.request.dto.js';
import {
    testExecutionAssignResponseSchema,
    testExecutionAuditLogListResponseSchema,
    testExecutionDetailsResponseSchema,
    testExecutionPageResponseSchema,
    testExecutionProgressResponseSchema,
} from './test-execution.response.dto.js';

const rateLimitedResponse = tooManyRequestsResponse(RATE_LIMIT.TEST_EXECUTION, 'user', 'test execution');

const { TEST_ASSIGNMENT, TEST_EXECUTION } = RESOURCE_CODE;
const { CREATE, READ, UPDATE } = PERMISSION_CODE;

// Mounted at /projects/:projectId/test-executions in api.router.ts (behind authenticate); mergeParams exposes
// projectId. PRD Features §4: tester, test-lead and admin run tests and record results (TEST_EXECUTION
// CREATE/UPDATE); only admin and test-lead assign (TEST_ASSIGNMENT CREATE); every role views. The service then
// checks the project is in the caller's scope.
export const testExecutionRouter = Router({ mergeParams: true });

testExecutionRouter.get('/', authorize(TEST_EXECUTION, READ), testExecutionController.getPage);
testExecutionRouter.post('/', authorize(TEST_EXECUTION, CREATE), testExecutionController.create);
// Fixed paths before '/:executionId', which would otherwise match them.
testExecutionRouter.get('/progress', authorize(TEST_EXECUTION, READ), testExecutionController.getProgress);
testExecutionRouter.post('/assignments', authorize(TEST_ASSIGNMENT, CREATE), testExecutionController.assign);
testExecutionRouter.get('/:executionId', authorize(TEST_EXECUTION, READ), testExecutionController.getById);
testExecutionRouter.put('/:executionId', authorize(TEST_EXECUTION, UPDATE), testExecutionController.recordResult);
testExecutionRouter.get('/:executionId/audit', authorize(TEST_EXECUTION, READ), testExecutionController.getAuditLogs);

const TAGS = ['Test executions'];
const BASE_PATH = '/projects/{projectId}/test-executions';
const EXECUTION_PATH = `${BASE_PATH}/{executionId}`;

const validationErrorResponse = errorResponse('Invalid request');
const unauthorizedResponse = errorResponse('Missing, invalid or expired access-token cookie, or inactive account');
const forbiddenResponse = (resource: string, permission: string) =>
    errorResponse(`Missing permission ${resource} ${permission} (code FORBIDDEN)`);
const projectNotFoundResponse = errorResponse('Project not found, or the caller is not a member of it');
const notFoundResponse = errorResponse('Project or test execution not found (or the caller is not a member of the project)');
const RESULT_DESCRIPTION = '`stepResults` (optional) gives a result per step by its 1-based `order`; an unknown order is a 400 on '
    + '`stepResults[i].order`, and the overall `status` can\'t be PASS when a step failed. The title and steps are '
    + 'snapshotted into the execution, and the test case\'s `lastResult` is updated.';

openApiRegistry.registerPath({
    method: 'get',
    path: BASE_PATH,
    tags: TAGS,
    summary: 'Execution queue and history (paginated, by test case title)',
    description: 'Filters combine with AND: `status` (comma-separated), `assigneeId` ("assigned to me"), `testCaseId` (a test '
        + 'case\'s history), `suiteRunId`. Sorted by `sort`, default `testCaseTitle:asc`; a history reads best with '
        + '`sort=createdAt:desc`.',
    request: { params: testExecutionProjectParamsSchema, query: testExecutionPageRequestSchema },
    responses: {
        200: { description: 'A page of executions', content: jsonContent(testExecutionPageResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        429: rateLimitedResponse,
        403: forbiddenResponse(TEST_EXECUTION, READ),
        404: projectNotFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: `${BASE_PATH}/progress`,
    tags: TAGS,
    summary: 'Execution progress: counts per status (optionally for one assignee)',
    request: { params: testExecutionProjectParamsSchema, query: testExecutionProgressRequestSchema },
    responses: {
        200: { description: 'Counts per status', content: jsonContent(testExecutionProgressResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        429: rateLimitedResponse,
        403: forbiddenResponse(TEST_EXECUTION, READ),
        404: projectNotFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'post',
    path: `${BASE_PATH}/assignments`,
    tags: TAGS,
    summary: 'Assign test cases to a tester (creates pending executions)',
    description: 'One PENDING execution per test case, all-or-nothing (an id not in the project is a 400 on `testCaseIds[i]`). '
        + 'The assignee must be an active project member who can execute tests (400 on `assigneeId`). Test cases already '
        + 'pending for this assignee are skipped.',
    request: { params: testExecutionProjectParamsSchema, body: { content: jsonContent(testExecutionAssignRequestSchema) } },
    responses: {
        201: { description: 'How many executions were created', content: jsonContent(testExecutionAssignResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        429: rateLimitedResponse,
        403: forbiddenResponse(TEST_ASSIGNMENT, CREATE),
        404: projectNotFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'post',
    path: BASE_PATH,
    tags: TAGS,
    summary: 'Run a test case ad hoc (creates an execution with its result)',
    description: RESULT_DESCRIPTION,
    request: { params: testExecutionProjectParamsSchema, body: { content: jsonContent(testExecutionCreateRequestSchema) } },
    responses: {
        201: { description: 'The recorded execution', content: jsonContent(testExecutionDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        429: rateLimitedResponse,
        403: forbiddenResponse(TEST_EXECUTION, CREATE),
        404: projectNotFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: EXECUTION_PATH,
    tags: TAGS,
    summary: 'Get an execution with its steps',
    description: 'Recorded: the steps as run, with their results. Pending: the test case\'s current steps.',
    request: { params: testExecutionIdParamsSchema },
    responses: {
        200: { description: 'The execution', content: jsonContent(testExecutionDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        429: rateLimitedResponse,
        403: forbiddenResponse(TEST_EXECUTION, READ),
        404: notFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'put',
    path: EXECUTION_PATH,
    tags: TAGS,
    summary: 'Record the result of a pending execution (once)',
    description: `Results are immutable: a recorded execution answers 409 — run the test case again instead. Any project member `
        + `who may execute can record it, not only the assignee. ${RESULT_DESCRIPTION}`,
    request: { params: testExecutionIdParamsSchema, body: { content: jsonContent(testExecutionResultRequestSchema) } },
    responses: {
        200: { description: 'The recorded execution', content: jsonContent(testExecutionDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        429: rateLimitedResponse,
        403: forbiddenResponse(TEST_EXECUTION, UPDATE),
        404: notFoundResponse,
        409: errorResponse('The result is already recorded'),
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: `${EXECUTION_PATH}/audit`,
    tags: TAGS,
    summary: 'Audit trail of an execution (who did what and when, oldest first)',
    request: { params: testExecutionIdParamsSchema },
    responses: {
        200: { description: 'The audit entries', content: jsonContent(testExecutionAuditLogListResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        429: rateLimitedResponse,
        403: forbiddenResponse(TEST_EXECUTION, READ),
        404: notFoundResponse,
    },
});
