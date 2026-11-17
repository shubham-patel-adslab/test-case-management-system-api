export const ACCESS_TOKEN_ALGORITHM = 'HS256';

// The access token travels only in this httpOnly cookie (decided 2026-11-17), never in a response body or
// an Authorization header.
export const ACCESS_TOKEN_COOKIE_NAME = 'tcms_access_token';
