import { withTransaction, type Queryable } from '../../app/database.js';
import { AppError, ERROR_CODE } from '../../shared/error/app.error.js';
import { hashPassword } from '../user/user.password.js';
import { userRepository } from '../user/user.repository.js';
import { INVITATION_TTL_HOURS } from './invitation.constant.js';
import { sendInvitationEmail, type InvitationRecipient } from './invitation.email.js';
import { invitationRepository } from './invitation.repository.js';
import type { InvitationAcceptRequestDto } from './invitation.request.dto.js';
import { createInvitationToken, hashInvitationToken } from './invitation.token.js';

// One message for every reason (unknown, used, replaced, expired, user deactivated): the link is dead
// either way, and the remedy is the same — ask an admin to send a new one.
function invalidInvitation(): AppError {
    return new AppError(400, ERROR_CODE.INVALID_INVITATION, 'This invitation link is invalid or has expired');
}

export const invitationService = {
    // Called inside the caller's transaction, so the invitation exists only if the user change commits.
    // Returns the plain token for send(), which runs after the commit.
    async issue(userId: string, createdById: string | null, db: Queryable): Promise<string> {
        const { token, tokenHash } = createInvitationToken();

        await invitationRepository.upsert(userId, tokenHash, INVITATION_TTL_HOURS, createdById, db);

        return token;
    },

    // After the commit, never inside the transaction: an SMTP round trip shouldn't hold a database
    // connection, and a slow mail server shouldn't roll back a valid user change. If sending fails the
    // change stays saved and an admin re-sends the invitation.
    async send(recipient: InvitationRecipient, token: string): Promise<void> {
        try {
            await sendInvitationEmail(recipient, token);
        } catch (error) {
            throw new AppError(
                502,
                ERROR_CODE.EMAIL_DELIVERY_FAILED,
                'The change was saved, but the invitation email could not be sent. Resend the invitation.',
                { cause: error },
            );
        }
    },

    // Deactivation: a pending link must stop working.
    revoke(userId: string, db: Queryable): Promise<void> {
        return invitationRepository.deleteByUserId(userId, db);
    },

    async accept(request: InvitationAcceptRequestDto): Promise<void> {
        const tokenHash = hashInvitationToken(request.token);

        // Cheap check first, so a stream of bad tokens doesn't cost a bcrypt hash each.
        if (!(await invitationRepository.existsValid(tokenHash))) {
            throw invalidInvitation();
        }

        // Hashed before the transaction opens, so a pooled connection isn't held for the CPU work.
        const passwordHash = await hashPassword(request.password);

        // Consume + activate together: a used token always means a set password, and the other way round.
        await withTransaction(async (client) => {
            const userId = await invitationRepository.consume(tokenHash, client);

            if (!userId || !(await userRepository.activateWithPassword(userId, passwordHash, client))) {
                throw invalidInvitation();
            }
        });
    },
};
