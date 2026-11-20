# 00 — Executive Recommendation

Discovery only. No application code, backend, flags or dependencies were changed. Baseline: `origin/test` at `c3ca6a3` (2026-11-19).

## The recommendation in one paragraph

Use **Driver.js 1.14.0, pinned exactly, as the drawing layer only** (dimmed overlay, cut-out, popover, waiting for elements, tap-to-advance steps). Put everything that makes a tour *right for Gharzetak* in app-owned code: who is eligible, when it is safe to show, where state is stored, how targets are found on Ionic's cached pages, the Getting Started list, and replay. Ship a **6-step welcome tour that stays on Home**, short per-screen tours that are **offered, never forced**, and a **5-item Getting Started card** on Home that is ticked by real actions. Keep every tour on a single screen in v1; the Getting Started card is what carries the user from Pattern to Project to Tracker.

## Is Driver.js suitable?

Yes, with a wrapper. This was tested, not assumed: the library was loaded into the running app (local dev build, guest mode, 375×812) and driven against the real Ionic DOM. Details and limits of that test are in `06`.

| Question | Result | How we know |
|---|---|---|
| Can it highlight Ionic elements (tab buttons, content inside `ion-content`)? | Yes | Probe: cut-out matched the target rectangle on a tab button and on Home content |
| Does it scroll a target into view inside `ion-content`? | Yes | Probe: inner scroller moved 0 → 398 px; cut-out matched |
| Does the highlight follow when `ion-content` scrolls afterwards? | **No**, until `refresh()` is called | Probe: target moved 80 px, cut-out did not; `refresh()` fixed it |
| Does it wait for a lazy-loaded page and continue? | Yes | Probe: step waited, Projects page loaded, step highlighted |
| Can a step advance when the user taps the real control? | Yes | Probe: tapping the tracker's big button counted 0 → 1 and advanced the tour |
| Does it work in Arabic RTL? | Layout mirrors correctly; the close button needs one CSS rule; the library has no RTL code | Probe + source |
| Does a plain CSS selector find the right element? | **No**: it matched a button on a hidden cached page | Probe: `.gz-btn` resolved to the hidden Home page, size 0×0 |
| What if an Ionic sheet or alert opens during a tour? | The sheet appears above the dimmer but **cannot be tapped** | Probe: `ion-modal` z-index 20007 vs overlay 10000, `pointer-events: none` on the modal |
| Does it clean up? | Yes | Probe: no leftover nodes, classes or attributes after `destroy()` |
| Persistence, routing, eligibility, Android Back | Not provided | Docs + source; these are ours to build |

Things the library offers that we should **not** use: its checklist widget (a floating corner panel that stores nothing; ours belongs inside Home as a card) and string selectors.

## Main risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Library churn.** Ten releases in six weeks; 1.14.0 is seven days old; the repository changed owner name. | Medium | Pin the exact version; one adapter file imports it; re-read the changelog in Phase 0; a second engine can replace it behind the same interface. |
| 2 | **A tour traps the user** behind an unclickable Ionic alert or sheet (for example the guest-import prompt). | High if unhandled | Never start while any overlay is open; end the tour the moment one appears. |
| 3 | **Wrong element highlighted** from a cached, hidden page. | High if unhandled | No string selectors. Targets register themselves through a directive and are resolved only on the visible page. |
| 4 | **Highlight drifts** when the page scrolls. | Medium | Adapter calls `refresh()` on the active page's scroll events. |
| 5 | **A tour tap changes real data.** Every tracker tap is saved and can unlock a permanent achievement. | Medium | Only one step in v1 invites a tap, in simple-counter mode, where one tap is +1 stitch and Undo is the very next step. |
| 6 | **Tour annoys returning users** (reinstall, new device, users from before the feature). | Medium | Tours are armed by an entry event and suppressed by evidence of prior use; see `03`. |
| 7 | **Khayoota copy over-promises.** Real AI is tester-only on staging; the tab is visible to all. | Medium | Highlight only, never click; copy is chosen from the screen's own status. |
| 8 | **No device test yet.** The HONOR phone was not connected during discovery. | Open | Phase 0 runs the same probe on the phone before any feature code is merged. |
| 9 | **No analytics exist** to measure the result. | Medium | Local, content-free event log first; a later endpoint is a separate decision. |

## Alternative worth knowing about

`ngx-ui-tour-ionic` 10.0.0 (MIT) declares peer dependencies on exactly Angular 22 and Ionic 9 and has route and scroll-container options built in. It was not tested hands-on. It is the fallback if Phase 0 on the phone fails. Shepherd.js and Intro.js are AGPL or commercial and are ruled out on licence.

Why Driver.js still comes first: tap-to-advance steps and wait-for-element were proven on the real tracker and tab bar, it has no dependencies, about 15 KB gzipped loaded only when a tour starts, and the wrapper removes the lock-in.

## What ships first (v1)

1. Tour foundation: coordinator, state, target directive, adapter, theme.
2. Getting Started card on Home, which also carries the welcome offer.
3. Welcome tour (6 steps, Home only).
4. Tracker tours (simple 4 steps, pattern 5 steps).
5. Patterns tour (3 steps) and Pattern reader tour (3 steps).
6. Settings → "Tours & help" for replay.

Deferred: New-project tour, Khayoota tour, multi-part tracker tour, Smart paste and multi-part editor guidance, a practice counter, cross-device tour state, a metrics endpoint.

## Decisions needed from you

| # | Decision | Recommended |
|---|---|---|
| 1 | Does the welcome tour start by itself, or is it offered in the Home card and started by a tap? | **Offered.** A new account has already passed 4 slides, a form and 4 setup steps. |
| 2 | Arabic voice: keep the app's Egyptian colloquial, or write a neutral variant for Gulf users? | Keep the app's voice in v1; copy is structured so a second variant can be added. |
| 3 | May the tracker tour invite one real tap? | Yes, simple mode only. |
| 4 | Add Playwright as a dev dependency for tour tests? | Yes, in Phase 6. The repo has no browser-level tests today. |
