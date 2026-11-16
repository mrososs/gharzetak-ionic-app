# Supabase setup

> **SUPERSEDED.** The backend moved to Cloudflare Workers + D1 + R2 (see `docs/cloudflare-migration/`). The Supabase
> files are archived under `docs/cloudflare-migration/legacy-supabase/` for reference only until the migration is
> approved; `@supabase/supabase-js` and the `supabase` CLI are no longer dependencies, so the commands below no longer work.

Gharzetak uses its **own** Supabase project. Never point it at another project's database.

## Local (verified)

Requires Docker Desktop. The local stack uses dedicated ports (API 55421, DB 55422, Studio 55423,
Mailpit 55424) so it never collides with other local Supabase projects.

```powershell
npx supabase start            # applies supabase/migrations + seed.sql
npx supabase status -o env    # copy API_URL and PUBLISHABLE_KEY into .env
npm run db:types              # regenerate src/app/core/supabase/database.types.ts
npm run test:rls              # 36 RLS / storage / LWW checks (creates throw-away users locally)
```

`.env` (git-ignored):

```
GZ_SUPABASE_URL=http://127.0.0.1:55421
GZ_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Local auth: email confirmations are **off** (`supabase/config.toml`), minimum password length 8,
redirect URLs allow `http://localhost:4200/**` and `com.gharzetak.app://**`. Emails appear in Mailpit
(http://127.0.0.1:55424).

## Hosted project (not created by this build — needs your Supabase account)

1. Create a new project named **gharzetak** in the Supabase dashboard (choose a region near your users).
2. Link and push the migrations — check the project ref before pushing:
   ```powershell
   npx supabase login
   npx supabase link --project-ref <gharzetak-ref>
   npx supabase db push --dry-run   # review
   npx supabase db push
   ```
3. Auth → URL configuration: Site URL = your web origin; redirect URLs = web origin `/**` and
   `com.gharzetak.app://**`. Turn **on** email confirmations and set minimum password length 8.
4. Put the project URL and **publishable** key in `.env` (or CI secrets). Never the secret/service-role key.
5. Google / Apple: configure the providers in Auth → Providers first, then set `GZ_OAUTH_PROVIDERS=google,apple`.
   Until then the buttons show "not enabled yet".
6. Optional AI: deploy an Edge Function and set `GZ_AI_FUNCTION=<name>`. Keep model keys as function secrets.

## Schema summary

`profiles`, `user_tools`, `patterns` (+ built-in samples), `pattern_rounds`, `projects`, `project_parts`,
`project_progress`, `project_notes`, `project_photos`, `work_sessions`, `favorites`, `tutorial_bookmarks`,
`tutorial_timestamps`, `store_interest`; private buckets `project-photos` (8 MB, jpeg/png/webp) and
`pattern-files` (10 MB, pdf/jpeg/png/webp). See `supabase/migrations/`.

`project_parts` exists in the schema for multi-part projects (e.g. head/body/ears) but has no UI yet —
the approved design has no parts screen.
