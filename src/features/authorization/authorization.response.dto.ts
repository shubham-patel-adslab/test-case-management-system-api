import { z } from 'zod';

import { userRoleResponseSchema } from '../user/user.response.dto.js';

// Resource code → permission codes the role holds, e.g. { "USER": ["CREATE", "READ"] }. A resource with
// no grant is absent. Shaped for the UI's can(resource, permission).
export const authorizationPermissionsResponseSchema = z
    .record(z.string(), z.array(z.string()))
    .meta({ id: 'AuthorizationPermissionsResponse' });

// GET /authorization/me — what the signed-in user may do. Identity is GET /auth/me.
export const authorizationContextResponseSchema = z
    .object({
        role: userRoleResponseSchema,
        permissions: authorizationPermissionsResponseSchema,
    })
    .meta({ id: 'AuthorizationContextResponse' });

export type AuthorizationPermissionsResponseDto = z.infer<typeof authorizationPermissionsResponseSchema>;
export type AuthorizationContextResponseDto = z.infer<typeof authorizationContextResponseSchema>;
