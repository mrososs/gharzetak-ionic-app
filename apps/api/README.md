# Gharzetak API (Cloudflare Worker)

Hono + D1 (Drizzle) + R2 + Better Auth. Design docs: [`docs/cloudflare-migration`](../../docs/cloudflare-migration).

```powershell
cd apps\api
npm install
Copy-Item .dev.vars.example .dev.vars    # then put a random BETTER_AUTH_SECRET in it (git-ignored)
npm run db:migrate:local                 # applies drizzle/*.sql to Wrangler's LOCAL D1
npm run db:seed:local                    # built-in sample patterns
npm run dev                              # http://localhost:8787 (local D1 + local R2, nothing remote)
```

From the repo root: `npm run api:dev`, `api:test`, `api:typecheck`, `api:smoke` (HTTP smoke test against a running `api:dev`), `e2e:sync` (real Angular sync services against it).

* `wrangler dev` uses **simulated** D1/R2 persisted in `.wrangler/state`; it never touches the real account unless you pass `--remote`.
* `wrangler.jsonc` ships a placeholder D1 `database_id`; real creation/deploy is approval-gated (see `cutover-plan.md`).
* Schema changes: edit `src/db/schema.ts`, run `npm run db:generate`, review the SQL, commit.

## Routes

`GET /health` · `/api/auth/*` (Better Auth) · everything under `/v1` needs `Authorization: Bearer <token>`:
`/v1/sync/pull`, `/v1/profile`, `/v1/tools`, `/v1/patterns/:id`, `/v1/projects/:id` (+ `/progress`, `/notes`), `/v1/sessions/:id`,
`/v1/favorites/:itemId`, `/v1/tutorials/:tutorialId`, `/v1/interest`, `/v1/media/*`.

Errors are `{ "error": { "code", "message", "details?" } }`; a `409 conflict` adds `current: { revision, clientUpdatedAt, deleted? }`.
