# 10 — Test Strategy

## 0. What the repository has today

| Layer | Tooling | Notes |
|---|---|---|
| Unit | Vitest 5 + jsdom through `ng test` | 39 spec files; services and pure domain code |
| "e2e" | `vitest.e2e.config.ts`, 3 files in `e2e/` | API-level sync tests against a **local Worker**; not browser tests |
| Browser automation | **None** | No Playwright or Cypress |
| Device | Manual, over USB with `adb` on the HONOR phone | Used for earlier features; found bugs unit tests missed |

Consequences: unit tests fit the existing setup directly; Playwright is new tooling and is proposed for Phase 6; device testing follows the team's existing manual routine.

Specs that fake `AuthService` must provide `signedIn` and `guest`, and the suite must pass both with and without an API URL configured (an existing project rule).

## 1. Unit tests (Vitest, no DOM unless stated)

### 1.1 `tour-eligibility.spec.ts` — pure rules

| Case | Expect |
|---|---|
| Empty guest scope, armed | Welcome is offerable |
| Empty guest scope, not armed | Not offerable |
| Empty account, armed by sign-up | Offerable |
| Account with a project, not armed | `welcome` seeded `not_needed` |
| Account with `onboarded: true` and no data, not armed | `not_needed` |
| Account with `onboarded: true`, armed in this session (just finished setup) | Offerable |
| Fresh-account check: `onboarded: false`, no data, created < 7 days | Arms |
| Fresh-account check: same but created 30 days ago | Does not arm |
| Scope with a non-sample pattern | `patterns` and `pattern-reader` seeded `not_needed`; tracker tours untouched |
| Scope with only the two sample patterns | Nothing seeded from patterns |
| Scope with chat containing a user message | `khayoota` seeded `not_needed` |
| Scope with a project that has tracker progress | Tracker tours seeded `not_needed` |
| Project exists but tracker untouched | Tracker tours stay `not_started` |

### 1.2 `tour-state.spec.ts` — transitions

Table-driven over every row of the transition table in `07` §4, plus:

- Offer counter: welcome becomes `declined` on the 4th launch without an answer; a pill after the 2nd visit.
- `interrupted` twice → `skipped`.
- An `active` record on load → `interrupted`.
- Replay never downgrades `completed`.
- Version bump without `announceOnBump` keeps blocking; with it, resets to `not_started` for the new version.
- Saved `step` that no longer exists → resume index 0.
- Unknown tour ids in stored data are preserved and ignored.

### 1.3 `tour-state.service.spec.ts` — persistence and scopes

- Writes go through `AppStore.updatePrefs` and land in the active scope only.
- Guest → account in one session: account adopts guest state when it has none; does not overwrite existing account state.
- `user:A → user:B`: no adoption.
- `eraseLocal()` clears tour state.
- Guest import copies `tour` prefs with `joy` and `share`.
- IndexedDB unavailable (memory fallback): no throw.

### 1.4 `tour-coordinator.spec.ts` — with a fake renderer

- Gate closed (store not loaded / locked / overlay present / off `/tabs` / keyboard open) → no offer signal.
- One offer at a time; one tour per launch.
- `accept` → renderer `start` called with resolved copy in the current language and logical alignment mirrored for RTL.
- `NavigationStart` not requested by the tour → `stop('navigation')` before `NavigationEnd`.
- Overlay event → `stop('overlay')`.
- Scope change, lock, 30 s background → correct reasons.
- Back handler registered only while active; removed after.
- Renderer throws in `start` or in a callback → `interrupted/error`, DOM assertion runs, second error disables offers.
- Language change → `retext` with the other language.
- Khayoota: copy variant follows the mode; tour never calls `KhayootaService` methods that hit the network.
- Step with `when` false is omitted; step with `ifMissing: 'skip'` is skipped; `'end'` ends.

### 1.5 `tour-target.registry.spec.ts` (jsdom)

- Registers and unregisters with the directive lifecycle.
- Two elements with one id: returns the one whose `.ion-page` is not `.ion-page-hidden`.
- Element with a zero box or `hidden` → null.
- Tab-bar target (outside any page) resolves.

