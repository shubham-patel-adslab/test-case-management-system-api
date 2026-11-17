import { randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { USER_STATUS } from '../user/user.constant.js';
import { hashPassword } from '../user/user.password.js';
import { userRepository } from '../user/user.repository.js';
import { toAuthUserResponseDto } from './authentication.mapper.js';
import type { AuthUser } from './authentication.middleware.js';
import type { AuthSignInRequestDto } from './authentication.request.dto.js';
import type { AuthUserResponseDto } from './authentication.response.dto.js';
import { signAccessToken, verifyAccessToken } from './authentication.token.js';

// The controller puts the token into the cookie; it never appears in a response body.
export type AuthSignInResult = {
    accessToken: string;
    user: AuthUserResponseDto;
};

// Compared against when the email is unknown, so a sign-in for a missing user costs the same bcrypt time
// as one with a wrong password — response timing can't reveal which emails exist. Hashed once at startup
// with the real cost, so it stays in step if BCRYPT_COST changes.
const dummyPasswordHash = hashPassword(randomUUID());

function unauthorized(message: string): AppError {
    return new AppError(401, ERROR_CODE.UNAUTHORIZED, message);
}

async function getAuthUserDetails(userId: string): Promise<AuthUserResponseDto> {
    const user = await userRepository.selectById(userId);

    if (!user) {
        throw unauthorized('User no longer exists');
    }

    return toAuthUserResponseDto(user);
}

export const authenticationService = {
    // Token → current user. One indexed read per request makes deactivation apply immediately (a
    // stateless check would honour the token until it expires).
    async authenticate(accessToken: string): Promise<AuthUser> {
        const user = await userRepository.selectAuthStateById(verifyAccessToken(accessToken));

        if (!user) {
            throw unauthorized('User no longer exists');
        }

        if (user.status !== USER_STATUS.ACTIVE) {
            throw unauthorized('Account is inactive');
        }

        return { id: user.id };
    },

    async signIn(request: AuthSignInRequestDto): Promise<AuthSignInResult> {
        const credentials = await userRepository.selectCredentialsByEmail(request.email);
        const isPasswordValid = await bcrypt.compare(
            request.password,
            credentials?.password_hash ?? await dummyPasswordHash,
        );

        // One message for both cases, for the same reason as the dummy hash.
        if (!credentials || !isPasswordValid) {
            throw new AppError(401, ERROR_CODE.INVALID_CREDENTIALS, 'Invalid email or password');
        }

        // Checked only after the password: the account state is revealed only to someone who knows it.
        if (credentials.status !== USER_STATUS.ACTIVE) {
            throw new AppError(403, ERROR_CODE.ACCOUNT_INACTIVE, 'Account is inactive');
        }

        return { accessToken: signAccessToken(credentials.id), user: await getAuthUserDetails(credentials.id) };
    },

    getCurrentUser(authUser: AuthUser): Promise<AuthUserResponseDto> {
        return getAuthUserDetails(authUser.id);
    },
};
