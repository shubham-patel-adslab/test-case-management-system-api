import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry } from '../../app/openapi.js';
import { authorize } from '../authorization/authorization.middleware.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { userController } from './user.controller.js';
import {
    userCreateRequestSchema,
    userIdParamsSchema,
    userPageRequestSchema,
    userStatusUpdateRequestSchema,
    userUpdateRequestSchema,
} from './user.request.dto.js';
import { userDetailsResponseSchema, userPageResponseSchema } from './user.response.dto.js';

const { USER } = RESOURCE_CODE;
const { CREATE, READ, UPDATE } = PERMISSION_CODE;

// Authentication is applied to the whole router in api.router.ts; each
// route checks its USER permission (only ADMIN holds them, per role_resource_permissions_map_std).
// There is no DELETE route: users are deactivated, which keeps every reference to them intact.
export const userRouter = Router();

userRouter.get('/', authorize(USER, READ), userController.getPage);
userRouter.post('/', authorize(USER, CREATE), userController.create);
userRouter.get('/:userId', authorize(USER, READ), userController.getById);
userRouter.put('/:userId', authorize(USER, UPDATE), userController.update);
userRouter.patch('/:userId/status', authorize(USER, UPDATE), userController.updateStatus);

const TAGS = ['Users'];

const validationErrorResponse = errorResponse('Invalid request');
const unauthorizedResponse = errorResponse('Missing, invalid or expired access-token cookie, or inactive account');
const forbiddenResponse = (permission: string) =>
    errorResponse(`Missing permission USER ${permission} (code FORBIDDEN)`);
const notFoundResponse = errorResponse('User not found');
const conflictResponse = errorResponse('Email is already in use');

openApiRegistry.registerPath({
    method: 'get',
    path: '/users',
    tags: TAGS,
    summary: 'List users (paginated, newest first)',
    request: { query: userPageRequestSchema },
    responses: {
        200: { description: 'A page of users', content: jsonContent(userPageResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(READ),
    },
});

openApiRegistry.registerPath({
    method: 'post',
    path: '/users',
    tags: TAGS,
    summary: 'Create a user with one role and a password',
    description: 'User and role are created in one transaction. The password is never returned.',
    request: { body: { content: jsonContent(userCreateRequestSchema) } },
    responses: {
        201: { description: 'Created user', content: jsonContent(userDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(CREATE),
        409: conflictResponse,
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: '/users/{userId}',
    tags: TAGS,
    summary: 'Get a user',
    request: { params: userIdParamsSchema },
    responses: {
        200: { description: 'The user', content: jsonContent(userDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(READ),
        404: notFoundResponse,
    },
});

openApiRegistry.registerPath({
    method: 'put',
    path: '/users/{userId}',
    tags: TAGS,
    summary: 'Update a user\'s name, email and role',
    description: 'The body `id` must match `userId` in the URL. Changing your own role is forbidden.',
    request: {
        params: userIdParamsSchema,
        body: { content: jsonContent(userUpdateRequestSchema) },
    },
    responses: {
        200: { description: 'Updated user', content: jsonContent(userDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(UPDATE),
        404: notFoundResponse,
        409: conflictResponse,
    },
});

openApiRegistry.registerPath({
    method: 'patch',
    path: '/users/{userId}/status',
    tags: TAGS,
    summary: 'Activate or deactivate a user',
    description: 'A deactivated user is rejected on their next request and can\'t log in. Changing your own status is forbidden.',
    request: {
        params: userIdParamsSchema,
        body: { content: jsonContent(userStatusUpdateRequestSchema) },
    },
    responses: {
        200: { description: 'Updated user', content: jsonContent(userDetailsResponseSchema) },
        400: validationErrorResponse,
        401: unauthorizedResponse,
        403: forbiddenResponse(UPDATE),
        404: notFoundResponse,
    },
});
