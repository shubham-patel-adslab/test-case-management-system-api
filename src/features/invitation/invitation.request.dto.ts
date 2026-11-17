import { z } from 'zod';

import { newPasswordSchema } from '../user/user.request.dto.js';
import { INVITATION_TOKEN_MAX_LENGTH } from './invitation.constant.js';

export const invitationAcceptRequestSchema = z
    .object({
        token: z.string().min(1).max(INVITATION_TOKEN_MAX_LENGTH),
        password: newPasswordSchema,
    })
    .meta({ id: 'InvitationAcceptRequest' });

export type InvitationAcceptRequestDto = z.infer<typeof invitationAcceptRequestSchema>;
