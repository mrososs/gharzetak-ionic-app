# Phase 0 — Device Spike Results

Run on 2026-11-20 on the HONOR phone. **Verdict: the engine works on the device behind an adapter. Of the 14 planned checks, 9 passed, 1 passed in part and 4 are not verified. None failed.** Five defaults of the library were found that the design must override (§3).

## 1. Setup

| Item | Value |
|---|---|
| Device | HONOR DNY-NX9, Android 16, 1264×2736, DPR 3.5 → 361×781 CSS px |
| WebView | Android System WebView 157.0.8103.38 (Chrome 157) |
| Build | Branch `spike/product-tour-phase0` (local, throwaway, never merged) from the discovery commit. `driver.js` 1.14.0 pinned; its CSS added through `angular.json` `styles` (the path a real build would use); engine exposed to the probe through a lazy `import('driver.js')` in `main.ts`. |
| Isolation | Debug build with `applicationIdSuffix ".tourqa"` → package `com.gharzetak.app.tourqa`, launcher label "غرزتك QA", own storage. Installed **next to** the real app. The real app's `lastUpdateTime` (2026-11-19 01:19:03) is unchanged. Nothing was uninstalled or cleared. |
| Configuration | No API configured: guest-only, no network use by the app |
| Method | Automated checks (`scripts/spike/phase0-checks.js`) and a manual-harness (`phase0-manual.js`) driven over USB through WebView DevTools by `phase0-probe.mjs`. Real touches and the hardware Back key were sent with `adb shell input`. A tour-themed popover was injected to judge real rendering. |
| Repeatability | The automated suite was run twice on the same build with identical results (raw output in `phase-0-raw/auto-checks.json`) |
| Production build | `ng build` (the same build the APK uses). Debug APK, 14.4 MB. |

Raw evidence: `phase-0-raw/auto-checks.json`, `phase-0-raw/manual-log.json`, and one screenshot with the status bar cropped off (`phase-0-raw/device-themed-welcome-ar.png`). Other screenshots were reviewed and deleted because they showed notification icons.

## 2. Results by check

