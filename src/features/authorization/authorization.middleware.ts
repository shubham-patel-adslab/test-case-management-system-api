import type { RequestHandler } from 'express';

import { getAuthUser } from '../authentication/authentication.middleware.js';
import type { PermissionCode, ResourceCode } from './authorization.constant.js';
import { authorizationService } from './authorization.service.js';

// Route guard: `authorize(RESOURCE_CODE.USER, PERMISSION_CODE.CREATE)`. Runs after `authenticate`
// (who is calling — 401) and answers "may they do this?" — 403. Deny by default: no grant row, no access.
export function authorize(resourceCode: ResourceCode, permissionCode: PermissionCode): RequestHandler {
    return async (req, _res, next) => {
        await authorizationService.assertPermission(getAuthUser(req).id, resourceCode, permissionCode);
        next();
    };
}
