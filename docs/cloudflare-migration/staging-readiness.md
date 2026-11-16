# Staging readiness (`development` -> Cloudflare staging)

> **Status: PREPARED, NOT DEPLOYED.** Nothing in this file has been executed remotely. No D1 database, Worker, secret, subdomain or paid plan was created.
> Everything below needs your explicit approval first.

## Verified now (read-only, through the Cloudflare MCP)

| Item | State |
|---|---|
| Connection / identity | working |
| Workers, D1 | none exist (staging resources are free to create without clashing) |
| R2 `gharzetak-media` | exists, private (`r2.dev` off, no custom domains) |
| `workers.dev` subdomain | **not registered** (API error 10007) |
| Permissions a deploy needs | `D1 Write`, `Workers Scripts Write` (for secrets and the subdomain too). **Whether this connection's grant includes them is unknown until a write is attempted**; the `wrangler login` flow on your machine is the alternative |

## What is prepared in the repo

* `apps/api/wrangler.jsonc` -> `env.staging`: Worker `gharzetak-api-staging`, D1 `gharzetak-db-staging`, R2 binding to the **existing** `gharzetak-media`,
  `MEDIA_PREFIX=staging/`, `ENVIRONMENT=staging`. `wrangler deploy --env staging --dry-run` bundles it (475 KiB gzipped) and lists the right bindings.
* Placeholders that must be replaced first: `REPLACE_STAGING_D1_DATABASE_ID`, `REPLACE_WORKERS_SUBDOMAIN` (and the staging web origin in `APP_ORIGINS`).
  The Worker returns `500 misconfigured` until they are gone, so a half-configured deploy cannot serve traffic.
* Migrations (`drizzle/0000_init.sql`) and seed (`seed/sample-patterns.sql`) are applied with the same commands used locally, plus `--remote --env staging`.
* Safety guards: development config refuses to run on a public host; staging has rate limiting on; no production user data is involved (staging starts empty).

## Approval checklist (what I will do once you say go, in this order)

1. **Plan:** confirm **Workers Paid ($5/month)** - required, see `security-review.md` section 1 (PBKDF2 ~12 ms CPU vs Free's 10 ms). Set a spending limit / alert.
2. **Register the `workers.dev` subdomain** (account-wide, visible in every Worker URL; a custom domain is the alternative).
3. `npx wrangler d1 create gharzetak-db-staging --env staging` -> put the printed id into `wrangler.jsonc`.
4. `npx wrangler d1 migrations apply gharzetak-db-staging --env staging --remote` and the seed file. (Take a time-travel bookmark first on later runs.)
5. `npx wrangler secret put BETTER_AUTH_SECRET --env staging` (32+ random bytes; you paste it or I generate it into the prompt, never into git or chat).
6. Fill `AUTH_BASE_URL` / `APP_ORIGINS`, then `npx wrangler deploy --env staging`.
7. Verification against staging (smoke script with its localhost guard relaxed for the staging URL, plus a manual run): health, sign-up/in, session restore, project +
   progress, photo upload/download/delete **under `staging/`**, 409 conflict, rate limit (429), CORS from the real origin, `wrangler tail` CPU per sign-in.
8. Point a staging web build / debug APK at it (`GZ_API_URL=https://...`) and test on a device.

Estimated cost: $5/month Workers Paid; D1 and R2 usage is far inside the free allowances at staging volumes (D1 5 M reads / 100 k writes per day on Free; R2 10 GB,
1 M Class A, 10 M Class B per month; no egress fees). Checked against the Cloudflare docs on 2026-11-16.

## Readiness verdict

| Area | Ready? |
|---|---|
| Code + tests (local) | yes: 46 + 50 + 20 + 12 automated checks green, browser flows verified |
| Config / placeholders | prepared, validated by dry-run |
| Plan decision (Paid) | **needs you** |
| `workers.dev` subdomain / API hostname | **needs you** |
| Secrets | generated at deploy time, **needs you** present or approving |
| Mail provider | not needed to deploy staging (links go to `wrangler tail`), needed before real users |
| Device tests (Android Back, deep links, secure storage, RTL/LTR on hardware) | **not done** |
| Android native compile with the new secure-storage plugin | **not verified** here (`npm run android:build` locally) |

## Rollback

Delete the staging Worker and D1 (`wrangler delete --env staging`, `wrangler d1 delete gharzetak-db-staging`) and remove the `staging/` prefix objects. Production and
`production` branch are untouched; the shared bucket's other prefixes are never written by staging.
