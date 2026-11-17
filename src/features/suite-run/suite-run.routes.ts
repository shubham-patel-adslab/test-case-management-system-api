import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry } from '../../app/openapi.js';
import { authorize } from '../authorization/authorization.middleware.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { suiteRunController } from './suite-run.controller.js';
import {
    suiteRunCreateRequestSchema,
    suiteRunIdParamsSchema,
    suiteRunPageRequestSchema,
    suiteRunSuiteParamsSchema,
} from './suite-run.request.dto.js';
import { suiteRunDetailsResponseSchema, suiteRunPageResponseSchema } from './suite-run.response.dto.js';

const { TEST_EXECUTION } = RESOURCE_CODE;
const { CREATE, READ } = PERMISSION_CODE;

// Running a suite creates executions (TEST_EXECUTION CREATE — admin, test-lead, tester; assigning the run to
// someone else additionally needs TEST_ASSIGNMENT CREATE, checked in the service). Reports are readable by
// every role. Both routers are mounted in api.router.ts behind authenticate, with mergeParams.

// Mounted at /projects/:projectId/test-suites/:suiteId/runs.
export const testSuiteRunRouter = Router({ mergeParams: true });

testSuiteRunRouter.get('/', authorize(TEST_EXECUTION, READ), suiteRunController.getPageBySuite);
testSuiteRunRouter.post('/', authorize(TEST_EXECUTION, CREATE), suiteRunController.create);

// Mounted at /projects/:projectId/suite-runs.
export const suiteRunRouter = Router({ mergeParams: true });

suiteRunRouter.get('/:runId', authorize(TEST_EXECUTION, READ), suiteRunController.getById);

const TAGS = ['Suite runs'];
const validationErrorResponse = errorResponse('Invalid request');
const unauthorizedResponse = errorResponse('Missing, invalid or expired access-token cookie, or inactive account');
const forbiddenResponse = (permission: string) => errorResponse(`Missing permission TEST_EXECUTION ${permission} (code FORBIDDEN)`);
const suiteNotFoundResponse = errorResponse('Project or test suite not found (or the caller is not a member of the project)');

openApiRegistry.registerPath({
    method: 'post',
    path: '/projects/{projectId}/test-suites/{suiteId}/runs',
    tags: TAGS,
    summary: 'Run a whole suite (one pending execution per test case, in suite order)',
    description: 'Record each result with PUT …/test-executions/{executionId}. `assigneeId` (optional) assigns every execution: '
        + 'it must be an active project member who can execute tests (400 on `assigneeId`), and assigning to someone else '
        + 'needs TEST_ASSIGNMENT CREATE. 409 when the suite has no test cases.',
    request: { params: suiteRunSuiteParamsSchema, body: { content: jsonContent(suiteRunCreateRequestSchema), required: false } },
    responses: {
        201: { description: 'The new run (suite report)', content: jsonContent(suiteRunDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: errorResponse('Missing permission TEST_EXECUTION CREATE, or TEST_ASSIGNMENT CREATE when assigning to someone else'),
        404: suiteNotFoundResponse,
        409: errorResponse('The suite has no test cases'),
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: '/projects/{projectId}/test-suites/{suiteId}/runs',
    tags: TAGS,
    summary: 'List a suite\'s runs with their progress (paginated, newest first)',
    request: { params: suiteRunSuiteParamsSchema, query: suiteRunPageRequestSchema },
    responses: {
        200: { description: 'A page of suite runs', content: jsonContent(suiteRunPageResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(READ),
        404: suiteNotFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: '/projects/{projectId}/suite-runs/{runId}',
    tags: TAGS,
    summary: 'Suite run report: progress per status and every execution in suite order',
    description: 'Still available after the suite is deleted (suiteId null, suiteName as it was).',
    request: { params: suiteRunIdParamsSchema },
    responses: {
        200: { description: 'The suite report', content: jsonContent(suiteRunDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(READ),
        404: errorResponse('Project or suite run not found (or the caller is not a member of the project)'),
    },
});
