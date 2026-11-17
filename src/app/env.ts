import { z } from 'zod';

// HS256 needs a key at least as long as its 256-bit output to keep its full strength.
const JWT_SECRET_MIN_LENGTH = 32;
const ONE_HOUR_IN_SECONDS = 3600;

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    JWT_SECRET: z.string().min(JWT_SECRET_MIN_LENGTH),
    JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(ONE_HOUR_IN_SECONDS),
    // Any SMTP server: Mailpit in development, a transactional email provider in production.
    SMTP_URL: z.url({ protocol: /^smtps?$/ }),
    MAIL_FROM: z.string().trim().min(1),
    // Where the UI runs; invitation links point to its /set-password page.
    UI_BASE_URL: z.url({ protocol: /^https?$/ }),
});

export type Env = z.infer<typeof envSchema>;

const parsedEnv = envSchema.safeParse(process.env);

// Fail fast at startup with every problem listed. prettifyError reports names and rules, never the
// values, so a malformed DATABASE_URL doesn't print its password.
if (!parsedEnv.success) {
    console.error(`Invalid environment configuration:\n${z.prettifyError(parsedEnv.error)}`);
    process.exit(1);
}

export const env: Env = parsedEnv.data;
