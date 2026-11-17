import {
    PERMISSION_CODE,
    RESOURCE_CODE,
    type PermissionCode,
    type ResourceCode,
} from './authorization.constant.js';
import { toAuthorizationContextResponseDto } from './authorization.mapper.js';
import { authorizationRepository } from './authorization.repository.js';
import type { AuthorizationContextResponseDto } from './authorization.response.dto.js';

function findMissing(expected: string[], existing: string[]): string[] {
    return expected.filter((code) => !existing.includes(code));
}

export const authorizationService = {
    // Resolved from the database on every request, not from the token: a role change or a deactivated
    // role/resource/permission takes effect immediately.
    hasPermission(userId: string, resourceCode: ResourceCode, permissionCode: PermissionCode): Promise<boolean> {
        return authorizationRepository.hasGrant(userId, resourceCode, permissionCode);
    },

    // The caller's role and every active (resource, permission) it holds — for the UI to show or hide
    // controls. UX only: the server checks every request itself.
    async getContext(userId: string): Promise<AuthorizationContextResponseDto> {
        const [role, grants] = await Promise.all([
            authorizationRepository.selectRoleOfUser(userId),
            authorizationRepository.selectGrants(userId),
        ]);

        // Every user gets their role in the same transaction as the account, so this is a broken invariant
        // (a bug or a manual SQL change), not a client error.
        if (!role) {
            throw new Error(`User ${userId} has no role assignment`);
        }

        return toAuthorizationContextResponseDto(role, grants);
    },

    // Called once at startup. Throws when the code checks a resource or permission the database doesn't
    // have (e.g. a migration not applied yet).
    async assertCodesExist(): Promise<void> {
        const resourceCodes: string[] = Object.values(RESOURCE_CODE);
        const permissionCodes: string[] = Object.values(PERMISSION_CODE);

        const [existingResourceCodes, existingPermissionCodes] = await Promise.all([
            authorizationRepository.selectExistingResourceCodes(resourceCodes),
            authorizationRepository.selectExistingPermissionCodes(permissionCodes),
        ]);

        const missing = [
            ...findMissing(resourceCodes, existingResourceCodes).map((code) => `resources_std.${code}`),
            ...findMissing(permissionCodes, existingPermissionCodes).map((code) => `permissions_std.${code}`),
        ];

        if (missing.length > 0) {
            throw new Error(`Authorization codes missing from the database: ${missing.join(', ')}`);
        }
    },
};
