import { z } from 'zod';

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
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
