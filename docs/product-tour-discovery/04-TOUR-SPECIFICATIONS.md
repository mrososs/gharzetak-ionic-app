# 04 — Tour Specifications

Step-level specification for every recommended tour. Copy is in `05`; this file references it by step id.

## 0. Conventions that apply to every step

| Item | Rule |
|---|---|
| Step id | `<tourId>.<slug>`; never renumbered, so analytics and saved progress survive reordering |
| Selector strategy | A `gzTour` directive on the element registers it under its id and writes `data-tour="<id>"`. The engine receives a **function** that asks the registry for the element on the visible page. No CSS selector strings. |
| Target is "ready" | Registered, connected, inside an `.ion-page` without `.ion-page-hidden`, non-zero box, same rectangle on two consecutive frames |
| Wait | Up to 2500 ms for a target on the current page; then the fallback |
| Interaction | Highlighted element is **not** tappable unless the step says "Action". The adapter sets `disableActiveInteraction: true` on every blocked step: by default the highlighted element is live, and tapping a highlighted tab navigated away with the tour still showing (Phase 0, F2). |
| Dimmed area | Taps ignored: `overlayClickBehavior: 'none'`. By default a tap on the dimmer closes the tour (Phase 0, F1). |
| Popover position | `auto` = below if it fits, else above. Only `top` / `bottom` are specified; `left` / `right` are never used, because the library treats them physically and the app is bidirectional. Alignment is `start` / `center` / `end` and is mirrored by the adapter in RTL. |
| Stage | Padding 6 px, radius 20 px, unless noted |
| Focus | Moves to the popover's Next button; returns to the previously focused element on close |
| Screen reader | Popover is a labelled dialog; step text is announced once; progress is spoken as "Step N of M" |
| Navigation | None inside a tour. Every tour here is single-screen. |
| Common test set (**C**) | (1) target resolves on a fresh page and after returning to a cached page; (2) cut-out rectangle equals target rectangle ± padding; (3) popover fully inside the viewport at 320×568, 360×800, 412×915; (4) correct in `rtl` and `ltr`; (5) Back / Next / Skip / Close behave per `03` §5; (6) no `driver-*` node or class remains after exit |

Start conditions for every tour: the quiet gate in `03` §3.

---

## 1. `welcome` — version 1 — Home — 6 steps — P0

