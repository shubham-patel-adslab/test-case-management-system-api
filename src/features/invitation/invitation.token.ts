import { createHash, randomBytes } from 'node:crypto';

import { INVITATION_TOKEN_BYTES } from './invitation.constant.js';

export type InvitationToken = {
    // Goes into the email only — never stored.
    token: string;
    // Stored in user_invitations.token_hash.
    tokenHash: string;
};

export function hashInvitationToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

export function createInvitationToken(): InvitationToken {
    const token = randomBytes(INVITATION_TOKEN_BYTES).toString('base64url');

    return { token, tokenHash: hashInvitationToken(token) };
}
