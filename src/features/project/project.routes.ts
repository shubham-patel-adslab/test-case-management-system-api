import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry } from '../../app/openapi.js';
import { authorize } from '../authorization/authorization.middleware.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { projectController } from './project.controller.js';
import {
    projectCreateRequestSchema,
    projectIdParamsSchema,
    projectMemberCandidatePageRequestSchema,
    projectPageRequestSchema,
    projectUpdateRequestSchema,
} from './project.request.dto.js';
import {
    projectDetailsResponseSchema,
    projectMemberCandidatePageResponseSchema,
    projectPageResponseSchema,
} from './project.response.dto.js';

const { PROJECT } = RESOURCE_CODE;
const { CREATE, DELETE, READ, UPDATE } = PERMISSION_CODE;

// Authentication is applied to the whole router in api.router.ts. Each route checks its PROJECT permission
// (every role reads; ADMIN and TEST_LEAD create and update; ADMIN deletes — PRD Features §2). Which
// projects is membership, checked in the service: ALL_PROJECTS grants (ADMIN) reach every project, everyone
// else only the projects they are a member of.
export const projectRouter = Router();

projectRouter.get('/', authorize(PROJECT, READ), projectController.getPage);
projectRouter.post('/', authorize(PROJECT, CREATE), projectController.create);
// Before '/:projectId', which would otherwise match it. Needed by whoever edits teams.
projectRouter.get('/member-candidates', authorize(PROJECT, UPDATE), projectController.getMemberCandidatePage);
projectRouter.get('/:projectId', authorize(PROJECT, READ), projectController.getById);
projectRouter.put('/:projectId', authorize(PROJECT, UPDATE), projectController.update);
projectRouter.delete('/:projectId', authorize(PROJECT, DELETE), projectController.delete);

const TAGS = ['Projects'];

const validationErrorResponse = errorResponse('Invalid request');
const unauthorizedResponse = errorResponse('Missing, invalid or expired access-token cookie, or inactive account');
const forbiddenResponse = (permission: string) =>
    errorResponse(`Missing permission PROJECT ${permission} (code FORBIDDEN)`);
const notFoundResponse = errorResponse('Project not found, or the caller is not a member of it');
const SCOPE_DESCRIPTION =
    'Users with an `ALL_PROJECTS` grant (ADMIN) reach every project; everyone else only the projects they are a member of.';
const MEMBERS_DESCRIPTION =
    '`memberIds` is the whole team (user ids). Unknown users, or inactive users who are not already members, are a 400 on ' +
    '`memberIds[i]`. A caller without `ALL_PROJECTS` is always kept on the team.';

openApiRegistry.registerPath({
    method: 'get',
    path: '/projects',
    tags: TAGS,
    summary: 'List projects with their members (paginated, newest first)',
    description: SCOPE_DESCRIPTION,
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
    summary: 'Create a project with its team',
    description: MEMBERS_DESCRIPTION,
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
    path: '/projects/member-candidates',
    tags: TAGS,
    summary: 'Search users who can be added to a project team (member picker)',
    description: 'Active and invited users, newest first. For the create and edit forms; non-admins can\'t call GET /users.',
    request: { query: projectMemberCandidatePageRequestSchema },
    responses: {
        200: { description: 'A page of users', content: jsonContent(projectMemberCandidatePageResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(UPDATE),
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: '/projects/{projectId}',
    tags: TAGS,
    summary: 'Get a project with its members',
    description: SCOPE_DESCRIPTION,
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
    summary: 'Update a project and its team',
    description: `The body \`id\` must match \`projectId\` in the URL. ${MEMBERS_DESCRIPTION} ${SCOPE_DESCRIPTION}`,
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

openApiRegistry.registerPath({
    method: 'delete',
    path: '/projects/{projectId}',
    tags: TAGS,
    summary: 'Delete a project (and its team); refused while it has test cases or suites',
    description: SCOPE_DESCRIPTION,
    request: { params: projectIdParamsSchema },
    responses: {
        204: { description: 'Deleted' },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(DELETE),
        404: notFoundResponse,
        409: errorResponse('The project still has test cases, test suites or execution history (archive it instead)'),
    },
});
