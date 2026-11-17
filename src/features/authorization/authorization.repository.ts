import { pool } from '../../app/database.js';

export type GrantRow = {
    resource_code: string;
    permission_code: string;
};

export type UserRoleRow = {
    role_code: string;
    role_name: string;
};

// user → their one role → that role's (resource, permission) grants. Inactive roles, resources and
// permissions grant nothing, so deactivating a row in a _std table revokes it everywhere at once.
const ACTIVE_GRANTS_OF_USER = `
      FROM user_roles ur
      JOIN roles_std r ON r.id = ur.role_id AND r.is_active
      JOIN role_resource_permissions_map_std m ON m.role_id = r.id
      JOIN resources_std res ON res.id = m.resource_id AND res.is_active
      JOIN permissions_std p ON p.id = m.permission_id AND p.is_active
     WHERE ur.user_id = $1`;

export const authorizationRepository = {
    // One indexed query per authorized request (user_roles.user_id and the map's unique key).
    async hasGrant(userId: string, resourceCode: string, permissionCode: string): Promise<boolean> {
        const result = await pool.query<{ is_granted: boolean }>(
            `SELECT EXISTS (
                 SELECT 1 ${ACTIVE_GRANTS_OF_USER}
                    AND res.resource_code = $2
                    AND p.permission_code = $3
             ) AS is_granted`,
            [userId, resourceCode, permissionCode],
        );

        return result.rows[0]?.is_granted ?? false;
    },

    // The user's one role, active or not (an inactive role simply grants nothing).
    async selectRoleOfUser(userId: string): Promise<UserRoleRow | undefined> {
        const result = await pool.query<UserRoleRow>(
            `SELECT r.role_code, r.role_name
               FROM user_roles ur
               JOIN roles_std r ON r.id = ur.role_id
              WHERE ur.user_id = $1`,
            [userId],
        );

        return result.rows[0];
    },

    async selectGrants(userId: string): Promise<GrantRow[]> {
        const result = await pool.query<GrantRow>(
            `SELECT res.resource_code, p.permission_code
             ${ACTIVE_GRANTS_OF_USER}
             ORDER BY res.resource_code, p.permission_code`,
            [userId],
        );

        return result.rows;
    },

    // Which of the given codes exist (active or not) — for the startup check.
    async selectExistingResourceCodes(codes: string[]): Promise<string[]> {
        const result = await pool.query<{ resource_code: string }>(
            'SELECT resource_code FROM resources_std WHERE resource_code = ANY($1)',
            [codes],
        );

        return result.rows.map((row) => row.resource_code);
    },

    async selectExistingPermissionCodes(codes: string[]): Promise<string[]> {
        const result = await pool.query<{ permission_code: string }>(
            'SELECT permission_code FROM permissions_std WHERE permission_code = ANY($1)',
            [codes],
        );

        return result.rows.map((row) => row.permission_code);
    },
};
