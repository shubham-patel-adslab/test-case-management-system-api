import type { GrantRow, UserRoleRow } from './authorization.repository.js';
import type {
    AuthorizationContextResponseDto,
    AuthorizationPermissionsResponseDto,
} from './authorization.response.dto.js';

// [{ USER, CREATE }, { USER, READ }] → { USER: ["CREATE", "READ"] }
function toAuthorizationPermissionsResponseDto(grants: GrantRow[]): AuthorizationPermissionsResponseDto {
    const permissions: AuthorizationPermissionsResponseDto = {};

    for (const grant of grants) {
        (permissions[grant.resource_code] ??= []).push(grant.permission_code);
    }

    return permissions;
}

export function toAuthorizationContextResponseDto(role: UserRoleRow, grants: GrantRow[]): AuthorizationContextResponseDto {
    return {
        role: { code: role.role_code, name: role.role_name },
        permissions: toAuthorizationPermissionsResponseDto(grants),
    };
}
