// Provisions an ACTIVE ADMIN user with a password — the only way to create the first one, since everyone
// else is invited by an admin through the API. Usage:
//   INITIAL_ADMIN_PASSWORD=… in .env (or the deployment's secret store), then
//   npm run admin:create -- --email ana@example.com --first-name Ana --last-name Silva
// The password comes from the environment, never from code or a command-line flag (git history, shell
// history, `ps` output); the server itself never reads it. A CLI's terminal output is its
// interface, hence console use here.
import { parseArgs } from 'node:util';

import { z } from 'zod';

import { pool } from '../app/database.js';
import { AppError } from '../shared/error/app.error.js';
import { ADMIN_ROLE_CODE, USER_NAME_MAX_LENGTH } from '../features/user/user.constant.js';
import { emailSchema, newPasswordSchema } from '../features/user/user.request.dto.js';
import { userService } from '../features/user/user.service.js';

const argsSchema = z.object({
    email: emailSchema,
    'first-name': z.string().trim().min(1).max(USER_NAME_MAX_LENGTH),
    // Optional, like every user's last name.
    'last-name': z.string().trim().max(USER_NAME_MAX_LENGTH).optional().transform((name) => name || null),
});

async function createAdmin(): Promise<void> {
    const { values } = parseArgs({
        options: {
            email: { type: 'string' },
            'first-name': { type: 'string' },
            'last-name': { type: 'string' },
        },
    });

    const args = argsSchema.safeParse(values);

    if (!args.success) {
        throw new Error(`Invalid arguments:\n${z.prettifyError(args.error)}\n`
            + 'Usage: npm run admin:create -- --email <email> --first-name <name> [--last-name <name>]');
    }

    const password = newPasswordSchema.safeParse(process.env['INITIAL_ADMIN_PASSWORD']);

    if (!password.success) {
        throw new Error(`INITIAL_ADMIN_PASSWORD is missing or invalid:\n${z.prettifyError(password.error)}`);
    }

    // createdById null: nobody created the bootstrap admin through the API.
    const admin = await userService.createWithPassword({
        email: args.data.email,
        firstName: args.data['first-name'],
        lastName: args.data['last-name'],
        roleCode: ADMIN_ROLE_CODE,
        password: password.data,
    }, null);

    console.info(`Created ${admin.role.code} ${admin.email} (id ${admin.id}). Sign in with INITIAL_ADMIN_PASSWORD.`);
}

try {
    await createAdmin();
} catch (error) {
    // AppError = expected failure (e.g. email already in use): its message is enough.
    console.error(error instanceof AppError ? `${error.message}.` : error);
    process.exitCode = 1;
} finally {
    await pool.end();
}
