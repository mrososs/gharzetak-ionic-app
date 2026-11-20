# 06 — Driver.js × Ionic Technical Analysis

Three kinds of evidence are used and labelled throughout:

- **[docs]** read on driverjs.com on 2026-11-20
- **[source]** read in the published 1.14.0 source (`nilbuild/driver.js`, tag `1.14.0`, `packages/driver/src`)
- **[probe]** observed by loading the library into the running Gharzetak dev build

Anything not labelled is reasoning and says so.

## 1. The library as it is today

| Fact | Value |
|---|---|
| npm `latest` | **1.14.0**, published 2026-11-13 |
| Licence | MIT |
| Dependencies | None |
| Size | `driver.js.mjs` 47 KB raw, **15 KB gzip**; `driver.css` 7.5 KB raw, 1.9 KB gzip |
| Entry points | `driver.js`, `driver.js/hints`, `driver.js/headless`, `driver.js/checklist`; CSS is imported separately |
| Repository | `kamranahmedse/driver.js` now resolves to `nilbuild/driver.js` |
| Release pace | 1.8.0 in July; then **ten releases between 3 October and 13 November** |
| Open issues | 1 |
| npm `next` tag | Stale (`1.1.11-next.0`). Do not install it. |

The feature set changed a great deal in those six weeks. `waitForElement` (1.8), `skipMissingElement` (1.7), `advanceOn` (1.11), hints (1.8), checklists (1.10), headless mode (1.13) and "the highlight follows a panel that scrolls inside the page" (1.14) are all recent. Older blog posts and answers about Driver.js describe a much smaller library.

Not in the library, confirmed in docs and source: persistence of any kind, router integration, RTL handling, an Angular or Ionic integration, a Shadow DOM support statement, Android Back handling, `prefers-reduced-motion` for the main animation.

### API used by this design

| API | Exists in 1.14.0 | Use |
|---|---|---|
| `driver(config)`, `drive(index?)`, `destroy()`, `refresh()`, `moveNext()`, `movePrevious()`, `moveTo()`, `isActive()`, `getActiveIndex()` | Yes | Adapter |
| `updatePopover(patch)` | Yes (1.11) | Re-text a step when language or Khayoota status changes |
| `step.element: string \| Element \| (() => Element)` | Yes | **Function form only** |
| `waitForElement: ms`, `onWaitingForElement`, `onElementMissing`, `onElementReplaced` | Yes | Lazy pages, re-rendered targets |
| `skipMissingElement` | Yes | Optional steps |
| `advanceOn`, `popover.instruction`, `advance()` | Yes (1.11–1.12) | The one tap-to-advance step |
| `disableActiveInteraction: boolean \| "clicks"` | Yes | Highlight-only steps |
| `onHighlighted`, `onDeselected`, `onDestroyStarted`, `onDestroyed` with `opts.reason` and `opts.index` | Yes | State machine, analytics |
| `onPopoverRender(popover, opts)` | Yes | Progress dots, Skip button |
| `popoverClass`, `overlayColor`, `overlayOpacity`, `stagePadding`, `stageRadius`, `animate`, `duration`, `scrollIntoView`, `focus` | Yes | Theme and behaviour |
| `showProgress`, `progressText`, `nextBtnText`, `prevBtnText`, `doneBtnText`, `closeBtnLabel`, `showButtons` | Yes | Labels |

Destroy reasons reported by the library: `done`, `close`, `escape`, `overlay`, `replaced`, `api`. The adapter maps these to the app's own states (`07` §4).

## 2. The probe

**Setup.** Worktree at the `test` baseline, `ng serve`, no backend configured, fresh browser profile, guest mode, viewport emulated at 375×812, Arabic and English. The library and its CSS were loaded from the public CDN into that page with a script. Nothing was added to `package.json`, and no app file was edited.

**Limits.** This is desktop Chromium, not the Android WebView. The preview pane was in the background, so `requestAnimationFrame` did not fire; for the functional tests it was replaced by a 16 ms timer. Timing numbers are therefore meaningless and are not reported. Touch behaviour, TalkBack, the soft keyboard, rotation and safe areas were **not** tested.