### 1.6 `getting-started.spec.ts` — pure

Each task's completion from store snapshots, including: sample-only patterns do not complete "project"; a project with an untouched tracker does not complete "tracker"; a bot-only chat does not complete "khayoota".

### 1.7 Definitions — static checks

- Every `TourStep.target` is a `TargetId` (compile time).
- A test reads the feature templates and asserts every `TargetId` used by a P0 definition appears as a `gzTour` value (catches a removed attribute after a redesign).
- Every step has both `ar` and `en`, title ≤ 4 words (English) and body within the length limits of `05`.
- No definition has more steps than its budget (welcome 6, tracker-simple 4, tracker-pattern 5, others 3).
- Only `core/tour/driver-tour-renderer.ts` imports `driver.js`.

## 2. Angular + Ionic integration tests (TestBed, jsdom)

jsdom has no layout, so these check wiring, not geometry.

| Test | Checks |
|---|---|
| `TabsLayout` | Each tab button carries the right `data-tour` |
| `HomePage` | Patterns tile and avatar carry `data-tour`; `gz-getting-started` renders states A, B, C, hidden from mocked coordinator signals |
| `TrackerPage` | Simple layout exposes `tracker.ring`, `tracker.tap`, `tracker.undo`, `tracker.project-picker`; pattern layout exposes its five; empty state exposes none |
| `PatternLibraryPage` | `patterns.sample-row` is on exactly one row, a sample |
| Pill | Appears when the coordinator offers; Start calls `accept`; × calls `decline` |
| Settings | "Tours & help" rows call `replay`; "needs project" message path |
| Teardown | Destroying a page with a registered target leaves the registry empty; destroying the root leaves no listeners (spy on `addEventListener` / `removeEventListener` pairs) |
| Real engine smoke | With the real `DriverTourRenderer` in jsdom: start, next, stop → no `driver-*` nodes remain. (Geometry is not asserted.) |

## 3. Playwright (new, proposed for Phase 6)

Runs against `ng serve` with **no API configured**: the app then works fully in guest mode with local storage only (confirmed during discovery), so tests touch no account and no server.

Projects: Chromium at 360×800 and 320×568, `locale` `ar` and `en`, plus one landscape 800×360. Each test starts from a clean storage state; a helper seeds IndexedDB for "existing user" cases.

| # | Scenario | Assertions |
|---|---|---|
| 1 | First visit as a new guest | Home shows the Getting Started card in offer state; nothing is dimmed |
| 2 | Start welcome | 6 steps; each step's cut-out rectangle equals the `[data-tour]` rectangle ± padding; popover inside the viewport |
| 3 | Next / Back | Order is correct in both directions; Back absent on step 1 |
| 4 | Skip on step 3 | Overlay gone; card shows the list; reload → not offered again |
| 5 | Finish | Toast; card shows the list; reload → not offered |
| 6 | Replay from Settings | Welcome runs from step 1 on Home, even when the Home tab's stack was on a nested page |
| 7 | Arabic and English | `dir` and labels; × at the inline-end corner; Next on the left in RTL and on the right in LTR |
| 8 | Target scrolling | With a project present (taller hero), step 1 scrolls the tile into view; cut-out still matches |
| 9 | Scroll during a step | Programmatic scroll of the content area → cut-out follows within 2 frames |
| 10 | Existing user | Seed a project → no offer card, no pills |
| 11 | Patterns tour | Pill on first visit; 3 steps; second visit after completion shows no pill |
| 12 | Tracker simple tour | Create a project; pill; step 2: tapping the big button increments the count by exactly 1 and advances; Undo step shown; reload → count persisted |
| 13 | Tracker pattern tour | Project from a sample pattern; 5 steps; current-step card step skipped when the round is complete |
| 14 | Navigation mid-tour | Tap is blocked; trigger `history.back()` → tour gone, no overlay, state `interrupted`; next visit shows a Resume pill once |
| 15 | Overlay during tour | Open a sheet from script → tour ends first; sheet is clickable |
| 16 | No stuck overlay | After every test: zero `.driver-*` elements, `body` has no `driver-active` |
| 17 | No duplicate tour | Rapid double tap on Start → one instance |
| 18 | Broken selector | Remove a `data-tour` at runtime before the step → step skipped or tour ended, never a centred orphan popover |
| 19 | Getting Started | Each task ticks only after the real action; Hide persists; Settings brings it back |
| 20 | Khayoota tour (P1) | Zero requests to any `/ai/` URL during the tour; copy matches `data-mode` |
| 21 | Reduced motion | `prefers-reduced-motion` emulated → engine started with `animate: false` |
| 22 | Language switch | Change language in Settings, return → next tour is in the new language; state unchanged |
| 23 | Guest → account (needs the local Worker; optional job) | Welcome completed as guest is not offered after sign-up |

