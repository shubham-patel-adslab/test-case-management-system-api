import { z } from 'zod';

import { newPasswordSchema } from '../user/user.request.dto.js';
import { INVITATION_TOKEN_MAX_LENGTH } from './invitation.constant.js';

const invitationTokenSchema = z.string().min(1).max(INVITATION_TOKEN_MAX_LENGTH);

export const invitationAcceptRequestSchema = z
    .object({
        token: invitationTokenSchema,
        password: newPasswordSchema,
    })
    .meta({ id: 'InvitationAcceptRequest' });

// The token goes in the body (POST), not the URL: it stays out of access logs and Referer headers.
export const invitationVerifyRequestSchema = z
    .object({ token: invitationTokenSchema })
    .meta({ id: 'InvitationVerifyRequest' });

export type InvitationAcceptRequestDto = z.infer<typeof invitationAcceptRequestSchema>;
export type InvitationVerifyRequestDto = z.infer<typeof invitationVerifyRequestSchema>;
