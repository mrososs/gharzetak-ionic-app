# Implementation progress

Status as of 2026-11-16. "Verified" = executed and observed in this session.

| Area | Status | Evidence |
|---|---|---|
| Phase 0 design audit | Done | `docs/design-handoff/design-source-audit.md` |
| Angular 22.2 + Ionic 9.0 + Tailwind 4.3 + Capacitor 8.6 scaffold | Done, verified | `ng build` passes (≈277 kB initial transfer) |
| Design tokens / typography / components | Done | exact handoff values; `/design-system` preview |
| All 25 screens + 9 states + forgot/reset password | Implemented, visually checked | `screen-map.md`, `visual-qa.md` (all screens + sheets; overflow sweep at 320/360/390/412 px, AR + EN) |
| Supabase schema, RLS, storage, sample patterns | Done, verified locally | 2 migrations applied on the local stack; 36/36 RLS tests |
| Real Auth (sign-up, sign-in, sign-out, session restore, recovery) | Implemented; sign-up + session restore verified in browser | recovery email flow not exercised end-to-end |
| Persistence & sync (projects, progress, patterns, rounds, profile, tools) | Verified | rows observed in Postgres after UI actions |
| Offline counting + reconnect sync | Verified | API gateway stopped → counted → reload kept state → gateway started → server updated |
| Guest mode + import into account | Implemented | not exercised end-to-end |
| Tracker engine | Verified | 26 engine tests + UI check of `R5: (3sc, inc) × 6 [30]` |
| Pattern reader, add pattern, US/UK converter | Implemented; reader + converter checked visually | |
| Photos upload (cover / progress) | Implemented | upload path covered by RLS storage tests; not clicked through in the UI |
| AI assistant | Demo mode (labelled); Edge Function boundary ready | no model connected |
| YouTube companion | Links, embed (validated id), creator credit, timestamps, notes | no analysis/extraction (by design) |
| Android | Debug APK builds (verified) | not run on a device/emulator |
| iOS | Project generated | not built (needs macOS/Xcode) |
| Tab bar raised Projects/Learn buttons (owner request) | Done, visually checked | |
| Scrollbars, inputs, dropdowns styled (owner request) | Done, visually checked on `/design-system` | |

## Follow-ups

1. Save the supplied logo as `public/assets/brand/logo.png`, then generate launcher icons/splash.
2. Create the hosted Supabase project and push migrations (`supabase-setup.md`).
3. Run the app on an Android device/emulator (APK builds, not yet smoke-tested).
4. Replace the knitted-looking "clothes" photo; add a crochet-bag photo.
5. Configure Google/Apple providers before enabling those buttons.
