import type { RequestHandler } from 'express';
import { rateLimit, type Options } from 'express-rate-limit';

import { getAuthUser } from '../features/authentication/authentication.middleware.js';
import { AppError, ERROR_CODE } from '../shared/error/app.error.js';
import { env } from './env.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

// The PRD's limits (Backend Req §2). Which routes each one covers is wired in api.router.ts (api-requirements §7).
export const RATE_LIMIT = {
    AUTH: { windowMs: 15 * MINUTE_MS, limit: 5 },
    TEST_CASE: { windowMs: HOUR_MS, limit: 100 },
    TEST_EXECUTION: { windowMs: HOUR_MS, limit: 200 },
    ANALYTICS: { windowMs: HOUR_MS, limit: 50 },
} as const;

type RateLimitPolicy = (typeof RATE_LIMIT)[keyof typeof RATE_LIMIT];

const passThrough: RequestHandler = (_req, _res, next) => {
    next();
};

// Per user, not per IP: colleagues behind one office NAT don't share a budget. Needs `authenticate` before it.
const byUser: Options['keyGenerator'] = (req) => getAuthUser(req).id;

// RATE_LIMIT_ENABLED=false (development, tests) turns every limit into a no-op. Counters live in this process's
// memory: right for one API instance; several instances would need a shared store (Redis) to share a budget.
function createRateLimit(policy: RateLimitPolicy, keyGenerator?: Options['keyGenerator']): RequestHandler {
    if (!env.RATE_LIMIT_ENABLED) {
        return passThrough;
    }

    return rateLimit({
        ...policy,
        // Without a keyGenerator: the client IP (IPv6 grouped by /56), which needs TRUST_PROXY_HOPS behind a proxy.
        ...(keyGenerator && { keyGenerator }),
        // RateLimit-Limit/-Remaining/-Reset and RateLimit-Policy on every limited response; Retry-After on the 429.
        standardHeaders: 'draft-6',
        legacyHeaders: false,
        // The 429 goes through the error handler like every other error, so it has the standard envelope.
        handler: (_req, _res, next) => {
            next(new AppError(429, ERROR_CODE.TOO_MANY_REQUESTS, 'Too many requests, try again later'));
        },
    });
}

// Sign-in and accepting an invitation: one budget per IP (the caller isn't signed in). Every attempt counts.
export const authRateLimit = createRateLimit(RATE_LIMIT.AUTH);
export const testCaseRateLimit = createRateLimit(RATE_LIMIT.TEST_CASE, byUser);
export const testExecutionRateLimit = createRateLimit(RATE_LIMIT.TEST_EXECUTION, byUser);
export const analyticsRateLimit = createRateLimit(RATE_LIMIT.ANALYTICS, byUser);
