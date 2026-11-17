import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry } from '../../app/openapi.js';
import { projectController } from './project.controller.js';
import {
    projectCreateRequestSchema,
    projectIdParamsSchema,
    projectPageRequestSchema,
    projectUpdateRequestSchema,
} from './project.request.dto.js';
import { projectDetailsResponseSchema, projectPageResponseSchema } from './project.response.dto.js';

// Authentication is applied to the whole router in api.router.ts. KNOWN GAP (decided 2026-11-17): no
// permission check yet — every authenticated user can create and update projects until the PROJECT resource
// and its role mappings are seeded and these routes use authorize(...). PRD Features §2 allows only admin
// and test-lead.
export const projectRouter = Router();

projectRouter.get('/', projectController.getPage);
projectRouter.post('/', projectController.create);
projectRouter.get('/:projectId', projectController.getById);
projectRouter.put('/:projectId', projectController.update);

const TAGS = ['Projects'];

const validationErrorResponse = errorResponse('Invalid request');
const unauthorizedResponse = errorResponse('Missing, invalid or expired access-token cookie, or inactive account');
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
        404: notFoundResponse,
    },
});
