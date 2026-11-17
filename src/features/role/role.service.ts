import { toRoleResponseDto } from './role.mapper.js';
import { roleRepository } from './role.repository.js';
import type { RoleListResponseDto } from './role.response.dto.js';

export const roleService = {
    async getActiveRoles(): Promise<RoleListResponseDto> {
        const rows = await roleRepository.selectActive();

        return rows.map(toRoleResponseDto);
    },
};