Stable selectors for all of this are the `data-tour` attributes; no test uses design-system class names or translated text to find a target.

## 4. Real Android device (HONOR, Android 16, 1264×2736)

Status during discovery: **the phone was not connected** (`adb devices` returned an empty list). Everything in this section is pending.

Safety rules (from the team's existing practice):

- Install with `adb install -r` so app data is kept. Never uninstall, never clear data.
- Do not test in the user's real account or guest profile. Use a **separate debug build with a different application id** (e.g. `com.gharzetak.app.tourqa`) so it has its own storage, or a dedicated test account created for the purpose. The Phase 0 probe needs no account at all.
- Never start an emulator.
- Screenshots can contain private notifications: review, crop to the app, delete the rest; never commit raw captures.
- Gradle builds run in the user's terminal, not in the tool sandbox.

Checklist:

| # | Check | Pass |
|---|---|---|
| D1 | Overlay and cut-out alignment on all 6 welcome steps, Arabic | Cut-out hugs each target; no offset from the status bar |
| D2 | Bottom safe area and gesture bar; immersive display on and off | Tab-button cut-outs and popovers clear of system UI |
| D3 | Touch: tapping the dimmer, a blocked target, Next, Skip, × | Only tour controls respond |
| D4 | Action step with a real finger | One tap = one count = one advance |
| D5 | Hardware Back on a step; second Back | First closes the tour; second behaves as the app normally does |
| D6 | Scroll by dragging from the highlighted element | Highlight follows |
| D7 | Keyboard: New-project name step (P1) | Keyboard stays closed; popover visible |
| D8 | Rotate to landscape and back during a step | Re-aligned, or tour ends cleanly |
| D9 | Arabic rendering: Playpen Sans Arabic in the popover, diacritics, «» quotes, `1/2` direction | Correct |
| D10 | Kill the app mid-tour, reopen | No tour on launch; one Resume pill on that screen |
| D11 | Complete welcome, force-stop, reopen, reboot | Not offered again |
| D12 | Background 5 s and 40 s; with biometric lock enabled | Never above the lock screen |
| D13 | TalkBack run of the welcome and tracker tours | Per `09` §2.3 |
| D14 | System font at largest; display size at largest | Popover scrolls; controls reachable |
| D15 | Reduce-motion (system and in-app) | No glide animation |
| D16 | Celebration during the tracker tour (finish a round) | Banner visible; tour not broken |
| D17 | Guest-import prompt after sign-in with guest data | No tour before the prompt is answered |
| D18 | Production-mode build | Popover styled; engine chunk loads offline |
| D19 | Performance | No visible stutter when a tour starts; engine chunk not requested for a user who never starts a tour (check in WebView DevTools) |

## 5. Acceptance gates

| Gate | Requirement |
|---|---|
| Merge to `development` | Unit and integration suites green with and without an API URL; `ng build` clean; static checks in §1.7 green |
| Merge to `test` | Playwright scenarios 1–19 green at both sizes and both languages |
| Release build | Device checklist D1–D18 passed on the HONOR phone and recorded in `docs/` the way earlier QA passes were |
| Kill criteria | Any stuck overlay, any tour above the lock screen or an alert, any unintended data change, any AI request from a tour |
