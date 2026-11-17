# QA report — pattern collections, editing, Smart paste, time, immersive display, dialogs

Environment: Windows 11, Node 24.11 (the Angular CLI refuses < 24.15, so the CLI gate was bypassed via
`node node_modules/@angular/cli/bin/bootstrap.js …`; `scripts/android-debug.ps1` uses the portable Node 24 instead), Chromium preview pane,
local Wrangler Worker (simulated D1/R2). **No physical Android device was connected and no emulator was started (by request).**

## Automated (all executed)

| Check | Result |
|---|---|
| App typecheck (`tsc` app + spec) | pass |
| Angular unit tests (`ng test`) | **208 / 208** (126 pre-existing unchanged + 82 new: smart parser incl. bunny fixture, time maths, collections/revisions/merge, store, timer incl. force-stop recovery) |
| API typecheck | pass |
| API tests (Workers pool, real D1 migrations 0000-0003) | **89 / 89** (collections, ownership, CAS/409, idempotent revisions, old-client compat, sessions with part id, estimate, source_text) |
| Sync integration vs a running local Worker (`npm run e2e:sync`) | **23 / 23** (16 pre-existing + 4 collections/parts/time/offline/second device/deleted collection/piece-by-piece merge + 3 avatar parity) |
| Production Angular build (`ng build`) | pass |
| `cap sync android` + Gradle `assembleDebug` (incl. the new Java) | pass (APK `android/app/build/outputs/apk/debug/app-debug.apk` built twice; not installed or run) |

## Exercised in the real UI (browser pane, guest mode, 390 px and 320 px)

Pattern Library → New multi-part pattern → Smart paste of the bunny fixture (26 validated / 11 needs-review / 0 unsupported; 4 parts detected, arms/legs/ears
suggested ×2) → confirm → save → project from the collection with 8 h estimate → Arm 1 counted 9 taps → timer start / pause / resume → switch to Arm 2 (3 taps)
→ Arm 1 intact, per-piece time 9 s + 2 s = project 11 s → reload ("app restart"): active piece, progress, estimate restored, timer credited up to the last
heartbeat and left paused → edit a collection round → project shows "pattern edited", stays on its version → Review → update: cursor and 9 undo steps unchanged.
At 320 px the estimate sheet fits: all buttons inside the viewport (right ≤ 306 px), 44–50 px tall, no horizontal overflow. 360/390/412 use the same fluid
full-width layout; only 320 px was measured numerically.

Bugs found by this run and fixed: unsaved-changes guard fired when opening Smart paste; editors did not hydrate on a cold start / deep link; RTL "× 2" label.

## NOT verified (pending — needs the physical phone)

Pattern collection creation, editing, Smart paste, part switching, undo, estimate input, timer, **immersive navigation**, bottom-tab layout with the system bar
hidden, dialogs, soft keyboard, RTL/LTR, offline persistence, force-stop/restart, Android Back, crashes/ANRs, gesture vs three-button navigation, background/
resume, rotation. The APK builds; none of its native behaviour was run. Treat the immersive-mode behaviour as **unproven**.

## Not done / limits

* No real-device or emulator test; no screenshots of native screens.
* The originally supplied bunny pattern was not available: `src/app/core/domain/fixtures/bunny-dress.fixture.ts` is a reconstruction of the described features.
* Dialogs were unified by migrating every `gz-sheet` / alert / confirm in the app; width checks at 360/390/412 were not repeated numerically.
* Remote Cloudflare resources and remote D1 migrations: untouched. `development` was **not** merged or pushed (see report).
