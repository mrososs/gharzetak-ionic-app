# 13 — Implementation status

Branch `feat/gharzetak-product-tour` (local, not pushed). Written 2026-11-20. Documents 00–12 are the specification the work followed; this page records where the build **differs** from them, what was verified, and what is still open. Where the two disagree, this page and the code are right.

## What exists

| Area | Where |
|---|---|
| Engine adapter (the only file that imports Driver.js 1.14.0, loaded lazily, 47.7 kB chunk, outside the initial bundle) | `src/app/core/tour/driver-tour-renderer.ts` |
| State, eligibility, gate, target registry, coordinator, local event log | `src/app/core/tour/` |
| Eight tour definitions (welcome 6, patterns 3, reader 3, simple tracker 4, pattern tracker 5, pieces 2, new project 2, Khayoota 3) | `src/app/core/tour/definitions/` |
| Target directive, invitation pill, Getting Started card, Settings "Tours & help" | `src/app/shared/ui/tour/` |
| Theme | `src/theme/tour.scss` |
| Build-time kill switch (`GZ_TOURS=0`) | `scripts/set-env.mjs`, `environment.toursEnabled`, `TOURS_ENABLED` |

## Deviations from the blueprint

| # | Blueprint | Built | Why |
|---|---|---|---|
| 1 | Shared labels in `core/i18n/strings.ts` | `core/tour/tour-labels.ts` | Keeps the tour removable as one folder. |
| 2 | Adapter options as in `07` §5 | Added `RenderStep.waitFor`, `EndReason 'viewport'`, `TourStep.hint`, route `match` (a regex) instead of a path string | Needed for visible-page target resolution, short-screen refusal, the invited-tap hint, and the nested reader route. |
| 3 | Phase 0 findings F1–F5 as "to do" | Done: `overlayClickBehavior: 'none'`, `disableActiveInteraction: true` on blocked steps, no `popover.instruction`/`advanceOn` (own click listener, own hint strip), 44 px controls, dots instead of progress text, popover clamped to 16 px | Measured on the HONOR device in Phase 0. |
| 4 | Local analytics sink | `ScopeDocs.tourEvents`, a content-free ring buffer of the last 200 events; nothing leaves the device | No remote telemetry was approved. |
| 5 | Seeding and adoption as two steps | One effect: adopt the guest's state into a new account, otherwise seed | A test showed seeding could win over adoption. |
| 6 | Pills appear when idle | A pill is *latched* the first time it is safe, so the page never shifts under a finger | Layout jump on the library page. |
| 7 | Multi-part project: counter tour then pieces tour | A multi-part project with pattern pieces is offered the **pattern** tour first; the pieces tour is replayed from Settings | One automatic tour per launch. |
| 8 | Completion message on Home | Shown in the launch where the fifth task was done, then gone | Avoids a permanent congratulation card. |
| 9 | Arming right after "continue as guest" | `arm()` waits up to 60 s for the scope to load and never writes into an unloaded scope | A write made before the load is overwritten by it. |
| 10 | Pattern Reader tour title | "Round by round" (English) | The earlier title exceeded the four-word limit. |

## Verification (all on this machine, 2026-11-20)

| Check | Result |
|---|---|
| Unit and integration tests (`ng test`) | **972 passed, 48 files** (baseline before this work: 686). Includes 19 tests of the real Driver.js against a jsdom page and 21 component tests. |
| Browser tests (`npm run test:ui`, real Chrome, 360×800 touch, no backend) | **72 passed**, Arabic and English: start/next/back/skip/escape/finish, persistence and no auto-restart, replay, hidden cached pages, controls ≥ 44 px, 15 px edge margin, RTL button order, rapid taps, dimmer taps, the invited tap counting and advancing exactly once, highlight-only tours leaving the project untouched, contextual offers, one automatic tour per launch, Settings replay and checklist, all five Getting Started tasks completed through real actions, Back, Ionic overlay, rotation, crash recovery, missing targets, keyboard and focus trap, 320×568 to tablet, 150 % and 200 % text, reduced motion, dark mode; every test asserts **zero AI or backend requests** and nothing leaving the device. |
| Kill switch (`GZ_TOURS=0` build, opt-in test) | Passed: no card, no pill, no "Tours & help", engine chunk never requested, "Replay app intro" unaffected. |
| TypeScript (app, specs, browser tests) | Clean. |
| Production build | Clean. Initial bundle 1.34 MB raw / 291 kB transfer; Driver.js is a separate lazy chunk. |
| Backend, Android project, public assets | Unchanged (`git diff` against the base is empty for `apps/`, `android/`, `public/`). |

