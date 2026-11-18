# Deployment (free tier)

How to put the full stack (this API + the tcms-ui repo) online for $0. Decided 2026-11-17; updated 2026-11-18
for Redis caching, rate limiting and the demo seed.

| Piece | Host | Free-tier limits that matter |
| --- | --- | --- |
| UI (React, static) | Vercel | none that matter here |
| API (Express) | Render web service | sleeps after 15 min idle (~1 min to wake) · disk wiped on restart/deploy/sleep · SMTP ports 25/465/587 blocked |
| PostgreSQL | Neon | 1 GB storage, 100 compute-hours/month, never expires |
| Redis (cache) | Upstash | 256 MB, 500K commands/month, data survives restarts |
| Email | Brevo SMTP | 300 emails/day |

**Why the UI proxies `/api` instead of calling Render directly:** the auth cookie is `SameSite=Strict`, so
the browser only sends it to the site the page came from. Vercel forwards `/api/*` to Render, so the
browser sees one origin — exactly what the Vite proxy does in development. No CORS needed.

**Who does what:** **[You]** = the user (accounts, secrets, commits, migrations). **[Claude]** = file
changes Claude can make in the repos when asked. Never paste secrets into a chat or commit them.

**Region:** pick **one region for Neon, Upstash and Render** — e.g. Singapore (Neon: AWS Asia Pacific
Singapore · Upstash: `ap-southeast-1` · Render: Singapore) for users in Asia, Ohio/Virginia for the US,
Frankfurt for Europe. Every API request talks to the database and the cache; a cross-region hop adds latency
to all of them. Neon asks for the region when you create the **project** (not on the organization screen),
and it can't be changed later — delete and recreate the project instead.

---

## Step 0 — Prerequisites [You]

1. Commit and push both repos to `main` on GitHub (Render and Vercel deploy from GitHub):
   - API: `shubham-patel-adslab/test-case-management-system-api`
   - UI: `shubham-patel-adslab/test-case-management-system-ui` (`.env.production` is already committed)
