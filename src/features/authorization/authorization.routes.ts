import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry } from '../../app/openapi.js';
import { authorizationController } from './authorization.controller.js';
import { authorizationContextResponseSchema } from './authorization.response.dto.js';

// Authentication is applied in api.router.ts. No permission needed: every user may see their own role and
// permissions. Read-only — roles and grants change only by migration.
export const authorizationRouter = Router();

authorizationRouter.get('/me', authorizationController.getContext);

openApiRegistry.registerPath({
    method: 'get',
    path: '/authorization/me',
    tags: ['Authorization'],
    summary: 'Get the signed-in user\'s role and permissions (grouped by resource)',
    description: 'For showing/hiding UI only — the server checks every request itself. Called once per page load, after GET /auth/me.',
    responses: {
        200: { description: 'Role and permissions', content: jsonContent(authorizationContextResponseSchema) },
        401: errorResponse('Missing, invalid or expired access-token cookie, or inactive account'),
    },
});
