import { env } from '../../app/env.js';
import { sendEmail } from '../../app/mailer.js';
import { INVITATION_TTL_HOURS, INVITATION_UI_PATH } from './invitation.constant.js';

export type InvitationRecipient = {
    email: string;
    firstName: string;
};

// Plain text: no HTML to escape user-supplied names into, and every mail client makes the link clickable.
export async function sendInvitationEmail(recipient: InvitationRecipient, token: string): Promise<void> {
    const link = new URL(INVITATION_UI_PATH, env.UI_BASE_URL);
    link.hash = new URLSearchParams({ token }).toString();

    await sendEmail({
        to: recipient.email,
        subject: 'Set your TCMS password',
        text: [
            `Hi ${recipient.firstName},`,
            '',
            'An account has been created for you in the Test Case Management System.',
            'Set your password to sign in:',
            '',
            link.toString(),
            '',
            `The link works once and expires in ${INVITATION_TTL_HOURS} hours. If it has expired, ask an admin to send a new one.`,
        ].join('\n'),
    });
}
