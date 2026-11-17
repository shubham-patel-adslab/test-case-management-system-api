import type { Request, Response } from 'express';

import { parseRequest } from '../../shared/request/parse-request.js';
import { invitationAcceptRequestSchema } from './invitation.request.dto.js';
import { invitationService } from './invitation.service.js';

// HTTP ↔ service mapping only: parse the request, call the service, choose the status code.
export const invitationController = {
    // 204, no session: the user signs in with the new password afterwards.
    async accept(req: Request, res: Response): Promise<void> {
        await invitationService.accept(parseRequest(invitationAcceptRequestSchema, req.body));

        res.status(204).end();
    },
};
