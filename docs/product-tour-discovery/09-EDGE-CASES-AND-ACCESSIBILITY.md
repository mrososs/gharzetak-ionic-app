# 09 — Edge Cases, Failure Handling and Accessibility

Guiding rule: **a broken tour must cost the user nothing.** Every failure path ends with the tour gone, the screen usable, and at most one line in the local log.

## 1. Failure scenarios

| # | Scenario | Detection | Response | State written | User sees |
|---|---|---|---|---|---|
| 1 | Target element missing | Resolver returns null after the 2.5 s wait | `ifMissing: 'skip'` → next step; `'end'` → stop | `tour_target_missing`; if ended, `interrupted` | Nothing, or the tour quietly ends |
| 2 | Target exists but is hidden (cached page, `@if` false, `hidden`, zero size) | Resolver's visibility rules (`07` §5) | Same as 1 | Same | Same |
| 3 | Lazy page has not rendered | Target not yet registered | Wait (condition with deadline), then 1 | — | Step appears when the page is ready |
| 4 | User navigates away mid-tour | `NavigationStart` not requested by the tour | Stop before the transition | `interrupted` (reason `navigation`) | Tour disappears with the page |
| 5 | Android Back | Priority-100 back handler, active only during a tour | Stop; swallow the event | `skipped` (via `back`) | Tour closes; the page stays |
| 6 | App goes to background | `pause` / `visibilitychange` | 30 s grace, then stop; on quick return `refresh()` | `interrupted` (reason `background`) after 30 s | Tour still there after a quick switch; gone after a long one |
| 7 | App relocks (biometric) | `auth.locked()` or the privacy cover | Stop immediately | `interrupted` (reason `lock`) | Lock screen, nothing above it |
| 8 | Screen rotates | `resize` (engine refreshes); height check | Refresh; if height < 420 px, stop | `interrupted` if stopped | Re-aligned popover, or tour ends |
| 9 | Data loading fails or is slow | `store.loaded()` false | Gate stays closed: no offer | — | No tour yet |
| 10 | Network unavailable | Not relevant: the tour uses no network | Continue | — | Tour works offline |
| 11 | Soft keyboard appears | Capacitor Keyboard events / viewport shrink | Gate closes for offers; a running tour refreshes, and stops if height < 420 px | `interrupted` if stopped | — |
| 12 | Ionic modal, alert, action sheet, popover or loading opens | Ionic `…WillPresent` events + observer on `ion-app` | Stop **before** the overlay is interactive | `interrupted` (reason `overlay`) | The sheet or alert, fully usable |
| 13 | User logs out | `auth.scope()` changes | Stop; nothing is written to the old scope after the change | `interrupted` in the scope that was active | Onboarding screen |
| 14 | Guest becomes authenticated | Scope `guest → user:<id>` | Stop; adopt guest tour state into the account (`07` §7.2) | Guest record becomes the account's | No repeated offers |
| 15 | Feature availability changes (Khayoota mode flips) | `KhayootaService` signals | Re-text the open step; never show a control as usable that is not | — | Copy updates in place |
| 16 | Language changes | `i18n.lang()` | Re-text and re-label; direction follows `html[dir]` | — | Same step in the new language |
| 17 | App updates during an incomplete tour | On load, an `active` record is found | Rewrite to `interrupted`; if the saved step id no longer exists, resume starts at step 1 | `interrupted` | One "Resume" pill on the next visit |
| 18 | Engine throws | try/catch around every call and callback | Stop, clean the DOM manually, count the error; after two in a session disable automatic offers | `interrupted` (reason `error`) | Nothing |
| 19 | Selector breaks after a redesign | Same as 1; plus a unit test that every `TargetId` used by a definition has a matching `gzTour` in a template | Step skipped or tour ended | `tour_target_missing` | Shorter tour, never a stray popover |
| 20 | Engine chunk fails to load | Dynamic import rejects | `accept()` resolves without starting; offer stays | — | Tapping Start does nothing visible; a toast "Try again in a moment" |
| 21 | Celebration banner or card appears during a tracker tour | Presenter signals | Banner (2.4 s) and milestone card (6 s) are not overlays: call `refresh()`; piece-finished sheet and finale are overlays → scenario 12 | — | Celebration plays; tour continues or yields |
| 22 | Toast appears | — | Ignore: toasts render above the dimmer and are not interactive | — | Toast visible |
| 23 | Guest-import prompt pending after sign-in | Gate condition | No offer until it is answered | — | The import prompt only |
| 24 | App launched from a reminder notification | `NotificationRouter` navigation | No welcome offer in that session | — | The project she tapped |
| 25 | Tracker has unfinished work on arrival | Current project exists and has progress | Welcome is not auto-offered from the tracker; the card waits on Home | — | Her work |
| 26 | Target moves without a resize (list re-sorted, timer text ticking) | Engine's `ResizeObserver` covers size; position changes do not fire it | Tracker steps avoid elements that move; the scroll listener and a `refresh()` on store change during a tracker tour cover the rest | — | Highlight stays aligned |
| 27 | Two tours want to start | Coordinator holds one slot | The later request is dropped | — | One tour |
| 28 | User taps a Getting Started row for a screen whose tour precondition is unmet (tracker, no project) | `canRun` false | Navigate to New project instead; no pill | — | A sensible next screen |
| 29 | Design System page or any non-`/tabs` route | Gate | No offers, ever | — | — |
| 30 | Private mode / IndexedDB unavailable | `LocalDb` falls back to memory | State lasts for the session only; offers may repeat next launch | — | Possible repeat offer; acceptable |