| # | Check | Result | Evidence |
|---|---|---|---|
| S1 | Highlight follows `ion-content` scrolling | **PASS with the adapter hook; the library alone fails** | Scrolling the page 80 px left the cut-out where it was (target moved from y=482 to y=562, cut-out stayed at 472). With a `scroll` listener on Ionic's scroll element calling `refresh()`, the cut-out stayed within 6 px of the target. Same behaviour as on desktop. |
| S2 | An Ionic overlay appearing during a tour | **PASS** | `ionModalWillPresent` fires on `document` in the capture phase with `target = ION-MODAL`. Calling `destroy()` there removed the popover in the same handler, the sheet's `pointer-events` was `auto`, and the sheet title was the top element at its own centre. Tested with an app-initiated sheet, because a tour blocks the user's own touches. |
| S3 | Hidden cached pages | **PASS** | After Home → Projects → Home the plain selector `.gz-btn3` matched a button on the hidden Projects page (rect 0×0). The registry-style resolver (visible `.ion-page` only) returned the Home button. |
| S4 | `scrollIntoView` shifting the body | **PASS** | `ion-app` stayed at 0,0; `documentElement`, `body` and `window` scroll offsets all 0 after stepping to a card below the fold. |
| S5 | Keyboard | **PASS** | With a step on the New-project name field, focus went to the popover's Next button, the keyboard stayed closed (`mInputShown=false`), and a real tap on the highlighted (blocked) field did not open it. Viewport height unchanged (782). |
| S6 | Rotation | **NOT VERIFIED** | Auto-rotate is on and the manifest has no orientation lock, but the harness recorded no `resize` or `orientationchange` event, so the page never saw a rotation. You reported nothing looked wrong; that is recorded, but there is no instrumentation behind it. |
| S7 | Hardware Back | **PASS** | With the tour on step 1, Back reached an Ionic `ionBackButton` handler registered at priority 100; the tour ended and the app stayed on `/tabs/home`. With no tour active, Back on Home returned to the launcher (the app's own handler). |
| S8 | Background and return | **PARTIAL** | Home key, 6 s away, return: `visibilitychange` hidden → visible, tour still active at the same step, cut-out still equal to the target (205,694 vs 215,704 − 10 padding). The 30 s limit, and a biometric relock, were not exercised (the QA build has no account or biometrics). |
| S9 | Safe areas | **PASS (immersive mode on)** | `env(safe-area-inset-top)` = 40 px; the tab bar ends exactly at the bottom edge (y 704 + 78 = 782); popover and cut-out fully inside the viewport; visually clear of the status bar and gesture area. Not tested with immersive display off. |
| S10 | TalkBack | **NOT TESTED** | No accessibility service is enabled; needs a person. |
| S11 | Largest system font | **NOT TESTED** | `font_scale` is 1.0; changing it alters the phone's settings and was left to you. |
| S12 | Engine CSS in a production build | **PASS** | `ng build` output contains the engine's rules in `styles-*.css`; on the device the popover computed `position: fixed`, `z-index: 1000000000`, white background. |
| S13 | Swipe-back during a step | **NOT VERIFIED** | The page is the tab root, where swipe-back has nothing to pop, and no page event was recorded. Needs a pushed page. |
| S14 | One finger tap = one count = one advance | **PASS** | Real tap on the tracker's big button: count 0 → 1 exactly once, step advanced exactly once, listener called once. A second real tap during the following (blocked) Undo step did not count (count stayed 1). |
| — | No stuck overlay at the end | **PASS** | Zero `driver-*` nodes and no body class after every exit path tried: Skip, Back, destroy, overlay, background return. |

Also confirmed on the device: Arabic text renders correctly in the popover; with the draft theme every control is ≥ 44 px (close 44×44, Skip 47×44, Back 71×44, Next 63×44). Not checked: that the engine is fetched lazily (the spike imports it at start-up).

## 3. Findings that change the design

| # | Finding | Evidence | Change |
|---|---|---|---|
| F1 | **Tapping the dimmed area closes the tour** by default | Tour ended with `reason=overlay` | Adapter must set `overlayClickBehavior: 'none'` (already in `08` §8). With it, the same tap was ignored. |
| F2 | **The highlighted element is live by default.** Tapping the highlighted Projects tab navigated to Projects and left the tour showing step 1 | URL changed to `/tabs/projects`, tour still active at index 0 | Adapter must set `disableActiveInteraction: true` on every blocked step. With it, the tab tap did nothing. Only action steps use `false`. |
| F3 | **`popover.instruction` makes Next inert** (`aria-disabled="true"`, a real tap on it does nothing), and so does `advanceOn` as used with it | Tap on Next left the index at 0 | Do not use `popover.instruction` or `advanceOn`. Use the adapter's own click listener that calls `moveNext()`, and render the hint line ourselves. Verified on the device: a stitch tap advanced the step once; without `instruction`, Next advanced with no stitch tap (count unchanged). Keeps the "invited, optional" rule. |
| F4 | The library's default buttons are 23 px tall and its progress text is reversed in Arabic ("of 4 1") | Measured 42×23; seen in the Arabic screenshot | The theme (44 px buttons, dots instead of text) already covers both; keep `progress-text` hidden. |
| F5 | The popover sits 10 px from the screen edge, not the 16 px in the design rule | Popover rect x = 10 on a 361 px viewport | Reduce the width cap to `min(310px, 100vw − 20px)`, or accept 10 px; decide in Phase 1. |

Already designed for and now confirmed on the device: function-based targets scoped to the visible page (S3), refresh on Ionic scroll (S1), ending on an Ionic overlay event (S2), a priority-100 Back handler (S7).

## 4. Still open (Phase 6 device pass)

| Check | Needs |
|---|---|
| S6 rotation | Re-run with the harness open and confirm a `resize` event is logged; check landscape under 420 px height |
| S8 long background and biometric relock | A build with an account and biometrics, or a mock lock |
| S9 with immersive display off | Toggle in Settings of the QA app |
| S10 TalkBack | A person using the phone |
| S11 maximum font and display size | A person changing the settings |
| S13 swipe-back | On a pushed page (e.g. Pattern reader) |
| Production-signed release build | `ng build` + release signing |
| Real-world pace: the engine was exercised on a fast, nearly empty QA app | Repeat on a profile with real projects |

## 5. Decision on the engine

Proceed with Driver.js 1.14.0 behind the adapter. The fallback (`ngx-ui-tour-ionic`) was not needed and was not tested. The engine's default behaviours F1–F3 are the kind of thing a wrapper exists to pin down; each is now a named adapter requirement with a test.

Pinning rule stands: re-read the engine changelog and the "Unreleased" section before choosing the version in Phase 1.

## 6. What was left on the phone and in the repository

| Where | State |
|---|---|
| Phone | App "غرزتك QA" (`com.gharzetak.app.tourqa`) still installed with one throwaway project in its own storage. Remove with `adb uninstall com.gharzetak.app.tourqa` when no longer needed. The real app was not touched. No adb port forward remains. |
| Repository | Spike changes are committed only on the local branch `spike/product-tour-phase0` (dependency, `angular.json`, `main.ts` hook, debug Gradle suffix, `scripts/spike/`). Not pushed. The results and design corrections are on the documentation branch. |
