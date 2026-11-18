import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry, tooManyRequestsResponse } from '../../app/openapi.js';
import { RATE_LIMIT } from '../../app/rate-limit.js';
import { ACCESS_TOKEN_COOKIE_NAME } from './authentication.constant.js';
import { authenticationController } from './authentication.controller.js';
import { authenticate } from './authentication.middleware.js';
import { authSignInRequestSchema } from './authentication.request.dto.js';
import { authUserResponseSchema } from './authentication.response.dto.js';

// Mounted before the global `authenticate` in api.router.ts. sign-in and sign-out are public (sign-out
// must clear the cookie even when the token inside has expired); /me authenticates per route.
export const authenticationRouter = Router();

authenticationRouter.post('/sign-in', authenticationController.signIn);
authenticationRouter.post('/sign-out', authenticationController.signOut);
authenticationRouter.get('/me', authenticate, authenticationController.getCurrentUser);

const TAGS = ['Authentication'];
const authRateLimitedResponse = tooManyRequestsResponse(RATE_LIMIT.AUTH, 'IP', 'sign-in and invitation-accept');

openApiRegistry.registerPath({
    method: 'post',
    path: '/auth/sign-in',
    tags: TAGS,
    summary: 'Sign in',
    description: `Sets the access token in the httpOnly cookie \`${ACCESS_TOKEN_COOKIE_NAME}\` (not readable by page scripts) and returns the user. Then call GET /authorization/me for role and permissions.`,
    security: [],
    request: { body: { content: jsonContent(authSignInRequestSchema) } },
    responses: {
        200: { description: 'Signed-in user; the token is in the Set-Cookie header', content: jsonContent(authUserResponseSchema) },
        400: errorResponse('Invalid request'),
        401: errorResponse('Invalid email or password (code INVALID_CREDENTIALS)'),
        403: errorResponse('Correct password but the account is deactivated (code ACCOUNT_INACTIVE)'),
        429: authRateLimitedResponse,
    },
});

openApiRegistry.registerPath({
    method: 'post',
    path: '/auth/sign-out',
    tags: TAGS,
    summary: 'Sign out',
    description: 'Clears the access-token cookie. No server-side revocation yet: the token stays valid until it expires.',
    security: [],
    responses: {
        204: { description: 'Signed out; the cookie is cleared' },
    },
});

openApiRegistry.registerPath({
    method: 'get',
    path: '/auth/me',
    tags: TAGS,
    summary: 'Get the signed-in user (identity only)',
    responses: {
        200: { description: 'The signed-in user', content: jsonContent(authUserResponseSchema) },
        401: errorResponse('Missing, invalid or expired access-token cookie, or inactive account'),
    },
});
