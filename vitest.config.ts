import { defineConfig } from 'vitest/config';

// The same .env as the app, through Node's built-in loader (no dotenv). Loaded here, before Vitest starts
// its workers, so every test file inherits it; variables already set win, like `node --env-file`.
process.loadEnvFile('.env');

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        environment: 'node',
        // Every file uses the shared dev database and Mailpit: one file at a time, so one file's cleanup
        // (e.g. deleting test emails) can't race another file's assertions.
        fileParallelism: false,
    },
});