## Not covered, and why

| Item | Status |
|---|---|
| Guest → account in a live session | Unit-tested (coordinator spec, "guest, account and scope rules"). Not run in a browser: it needs the backend, which this work must not touch. |
| Background longer than 30 s | Unit-tested with fake timers; not driven in a browser. |
| API-level tests (`npm run api:test`, `e2e:sync`) | Not run: `apps/api` has no installed dependencies here and was not changed. |
| Focus after a card-launched tour | The Start button no longer exists, so focus falls back to the document. It is never left inside the removed popover. |
| TalkBack | Not verified. The app is made inert behind a blocked step as a fallback; whether TalkBack honours it is unknown until tested on the device. |
| Physical device | See the next section. |

## Unrelated change on this branch

Commit `19d6603` fixes a separate parser bug (`R1: 43 ch` was rejected because `ch` was not a stitch kind). It is independent of the tour and can be cherry-picked on its own.

## Device pass (HONOR DNY-NX9, Android 16, WebView 157, 361×781 CSS px, DPR 3.5)

Isolated debug build  (app id suffix from a Gradle init script, label from an untracked debug resource, nothing committed), installed next to the real app. The real app's  stayed 2026-11-19 01:19:03 throughout; nothing of it was uninstalled, cleared or changed. State was read read-only over WebView DevTools; every interaction with the app was a real touch or key event except where noted.

| Check | Result |
|---|---|
| First run as a guest (Arabic, RTL) | **PASS.** Getting Started invitation on Home, nothing auto-started. |
| Welcome tour, all 6 steps | **PASS.** Right targets in order; every control ≥ 44×44 CSS px; popover never closer than 16 px to an edge; Skip hidden on the last step; Done leaves 0 engine nodes, the app live, status , and a content-free event log. |
| Persistence across force-stop and restart | **PASS.** Finished tour stays finished; the card is the checklist; nothing restarts. |
| Pattern Library invitation and tour | **PASS.** Pill on the first visit, Start runs it, **a tap on the dimmed area is ignored**, **the hardware Back key ends it cleanly and stays on the page**. |
| One automatic tour per launch | **PASS.** No second invitation in the same launch. |
| Simple tracker: the one invited tap | **PASS.** One real finger tap: count 0 → 1 exactly once, step advanced exactly once, still 1 and on Undo 2 s later; the app is live only on that step. |
| New Project tour | **PASS.** Two steps; the input method stayed closed (); the form was not filled. |
| Khayoota tour via Settings replay | **PASS.** Runs highlight-only; no request left the app (the only origin seen was the app's own ). |
| Background | **PASS.** 6 s away: the tour continues at the same step. 36 s away: it ends cleanly with reason , 0 leftovers, app live. |
| An Ionic dialog appearing during a tour | **PASS.** The tour ends at once; the dialog is untouched. |
| Safe areas and popover geometry, Arabic text rendering, real fonts | **PASS** (screenshots reviewed, then deleted). |
| **Scrollbar in the popover** (reported by the user from the device) | **Found and fixed.** The engine's direction arrow sits outside the box and forced a 16 px overflow inside the scrolling popover. Arrow hidden, scrollbar chrome never drawn, regression test added; verified on the device afterwards (overflow 0, bar width 0). |
| Swipe-back gesture from a nested page | **NOT VERIFIED.** Injected swipes are not treated as the system back gesture on this phone. Needs a person: start a replay on a nested page and swipe from the screen edge; expected: the tour ends and the page is popped once. The hardware Back key is verified. |
| Rotation with instrumentation | **NOT VERIFIED.** Changing auto-rotate is a persistent phone setting; needs a person rotating the phone. Expected: the tour ends on  in landscape (height < 420 px) and the app stays usable. Covered in the browser. |
| Largest font / display size | **NOT VERIFIED.** Same reason (system setting). Covered at 150 % and 200 % text in the browser. |
| TalkBack | **NOT VERIFIED.** Needs a person with TalkBack on. |
| Biometric relock, immersive off, offline, account sign-in | **NOT RUN.** No account or backend in the QA build; the others change phone or app settings. |
