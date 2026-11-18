# Test Case Management System — API

The backend for the Test Case Management System (TCMS): a REST API where teams manage projects, test cases,
test suites and test executions, with role-based access. The React UI is a separate repository
(`test-case-management-system-ui`).

**Stack:** Node.js 24 · TypeScript (ESM) · Express 5 · PostgreSQL 17 (raw `pg`, `node-pg-migrate`) · zod
(validation and OpenAPI) · JWT in an httpOnly cookie · `bcryptjs` · `nodemailer` (invitation emails) ·
`multer` + `file-type` (attachments) · Vitest.

## Documentation

| Document | What it covers |
| --- | --- |
| Swagger UI at `/api/docs` (raw spec: `/api/docs.json`) | Every endpoint, request and response schema, status code |
| [document/database-schema.md](document/database-schema.md) | Tables, columns, constraints, indexes, and why |
| [document/user-guide.md](document/user-guide.md) | What each role (admin, test lead, tester, read-only) can do |
| [document/api-requirements.md](document/api-requirements.md) | Backend requirements and every contract decision |
| [document/deployment.md](document/deployment.md) | Putting the API and UI online on free tiers |
| [document/prd.md](document/prd.md) | The original assignment |

## Status

Built: authentication (admin invites users), database-driven RBAC with project membership, projects, test
cases and steps (with bulk operations), test suites (ordered), test executions (assignments, results, step
results, audit trail), suite runs and reports, defects, attachments, the analytics dashboard endpoint, the
PRD's rate limits (switchable with `RATE_LIMIT_ENABLED`), Redis caching with hit/miss metrics (switchable with
`CACHE_ENABLED`), and demo seed data. Every PRD backend requirement is built.

## Local setup

### 1. Prerequisites

- **Node.js 24** (the version is pinned: `.nvmrc`, and `npm install` refuses other majors). With nvm:
  `nvm install && nvm use`.
- **PostgreSQL 17**, installed locally.
- **Docker**, for Mailpit (a local mail server that catches the invitation emails).

### 2. Install dependencies

```bash
npm ci
```

### 3. Create the database

As a Postgres superuser (`sudo -u postgres psql`), create the app's role and database:

```sql
CREATE ROLE tcms_app_user LOGIN PASSWORD '<choose-a-password>';
CREATE DATABASE tcms_app_db_dev OWNER tcms_app_user;
```

Then, connected as the new role, create the schema all tables live in:

```bash
psql -h localhost -U tcms_app_user -d tcms_app_db_dev -c 'CREATE SCHEMA IF NOT EXISTS tcms;'
```

### 4. Start Mailpit

```bash
docker run -d --name tcms-mailpit --restart unless-stopped -p 1025:1025 -p 8025:8025 axllent/mailpit:v1.33.1
```

Invitation emails appear at <http://localhost:8025>; nothing reaches a real inbox.

### 4b. Start Redis

```bash
docker run -d --name tcms-redis --restart unless-stopped -p 6379:6379 redis:8.2-alpine
```

The cache (analytics, test suite lists, project details). To run without it, set `CACHE_ENABLED=false` in step 5;
if Redis stops while the API runs, requests read the database instead (response header `X-Cache: BYPASS`).

### 5. Configure the environment

```bash
cp .env.example .env
```

Edit `.env`. Every variable is explained in `.env.example`; the ones you must set:

- `DATABASE_URL`: put in your password. Special characters must be URL-encoded (`@` → `%40`).
- `JWT_SECRET`: at least 32 random characters. Generate one with
  `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
- `INITIAL_ADMIN_PASSWORD`: the first admin's password (step 7).
- `RATE_LIMIT_ENABLED=false` (as in `.env.example`): the PRD's rate limits are on unless this says `false`, and
  local work quickly runs into them (5 sign-ins per 15 minutes).
- `DEMO_USER_PASSWORD`: only if you load the demo data (step 9).
- `CACHE_ENABLED` and `REDIS_URL` (as in `.env.example`): caching is on unless `CACHE_ENABLED=false`, and then
  `REDIS_URL` is required. The tests run with caching on when it is on here (they need Redis then, like Mailpit).

The server checks the variables at startup. If any is missing or invalid, it lists them and exits; it never
prints the values.

### 6. Run the migrations

```bash
npm run migrate:up
```

This creates every table in the `tcms` schema, and seeds the roles and permissions.

### 7. Create the first admin

```bash
npm run admin:create -- --email admin@example.com --first-name Ada --last-name Admin
```

The password comes from `INITIAL_ADMIN_PASSWORD`. This is the only user created with a password; the admin
invites everyone else from the app, and each person sets their own password from the emailed link.

### 8. Start the API

```bash
npm run dev
```

- API: <http://localhost:3000/api>. Check it with `curl http://localhost:3000/api/health`, which returns
  `{"status":"ok"}`.
- Swagger: <http://localhost:3000/api/docs>. To try protected endpoints, first call
  `POST /api/auth/sign-in`; the browser then sends the auth cookie with every request.

The UI's dev server (port 5173) proxies `/api` to port 3000, so no CORS setup is needed in development.

### 9. Load the demo data (optional)

```bash
npm run seed:demo
```

Creates one active user per role and three sample projects — ShopFront Web, PayWallet Mobile, Partner API —
with 400 test cases in suites and 60 days of execution history (results, step results, defects, weekly
regression runs, a pending backlog), so every page and the dashboard have data. The same data every time,
dated from the day you run it. Run it again with `npm run seed:demo -- --reset` to replace it: that deletes the
demo users and every project they created.

Demo logins — the password is your `DEMO_USER_PASSWORD`:

| Role | Email | Projects |
| --- | --- | --- |
| Admin | `admin@tcms-demo.example` | all |
| Test lead | `lead@tcms-demo.example` | all three |
| Tester | `tester@tcms-demo.example` | ShopFront Web, PayWallet Mobile |
| Tester | `tester2@tcms-demo.example` | ShopFront Web, Partner API |
| Read-only | `readonly@tcms-demo.example` | all three |

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Starts the API with reload on change (`tsx watch`) |
| `npm run build` / `npm start` | Compiles to `dist/` / runs the compiled build |
| `npm run typecheck` | Type-checks `src/` and `test/` |
| `npm test` / `npm run test:watch` | Runs the tests once / on every change |
| `npm run migrate:create <name>` | Creates a new SQL migration in `migrations/` |
| `npm run migrate:up` / `migrate:down` | Applies the pending migrations / rolls back the last one |
| `npm run admin:create -- --email … --first-name … --last-name …` | Creates an active admin |
| `npm run seed:demo` / `seed:demo -- --reset` | Loads the demo data / replaces it |

## Tests

```bash
npm test
```

The tests are integration tests: they start the app and call it over HTTP, against the real database and
Mailpit, so **PostgreSQL and Mailpit must be running**. They use the development database, and only touch
rows they create themselves (users with `@tcms-test.example` emails, projects named `[tcms-test] …`). They
delete those rows afterwards and never truncate a table, so your own data is safe.

## Project structure

```text
migrations/             SQL migrations (the schema and the roles/permissions data)
src/
  server.ts             entry point: checks, listen, graceful shutdown
  app/                  app-wide wiring: Express app, router, env, database, OpenAPI, mailer, file storage
  shared/               code shared across features: errors, request parsing, pagination
  features/<feature>/   one folder per feature: routes → controller → service → repository, mapper, DTOs
  scripts/              command-line scripts (create-admin)
test/                   integration tests, one file per feature
document/               requirements, schema, user guide, deployment
```

Each request flows through the same layers:

1. **Routes**: permission check.
2. **Controller**: validates the request with zod.
3. **Service**: business rules, project-membership scope, transactions.
4. **Repository**: parameterized SQL.
5. **Mapper**: database row → response DTO.

Any error becomes the standard `{ error: { code, message, details? } }` response in one central handler.
