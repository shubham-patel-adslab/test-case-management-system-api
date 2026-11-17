import type { RoleRow } from './role.repository.js';
import type { RoleResponseDto } from './role.response.dto.js';

export function toRoleResponseDto(row: RoleRow): RoleResponseDto {
    return {
        code: row.role_code,
        name: row.role_name,
        description: row.description,
    };
}