### Stuck-overlay guarantee

After every `stop`, and again on every `NavigationEnd`, the coordinator asserts:

- no element with a class starting `driver-` exists,
- `document.body` has no `driver-active` class,
- the back-button handler and the scroll listener are removed.

If any assertion fails, it removes the leftovers itself and records an `error`. This is the single most important safety property and has its own tests (`10`).

## 2. Accessibility

### 2.1 What the engine provides (1.14.0, from source)

- Popover: `role="dialog"`, `aria-labelledby`, `aria-describedby`; no `aria-modal`.
- Focus moves to the Next button; focus returns to the previously focused element on close when focus is still on the popover or body.
- A polite live region announces step text when focus is not moved.
- Escape closes; Tab is trapped within popover + highlighted element; arrow keys change step.
- Buttons are real `<button type="button">`; the close button has a configurable accessible name.
- Limits: the Tab trap does not see focusable elements inside shadow roots; arrow keys are not mirrored in RTL; the main animation ignores reduced-motion; nothing outside the popover is hidden from assistive technology.

### 2.2 What the adapter adds

| Need | Addition |
|---|---|
| Spoken progress | Dialog label becomes "Title — Step N of M" (dots are `aria-hidden`) |
| Close name | `closeBtnLabel` set from `tour.close` in the current language |
| Reading order | DOM order is title, body, instruction, Skip, Back, Next: the same order a sighted user reads |
| Blocked steps | `aria-modal="true"` on the popover, so a screen reader stays in the dialog. The step text already says what the highlighted control is. |
| Action step | `aria-modal` not set; the highlighted control must be reachable. The instruction text is part of the description. Next remains available, so nobody is forced to perform a gesture. |
| RTL keys | Arrow keys swapped when `dir="rtl"` |
| Reduced motion | `animate: false` from the media query or the user's in-app setting |
| Focus restoration | After `stop`, if focus is on `body`, move it to the element that had focus before the tour, or to the page's first heading |
| Touch targets | Every tour control ≥ 44×44 px with ≥ 8 px between Next and Back |
| Large text | Popover scrolls internally; buttons wrap to a second row rather than shrink |
| High contrast | Tokens pass 4.5:1 (`08` §1); focus ring is the app's 3 px primary outline |
| No surprise keyboard | No step moves focus into an input |
| No trap | Escape, ×, Skip and Android Back always work; no step disables closing |

### 2.3 Screen-reader behaviour to verify on the phone (TalkBack)

1. Starting a tour moves TalkBack focus to the dialog and reads title, then body, once.
2. Next reads the following step once; no double announcement from the live region.
3. On blocked steps, swiping does not land on app content behind the dimmer.
4. On the action step, the big button is reachable and double-tap activates it; the tour then advances and announces the next step.
5. Closing returns focus to a sensible place and announces nothing extra.
6. The Getting Started card reads as a list of 5 items with done / not done state (`aria-checked` or text), and "Hide" is reachable.
7. The pill is announced politely (`role="status"`) once when it appears and does not steal focus.

Known weak spot to test first: because the engine does not hide the rest of the page, item 3 depends on `aria-modal` being honoured by TalkBack in the WebView. If it is not, the fallback is to set `aria-hidden="true"` on `ion-router-outlet` for blocked steps only when the target is the tab bar or outside the outlet; for targets inside the outlet, accept that background content is reachable and rely on focus placement.

### 2.4 User control

| Principle | How it is met |
|---|---|
| Optional | Every tour starts from a tap. No screen is blocked until a tour is finished. |
| Leaves no trace on work | Tours do not edit forms, do not navigate, and (except one invited tap) do not act |
| Easy exit | Four ways out on every step |
| No nagging | Hard limits on offers (`03` §4.4) |
| Reversible | The invited tap is followed by Undo; "Hide" on the list is reversible from Settings |
| Respect for attention | No tour during a counting session unless asked for; no tour over a celebration, permission prompt or alert |
| Predictable | Same controls in the same places on every step and in both languages |

## 3. Privacy and safety notes

- Tour state and the event buffer stay on the device, per scope. Nothing is sent anywhere in v1.
- No step requests a permission or leads to one.
- The Khayoota tour performs no request and cannot trigger consent.
- Tour copy never includes user content, so nothing private can end up in a popover, a log line or a screenshot of the tour.
- The Design System page's demo-data button is unrelated and is not referenced by any tour.