| | |
|---|---|
| Route | `/tabs/home` (exact; not a nested Home page) |
| Component | `HomePage` (`features/home/home.page.ts`), tab bar from `TabsLayout` |
| Entry | "Start the tour" in the Getting Started card; Settings → App tour |
| Before step 1 | If the router is not exactly on `/tabs/home`, `NavController.navigateRoot('/tabs/home')` first (a tab-button tap returns to the tab's last nested page, not its root) |
| Preconditions | Tab bar visible |
| On finish | Toast `welcome.done`; card switches to the list |

| # | Step id | Target (`data-tour`) | Element | Position | Interaction | Next when | Expected UI state | If missing | Accessibility | Tests |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `welcome.patterns` | `home.patterns-tile` | Quick tile "Pattern reader", `home.page.ts:89` | top, center | Blocked | Next | Quick access grid rendered; page scrolls the tile into view if a hero photo pushed it down | Skip step | Tile's visible label is its accessible name | C; with and without a current project (hero height differs) |
| 2 | `welcome.projects` | `tab.projects` | `ion-tab-button`, `tabs.layout.ts:30` | top, center | Blocked | Next | Tab bar visible | End tour (`interrupted`) | Host element, not shadow internals | C; cut-out inside the bottom safe area |
| 3 | `welcome.tracker` | `tab.tracker` | Floating centre tab button | top, center | Blocked | Next | Same | End tour | Stage radius 24 to suit the round button | C; the raised circle is not clipped by the cut-out |
| 4 | `welcome.learn` | `tab.learn` | Tab button | top, center | Blocked | Next | Same | End tour | — | C |
| 5 | `welcome.khayoota` | `tab.assistant` | Tab button | top, end | Blocked | Next | Same | End tour | Copy makes no AI claim | C |
| 6 | `welcome.settings` | `home.avatar` | `button.gz-avatar-btn`, `home.page.ts:35` | bottom, start | Blocked | Done | Page scrolled back to the top | Skip step | The button's `aria-label` is "Settings" | C; scroll returns to top from step 1 |

Notes:

- Steps 2–5 need no scrolling and no navigation: the tab bar is always on screen on Home.
- Reading order in Arabic runs right to left across the tab bar, which matches the step order.
- The hero card, bell, heart, tools card and store teaser are intentionally not steps.

---

## 2. `patterns` — version 1 — Pattern library — 3 steps — P0

| | |
|---|---|
| Route | `/tabs/home/patterns` |
| Component | `PatternLibraryPage` |
| Entry | Pill on first visit; Settings → Patterns tour |
| Preconditions | Search box empty and type filter on "All" (so the sample rows are visible). If the user has filtered, the pill waits for the next visit. |

| # | Step id | Target | Element | Position | Interaction | Next when | Expected UI state | If missing | Accessibility | Tests |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `patterns.sample` | `patterns.sample-row` | First row with `isSample`, `pattern-library.page.ts:61` | bottom, center | Blocked | Next | List rendered; row has a "Sample" badge | Skip step | Row's accessible name is the pattern name | C; with 0 and with many user patterns above/below the samples |
| 2 | `patterns.kinds` | `patterns.kind-filter` | `div[role=tablist]`, `:47` | bottom, start | Blocked | Next | Three chips | Skip step | — | C |
| 3 | `patterns.add` | `patterns.add` | Header `button.gz-icb.pur`, `:38` | bottom, end | Blocked | Done | Header fixed | End tour | Button has an `aria-label` | C |

Notes:

- The bottom "Add pattern" button is not used: it moves as the list grows.
- The add sheet is not opened by the tour.
- "Multi-part" is the word the UI uses; the copy never says "collection".

---

## 3. `pattern-reader` — version 1 — Pattern reader — 3 steps — P0

| | |
|---|---|
| Route | `/tabs/home/patterns/:id` |
| Component | `PatternReaderPage` |
| Entry | Pill on first visit to any pattern that has text; Settings does not list it separately (it follows the Patterns tour) |
| Preconditions | `pat.text` present and at least one round parsed. Not offered on a file-only (PDF/image) pattern. |
| Milestone | Entering this page records `patternOpened` for the Getting Started list, with or without the tour |

| # | Step id | Target | Element | Position | Interaction | Next when | Expected UI state | If missing | Accessibility | Tests |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `reader.read` | `reader.focus-card` | `div.gz-card.focus`, `pattern-reader.page.ts:74` | bottom, center | Blocked | Next | Current round shown (the first sample opens on round 5) | End tour | Stitch code is left-to-right inside Arabic; unchanged | C |
| 2 | `reader.move` | `reader.next-round` | Next-round button, `:88` | top, center | Blocked | Next | Not on the last round | Skip step | — | C |
| 3 | `reader.track` | `reader.track` | "Track with this pattern", `:96` | top, center | Blocked | Done | Scrolls into view below the card | Skip step | — | C; both copy variants: user has / has no unfinished project |

Notes:

- Step 3 has two copy variants because the "Link to a project" row is silently empty when the user has no projects. The variant is chosen from `store.projects()` at the time the step is shown.
- The tour does not tap "Track" or link anything: linking resets that project's position to round 1.

---

## 4. `tracker-simple` — version 1 — Tracker, simple counter — 4 steps — P0

| | |
|---|---|
| Route | `/tabs/tracker` |
| Component | `TrackerPage` (`tracker.page.html`) |
| Entry | Pill on first visit with a current project in simple mode; Settings → Tracker tour |
| Preconditions | `store.currentProject()` exists, mode is `simple`, not on the final round (`sm.last` false), no celebration banner showing |
| Never offered | In the "No active project" empty state (its single button is enough) |

| # | Step id | Target | Element | Position | Interaction | Next when | Expected UI state | If missing | Accessibility | Tests |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `tracker.read` | `tracker.ring` | `gz-ring`, `tracker.page.html:54` | bottom, center | Blocked | Next | Ring shows round label, count and target | End tour | Numbers stay left-to-right | C |
| 2 | `tracker.tap` | `tracker.tap` | `button.gz-bigbtn`, `:70` | top, center | **Action**: the button is tappable | Next, **or** one tap on the button | Button enabled, label `+N` | End tour | Focus stays on the popover; instruction line is part of the dialog description | C; one tap → count +1 exactly once and the tour advances once; Next without tapping also advances; the tap is saved (reload shows it) |
| 3 | `tracker.undo` | `tracker.undo` | First `button.gz-icb.lg`, `:69` | top, end | Blocked | Next | — | Skip step | `aria-label` "Undo" | C |
| 4 | `tracker.resume` | `tracker.project-picker` | Header picker button, `:3` | bottom, start | Blocked | Done | Header fixed | Skip step | — | C |

Action-step details:

- **Verified on the phone (Phase 0, F3):** the library's `popover.instruction` and `advanceOn` make Next inert. So this step uses neither. The adapter attaches its own click listener to the target, calls `moveNext()` one frame after the tap, and renders the hint line itself. A real tap counted once and advanced once; Next also advances with no tap.
- If the tap completes the round (count reaches the target), the app's own "round complete" note and possibly a celebration banner appear. That is real feedback; the tour moves on to Undo as usual. If a piece-finished sheet or the finale opens, the overlay rule ends the tour.
- Undo is highlighted but not tappable: the user decides whether to keep her stitch.
- The tap is one of the two actions that can tick the Getting Started task "Try the tracker".

---

## 5. `tracker-pattern` — version 1 — Tracker, pattern mode — 5 steps — P0

| | |
|---|---|
| Entry | Pill on first visit with a current project in pattern mode and a usable pattern (`pt()` present) |
| Preconditions | Not the multi-part fallback card, not the "link a pattern" card |

| # | Step id | Target | Element | Position | Interaction | Next when | Expected UI state | If missing | Accessibility | Tests |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `tracker.rounds` | `tracker.round-pills` | Pill strip, `:88` | bottom, center | Blocked | Next | Current pill carries `aria-current="step"` | End tour | — | C; strip scrolled horizontally to the current pill |
| 2 | `tracker.instruction` | `tracker.instruction` | Instruction card, `:93` | bottom, center | Blocked | Next | Stitch code and check badge visible | End tour | — | C |
| 3 | `tracker.step` | `tracker.current-step` | Current-step card, `:116` | top, center | Blocked | Next | Round not complete | **Skip step** (absent when the round is complete) | — | C; skipped correctly on a completed round |
| 4 | `tracker.countby` | `tracker.count-by` | Segment, `:127` | top, center | Blocked | Next | Three options | Skip step | — | C |
| 5 | `tracker.count` | `tracker.tap-row` | Row with undo, big button, reset, `:133` | top, center | Blocked | Done | Scrolled into view (it is the last block of a long page) | End tour | — | C at 320×568 |

No action step here: with "whole round" counting a single tap completes a round.

---

## 6. `tracker-parts` — version 1 — Tracker, multi-part project — 2 steps — P1

| | |
|---|---|
| Entry | Pill on first visit with a project created from a multi-part pattern, after `tracker-pattern` or `tracker-simple` has been handled (never two pills at once) |
| Preconditions | `inst()` present |

| # | Step id | Target | Element | Position | Interaction | Next when | If missing | Tests |
|---|---|---|---|---|---|---|---|---|
| 1 | `tracker.pieces` | `tracker.piece-tabs` | Piece switcher, `:36` | bottom, center | Blocked | Next | End tour | C; long piece lists (horizontal scroll) |
| 2 | `tracker.whole` | `tracker.completion` | Completion line, `:25` | bottom, center | Blocked | Done | Skip step | C |

---

## 7. `project-create` — version 1 — New project — 2 steps — P1

| | |
|---|---|
| Route | `/tabs/projects/new` |
| Component | `NewProjectPage` |
| Entry | Pill on first visit |
| Special conditions | The tab bar is hidden on this route. The page has an unsaved-changes guard. The form resets on every entry. |
| Not offered | When the page was opened with `?collection=` (the user is already starting from a pattern) |

| # | Step id | Target | Element | Position | Interaction | Next when | Expected UI state | If missing | Accessibility | Tests |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `project.name` | `project-new.name` | `div.gz-in` around `#np-name`, `new-project.page.ts:36` | bottom, start | Blocked | Next | Field empty; keyboard closed | End tour | Focus goes to the popover, not the input, so the keyboard stays closed | C; keyboard does not open |
| 2 | `project.source` | `project-new.source` | "Start from a saved pattern" block, `:44` | bottom, center | Blocked | Done | "None" plus at least the two sample chips | Skip step | — | C |

The tour leaves the form untouched, so the unsaved-changes alert cannot be caused by it.

---

## 8. `khayoota` — version 1 — Khayoota — 3 steps — P1 — highlight only

| | |
|---|---|
| Route | `/tabs/assistant` |
| Component | `AssistantPage` |
| Entry | Pill on first visit; Settings → Khayoota tour |
| Preconditions | Server status has settled (the page shows `rules` until `/status` answers; wait until the status signal is non-null, or the user is a guest, or 2 s have passed), no message is being sent, composer empty, photo tray empty |
| Hard rules | No step is an action step. The tour never taps a chip, "Explain round", Send, the camera, or "Agree". It never opens the consent sheet. It makes no network request. |

| # | Step id | Target | Element | Position | Interaction | Next when | Copy variant | If missing | Tests |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `khayoota.status` | `khayoota.status` | `button.kh-status`, `assistant.page.ts:189` | top, center | Blocked | Next | By the element's `data-mode`: `ai`, `consent`, `soon`, or `rules`/`offline`/`demo` | End tour | C; each mode shows its own copy; copy updates if the mode changes while the step is open |
| 2 | `khayoota.ask` | `khayoota.composer` | `div.kh-composer`, `:169` | top, center | Blocked | Next | — | End tour | C; zero requests to the AI endpoint during the whole tour |
| 3 | `khayoota.controls` | `khayoota.menu` | Options button, `:68` | bottom, end | Blocked | Done | Testers (`ai`/`consent`): mentions turning AI off. Others: clear chat and status only. | Skip step | C |

Photo analysis and reading a pattern from a photo are **not** mentioned in any mode except inside the `ai` variant of step 1, and there only as "can be wrong".

---

## 9. Later tours (outline only, P2)

| Tour | Screen | Steps | Trigger | Key constraint |
|---|---|---|---|---|
| `smart-paste` | Smart paste | 2: status badges; Confirm button | After the first successful Convert | Result DOM exists only after Convert; Confirm is at the bottom of a long page; copy must say that nothing is saved yet and that needs-review lines must be checked |
| `add-pattern` hint | Add pattern | 1: "Fill an example" | First visit, text source | Keyboard; never claim PDF or image import reads the file |
| `collection-editor` hint | Multi-part editor | 1: "Add a part" | First visit | Explains part vs piece and quantity |
| `project-detail` hint | Project detail | 1: "Resume project" | First visit | Low value; only if data shows users stall here |

## 10. Getting Started card (not an engine tour)

| | |
|---|---|
| Location | Home, directly under the hero card, above "My tools" |
| Component | New `gz-getting-started`; target id `home.getting-started` |
| States | A: welcome offer · B: list with progress · C: all done (one session) · hidden |
| Engine | None. Plain Angular; the tour engine is not loaded for it. |
| Tests | State from each combination of tour records and task signals; Hide persists; reappears from Settings; never rendered for seeded-established users; RTL and LTR; rows are ≥ 44 px |

## 11. Offer pill (not an engine tour)

| | |
|---|---|
| Location | Top of the page content, below the header, in normal flow (it pushes content down; it does not cover it) |
| Content | Text + "Start" + close |
| Behaviour | Appears once the quiet gate passes; disappears on Start, close, first interaction with the page within 1.5 s, or leaving the page |
| Tests | Never two pills; never with an overlay; counts visits correctly; `declined` after two |
