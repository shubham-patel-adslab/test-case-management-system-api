import type { CookieOptions, Request, Response } from 'express';

import { env } from '../../app/env.js';
import { ACCESS_TOKEN_COOKIE_NAME } from './authentication.constant.js';

const MILLISECONDS_PER_SECOND = 1000;

// httpOnly: page scripts can't read the cookie, so an XSS bug can't steal the token.
// sameSite strict: the browser never attaches it to a request started by another site (CSRF protection —
//   the UI is same-origin through the Vite proxy, so it never needs a cross-site request).
// secure outside development/test: sent over HTTPS only.
// path /api: sent to the API only, not with every static asset.
// clearCookie() must get the same attributes, or the browser keeps the cookie.
const ACCESS_TOKEN_COOKIE_OPTIONS: CookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: '/api',
};

// Same lifetime as the token inside it, so the browser drops the cookie when the token expires.
export function setAccessTokenCookie(res: Response, accessToken: string): void {
    res.cookie(ACCESS_TOKEN_COOKIE_NAME, accessToken, {
        ...ACCESS_TOKEN_COOKIE_OPTIONS,
        maxAge: env.JWT_EXPIRES_IN_SECONDS * MILLISECONDS_PER_SECOND,
    });
}

export function clearAccessTokenCookie(res: Response): void {
    res.clearCookie(ACCESS_TOKEN_COOKIE_NAME, ACCESS_TOKEN_COOKIE_OPTIONS);
}

// Express doesn't parse cookies. Reading one known cookie whose value (a JWT) needs no decoding doesn't
// justify adding cookie-parser.
export function readAccessTokenCookie(req: Request): string | undefined {
    for (const pair of (req.get('Cookie') ?? '').split(';')) {
        const separatorIndex = pair.indexOf('=');

        if (separatorIndex !== -1 && pair.slice(0, separatorIndex).trim() === ACCESS_TOKEN_COOKIE_NAME) {
            return pair.slice(separatorIndex + 1).trim() || undefined;
        }
    }

    return undefined;
}
