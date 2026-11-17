import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry } from '../../app/openapi.js';
import { authorize } from '../authorization/authorization.middleware.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { testSuiteController } from './test-suite.controller.js';
import {
    testSuiteCaseParamsSchema,
    testSuiteCasesAddRequestSchema,
    testSuiteCasesReorderRequestSchema,
    testSuiteCreateRequestSchema,
    testSuiteIdParamsSchema,
    testSuitePageRequestSchema,
    testSuiteProjectParamsSchema,
    testSuiteUpdateRequestSchema,
} from './test-suite.request.dto.js';
import { testSuiteDetailsResponseSchema, testSuitePageResponseSchema } from './test-suite.response.dto.js';

const { TEST_SUITE } = RESOURCE_CODE;
const { CREATE, DELETE, READ, UPDATE } = PERMISSION_CODE;

// Mounted at /projects/:projectId/test-suites in api.router.ts (behind authenticate); mergeParams exposes
// projectId. Each route checks its TEST_SUITE permission (every role reads; ADMIN and TEST_LEAD manage —
// PRD Features §6); changing a suite's test cases is updating the suite. The service then checks the
// project is in the caller's scope.
export const testSuiteRouter = Router({ mergeParams: true });

testSuiteRouter.get('/', authorize(TEST_SUITE, READ), testSuiteController.getPage);
testSuiteRouter.post('/', authorize(TEST_SUITE, CREATE), testSuiteController.create);
testSuiteRouter.get('/:suiteId', authorize(TEST_SUITE, READ), testSuiteController.getById);
testSuiteRouter.put('/:suiteId', authorize(TEST_SUITE, UPDATE), testSuiteController.update);
testSuiteRouter.delete('/:suiteId', authorize(TEST_SUITE, DELETE), testSuiteController.delete);
testSuiteRouter.post('/:suiteId/test-cases', authorize(TEST_SUITE, UPDATE), testSuiteController.addTestCases);
testSuiteRouter.patch('/:suiteId/test-cases/reorder', authorize(TEST_SUITE, UPDATE), testSuiteController.reorderTestCases);
testSuiteRouter.delete('/:suiteId/test-cases/:testCaseId', authorize(TEST_SUITE, UPDATE), testSuiteController.removeTestCase);

const TAGS = ['Test suites'];
const BASE_PATH = '/projects/{projectId}/test-suites';
const SUITE_PATH = `${BASE_PATH}/{suiteId}`;

const validationErrorResponse = errorResponse('Invalid request');
const unauthorizedResponse = errorResponse('Missing, invalid or expired access-token cookie, or inactive account');
const forbiddenResponse = (permission: string) =>
    errorResponse(`Missing permission TEST_SUITE ${permission} (code FORBIDDEN)`);
const projectNotFoundResponse = errorResponse('Project not found, or the caller is not a member of it');
const notFoundResponse = errorResponse('Project or test suite not found (or the caller is not a member of the project)');
const nameTakenResponse = errorResponse('The project already has a test suite with this name (ignoring case)');

openApiRegistry.registerPath({
    method: 'get',
    path: BASE_PATH,
    tags: TAGS,
    summary: 'List test suites of a project (paginated, by name)',
    request: { params: testSuiteProjectParamsSchema, query: testSuitePageRequestSchema },
    responses: {
        200: { description: 'A page of test suites', content: jsonContent(testSuitePageResponseSchema) },
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
    summary: 'Create a test suite',
    description: 'Test cases are added afterwards (POST …/{suiteId}/test-cases, or a test case\'s `suiteIds`).',
    request: { params: testSuiteProjectParamsSchema, body: { content: jsonContent(testSuiteCreateRequestSchema) } },
    responses: {
        201: { description: 'Created test suite', content: jsonContent(testSuiteDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(CREATE),
        404: projectNotFoundResponse,
        409: nameTakenResponse,
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: SUITE_PATH,
    tags: TAGS,
    summary: 'Get a test suite with its test cases in order',
    request: { params: testSuiteIdParamsSchema },
    responses: {
        200: { description: 'The test suite', content: jsonContent(testSuiteDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(READ),
        404: notFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'put',
    path: SUITE_PATH,
    tags: TAGS,
    summary: 'Update a test suite\'s name and description',
    description: 'The body `id` must match `suiteId` in the URL.',
    request: { params: testSuiteIdParamsSchema, body: { content: jsonContent(testSuiteUpdateRequestSchema) } },
    responses: {
        200: { description: 'Updated test suite', content: jsonContent(testSuiteDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(UPDATE),
        404: notFoundResponse,
        409: nameTakenResponse,
    },
});

openApiRegistry.registerPath({
    method: 'delete',
    path: SUITE_PATH,
    tags: TAGS,
    summary: 'Delete a test suite (its test cases stay)',
    request: { params: testSuiteIdParamsSchema },
    responses: {
        204: { description: 'Deleted' },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(DELETE),
        404: notFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'post',
    path: `${SUITE_PATH}/test-cases`,
    tags: TAGS,
    summary: 'Add test cases to a suite (appended in the order given)',
    description: '1–100 test cases of the same project, no duplicates; any other id rejects the whole request '
        + '(400 on `testCaseIds[i]`, nothing added). Cases already in the suite keep their position.',
    request: { params: testSuiteIdParamsSchema, body: { content: jsonContent(testSuiteCasesAddRequestSchema) } },
    responses: {
        200: { description: 'The test suite after the change', content: jsonContent(testSuiteDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(UPDATE),
        404: notFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'patch',
    path: `${SUITE_PATH}/test-cases/reorder`,
    tags: TAGS,
    summary: 'Reorder a suite\'s test cases',
    description: '`testCaseIds` is the new order and must list every test case in the suite exactly once.',
    request: { params: testSuiteIdParamsSchema, body: { content: jsonContent(testSuiteCasesReorderRequestSchema) } },
    responses: {
        200: { description: 'The test suite in its new order', content: jsonContent(testSuiteDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(UPDATE),
        404: notFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'delete',
    path: `${SUITE_PATH}/test-cases/{testCaseId}`,
    tags: TAGS,
    summary: 'Remove a test case from a suite (the test case stays)',
    request: { params: testSuiteCaseParamsSchema },
    responses: {
        204: { description: 'Removed from the suite' },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(UPDATE),
        404: errorResponse('Project or test suite not found, or the test case is not in the suite'),
    },
});
