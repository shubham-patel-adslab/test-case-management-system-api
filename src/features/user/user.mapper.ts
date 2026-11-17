import type { UserRow } from './user.repository.js';
import type { UserDetailsResponseDto } from './user.response.dto.js';

// The only place a user row becomes an API response. Fields are picked one by one, never spread.
export function toUserDetailsResponseDto(row: UserRow): UserDetailsResponseDto {
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
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}
