import { isUniqueViolation, withTransaction, type Queryable } from '../../app/database.js';
import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { toPageResponseDto } from '../../shared/response/page.response.dto.js';
import type { AuthUser } from '../authentication/authentication.middleware.js';
import type { UserStatus } from './user.constant.js';
import { toUserDetailsResponseDto } from './user.mapper.js';
import { hashPassword } from './user.password.js';
import { USER_EMAIL_UNIQUE_CONSTRAINT, userRepository } from './user.repository.js';
import type { UserCreateRequestDto, UserPageRequestDto, UserUpdateRequestDto } from './user.request.dto.js';
import type { UserDetailsResponseDto, UserPageResponseDto } from './user.response.dto.js';

const EMAIL_TAKEN_MESSAGE = 'Email is already in use';
const UNKNOWN_ROLE_MESSAGE = 'Unknown or inactive role';

function userNotFound(): AppError {
    return new AppError(404, ERROR_CODE.NOT_FOUND, 'User not found');
}

function emailTaken(cause?: unknown): AppError {
    return new AppError(409, ERROR_CODE.CONFLICT, EMAIL_TAKEN_MESSAGE, {
        details: [{ field: 'email', message: EMAIL_TAKEN_MESSAGE }],
        cause,
    });
}

function unknownRole(): AppError {
    return new AppError(400, ERROR_CODE.VALIDATION_ERROR, 'Request validation failed', {
        details: [{ field: 'roleCode', message: UNKNOWN_ROLE_MESSAGE }],
    });
}

// Self-protection: nobody changes their own role or status — no self-elevation, and an admin can't lock
// themselves out (which also means at least one admin always remains).
function selfChangeForbidden(what: 'role' | 'status'): AppError {
    return new AppError(403, ERROR_CODE.FORBIDDEN, `You cannot change your own ${what}`);
}

// After a write the row must exist; inside a transaction it must be read through the same client.
async function getUserDetails(userId: string, db?: Queryable): Promise<UserDetailsResponseDto> {
    const row = await userRepository.selectById(userId, db);

    if (!row) {
        throw userNotFound();
    }

    return toUserDetailsResponseDto(row);
}

export const userService = {
    async getPage(request: UserPageRequestDto): Promise<UserPageResponseDto> {
        const filter = { search: request.search, status: request.status };
        const offset = (request.page - 1) * request.pageSize;

        const [rows, totalItems] = await Promise.all([
            userRepository.selectPage(filter, request.pageSize, offset),
            userRepository.count(filter),
        ]);

        return toPageResponseDto(rows.map(toUserDetailsResponseDto), request, totalItems);
    },

    getById(userId: string): Promise<UserDetailsResponseDto> {
        return getUserDetails(userId);
    },

    // User + role in one transaction: a failed role assignment leaves no role-less user behind.
    // `createdById` is null only for the bootstrap admin (src/scripts/create-admin.ts).
    async create(request: UserCreateRequestDto, createdById: string | null): Promise<UserDetailsResponseDto> {
        // Hashed before the transaction opens, so a pooled connection isn't held for ~270 ms of CPU work.
        const passwordHash = await hashPassword(request.password);

        return withTransaction(async (client) => {
            const userId = await userRepository.insert({ ...request, passwordHash }, client);

            if (!userId) {
                throw emailTaken();
            }

            if (!(await userRepository.upsertRole(userId, request.roleCode, createdById, client))) {
                throw unknownRole();
            }

            return getUserDetails(userId, client);
        });
    },

    async update(actor: AuthUser, userId: string, request: UserUpdateRequestDto): Promise<UserDetailsResponseDto> {
        const current = await userRepository.selectById(userId);

        if (!current) {
            throw userNotFound();
        }

        const isRoleChange = request.roleCode !== current.role_code;

        if (isRoleChange && userId === actor.id) {
            throw selfChangeForbidden('role');
        }

        try {
            return await withTransaction(async (client) => {
                if (!(await userRepository.updateById(userId, request, client))) {
                    throw userNotFound();
                }

                // Only on a real change, so created_by/created_at keep describing when the role was assigned.
                if (isRoleChange && !(await userRepository.upsertRole(userId, request.roleCode, actor.id, client))) {
                    throw unknownRole();
                }

                return getUserDetails(userId, client);
            });
        } catch (error) {
            if (isUniqueViolation(error, USER_EMAIL_UNIQUE_CONSTRAINT)) {
                throw emailTaken(error);
            }

            throw error;
        }
    },

    async updateStatus(actor: AuthUser, userId: string, status: UserStatus): Promise<UserDetailsResponseDto> {
        if (userId === actor.id) {
            throw selfChangeForbidden('status');
        }

        if (!(await userRepository.updateStatusById(userId, status))) {
            throw userNotFound();
        }

        return getUserDetails(userId);
    },
};
