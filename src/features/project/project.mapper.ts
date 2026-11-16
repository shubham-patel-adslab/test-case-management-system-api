import type { ProjectRow } from './project.repository.js';
import type { ProjectDetailsResponseDto } from './project.response.dto.js';

// The only place a projects row becomes an API response: snake_case → camelCase, Date → ISO string.
export function toProjectDetailsResponseDto(row: ProjectRow): ProjectDetailsResponseDto {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        version: row.version,
        status: row.status,
        members: [], // filled in by the project members feature
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}
