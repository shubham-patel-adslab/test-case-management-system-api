import { Router } from 'express';

import { jsonContent, openApiRegistry } from '../../app/openapi.js';
import { errorResponseSchema } from '../../shared/response/error.response.dto.js';
import { projectController } from './project.controller.js';
import {
    projectCreateRequestSchema,
    projectIdParamsSchema,
    projectPageRequestSchema,
    projectUpdateRequestSchema,
} from './project.request.dto.js';
import { projectDetailsResponseSchema, projectPageResponseSchema } from './project.response.dto.js';

export const projectRouter = Router();

projectRouter.get('/', projectController.getPage);
projectRouter.post('/', projectController.create);
projectRouter.get('/:projectId', projectController.getById);
projectRouter.put('/:projectId', projectController.update);

const TAGS = ['Projects'];

const validationErrorResponse = { description: 'Invalid request', content: jsonContent(errorResponseSchema) };
const notFoundResponse = { description: 'Project not found', content: jsonContent(errorResponseSchema) };

openApiRegistry.registerPath({
    method: 'get',
    path: '/projects',
    tags: TAGS,
    summary: 'List projects (paginated, newest first)',
    request: { query: projectPageRequestSchema },
    responses: {
        200: { description: 'A page of projects', content: jsonContent(projectPageResponseSchema) },
        400: validationErrorResponse,
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
        404: notFoundResponse,
    },
});
