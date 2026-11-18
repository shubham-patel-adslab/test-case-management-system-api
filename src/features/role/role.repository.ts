import { pool } from '../../app/database.js';

// A roles_std row as the roles list needs it.
export type RoleRow = {
    role_code: string;
    role_name: string;
    description: string;
};

export const roleRepository = {
    // Only active roles: an inactive one can't be assigned (user_roles upsert requires is_active). Unbounded
    // on purpose — roles_std is a handful of migration-owned rows. By name, like every list of named things.
    async selectActive(): Promise<RoleRow[]> {
        const result = await pool.query<RoleRow>(
            `SELECT role_code, role_name, description
               FROM roles_std
              WHERE is_active
              ORDER BY lower(role_name), id`,
        );

        return result.rows;
    },
};
