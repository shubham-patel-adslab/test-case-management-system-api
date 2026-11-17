import type { Request, Response } from 'express';

import { parseRequest } from '../../shared/request/parse-request.js';
import { clearAccessTokenCookie, setAccessTokenCookie } from './authentication.cookie.js';
import { getAuthUser } from './authentication.middleware.js';
import { authSignInRequestSchema } from './authentication.request.dto.js';
import { authenticationService } from './authentication.service.js';

// HTTP ↔ service mapping only: parse the request, call the service, set cookies and the status code.
export const authenticationController = {
    async signIn(req: Request, res: Response): Promise<void> {
        const request = parseRequest(authSignInRequestSchema, req.body);
        const { accessToken, user } = await authenticationService.signIn(request);

        setAccessTokenCookie(res, accessToken);
        res.json(user);
    },

    // Removes the cookie from the browser, so this browser is signed out. The token itself stays valid until
    // it expires (no server-side denylist without Redis) — but it was never readable by page scripts, so
    // only someone who already extracted it from the browser could still use it.
    signOut(_req: Request, res: Response): void {
        clearAccessTokenCookie(res);
        res.status(204).end();
    },

    async getCurrentUser(req: Request, res: Response): Promise<void> {
        res.json(await authenticationService.getCurrentUser(getAuthUser(req)));
    },
};
