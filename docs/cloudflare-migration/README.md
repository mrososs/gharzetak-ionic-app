# Cloudflare migration docs

Architecture: **Ionic Angular -> typed HTTP client -> Hono Worker -> D1 (Drizzle) / private R2**, Better Auth for accounts.
Angular never touches D1 or R2 directly.

| Doc | Content |
|---|---|
| [final-report.md](final-report.md) | outcome, behaviour changes, blockers, decisions needed |
| [audit.md](audit.md) | baseline, Supabase state evidence, touchpoint inventory |
| [schema-mapping.md](schema-mapping.md) | Postgres -> D1 mapping, RLS -> API checks |
| [auth-strategy.md](auth-strategy.md) | Better Auth, bearer sessions, Capacitor, reset links |
| [storage-strategy.md](storage-strategy.md) | private R2, validation, access control |
| [sync-strategy.md](sync-strategy.md) | outbox, revisions, conflict rules, fixed race |
| [test-results.md](test-results.md) | what ran, what did not |
| [cutover-plan.md](cutover-plan.md) | approval-gated resources, cost, rollback |
| [legacy-supabase/](legacy-supabase) | archived Supabase config, migrations, seed, RLS test |
