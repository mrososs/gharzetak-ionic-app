# Cutover plan and rollback

> **Nothing below has been executed.** No remote Cloudflare resource was created, nothing was deployed, no Supabase data was touched and
> nothing was merged into `production`. Every remote step needs explicit approval.

## What exists today (read-only, verified through the Cloudflare MCP)

| Item | State |
|---|---|
| Account | the owner's personal Cloudflare account (id/name intentionally not recorded in this public repo); 1 account visible to the connection. Pass its id via `CLOUDFLARE_ACCOUNT_ID` / `wrangler` login, never commit it. |
| Workers / D1 / KV / Pages / Queues / Vectorize / Hyperdrive / zones | none |
| R2 bucket `gharzetak-media` | exists (WEUR, Standard), private (`r2.dev` disabled, no custom domains) - created by the account owner |
| `workers.dev` subdomain | **not registered** (API error 10007) |

## Resources to create (needs approval)

| # | Resource | Command (from `apps/api`) | Notes |
|---|---|---|---|
| 1 | D1 database `gharzetak-db` | `npx wrangler d1 create gharzetak-db` | Paste the printed `database_id` into `wrangler.jsonc` (currently a placeholder). |
| 2 | Apply schema + seed | `npx wrangler d1 migrations apply gharzetak-db --remote` then `npx wrangler d1 execute gharzetak-db --remote --file=./seed/sample-patterns.sql` | Review `drizzle/0000_init.sql` first. Empty database: no user data is transferred. |
| 3 | Secret | `npx wrangler secret put BETTER_AUTH_SECRET` (32+ random bytes) | Never in git. |
| 4 | Worker `gharzetak-api` | `npx wrangler deploy` | Binds `DB` and `MEDIA` (existing bucket). Set `AUTH_BASE_URL` to the final public API URL and `APP_ORIGINS` to the real web origin + Capacitor origins. |
| 5 | `workers.dev` subdomain **or** custom domain | dashboard / DNS | Pick the final API hostname **before** shipping a mobile build; email links and `GZ_API_URL` depend on it. |
| 6 | Mail provider | choose + implement in `services/mailer.ts` | Required for password reset and (optional) email verification. |

### Cost (from the Cloudflare docs, checked 2026-11-16)

| Service | Free | Paid |
|---|---|---|
| Workers | 100,000 req/day, **10 ms CPU per request** | $5/month, 10 M req + 30 M CPU-ms included, then $0.30/M req |
| D1 | 5 M rows read/day, 100 k rows written/day, 5 GB; **queries fail** past the daily limit | 25 B reads + 50 M writes/month included, 5 GB then $0.75/GB-mo |
| R2 | 10 GB-month, 1 M Class A, 10 M Class B per month; no egress fees | $0.015/GB-mo, $4.50/M Class A, $0.36/M Class B |

**Risk to decide on:** password hashing uses PBKDF2 (100,000 iterations). Native WebCrypto time may or may not count against the Free plan's 10 ms CPU
limit; **measure sign-up/sign-in on the deployed Worker** (`wrangler tail`, or the dashboard CPU metric). If it exceeds 10 ms the Free plan would
reject auth requests and the **$5/month Paid plan** is required. Set a Workers spending limit / email alert either way.

## Order of operations

1. Merge the PR **only after review** (this branch is local; it has not been pushed - see below).
2. Create resources 1-3, deploy to a **staging** Worker name (e.g. `gharzetak-api-staging`, its own D1 and a separate R2 bucket) and run `API_URL=<staging> node apps/api/scripts/smoke-local.mjs` after temporarily relaxing its localhost guard, or run the same checks manually.
3. Choose the mail provider; verify reset-password end to end with a real mailbox.
4. Set `GZ_API_URL` (https) and `GZ_AUTH_REDIRECT_URL` in the build environment; build web + `npx cap sync`; test on a real Android device and iOS (Back button, deep links, RTL/LTR, offline).
5. Production deploy; point web and mobile builds at it.
6. Observe for a week (error rate, 401/409 rates, D1 rows read/written, CPU time) before deleting anything.

## Data migration

Evidence says there is **nothing to migrate**: no hosted Supabase project was ever created (per `docs/implementation/progress.md`), the local Supabase stack
is not running here, and the only data lives in developer-device IndexedDB. So: no export/transform/import scripts were written (they would be untestable dead
code), and no private data was uploaded anywhere. If a hosted project turns out to exist, stop and do an inventory first (see `audit.md`).

## Rollback

* **Before production traffic:** delete the staging Worker/D1; `git revert` or abandon the branch. `production` is untouched.
* **After release:** redeploy the previous Worker version (`wrangler rollback`), or ship the previous app build. D1 schema changes are additive; take a
  D1 time-travel bookmark (`wrangler d1 time-travel info gharzetak-db`) before each production migration and restore with `time-travel restore` if needed.
* **App side:** the legacy Supabase backend is archived in `docs/cloudflare-migration/legacy-supabase` and the previous app is `production@b95981f`. Because
  no hosted Supabase data exists, "rolling back" the backend means returning to guest-only/local data; nothing is lost on the device (IndexedDB is only
  extended with an additive `revisions` store, never reset).
* Local offline data is never deleted by the migration.

## Repository state

* Branch `feat/cloudflare-backend-migration` (from `production@b95981f`): local commits only. **Not pushed, no PR opened** - waiting for your go-ahead.
* `production` was never modified; no force-push.