2. Create accounts (sign in with GitHub where offered): [neon.com](https://neon.com),
   [upstash.com](https://upstash.com), [brevo.com](https://www.brevo.com), [render.com](https://render.com),
   [vercel.com](https://vercel.com).
3. Decide the two public names now — they become URLs, and each service needs the other's:
   - Render service name, e.g. `tcms-api` → `https://tcms-api.onrender.com` (Render appends a suffix if
     the name is taken — use whatever URL it shows you)
   - Vercel project name, e.g. `tcms-ui` → `https://tcms-ui.vercel.app`

## Step 1 — Redis on Upstash [You]

Caching is on by default, and the API refuses to start without `REDIS_URL`, so this comes first.

1. Upstash → **Create database** (Redis): region per the note above, free plan, **Eviction off** (every key
   the API writes carries a TTL — cache entries ≤ 1 hour, version tokens 24 hours; eviction could later drop a
   sign-out denylist entry and revive a revoked token).
2. Copy the TLS URL `rediss://default:<password>@<host>.upstash.io:6379` (double `s` = TLS).
3. Check (optional, if `redis-cli` is installed): `redis-cli -u '<upstash-url>' ping` → `PONG`.

## Step 2 — Database on Neon [You]

1. Neon console → **New project**: Postgres version **17**, region per the note above.
2. **Roles** → create role `tcms_app_user`. Copy its password (shown once).
3. **Databases** → create database `tcms_app_db`, owner `tcms_app_user`.
4. **Connect** → database `tcms_app_db`, role `tcms_app_user`, **Connection pooling OFF** (direct
   connection — the pool sets `search_path` at connect time, which the pooled endpoint may not accept).
   Copy the URL; it looks like
   `postgresql://tcms_app_user:<password>@ep-xxx.<region>.aws.neon.tech/tcms_app_db?sslmode=require`.
5. Create the schema (the migrate script expects it to exist):

   ```bash
   psql '<neon-direct-url>' -c 'CREATE SCHEMA IF NOT EXISTS tcms;'
   ```

6. Run the migrations from this repo. The scripts load your local `.env`; a variable set in front of the
   command wins over it:

   ```bash
   DATABASE_URL='<neon-direct-url>' npm run migrate:up
   ```

7. Create the production admin — **a new password, not your local one**:

   ```bash
   DATABASE_URL='<neon-direct-url>' INITIAL_ADMIN_PASSWORD='<new-strong-password>' \
     npm run admin:create -- --email <admin-email> --first-name <first> --last-name <last>
   ```

8. Check: `psql '<neon-direct-url>' -c 'SELECT email, status FROM tcms.users;'` → your admin, `ACTIVE`.
9. Load the demo data (PRD Live Demo: a login per role, sample projects) — **a new password, shown to whoever
   should try the demo, never your admin's**. `REDIS_URL` points the seed at the production cache, so the
   projects it changes are invalidated there (with your local `.env`'s URL it would clear your local Redis
   instead, and a `--reset` would leave stale entries online for up to an hour):

   ```bash
   DATABASE_URL='<neon-direct-url>' REDIS_URL='<upstash-url>' DEMO_USER_PASSWORD='<demo-password>' \
     npm run seed:demo
   ```

   To restore it after people have used the demo: the same command with `-- --reset` (deletes the
   `@tcms-demo.example` users and every project they created, then seeds again, dated from that day).

## Step 3 — Email on Brevo [You]

1. Brevo → **Senders, domains & dedicated IPs → Senders** → add the address emails come from (e.g. your
   Gmail) and click the verification link Brevo sends it.
2. **SMTP & API → SMTP** → **Generate a new SMTP key**. Note the SMTP **login** shown on that page (looks
   like `xxxx@smtp-brevo.com`) and the key.
3. Build `SMTP_URL` — **port 2525** (Render free blocks 587/465), and URL-encode `@` in the login as `%40`:

   ```text
   smtp://xxxx%40smtp-brevo.com:<smtp-key>@smtp-relay.brevo.com:2525
   ```

   If the key contains `/`, `+`, `=` or `@`, URL-encode those too (`%2F`, `%2B`, `%3D`, `%40`).
4. `MAIL_FROM="TCMS <the-verified-address>"` — must be the address verified in 1.

## Step 4 — API on Render [You]

1. Render → **New → Web Service** → connect GitHub → pick `test-case-management-system-api`.
2. Settings:

   | Field | Value |
   | --- | --- |
   | Name | the name from Step 0 |
   | Region | same as Neon and Upstash |
   | Branch | `main` |
   | Runtime | Node (version comes from `.nvmrc` / `engines`: 24) |
   | Build command | `npm ci --include=dev && npm run build` |
   | Start command | `npm start` |
   | Instance type | Free |

   `--include=dev` is required: with `NODE_ENV=production`, npm skips devDependencies and `tsc` (the build)
   would be missing.
3. **Environment variables** — every variable of `.env.example`:

   | Key | On Render |
   | --- | --- |
   | `NODE_ENV` | `production` (makes the cookie `Secure`) |
   | `PORT` | **don't set** — Render sets it |
   | `DATABASE_URL` | the Neon direct URL from Step 2 |
   | `JWT_SECRET` | a **new** secret, never the local one: `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"` |
   | `JWT_EXPIRES_IN_SECONDS` | `3600` |
   | `SMTP_URL` | from Step 3 |
   | `MAIL_FROM` | from Step 3 |
   | `UI_BASE_URL` | `https://<vercel-project>.vercel.app` (Step 0 name; no trailing slash) |
   | `UPLOAD_DIR` | `uploads` |
   | `RATE_LIMIT_ENABLED` | **don't set** — unset = the PRD's rate limits are on |
   | `TRUST_PROXY_HOPS` | `2` — Vercel's rewrite and Render's load balancer; checked in Step 7.7 |
   | `CACHE_ENABLED` | **don't set** — unset = caching on, which requires `REDIS_URL` |
   | `REDIS_URL` | the Upstash URL from Step 1 |
   | `INITIAL_ADMIN_PASSWORD` | **don't set** — only `admin:create` reads it, on your machine (Step 2.7) |
   | `DEMO_USER_PASSWORD` | **don't set** — only `seed:demo` reads it, on your machine (Step 2.9) |

4. **Advanced → Health Check Path:** `/api/health`.
5. Create the service. The deploy log should show:

   ```text
   TCMS API listening on port … (production)
     Rate limiting: on
     Caching: on (Redis connected)
   ```

6. Check: open `https://<render-url>/api/health` → `{"status":"ok"}`, and `https://<render-url>/api/docs`.
7. Give Claude the Render URL for Step 5.

## Step 5 — UI deploy file [Claude]

`vercel.json` in the UI repo — forwards `/api/*` to the Render URL, and sends every other path to
`index.html` so deep links like `/projects/5` work on refresh:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://<render-url>/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

(`.env.production` with `VITE_TCMS_API_URL=/api` is already committed.) Then **[You]** review, commit and push
the UI repo.

## Step 6 — UI on Vercel [You]

1. Vercel → **Add New → Project** → import `test-case-management-system-ui`.
2. Project name = the name from Step 0. Framework preset **Vite**; build `npm run build`; output `dist`. No
   environment variables to set.
3. **Settings → General → Node.js Version:** `24.x` (same as the UI's `.nvmrc`).
4. Deploy. If the final URL differs from what you put in Render's `UI_BASE_URL`, update it there (Render
   redeploys by itself) — invitation links are built from it.

## Step 7 — Smoke test [You]

Open `https://<vercel-project>.vercel.app`:

1. Sign in as the admin → dashboard loads. DevTools → Application → Cookies: `tcms_access_token` on the
   **vercel.app** domain, `HttpOnly`, `Secure`, `SameSite=Strict`, path `/api`.
2. Reload on a deep link (e.g. a project page) → the page loads, no 404.
3. **Cache:** open the dashboard twice → DevTools → Network → the analytics request's `X-Cache` header is
   `MISS`, then `HIT` (`BYPASS` = Redis not reachable). `GET /api/metrics/cache` as the admin shows the hit.
4. Invite a user with a real inbox → email arrives → link opens `/set-password` → set the password → sign
   in as that user. Sign in as a demo user.
5. Create a project, a test case, run an execution.
6. **Upload test:** attach a file of **~6 MB** to a recorded execution. It is unconfirmed whether Vercel's
   4.5 MB request-body limit applies to rewrites to an external origin. If this fails with a Vercel `413`
   (not the API's `PAYLOAD_TOO_LARGE` envelope), tell Claude — the alternatives are hosting the UI as a
   Render Static Site with the same rewrite, or a lower upload limit.
7. **Rate limit + `TRUST_PROXY_HOPS` — do this last** (it blocks sign-in from your IP for 15 minutes):
   - **A client must not be able to pick its own IP.** Six wrong sign-ins, each claiming a different IP:

     ```bash
     for i in 1 2 3 4 5 6; do
       curl -s -o /dev/null -w '%{http_code}\n' -X POST 'https://<vercel-project>.vercel.app/api/auth/sign-in' \
         -H 'Content-Type: application/json' -H "X-Forwarded-For: 203.0.113.$i" \
         -d '{"email":"nobody@example.com","password":"wrong-password"}'
     done
     ```

     Expected: `401` five times, then `429`. Six `401`s → the hop count is **too high** (the API believes the
     header the client sent): lower `TRUST_PROXY_HOPS` by 1 and repeat.
   - **Different clients must not share one budget.** Right after that, sign in from your phone **on mobile
     data** (a different IP) → it works. A `429` there → the hop count is **too low** (every client looks like
     the proxy): raise `TRUST_PROXY_HOPS` by 1 and repeat both checks.
8. Sign out → you land on sign-in; a reload stays signed out.

---

## Known limits of this setup

- **First request after 15 min idle takes ~1 min** (Render waking up). Open the site a minute before a
  demo. Don't keep it awake with a 24/7 pinger: `/api/health` queries Postgres, so it would also keep
  Neon awake and use up its 100 compute-hours.
- **Rate-limit counters and cache metrics live in the API's memory** — they reset whenever Render sleeps or
  redeploys. The cached data itself (Upstash) survives.
- **All sign-ins from one IP share the 5-per-15-min budget** — switching between the four demo roles from one
  laptop runs into it. Plan the demo order, or use a second network.
- **Attachments are lost** on every restart, deploy or sleep (Render free disk is ephemeral). Their
  database rows stay, so downloads then fail. Fix when needed: an S3-compatible object store (Cloudflare R2
  or Backblaze B2, 10 GB free) behind `src/app/file-storage.ts`, plus the download path in the attachment
  service and controller (it serves a local file with `res.sendFile` today).
- **Deploys:** pushing to `main` redeploys both. **Migrations are not automatic** — run Step 2.6 against
  Neon before pushing code that needs a new migration.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Render build: `tsc: not found` | build command missing `--include=dev` |
| Render log: `Invalid environment configuration` | a variable is missing or malformed — the log names which (never the value); `REDIS_URL` is required while `CACHE_ENABLED` is unset |
| Every API call after sign-in → `401` | UI calls Render directly instead of `/api` (check `.env.production`), or `NODE_ENV` isn't `production` while on HTTPS — cookie attributes |
| `/api/health` → `503` | `DATABASE_URL` wrong, or the pooled Neon URL instead of the direct one |
| `X-Cache: BYPASS` on every request | `REDIS_URL` wrong, or `redis://` instead of `rediss://` (Upstash requires TLS) |
| Sign-in → `429` for everyone | `TRUST_PROXY_HOPS` too low — Step 7.7 |
| Invitation → `502 EMAIL_DELIVERY_FAILED` | `SMTP_URL` port not 2525, `@` in the login not encoded, or `MAIL_FROM` not a verified sender |
| Invitation link opens localhost | `UI_BASE_URL` on Render still the dev value |
| Deep link → Vercel 404 | the `/(.*)` → `/index.html` rewrite missing from `vercel.json` |
