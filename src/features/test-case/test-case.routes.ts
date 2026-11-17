import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry } from '../../app/openapi.js';
import { authorize } from '../authorization/authorization.middleware.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { testCaseController } from './test-case.controller.js';
import {
    testCaseBulkRequestSchema,
    testCaseCreateRequestSchema,
    testCaseIdParamsSchema,
    testCasePageRequestSchema,
    testCaseProjectParamsSchema,
    testCaseUpdateRequestSchema,
} from './test-case.request.dto.js';
import {
    testCaseBulkResponseSchema,
    testCaseDetailsResponseSchema,
    testCasePageResponseSchema,
} from './test-case.response.dto.js';

const { TEST_CASE } = RESOURCE_CODE;
const { CREATE, DELETE, READ, UPDATE } = PERMISSION_CODE;

// Mounted at /projects/:projectId/test-cases in api.router.ts (behind authenticate); mergeParams exposes
// projectId. Each route checks its TEST_CASE permission (every role reads; ADMIN and TEST_LEAD create,
// update and delete — PRD Features §3); the service then checks the project is in the caller's scope.
export const testCaseRouter = Router({ mergeParams: true });

testCaseRouter.get('/', authorize(TEST_CASE, READ), testCaseController.getPage);
testCaseRouter.post('/', authorize(TEST_CASE, CREATE), testCaseController.create);
// Every action changes test cases (UPDATE); DELETE additionally needs TEST_CASE DELETE (checked in the service).
testCaseRouter.post('/bulk', authorize(TEST_CASE, UPDATE), testCaseController.bulk);
testCaseRouter.get('/:testCaseId', authorize(TEST_CASE, READ), testCaseController.getById);
testCaseRouter.put('/:testCaseId', authorize(TEST_CASE, UPDATE), testCaseController.update);
testCaseRouter.delete('/:testCaseId', authorize(TEST_CASE, DELETE), testCaseController.delete);

const TAGS = ['Test cases'];
const BASE_PATH = '/projects/{projectId}/test-cases';

const validationErrorResponse = errorResponse('Invalid request');
const unauthorizedResponse = errorResponse('Missing, invalid or expired access-token cookie, or inactive account');
const forbiddenResponse = (permission: string) =>
    errorResponse(`Missing permission TEST_CASE ${permission} (code FORBIDDEN)`);
const projectNotFoundResponse = errorResponse('Project not found, or the caller is not a member of it');
const notFoundResponse = errorResponse('Project or test case not found (or the caller is not a member of the project)');
const BODY_DESCRIPTION =
    'The whole test case: `steps` in order (at least one; replaced as a whole on update), `suiteIds` = every suite '
    + 'of the same project it is in (unknown ids are a 400 on `suiteIds[i]`). Tags are lowercased and merged.';

openApiRegistry.registerPath({
    method: 'get',
    path: BASE_PATH,
    tags: TAGS,
    summary: 'List test cases of a project (paginated, filtered, sorted)',
    description: 'Multi-value filters are comma-separated (`priority=HIGH,CRITICAL`); filters combine with AND. '
        + '`tags` matches any of the tags. `sort=<field>:<asc|desc>`, default `title:asc`. Items have no steps.',
    request: { params: testCaseProjectParamsSchema, query: testCasePageRequestSchema },
    responses: {
        200: { description: 'A page of test cases', content: jsonContent(testCasePageResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(READ),
        404: projectNotFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'post',
    path: BASE_PATH,
    tags: TAGS,
    summary: 'Create a test case with its steps and suites',
    description: BODY_DESCRIPTION,
    request: { params: testCaseProjectParamsSchema, body: { content: jsonContent(testCaseCreateRequestSchema) } },
    responses: {
        201: { description: 'Created test case', content: jsonContent(testCaseDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(CREATE),
        404: projectNotFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'post',
    path: `${BASE_PATH}/bulk`,
    tags: TAGS,
    summary: 'Bulk delete, update priority or assign to a suite (all-or-nothing)',
    description: '`testCaseIds`: 1–100 test cases of this project, no duplicates; any other id rejects the whole request '
        + '(400 on `testCaseIds[i]`, nothing changed). `ASSIGN_TO_SUITE` appends them to the suite in the order given; '
        + 'those already in it keep their position. `DELETE` also requires TEST_CASE DELETE.',
    request: { params: testCaseProjectParamsSchema, body: { content: jsonContent(testCaseBulkRequestSchema) } },
    responses: {
        200: { description: 'How many test cases were affected', content: jsonContent(testCaseBulkResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: errorResponse('Missing permission TEST_CASE UPDATE, or TEST_CASE DELETE for the DELETE action (code FORBIDDEN)'),
        404: projectNotFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: `${BASE_PATH}/{testCaseId}`,
    tags: TAGS,
    summary: 'Get a test case with its steps',
    request: { params: testCaseIdParamsSchema },
    responses: {
        200: { description: 'The test case', content: jsonContent(testCaseDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(READ),
        404: notFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'put',
    path: `${BASE_PATH}/{testCaseId}`,
    tags: TAGS,
    summary: 'Update a test case (full replacement, steps and suites included)',
    description: `The body \`id\` must match \`testCaseId\` in the URL. ${BODY_DESCRIPTION}`,
    request: { params: testCaseIdParamsSchema, body: { content: jsonContent(testCaseUpdateRequestSchema) } },
    responses: {
        200: { description: 'Updated test case', content: jsonContent(testCaseDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(UPDATE),
        404: notFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'delete',
    path: `${BASE_PATH}/{testCaseId}`,
    tags: TAGS,
    summary: 'Delete a test case (its steps and suite memberships go with it; suites stay)',
    request: { params: testCaseIdParamsSchema },
    responses: {
        204: { description: 'Deleted' },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(DELETE),
        404: notFoundResponse,
    },
});
