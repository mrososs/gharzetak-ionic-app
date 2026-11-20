# Account deletion — dependency inventory and coverage matrix

Verified against the code on branch `feat/account-deletion-play-readiness` (base `1e12b03`, the integrated Cloudflare line).
Every row names the mechanism and the test that proves it (`apps/api/tests/account-deletion.test.ts` = API, `src/app/**/*.spec.ts` = app).
Versions audited: Better Auth **1.7.25** (`bearer()` plugin, no cookies), drizzle-orm 0.45.4, Hono 4.13.18, D1 (SQLite), R2.

## 1. Server — D1 tables

D1 enforces foreign keys. Deleting the `user` row cascades to everything below it in one operation.

| Data category | Table(s) | Link to the account | Removed by | Proven by |
|---|---|---|---|---|
| Auth user (e-mail, name, flags) | `user` | the row itself | Better Auth `deleteUser` | "deletes every record" |
| Sessions (all devices) | `session` | FK `user_id` CASCADE + explicit `deleteUserSessions` | cascade | "revokes access at once" (401 on sync/media/AI/get-session) |
| Credentials + Google link | `account` | FK CASCADE | cascade | counts → 0 |
| Profile (name, level, terms, interests, avatar) | `profiles` | FK CASCADE | cascade | counts → 0 |
| Tools (hooks, yarns, accessories) | `user_tools` | FK CASCADE | cascade | counts → 0 |
| Projects (+ soft-deleted/tombstoned) | `projects` | FK `owner_id` CASCADE | cascade | counts → 0; "tombstoned rows… removed" |
| Project parts / progress / notes / photos / work sessions | `project_parts`, `project_progress`, `project_notes`, `project_photos`, `work_sessions` | FK CASCADE (project **and** owner) | cascade | counts → 0 |
| Patterns incl. original text / source text | `patterns` (+ `pattern_rounds` via pattern) | FK `owner_id` CASCADE | cascade | counts → 0 (rounds counted via join) |
| Collections + parts | `pattern_collections`, `pattern_parts` | FK CASCADE | cascade | counts → 0 |
| Pattern / collection revisions (history) | `pattern_revisions` | FK `owner_id` CASCADE | cascade | counts → 0 |
| Favorites, tutorial bookmarks + timestamps | `favorites`, `tutorial_bookmarks`, `tutorial_timestamps` | FK CASCADE | cascade | counts → 0 |
| Store-interest e-mail | `store_interest` | FK CASCADE | cascade | counts → 0 |
| Upload registry (R2 key, mime, size) | `media_objects` | FK CASCADE | cascade | counts → 0 |
| AI consent record | `ai_user_state` | FK CASCADE | cascade | counts → 0 |
| Sync tombstones + revision counters | `deleted_at` / `revision` columns of the rows above | same rows | cascade | "tombstoned rows…" |
| **AI per-user usage counters** | `ai_usage_daily` (scope = user id) | **no FK** | `purgeAiCounters` (never touches the shared `'__all__'` row) | "never touches B… or the shared AI budget" |
| **AI per-user burst windows** | `ai_rate` | **no FK** | `purgeAiCounters` | counts → 0 |
| **Verification tokens** (e-mail / reset / delete) | `verification` | **no FK** (identifier = e-mail or token, value = user id) | `purgeVerification` in `beforeDelete` | counts → 0; B's tokens untouched |
| Pending sync operations | **client-side** `outbox` (IndexedDB) — nothing server-side | — | local wipe (§3) | `account-deletion.spec.ts` |

## 2. Server — R2 (not covered by D1 transactions or foreign keys)

| Object | Key layout | Removed by | Proven by |
|---|---|---|---|
| Project photos | `<userId>/<projectId>/<photoId>.<ext>` | `sweepUserObjects` (prefix `<userId>/`) | `r2Keys(user) == []` |
| Project covers | `<userId>/<projectId>/cover-<uuid>.<ext>` | same | same |
| Pattern files (PDF / images) | `<userId>/<patternId>/source.<ext>` | same | same |
| Objects with **no registry row** (upload raced a failure) | any key under `<userId>/` | same (the listing is authoritative, not the registry) | straggler test |
| Environments sharing one bucket | `MEDIA_PREFIX` (`staging/`) is applied by the `withPrefix` wrapper for both `list` and `delete` | same code path | prefix tests (`prefix-a` / `prefix-ax`) |

Sweep properties: lists `<userId>/` (limit 1000/page), deletes in batches ≤ 1000 (R2 limit), repeats until a page is empty, throws on **any** failure
(a partial sweep can never be mistaken for a complete one), refuses ids that are not `[A-Za-z0-9_-]{8,64}`, matches `<id>/` exactly
(a user whose id merely starts with another id keeps their files). Tested with 1005 objects.

## 3. Client (device) data of the deleted account

Erased only **after** the server confirmed (see 02). Scope `user:<id>` — `LocalDb.clearScope` removes projects, patterns, collections, pattern revisions,
the **outbox (pending sync operations)**, the revisions map, the Crochet Joy ledger and the scope docs (profile, favorites, tutorials, chat, prefs, timer, conflicts).
Also removed: the stored session + biometric-protected copy (`AuthService.expire`), the per-account `gz.bio.declined.<id>` flag.

| Not erased, on purpose | Why |
|---|---|
| Guest scope (`guest`) | A different data owner; never read, merged or deleted by this flow (test: `clearScope` is never called with `guest`) |
| Language / UI preference (`gz.lang`) | Device preference, not account data |
| Other devices signed in to the account | Unreachable from the server. They get 401 on the next request and sign out; the local copy stays until the person uses "Erase data on this device". The delete screen says so. |

## 4. What cannot be deleted immediately (and why) — see 02 §6 for the operational detail

| Item | Held by | Why not removable | Ends |
|---|---|---|---|
| D1 Time Travel history | Cloudflare (always on) | whole-database point-in-time recovery only; the docs describe no per-row purge | ages out: 30 days (Workers Paid) / 7 days (Free) per Cloudflare docs, dated 2026-11-06. **Which plan applies to this account is a fact the owner must confirm.** |
| Workers request logs | Cloudflare (`observability.enabled = true`) | platform logging | 3 days (Free) / 7 days (Paid) per docs; the docs table is internally inconsistent (7-day "maximum" in the limits table) → 7 days is disclosed as the maximum |
| Shared AI daily totals (`'__all__'` row) | this database | aggregate account-wide budget; not attributable to a person | retained (no personal data) |
| R2 residue after a failed sweep | this bucket | R2 outage / error | retried hourly by the cron until a clean sweep (02 §4) |
