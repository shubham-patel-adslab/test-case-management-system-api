import { Router } from 'express';

import { errorResponse, jsonContent, openApiRegistry } from '../../app/openapi.js';
import { PERMISSION_CODE, RESOURCE_CODE } from '../authorization/authorization.constant.js';
import { authorize } from '../authorization/authorization.middleware.js';
import { roleController } from './role.controller.js';
import { roleListResponseSchema } from './role.response.dto.js';

// Read-only by design: roles are standard data changed only by migrations (no create/update/delete API).
// The list feeds the role picker of the user form, so it needs the same permission as reading users —
// no separate ROLE resource to seed. Authentication is applied in api.router.ts.
export const roleRouter = Router();

roleRouter.get('/', authorize(RESOURCE_CODE.USER, PERMISSION_CODE.READ), roleController.getList);

openApiRegistry.registerPath({
    method: 'get',
    path: '/roles',
    tags: ['Roles'],
    summary: 'List active roles (for assigning a role to a user)',
    description: 'Read-only: roles are managed by database migrations. Requires USER READ.',
    responses: {
        200: { description: 'Active roles, by name', content: jsonContent(roleListResponseSchema) },
        401: errorResponse('Missing, invalid or expired access-token cookie, or inactive account'),
        403: errorResponse('Missing permission USER READ (code FORBIDDEN)'),
    },
});
