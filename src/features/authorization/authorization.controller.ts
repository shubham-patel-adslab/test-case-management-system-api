import type { Request, Response } from 'express';

import { getAuthUser } from '../authentication/authentication.middleware.js';
import { authorizationService } from './authorization.service.js';

// HTTP ↔ service mapping only.
export const authorizationController = {
    async getContext(req: Request, res: Response): Promise<void> {
        res.json(await authorizationService.getContext(getAuthUser(req).id));
    },
};
