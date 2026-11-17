import { randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { env } from '../../app/env.js';
import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { ACCESS_TOKEN_ALGORITHM } from './authentication.constant.js';

// The token only proves *who* is calling (`sub` = user id). Role, permissions and account status are read
// from the database on each request, so they take effect immediately instead of when the token expires.
// `jti` (unique per token) is what a server-side sign-out denylist will key on once Redis is added; nothing
// reads it yet.
const accessTokenClaimsSchema = z.object({
    sub: z.uuid(),
});

function invalidToken(message: string, cause?: unknown): AppError {
    return new AppError(401, ERROR_CODE.UNAUTHORIZED, message, { cause });
}

export function signAccessToken(userId: string): string {
    return jwt.sign({}, env.JWT_SECRET, {
        algorithm: ACCESS_TOKEN_ALGORITHM,
        subject: userId,
        jwtid: randomUUID(),
        expiresIn: env.JWT_EXPIRES_IN_SECONDS,
    });
}

// Returns the user id the token was issued to.
export function verifyAccessToken(token: string): string {
    let payload: unknown;

    try {
        // Pinning the algorithm stops a forged token from choosing its own (e.g. "none").
        payload = jwt.verify(token, env.JWT_SECRET, { algorithms: [ACCESS_TOKEN_ALGORITHM] });
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw invalidToken('Access token has expired', error);
        }

        // Covers bad signature, malformed token and not-yet-valid; anything else is a bug and propagates.
        if (error instanceof jwt.JsonWebTokenError) {
            throw invalidToken('Access token is invalid', error);
        }

        throw error;
    }

    // A validly signed token is still shape-checked: an older API version may have issued other claims.
    const claims = accessTokenClaimsSchema.safeParse(payload);

    if (!claims.success) {
        throw invalidToken('Access token is invalid', claims.error);
    }

    return claims.data.sub;
}
