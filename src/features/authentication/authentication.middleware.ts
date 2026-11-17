import type { Request, RequestHandler } from 'express';

import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { readAccessTokenCookie } from './authentication.cookie.js';
import { authenticationService } from './authentication.service.js';

// Who is calling: an active user, as proven by the access token and confirmed by the database. What they
// may do is decided per route by authorize(...) (features/authorization).
export type AuthUser = {
    id: string;
};

// Adds `authUser` to Express's Request type (declaration merging — the only way to extend it).
declare global {
    namespace Express {
        interface Request {
            // Set by `authenticate`; read it through getAuthUser().
            authUser?: AuthUser;
        }
    }
}

// Reads the token from the httpOnly cookie only (no Authorization header): one way in, and the browser
// manages it. 401 for a missing/invalid/expired token, a deleted user or an inactive account.
export const authenticate: RequestHandler = async (req, _res, next) => {
    const token = readAccessTokenCookie(req);

    if (!token) {
        throw new AppError(401, ERROR_CODE.UNAUTHORIZED, 'Authentication required');
    }

    req.authUser = await authenticationService.authenticate(token);
    next();
};

// For handlers behind `authenticate`. A missing user here means the route was mounted without it — a bug,
// so it's a plain Error (500), not a 401.
export function getAuthUser(req: Request): AuthUser {
    if (!req.authUser) {
        throw new Error(`No authenticated user on ${req.method} ${req.originalUrl}: route is missing authenticate`);
    }

    return req.authUser;
}
