import { rateLimit } from 'express-rate-limit';

import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { AUTH_RATE_LIMIT_MAX_REQUESTS, AUTH_RATE_LIMIT_WINDOW_MS } from './authentication.constant.js';

// Applied to sign-in, the password-guessing surface, keyed by client IP (the caller isn't authenticated
// yet). In-memory store: resets on restart, not shared between instances (CLAUDE.md overrides).
export const authRateLimiter = rateLimit({
    windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
    limit: AUTH_RATE_LIMIT_MAX_REQUESTS,
    // RateLimit-Limit / -Remaining / -Reset on every response, plus Retry-After on a 429 — the headers the
    // UI reads to show "try again in N minutes" (ui-requirements §6.4).
    standardHeaders: 'draft-6',
    legacyHeaders: false,
    // Hand the 429 to the central error handler so it gets the standard error envelope.
    handler: (_req, _res, next) => {
        next(new AppError(429, ERROR_CODE.TOO_MANY_REQUESTS, 'Too many attempts, please try again later'));
    },
});
