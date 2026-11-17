import type { ProjectMemberUserRow, ProjectRow } from './project.repository.js';
import type { ProjectDetailsResponseDto, ProjectMemberResponseDto } from './project.response.dto.js';

// The only place a member (or member candidate) becomes an API response. Fields are picked one by one.
export function toProjectMemberResponseDto(row: ProjectMemberUserRow): ProjectMemberResponseDto {
    return {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
        status: row.status,
        role: {
            code: row.role_code,
            name: row.role_name,
        },
    };
}

// The only place a projects row becomes an API response: snake_case → camelCase, Date → ISO string.
export function toProjectDetailsResponseDto(row: ProjectRow, members: ProjectMemberUserRow[]): ProjectDetailsResponseDto {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        version: row.version,
        status: row.status,
        members: members.map(toProjectMemberResponseDto),
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}
