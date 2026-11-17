import nodemailer from 'nodemailer';

import { env } from './env.js';

export type EmailMessage = {
    to: string;
    subject: string;
    text: string;
};

// One transport for the process; nodemailer opens an SMTP connection per message.
const transporter = nodemailer.createTransport(env.SMTP_URL);

export async function sendEmail(message: EmailMessage): Promise<void> {
    await transporter.sendMail({ from: env.MAIL_FROM, ...message });
}
