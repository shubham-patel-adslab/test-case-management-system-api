import { isUniqueViolation, withTransaction, type Queryable } from '../../app/database.js';
import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { toPageResponseDto } from '../../shared/response/page.response.dto.js';
import type { AuthUser } from '../authentication/authentication.middleware.js';
import { invitationService } from '../invitation/invitation.service.js';
import { USER_STATUS, type UserSettableStatus, type UserStatus } from './user.constant.js';
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

// Exactly one role per user, written with the user: a failed role assignment rolls the user back too.
async function insertUserWithRole(
    request: UserCreateRequestDto,
    credentials: { status: UserStatus; passwordHash: string | null },
    createdById: string | null,
    db: Queryable,
): Promise<string> {
    const userId = await userRepository.insert({ ...request, ...credentials }, db);

    if (!userId) {
        throw emailTaken();
    }

    if (!(await userRepository.upsertRole(userId, request.roleCode, createdById, db))) {
        throw unknownRole();
    }

    return userId;
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
        const filter = { search: request.search, statuses: request.status ? [request.status] : undefined };
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

    // An admin creates the user INVITED, without a password; the emailed link lets them set their own.
    // User, role and invitation commit together; the email goes out after the commit.
    async create(request: UserCreateRequestDto, createdById: string): Promise<UserDetailsResponseDto> {
        const { user, token } = await withTransaction(async (client) => {
            const userId = await insertUserWithRole(request, { status: USER_STATUS.INVITED, passwordHash: null }, createdById, client);
            const invitationToken = await invitationService.issue(userId, createdById, client);

            return { user: await getUserDetails(userId, client), token: invitationToken };
        });

        await invitationService.send(user, token);

        return user;
    },

    // An ACTIVE user with a known password — only for the bootstrap admin (src/scripts/create-admin.ts,
    // createdById null) and test setup; there is no API for it.
    async createWithPassword(
        request: UserCreateRequestDto & { password: string },
        createdById: string | null,
    ): Promise<UserDetailsResponseDto> {
        // Hashed before the transaction opens, so a pooled connection isn't held for ~270 ms of CPU work.
        const passwordHash = await hashPassword(request.password);

        return withTransaction(async (client) => {
            const userId = await insertUserWithRole(request, { status: USER_STATUS.ACTIVE, passwordHash }, createdById, client);

            return getUserDetails(userId, client);
        });
    },

    // Only while INVITED; replaces the pending link, so earlier links stop working.
    async resendInvitation(actor: AuthUser, userId: string): Promise<void> {
        const current = await userRepository.selectById(userId);

        if (!current) {
            throw userNotFound();
        }

        if (current.status !== USER_STATUS.INVITED) {
            throw new AppError(409, ERROR_CODE.CONFLICT, 'Only a user who hasn\'t set a password yet can be sent an invitation');
        }

        const token = await withTransaction((client) => invitationService.issue(userId, actor.id, client));

        await invitationService.send({ email: current.email, firstName: current.first_name }, token);
    },

    async update(actor: AuthUser, userId: string, request: UserUpdateRequestDto): Promise<UserDetailsResponseDto> {
        const current = await userRepository.selectById(userId);

        if (!current) {
            throw userNotFound();
        }

        const isRoleChange = request.roleCode !== current.role_code;
        // The pending link went to the old address — it must not stay usable; a new one goes to the new one.
        const isInviteRedirect = request.email !== current.email && current.status === USER_STATUS.INVITED;

        if (isRoleChange && userId === actor.id) {
            throw selfChangeForbidden('role');
        }

        let result: { user: UserDetailsResponseDto; token: string | undefined };

        try {
            result = await withTransaction(async (client) => {
                if (!(await userRepository.updateById(userId, request, client))) {
                    throw userNotFound();
                }

                // Only on a real change, so created_by/created_at keep describing when the role was assigned.
                if (isRoleChange && !(await userRepository.upsertRole(userId, request.roleCode, actor.id, client))) {
                    throw unknownRole();
                }

                const token = isInviteRedirect ? await invitationService.issue(userId, actor.id, client) : undefined;

                return { user: await getUserDetails(userId, client), token };
            });
        } catch (error) {
            if (isUniqueViolation(error, USER_EMAIL_UNIQUE_CONSTRAINT)) {
                throw emailTaken(error);
            }

            throw error;
        }

        if (result.token) {
            await invitationService.send(result.user, result.token);
        }

        return result.user;
    },

    // Deactivating revokes a pending invitation; reactivating a user without a password makes them INVITED
    // again (userRepository.updateStatusById), and an admin re-sends the invitation.
    async updateStatus(actor: AuthUser, userId: string, status: UserSettableStatus): Promise<UserDetailsResponseDto> {
        if (userId === actor.id) {
            throw selfChangeForbidden('status');
        }

        return withTransaction(async (client) => {
            if (!(await userRepository.updateStatusById(userId, status, client))) {
                throw userNotFound();
            }

            if (status === USER_STATUS.INACTIVE) {
                await invitationService.revoke(userId, client);
            }

            return getUserDetails(userId, client);
        });
    },
};
