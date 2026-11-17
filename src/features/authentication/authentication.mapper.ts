import type { UserRow } from '../user/user.repository.js';
import type { AuthUserResponseDto } from './authentication.response.dto.js';

export function toAuthUserResponseDto(row: UserRow): AuthUserResponseDto {
    return {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        email: row.email,
    };
}
