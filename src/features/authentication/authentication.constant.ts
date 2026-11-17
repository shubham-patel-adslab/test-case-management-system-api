export const ACCESS_TOKEN_ALGORITHM = 'HS256';

// The access token travels only in this httpOnly cookie (decided 2026-11-17), never in a response body or
// an Authorization header.
export const ACCESS_TOKEN_COOKIE_NAME = 'tcms_access_token';

// PRD Backend Req §2: auth endpoints — 5 requests per 15 minutes.
export const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const AUTH_RATE_LIMIT_MAX_REQUESTS = 5;