| # | Test | Result |
|---|---|---|
| P1 | Highlight `ion-tab-button` (a Shadow DOM host) using a function resolver | **Pass.** Cut-out equals the host rectangle plus padding. The host and its shadow children receive `pointer-events: auto`; other tab buttons and their shadow children are `none`. The library added and later removed `aria-haspopup`, `aria-expanded`, `aria-controls` on the host. |
| P2 | Highlight a Home card far below the fold | **Pass.** `ion-content`'s inner scroller went from 0 to 398 px; cut-out matched; the popover flipped above the target. |
| P3 | Scroll `ion-content` by 80 px while a step is showing | **Fail as shipped.** The target moved; the cut-out and popover stayed. Calling `refresh()` corrected both. |
| P4 | Next step is back at the top of the page | **Pass.** Scroller returned to 0; cut-out and popover correct. |
| P5 | `destroy()` | **Pass.** Body classes gone, no `driver-*` nodes, ARIA attributes restored, page interactive again. |
| P6 | Cross-tab step: tap the Projects tab, next step targets a button on the lazily loaded Projects page with `waitForElement` | **Pass.** `advanceOn: 'click'` advanced on the tab tap; the next step reported "waiting", the route chunk loaded, the step highlighted the button. |
| P7 | Cached pages | After leaving Home, `gz-home` remains in the DOM as `.ion-page.ion-page-hidden[aria-hidden=true]`. `document.querySelector('.gz-btn')` returned a button **on that hidden page**, size 0×0. |
| P8 | Ionic sheet opened, then a highlight inside it | `ion-modal` is a child of `ion-app` with z-index **20007**; the overlay is a child of `body` with z-index **10000**; the popover is **1 000 000 000**. The modal host had `pointer-events: none`. |
| P9 | RTL popover, unstyled | Text right-aligned, progress on the right, Next on the left of Previous: correct. The close button stayed top-right, over the start of the title. |
| P10 | RTL and LTR popover with the Gharzetak theme, language switched live in Settings | **Pass** in both directions with one logical-property rule for the close button. See `concepts/`. |
| P11 | Tap-to-advance on the tracker's big button | **Pass.** The app counted 0 → 1 (really saved in the test profile) and the tour moved to the Undo step. With `advanceOn`, the Next button is `aria-disabled="true"`. |
| P12 | Tapping a tab button to "go Home" | Not a library issue, but found here: a tab button returns to that tab's **last nested page**, not its root. A tour must navigate with `navigateRoot('/tabs/home')`. |

### 2.1 Device run (Phase 0, 2026-11-20)

The same behaviour was then tested on the HONOR phone (Android 16, WebView 157) in an isolated QA build. Full results, method and the checks still open are in [phase-0-results.md](phase-0-results.md). In short: highlight alignment, scroll-follow with the refresh hook, hidden-page resolution, overlay ending, hardware Back, background return, safe areas, production CSS, keyboard and a real finger tap on the tracker all passed; rotation, TalkBack, large font, long background and swipe-back are not yet verified. Four library defaults must be overridden: tapping the dimmer closes the tour, the highlighted element stays live, `instruction` / `advanceOn` make Next inert, and the default buttons are 23 px tall.

## 3. Compatibility analysis by topic

### 3.1 Angular lifecycle

| Concern | Finding | Design response |
|---|---|---|
| Zone / change detection | The app is zoneless (observed: no `Zone` global) and `OnPush` with signals. Library callbacks run outside any Angular context. | Hooks only write signals or call services; no `detectChanges`. |
| Lazy routes | Every page is `loadComponent`. | Steps on another page use `waitForElement` with a deadline; v1 has no such steps. |
| Signals re-rendering a target | [docs][source] A disconnected target is re-resolved through the step's function and re-bound (`onElementReplaced`). | Function resolvers make this automatic. |
| Async data | No page in the tour areas waits for `store.loaded()`; empty states flash first. | The coordinator will not start until `store.loaded()`. |
| Component destroyed while its target is highlighted | [source] After the removal wait, `onElementMissing` decides; default keeps the cut-out where the element was. | Adapter sets `onElementMissing` to end the tour as *interrupted*. |
| Multiple instances | [source] One on screen at a time; starting another destroys the first with reason `replaced`. | One coordinator owns one instance. |
| Leaks | [probe] `destroy()` removes listeners, observers and nodes. | Adapter calls `destroy()` on every exit path, including service teardown in tests. |

### 3.2 Ionic navigation

| Concern | Finding | Design response |
|---|---|---|
| Cached pages | [probe] Hidden pages stay in the DOM with `.ion-page-hidden`. [source] "Found" means the resolver returned something; visibility is not checked. | Resolver returns an element only if it is connected, inside an `.ion-page` that is not hidden, and has a non-zero box. |
| Tabs | [probe] Five hosts with stable runtime ids; each tab keeps its own stack. | Tab targets get `data-tour`; navigation uses `NavController.navigateRoot`. |
| Page transitions | Ionic animates enter/leave; a target is in the DOM before it is in place. | "Stable" means the resolver succeeds and the rectangle is identical on two consecutive frames. |
| `ionViewWillLeave` | Fired when the user leaves by any means. | The router listener ends the tour on `NavigationStart` that the tour did not request. |
| Hardware Back | App handler at priority −1; Ionic overlays use higher priorities. The library ignores Back. | While a tour is active, a priority-100 handler closes it and stops propagation. |
| Swipe back | `swipeBackEnabled: true`. | [source] Page interaction is blocked by CSS and by capture-phase listeners for press, release and click; touch moves are not cancelled. A swipe that starts on the highlighted element could still begin a gesture. Covered by "end on unexpected navigation". Verify on device. |

