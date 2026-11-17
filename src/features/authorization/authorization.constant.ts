// Codes the application checks in authorize(...). Each must exist in resources_std / permissions_std —
// verified at startup (authorizationService.assertCodesExist), so a missing migration fails fast instead
// of silently answering 403 on every request.
export const RESOURCE_CODE = {
    USER: 'USER',
    PROJECT: 'PROJECT',
} as const;

export const PERMISSION_CODE = {
    CREATE: 'CREATE',
    READ: 'READ',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
} as const;

export type ResourceCode = (typeof RESOURCE_CODE)[keyof typeof RESOURCE_CODE];
export type PermissionCode = (typeof PERMISSION_CODE)[keyof typeof PERMISSION_CODE];
