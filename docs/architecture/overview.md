# Architecture overview

```
Angular 22 (standalone, signals, zoneless) ── Ionic 9 (standalone components, IonicRouteStrategy)
        │                                    └─ Tailwind v4 (layout utilities, @layer base preflight)
        ├─ core/domain     pure TypeScript: pattern parser, US↔UK converter, tracker engine (unit tested)
        ├─ core/state      AppStore — local-first signals state, ordered IndexedDB writes, outbox enqueue
        ├─ core/storage    LocalDb (idb): projects · patterns · docs · outbox, per data scope
        ├─ core/sync       SyncService (outbox flush + pull/merge, LWW) · GuestImportService
        ├─ core/auth       AuthService (Supabase Auth + guest mode) · guards
        ├─ core/ai         AssistantService (demo rules ⇄ Edge Function boundary)
        ├─ layout          Ionic tabs shell (one stack per tab)
        ├─ shared/ui       icon, photo slot, ring, stepper, sheet, toasts, brand mark
        └─ features/*      lazy-loaded pages, one per approved screen
Capacitor 8 (Android + iOS projects) ── App, Keyboard, StatusBar, Network, SplashScreen, Preferences
Supabase ── Auth · Postgres (RLS on every user table) · Storage (private buckets) · Edge Functions (future AI)
```

## Data scopes

Every piece of local data belongs to a **scope**: `guest` or `user:<uuid>`.
Switching account switches scope, so a guest's projects never leak into an account (or vice versa).
After sign-in the app *offers* to import guest data (`GuestImportService`): nothing is copied without the
user's consent, existing cloud projects are never overwritten (identical → skipped; same id but different
content → imported as a new copy), and the guest scope is cleared only after everything was written and queued.

## Persistence & offline sync

1. A user action (e.g. one tracker tap) produces a new immutable state through the pure engine.
2. `AppStore` updates the signal (UI is instant), then **awaits** an IndexedDB write. Writes are chained so a
   later step can never be overwritten by an earlier one. A confirmed step survives reloads, crashes and
   app backgrounding.
3. For signed-in users the change is coalesced into the **outbox** (one entry per entity + kind).
4. `SyncService` flushes the outbox in dependency order (profile → tools → patterns → projects → cover →
   progress → notes → photos → sessions → favourites → tutorials → interest). Every row carries the client
   `updated_at`; the DB trigger `gz_lww_guard` ignores writes older than the stored row, so a stale device
   can never roll progress back.
5. On sign-in, app resume, reconnect and pull-to-refresh it **pulls** and merges last-write-wins, except
   entities with a pending local change (kept and pushed). Network failures keep entries queued and retry
   with exponential backoff (5 s → 5 min).

Tracker progress is its own table (`project_progress`) so counting never conflicts with edits to the
project's name/status, and undo history is stored with it (last 100 steps server-side, 300 locally).

## Tracker correctness

`core/domain/tracker-engine.ts` is pure and deterministic — no AI is involved in stitch arithmetic.
Simple mode never exceeds the target (target 32, +5 → … 30, 32). Pattern mode tracks *actions*,
*input stitches consumed*, *output stitches produced* and *repeat groups* separately
(`R5: (3sc, inc) × 6 [30]` → 24 actions, 24 consumed, 30 produced, 6 groups) and counts per action,
per group or per round. A 120 ms tap guard swallows accidental double-fires.

## Security

* Frontend only ever holds the **publishable** key; `scripts/set-env.mjs` refuses `sb_secret_…` and
  service-role JWTs.
* RLS: owner predicates on SELECT/INSERT/UPDATE (USING + WITH CHECK)/DELETE; restrictive policies make child
  rows (progress, notes, photos, parts, sessions, timestamps) require a parent owned by the same user; projects
  can only link readable patterns; samples are read-only.
* Storage: private buckets, size & MIME limits, objects must live under `<uid>/<id>/`.
* 36 automated RLS/storage/LWW checks: `npm run test:rls`.

## AI & video boundaries

* Assistant: demo rules by default, labelled "Demo" on every reply. Setting `GZ_AI_FUNCTION` routes questions
  through a Supabase Edge Function with a minimal project context (no credentials, no direct DB access).
  Image analysis is not connected and the UI says so.
* YouTube: topic search links, user-supplied YouTube link played through the official
  `youtube-nocookie.com` embed (only validated 11-char video ids reach the iframe), creator attribution,
  timestamp bookmarks that seek the embed or open YouTube at `&t=`. No downloading or scraping.
  The future "YouTube → transcript → pattern review → tracker" pipeline belongs in an Edge Function and must
  mark unverified instructions; it is **not** implemented.
