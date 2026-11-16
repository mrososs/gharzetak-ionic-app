# Schema mapping: Supabase (PostgreSQL) -> Cloudflare D1 (SQLite)

Source of truth for the new schema: [`apps/api/src/db/schema.ts`](../../apps/api/src/db/schema.ts) (Drizzle) and the generated
migration [`apps/api/drizzle/0000_init.sql`](../../apps/api/drizzle/0000_init.sql). The original Postgres migrations are archived,
unchanged, in [`legacy-supabase/migrations`](legacy-supabase/migrations).

## Type conversions

| PostgreSQL | D1 / SQLite | Notes |
|---|---|---|
| `uuid` PK/FK | `text` | Client-generated UUIDs are kept verbatim, so IDs are stable across the migration. Sample patterns keep `00000000-0000-4000-8000-0000000000a1/a2`. |
| `auth.users.id` (uuid) | Better Auth `user.id` (text) | **IDs differ**: there is no hosted Supabase user base to map (see [audit](audit.md)). |
| `timestamptz` | `integer` (epoch ms) | Matches the app's `number` timestamps and avoids timezone parsing. |
| `boolean` | `integer` 0/1 (`mode: 'boolean'`) | |
| `text[]` (`profiles.interests`) | `text` JSON (`mode: 'json'`) | |
| `jsonb` (`history`, `pattern_history`) | `text` JSON | App already caps history at 100 entries; API validates `max(100)`. |
| `numeric(6,1)` (`estimated_hours`) | `real` | |
| `check (...)` | `CHECK (...)` | All 1:1 except regex checks (below). 45 CHECK constraints are in the generated SQL. |
| regex checks (`youtube_url ~*`, `email ~*`) | Zod validation in the API | SQLite has no regex operator. |
| `char_length()` | `length()` | |
| `split_part(storage_path, ...)` path check | `media_objects` registry row | Ownership is decided by the registry row, not by parsing the key. |
| `on delete cascade / set null` | same | D1 enforces foreign keys. |

## Tables

| Supabase | D1 | Differences |
|---|---|---|
| `profiles` | `profiles` | + `revision`, `client_updated_at`, `tools_revision`, `tools_client_updated_at`. Created by a Better Auth `user.create.after` hook (replaces trigger `on_auth_user_created`). |
| `user_tools` | `user_tools` | Replace-all set, versioned through `profiles.tools_revision`. |
| `patterns` | `patterns` | + `revision`, `client_updated_at`. Soft delete (`deleted_at`) is now **actually used** (Supabase hard-deleted). `file_*` columns are server-managed by the upload endpoint. |
| `pattern_rounds` | `pattern_rounds` | PK is now an autoincrement integer (was uuid); `(pattern_id, position)` stays unique. |
| `projects` | `projects` | + `revision`, `client_updated_at`; soft delete. `cover_path` is server-managed. |
| `project_parts` | `project_parts` | Schema parity only. The current app never synced parts; **no API route exists** for it. |
| `project_progress` | `project_progress` | + `revision`, `client_updated_at`. `count <= target` and all other CHECKs kept. |
| `project_notes` | `project_notes` | PK = `project_id` (was uuid PK + unique `project_id`). |
| `project_photos` | `project_photos` | Rows are created by the upload endpoint. |
| `work_sessions` | `work_sessions` | Immutable; insert is idempotent by id. |
| `favorites` | `favorites` | unchanged composite PK. |
| `tutorial_bookmarks` | `tutorial_bookmarks` | `(user_id, tutorial_id)` unique; + `revision`. |
| `tutorial_timestamps` | `tutorial_timestamps` | |
| `store_interest` | `store_interest` | |
| (none) | `user, session, account, verification, rate_limit` | Better Auth. |
| `storage.objects` + buckets | `media_objects` + R2 bucket `gharzetak-media` | See [storage-strategy.md](storage-strategy.md). |

## Row Level Security -> API checks

D1 has no RLS. Every `/v1/*` route runs behind `requireUser` and **every query is filtered by the authenticated user id**.

| Supabase policy | Where it is enforced now |
|---|---|
| `*_select/insert/update/delete` where `owner_id = auth.uid()` | `WHERE owner_id = :userId` on every statement (`routes/entities.ts`). |
| `*_parent_check` (child rows must reference a project the user owns) | `assertOwnProject()` before every child write (progress, notes, sessions, photo/cover upload, tutorial project link). |
| `projects_pattern_readable` (may only link readable patterns) | `assertPatternReadable()` (sample **or** own, not deleted). |
| `patterns_select` (samples readable by everyone) | Samples are bundled in the app and never returned by `/v1/sync/pull`; they are not writable through the API. |
| `gz_storage_*` policies (`foldername[1] = auth.uid()`) | `media_objects.user_id = :userId`, identical 404 for "missing" and "someone else's". |

Other users' resources always answer **404** (no existence leak). Verified by `apps/api/tests/sync.test.ts`
("two-user ownership isolation") and `media.test.ts`.

## Triggers

| Supabase | Replacement |
|---|---|
| `gz_lww_guard` (ignore writes with an older client `updated_at`) | **Replaced by stronger server-owned compare-and-swap**: `UPDATE ... WHERE revision = :baseRevision`. See [sync-strategy.md](sync-strategy.md). |
| `gz_touch_updated_at` | `updated_at` is set by the server on every accepted write. |
| `on_auth_user_created` | Better Auth `databaseHooks.user.create.after`. |

## Seed data

`apps/api/seed/sample-patterns.sql` is a SQLite port of `20261116000100_sample_patterns.sql` (same ids, 2 patterns, 17 rounds), idempotent
(`INSERT OR IGNORE`). Applied locally with `npm run api:db:seed:local`. Verified: 2 patterns / 17 rounds in the local D1.
