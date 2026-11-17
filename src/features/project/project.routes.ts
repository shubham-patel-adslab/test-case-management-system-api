import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry } from '../../app/openapi.js';
import { authorize } from '../authorization/authorization.middleware.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { projectController } from './project.controller.js';
import {
    projectCreateRequestSchema,
    projectIdParamsSchema,
    projectPageRequestSchema,
    projectUpdateRequestSchema,
} from './project.request.dto.js';
import { projectDetailsResponseSchema, projectPageResponseSchema } from './project.response.dto.js';

const { PROJECT } = RESOURCE_CODE;
const { CREATE, READ, UPDATE } = PERMISSION_CODE;

// Authentication is applied to the whole router in api.router.ts; each route checks its PROJECT permission
// (every role reads; ADMIN and TEST_LEAD create and update — PRD Features §2).
export const projectRouter = Router();

projectRouter.get('/', authorize(PROJECT, READ), projectController.getPage);
projectRouter.post('/', authorize(PROJECT, CREATE), projectController.create);
projectRouter.get('/:projectId', authorize(PROJECT, READ), projectController.getById);
projectRouter.put('/:projectId', authorize(PROJECT, UPDATE), projectController.update);

const TAGS = ['Projects'];

const validationErrorResponse = errorResponse('Invalid request');
const unauthorizedResponse = errorResponse('Missing, invalid or expired access-token cookie, or inactive account');
const forbiddenResponse = (permission: string) =>
    errorResponse(`Missing permission PROJECT ${permission} (code FORBIDDEN)`);
const notFoundResponse = errorResponse('Project not found');

openApiRegistry.registerPath({
    method: 'get',
    path: '/projects',
    tags: TAGS,
    summary: 'List projects (paginated, newest first)',
    request: { query: projectPageRequestSchema },
    responses: {
        200: { description: 'A page of projects', content: jsonContent(projectPageResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(READ),
    },
});

openApiRegistry.registerPath({
    method: 'post',
    path: '/projects',
    tags: TAGS,
    summary: 'Create a project',
    request: { body: { content: jsonContent(projectCreateRequestSchema) } },
    responses: {
        201: { description: 'Created project', content: jsonContent(projectDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(CREATE),
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: '/projects/{projectId}',
    tags: TAGS,
    summary: 'Get a project',
    request: { params: projectIdParamsSchema },
    responses: {
        200: { description: 'The project', content: jsonContent(projectDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(READ),
        404: notFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'put',
    path: '/projects/{projectId}',
    tags: TAGS,
    summary: 'Update a project',
    description: 'The body `id` must match `projectId` in the URL.',
    request: {
        params: projectIdParamsSchema,
        body: { content: jsonContent(projectUpdateRequestSchema) },
    },
    responses: {
        200: { description: 'Updated project', content: jsonContent(projectDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(UPDATE),
        404: notFoundResponse,
    },
});