### 3.3 Ionic overlays

[probe] Ionic overlays sit above the tour's dimmer and are made untappable by the library's page-blocking CSS. That combination is a dead end for the user unless she first closes the popover.

Rules:

1. A tour never starts while any `ion-modal`, `ion-alert`, `ion-action-sheet`, `ion-popover`, `ion-loading` or `ion-picker` is presented.
2. While a tour is active, the adapter listens for Ionic's `ionModalWillPresent`, `ionAlertWillPresent` and the equivalent events, plus a `MutationObserver` on `ion-app`'s direct children as a backstop, and ends the tour as *interrupted* immediately.
3. No v1 step targets anything inside a sheet. If a later tour needs it, the library's `allowedElements` (z-index variable `--driver-allowed-z-index`) and a raised overlay z-index must be prototyped first.
4. Toasts (`ion-toast`) are harmless: they render above the dimmer and are not interactive.

### 3.4 Shadow DOM

| Concern | Finding |
|---|---|
| String selectors | [source] `document.querySelector`: light DOM only. Not used. |
| Function resolvers | [source] May return any node. Used everywhere. |
| App content inside `ion-content` | Light DOM, slotted. [probe] Highlights correctly. |
| Ionic hosts (`ion-tab-button`, `ion-input`) | [probe] Highlight the **host**; shadow children inherit `pointer-events` from it. |
| Elements inside a shadow root | [source] The page-blocking stylesheet is global and cannot match inside a shadow root, so such a node would stay `pointer-events: none`. Rule: never target shadow internals. |
| Geometry | [source] The clipping walk is slot- and host-aware. [probe] Clipped by the tab bar correctly (a 164 px card reported 162 px visible). |
| Focus trap | [source] Uses `querySelectorAll` and `document.activeElement`, so focusable elements inside shadow roots are not in the Tab cycle. Touch users are unaffected; see `09`. |

### 3.5 Scrolling

- [source] The library calls native `scrollIntoView({ block: 'center', inline: 'center' })`, `behavior: 'auto'` when the parent scrolls.
- [probe] This works through `ion-content`'s shadow scroller.
- [probe] After that, scrolling is not followed. Reason [source]: the library listens for `scroll` on `window` in the capture phase; scroll events fired on an element inside a shadow root do not propagate out of it.
- Design: on each step, the adapter finds the active page's `ion-content`, awaits `getScrollElement()`, and adds a passive `scroll` listener that calls `refresh()` through one `requestAnimationFrame`. The listener is removed on step change.
- While a step shows, `ion-content` has `pointer-events: none` [probe], so most drags do nothing. A drag that starts on the highlighted element can still scroll its container. The listener covers that.
- [docs] An ancestor with `overflow: hidden` can be scrolled by `scrollIntoView`; the maintainer's advice is `overflow: clip`. `body` here is `position: fixed; overflow: hidden`. No shift was measured in the probe (`scrollLeft`/`scrollTop` of every ancestor stayed 0), but this is on the device checklist.

### 3.6 Mobile layout

| Concern | Expectation | Status |
|---|---|---|
| Small screens (320×568) | Popover width is `min(310px, 100vw − 32px)`; long copy is capped by the copy rules in `05`. | To test |
| Status bar | `StatusBar.overlaysWebView: false` (`capacitor.config.ts`): the WebView starts below it. | To test |
| Bottom safe area | The tab bar already includes `--gz-safe-bottom`. A cut-out on a tab button extends into it. | To test |
| Android immersive mode | `html.gz-immersive` raises the bottom inset; nothing tour-specific. | To test |
| Soft keyboard | `Keyboard.resize: native`: the WebView resizes, `window` fires `resize`, the library refreshes [source]. Default focus goes to the popover's Next button [source], so highlighting an input does not open the keyboard. | To test |
| Rotation | Not locked in the manifest. `resize` triggers a refresh. Landscape height (~360 px) may not fit popover plus target; rule in `09`. | To test |
| Large system font | The popover needs `max-height` and internal scroll (in the theme, `08`). | To test |
| WebView engine | [source] Uses `:where()`, `ResizeObserver`, `AbortSignal` in `addEventListener`, and the Popover API only if present. All are available in current Android System WebView. No support matrix is published. | To test on the HONOR phone (Android 16) |

