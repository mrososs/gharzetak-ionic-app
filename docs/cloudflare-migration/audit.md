# Migration audit and baseline

Date: 2026-11-16. Repository `mrososs/gharzetak-ionic-app`, default branch `production`.

## Repository state

| Check | Result |
|---|---|
| Remote `production` HEAD | `b95981f49c0abcb3f1b145fd4fab3318c1c5c6e2` (matches the handoff) |
| Local clone | `D:\mostqel\Gharzetak`, working tree clean, `feat/gharzetak-app` == `production` |
| Migration branch | `feat/cloudflare-backend-migration` cut from `b95981f` (never committed to `production`, no force-push) |
| Secrets in repo | none tracked; `.env`, `.dev.vars`, `.wrangler/` are git-ignored; tracked files scanned for keys |

## Baseline of the ORIGINAL commit (isolated worktree, `npm ci`, Node v24.22.3)

| Step | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm test` (`ng test`) | **38/38 pass** (tracker engine 23, pattern parser/terminology 15) |
| `npm run build` | pass |
| `npm run test:rls` (Supabase RLS suite, "36 checks") | **not run**: needs the local Supabase stack, and Docker is not running on this machine |

The system `node` is v24.11.0; Angular 22 requires >= 24.15, so `ng test/build` exit with code 3 there. The README's portable Node
(`D:\mostqel\.tools\node24`, v24.22.3) was used instead - nothing was installed or downloaded.

## What actually exists in Supabase?

Evidence only:

* The **Supabase MCP is not connected** in this session, so a hosted project cannot be queried or ruled out through tooling.
* `docs/implementation/progress.md` and `supabase-setup.md` state the hosted project **was never created**.
* `.env` points at the *local* stack on `127.0.0.1:55421`; it is unreachable (`curl` -> no response; Docker daemon not running).
* Therefore: no hosted schema, auth accounts, storage objects, Edge Functions or RPCs were inspected. The local schema was read from the repository
  migrations (14 tables, 2 private buckets, 4 triggers, RLS everywhere, no RPCs, no Edge Function in the repo).
* **Decision:** no data-migration scripts were written. If you know a hosted Supabase project exists, tell me its ref and give me the Supabase connector so the
  inventory can be done before cutover.

## Cloudflare account (read-only, via the Cloudflare MCP)

See `cutover-plan.md`. Summary: empty account (no Workers/D1/KV/Pages), R2 bucket `gharzetak-media` present and private.

## Supabase touchpoints found (repo-wide search, 28 occurrences in 13 files) and their disposition

| File | Disposition |
|---|---|
| `core/supabase/supabase.client.ts`, `database.types.ts` | deleted |
| `core/auth/auth.service.ts` | rewritten on `ApiClient` + `SessionStore` (same public surface) |
| `core/sync/sync.service.ts` | transport rewritten; outbox/order/retry kept |
| `core/ai/assistant.service.ts` | uses `ApiClient` (demo mode unchanged) |
| `environments/environment.ts`, `scripts/set-env.mjs`, `.env.example` | `apiUrl` instead of Supabase URL/key |
| `app.config.ts` | `provideHttpClient(withFetch())` |
| `features/auth/reset-password.page.ts` | token-based reset; navigates to login afterwards |
| `features/patterns/add-pattern.page.ts` | creates the pattern first, then uploads its file (server checks ownership) |
| `shared/ui/images/photo.component.ts` | `mediaUrl()` instead of `signedUrl()` |
| comments in `app.store.ts`, `strings.ts`, `auth.page.ts`, `forgot-password.page.ts` | reworded |
| `supabase/**`, `docs/implementation/supabase-setup.md` | archived / marked superseded |

No `supabase` string remains in the production web bundle (checked with grep over `www/`).

## Database-dependent user flows (inventory)

Sign up / sign in / sign out / session restore / password reset / guest mode -> profile + tools (onboarding, settings) -> projects CRUD -> tracker (simple counter and
pattern cursor, undo history) -> notes -> cover + progress photos -> work-session timer -> patterns (text/PDF/image, reader position, delete) -> tutorial
bookmarks + timestamps + favourites -> store-interest email -> guest-to-account import -> "erase local data".

## Local persistence inventory (IndexedDB `gharzetak`)

| Store | Content |
|---|---|
| `projects`, `patterns` | per-scope records (`guest` or `user:<id>`) |
| `docs` | per-scope profile, favourites, tutorials, chat, store email, last sync, current project |
| `outbox` | one coalesced entry per entity (`project, progress, note, pattern, profile, tools, favorite, tutorial, photo, cover, session, interest`) |
| `revisions` (**new, DB v2**) | last server revision per entity for compare-and-swap |

Active/unprocessed outbox entries on a real device were **not** inspected (no device or browser profile available to this session).

## Tools used / unavailable

Used: GitHub (`gh`, git), Cloudflare MCP (account, R2, docs), Wrangler (local D1/R2), Vitest, Angular CLI. Unavailable: Supabase MCP (not connected), a device/emulator,
Docker (not running), a browser session with the app on a phone viewport (not used for this migration).
