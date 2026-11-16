# Final report - Supabase -> Cloudflare migration

Branch: `feat/cloudflare-backend-migration` (local, from `production@b95981f`). **Not pushed, no PR, nothing deployed.**

## Verdict

The backend migration is **implemented and verified locally**: Angular 22 + Ionic 9 + Tailwind 4 + Capacitor 8 now talk to a **Cloudflare Worker (Hono) + D1
(Drizzle) + private R2 + Better Auth** API. The app builds, the 38 domain tests pass unchanged, and the Worker (42 tests), a Wrangler HTTP smoke test (20) and
11 integration tests that run the **real Angular sync services** against the live local Worker all pass.
It is **not production-ready** until the items under "Remaining blockers" are done. No remote resource exists yet.

## Definition of done

| Criterion | Status |
|---|---|
| Angular/Ionic app still builds | yes |
| All original screens remain | yes (no route/style/translation changed; minimal edits in `reset-password.page.ts` (token check + post-reset navigation), `add-pattern.page.ts` (upload order) and `photo.component.ts` (one method call); comment rewording elsewhere) |
| Tracker domain tests pass | yes, 38/38, assertions untouched |
| Worker API works | yes (local) |
| D1 stores/retrieves project data | yes (local D1) |
| Real authentication | yes (Better Auth, bearer sessions); email delivery **not wired** |
| R2 private uploads | yes (local R2 via Wrangler); real bucket verified private, **not written to** |
| User ownership enforced | yes, tested with two users |
| Offline sync works | yes (jsdom + live Worker); not on a device |
| Guest import works | yes |
| Existing data migrated or confirmed absent | **absence is inferred, not proven** (Supabase MCP unavailable, no hosted project per docs) |
| No production code depends on Supabase | yes (deps removed, bundle clean) |
| No secrets exposed | yes (scan of tracked files; `.dev.vars`/`.env` ignored) |
| Migration + rollback docs | yes (this folder) |
| Branch ready for review | yes, locally |

## What changed

* `apps/api/` - Worker: 14-table D1 schema + Better Auth tables, owner-scoped sync endpoints with revision compare-and-swap, R2 media endpoints, Vitest suite.
* Angular: `core/api/` (typed client), `core/auth/` (Better Auth bearer sessions, offline restore), `core/sync/sync.service.ts` (transport), `core/storage/local-db.ts`
  (additive DB v2), environment/set-env, `reset-password` + `add-pattern` pages (minimal), `photo.component` (one call).
* Supabase runtime removed; `supabase/` archived to `docs/cloudflare-migration/legacy-supabase/`.
* `e2e/` - integration tests of the real sync services.

## Behaviour differences you should know about

1. **Password reset signs the user out everywhere** and lands on the login page (Supabase auto-signed in).
2. **Sign-up/duplicate-email responses** are Better Auth's (a duplicate email is reported as "email taken"; enumeration-safe only when email verification is on).
3. **Deletes are soft** server side (tombstones), as the original schema intended; Supabase hard-deleted.
4. **Conflict handling is stricter**: server revisions instead of trusting client clocks (clock skew is clamped, never authoritative).
5. **Pattern file upload now happens after the pattern is created** (the server must own the pattern first).
6. **Google/Apple remain disabled** (not "ready": no provider credentials and no native token hand-off).
7. Pre-existing bug fixed: in-flight pull could drop a freshly created project and lose its sync (see `sync-strategy.md`).

## Remaining blockers / decisions (nothing here was done without you)

1. **Approve remote resources**: D1 database, secret, Worker deploy, subdomain/domain, plan (Free vs $5 Paid - see CPU risk) - `cutover-plan.md`.
2. **Mail provider** for reset/verification (`services/mailer.ts` currently throws in production by design).
3. **Device testing**: Android Back, deep links, WebView CORS/bearer behaviour, iOS, RTL/LTR smoke, real offline kill/restart.
4. **Secure token storage** (Keychain/Keystore plugin) before public launch.
5. **Confirm there is no hosted Supabase project** (connect the Supabase MCP or confirm in the dashboard). If one exists, do the inventory before cutover.
6. Legacy local scopes (`user:<supabase-uuid>`) on dev devices are unreachable; an explicit "claim" action is a possible follow-up.
7. Push the branch and open the PR (needs your go-ahead).
8. Optional hardening later: account deletion endpoint (store-review requirement), PBKDF2 -> stronger KDF if the platform allows, `project_parts` API if the feature is built.

## Security notes

Exact-origin CORS without credentials; no cookies; DB-backed rate limiting; owner-scoped queries with uniform 404s; magic-byte file validation and streaming size
limits; private bucket with no public route; server-managed media paths; no secrets in git; 4 npm audit "moderate" advisories exist in the **dev-only** `drizzle-kit`
toolchain (not shipped in the Worker).

## Repro

```powershell
npm run api:install; copy apps\api\.dev.vars.example apps\api\.dev.vars   # set BETTER_AUTH_SECRET
npm run api:db:migrate:local; npm run api:db:seed:local
npm run api:dev            # terminal 1
npm run api:smoke          # terminal 2
npm run e2e:sync; npm run api:test; npm test; npm run build   # use Node >= 24.15
```