### 3.7 Route transitions (multi-page tours)

The library has no notion of routes [docs]: "save the step to resume at, let the app navigate, and start the tour from that step on the next page", and for SPAs, call `destroy()` before navigating.

[probe] A simpler form works inside one instance when the user herself performs the navigation by tapping a highlighted control: the next step waits and then appears.

Design position:

- **v1 has no multi-page tours.** Each tour lives on one screen. The welcome tour can do this because all five tab buttons, the Patterns tile and the avatar are on Home.
- The coordinator still supports a `route` on a step for later use (`07` §6). The sequence is: end the current highlight, `NavController.navigateRoot/Forward`, wait for `NavigationEnd`, wait for the target to resolve on the visible page and hold still for two frames, then show the step. Every wait has an `AbortSignal` and a deadline; closing the tour aborts them. No fixed sleeps.

### 3.8 Accessibility as shipped

[source] The popover is `role="dialog"` with `aria-labelledby` and `aria-describedby`, **no `aria-modal`**, focus moves to the Next button, focus returns on close, a polite live region announces changes, Escape closes, arrow keys move between steps (Right is always "next", also in RTL). The main animation ignores `prefers-reduced-motion`.

Adapter additions are in `09`.

### 3.9 Content safety

[source] Titles, descriptions, instructions and button labels are written with `innerHTML`. All tour copy is static and comes from the tour definitions. No user content (project names, pattern text) is ever interpolated into a popover. Where a name is wanted, it is referred to generically ("your project").

## 4. Suspected incompatibilities and how to reproduce each

Each is a Phase 0 task on the HONOR phone. "Probe page" means a temporary dev-only route or a DevTools snippet over USB; none of it ships.

| # | Suspicion | Reproduce | Pass criterion |
|---|---|---|---|
| S1 | Highlight drifts on scroll | Start a step on a Home card; drag the page from the highlighted card | Cut-out stays on the card (with the scroll listener) |
| S2 | Overlay vs Ionic sheet | Start a step; trigger the Home tools sheet from a script | Tour ends within one frame; sheet is usable |
| S3 | Hidden-page match | Visit Home, Projects, Home; resolve a target that exists on both | Resolver returns the visible one only |
| S4 | Body shift from `scrollIntoView` | Step on the lowest Home element at 320×568 | `ion-app` rect stays at 0,0; no horizontal offset |
| S5 | Keyboard | Step on the new-project name field | Keyboard stays closed; popover fully visible |
| S6 | Rotation | Rotate during a tab-bar step | Cut-out and popover re-align; no clipped buttons |
| S7 | Hardware Back | Press Back on step 3 | Tour closes; page does not navigate; a second Back behaves as before |
| S8 | Background and resume | Home button during a step; return after 5 s and after 40 s (biometric relock) | Tour is gone or correctly re-shown; never above the lock screen |
| S9 | Safe areas / immersive | Tab-bar step with immersive display on and off | Popover clear of system bars |
| S10 | TalkBack | Run the welcome tour with TalkBack | Each step is announced once; Next and Skip reachable; focus returns |
| S11 | Large font | System font at maximum | Popover scrolls internally; buttons stay ≥ 44 px and on screen |
| S12 | CSS in a production build | `ng build`, install, start a tour | Popover styled (issue #530 history) |
| S13 | Swipe-back during a step | Edge-swipe on a pushed page with a step showing | No navigation, or tour ends cleanly |
| S14 | Tap-to-advance with a real finger | Tracker big button step | One tap counts once and advances once (no double count with the 120 ms guard) |

## 5. Integration notes for Angular 22

- Import the engine lazily: `const { driver } = await import('driver.js')` inside the adapter. Users who never start a tour never download it.
- Load `driver.js/dist/driver.css` through the app's global styles together with the theme partial. It is 1.9 KB gzipped; lazy-loading it is not worth a flash of unstyled popover. Confirm the exact Sass/`angular.json` form in Phase 0 (S12).
- Pin `"driver.js": "1.14.0"` with no range. Re-check the changelog's "Unreleased" section first: a focus-trap fix (PR #631) was merged after 1.14.0.
- Only `core/tour/driver-tour-renderer.ts` may import the package. An ESLint `no-restricted-imports` rule (or a simple unit test that greps) enforces it.

## 6. Verdict

Technically suitable behind an adapter, now on both desktop and device evidence, with these mandatory adapter behaviours: function resolvers scoped to the visible page, refresh on Ionic scroll, end on Ionic overlay, Back-button handling at priority 100, `overlayClickBehavior: 'none'`, `disableActiveInteraction: true` on blocked steps, and no use of `instruction` / `advanceOn`. The remaining device checks are listed in `phase-0-results.md` §4.
