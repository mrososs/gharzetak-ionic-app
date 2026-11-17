# QA report — pattern collections, editing, Smart paste, time, immersive display, dialogs

Environment: Windows 11, Node 24.11 (the Angular CLI refuses < 24.15, so the CLI gate was bypassed via
`node node_modules/@angular/cli/bin/bootstrap.js …`; `scripts/android-debug.ps1` uses the portable Node 24 instead), Chromium preview pane,
local Wrangler Worker (simulated D1/R2). Automated checks ran without a device; a real-phone USB pass was added afterwards (see the last section). No emulator was ever started (by request).

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

## Superseded: native behaviour

This section originally listed native behaviour as unverified. It has since been exercised on a real phone — see "Real Android device QA (USB)" at the end. Still untested: TalkBack, gesture navigation.

## Not done / limits

* Real-device coverage is limited to what the last section lists; no emulator test.
* The originally supplied bunny pattern was not available: `src/app/core/domain/fixtures/bunny-dress.fixture.ts` is a reconstruction of the described features.
* Dialogs were unified by migrating every `gz-sheet` / alert / confirm in the app; width checks at 360/390/412 were not repeated numerically.
* Remote Cloudflare resources and remote D1 migrations: untouched. `development` was **not** merged or pushed (see report).

## Real Android device QA (USB)

Device: Honor DNY-NX9, Android 16, 1264×2736 @ 560 dpi, three-button navigation, WebView driven over `adb forward` + DevTools; real taps via `adb shell input`.
Build under test: `development` @ `4f3b3b6` + the UI fixes below. Installed with `adb install -r` only (no uninstall, no data clearing). No emulator used.
Screenshots and a filtered logcat (no crashes / ANRs) are in `docs/pattern-collections/device-qa/`.

| Area | Result |
|---|---|
| Collections, parts, per-piece progress / undo / reset | **passed on real Android** |
| Smart parser (joins, HDC, ranges, unsupported syntax, large paste) | **passed on real Android** (Arabic text injected via DevTools, not the Android IME) |
| Edit-earlier-round protection + explicit update flow | **passed on real Android** |
| Estimate (8h30), timers: start / pause / resume / switch / stop, force-stop recovery, restart | **passed on real Android** |
| Immersive mode: toggle, edge-swipe reveal, auto-hide, Back/Home, rotation, background/resume, keyboard, dialogs | **passed on real Android** |
| Sync of collections / parts / estimate / multi-state | **passed against the local Worker** (`adb reverse`), confirmed in local D1 |
| Remote staging sync | **blocked — not deployed, not verified** |
| TalkBack safeguard, gesture navigation, Android-IME Arabic paste, standalone-pattern edit on device | **not tested** |

Bugs found on the device and fixed (all in CSS/templates, no data-model change):

1. "Add part" sheet: primary button pushed below the fold → dialog actions are a sticky bar pinned to the bottom of the sheet.
2. Dialog / alert buttons stacked in a column → one row (primary first), secondary = outlined `.gz-btn2` style (1.5px primary border), including alert cancel.
3. Alert labels start-aligned instead of centred (Ionic specificity) → 4-class selector.
4. Keyboard autocapitalised `MR` → `Mr` and the char counter reversed in RTL → `autocapitalize/autocorrect/spellcheck` off on pattern textareas, LTR counter.

Incident: during device QA a scripted tap hit the "move guest data" prompt, which moved the on-device guest data into the local test account's scope. The data was not deleted (it is on the device under that scope and in the local D1); restoring it to the guest scope is left to the owner.
