# 12 — Final Product Tour Blueprint

One page of decisions, then the twenty required answers. Each line points to the document that justifies it.

## Part A — The blueprint

### A1. Model

| Layer | What | Where | Starts when |
|---|---|---|---|
| Existing | 4 onboarding slides, 4 setup steps | Before / at entry | Unchanged |
| Offer | Getting Started card, state A | Home, under the hero | A new user reaches a quiet Home |
| A — Welcome tour | 6 steps, all on Home | Home | She taps "Start the tour" |
| D — Getting Started list | 5 real tasks | Same card, state B | After the offer is answered |
| B — Feature tours | 2–5 steps each, one screen each | Patterns, Reader, Tracker (v1); New project, multi-part, Khayoota (next) | She taps "Start" on a pill shown on her first visit |
| C — Guided action | One invited tap | Tracker, simple mode | Inside the tracker tour |
| Help | Tours & help | Settings | Any time |

### A2. Engine and architecture

| Decision | Choice | Ref |
|---|---|---|
| Engine | Driver.js, exact version pinned (1.14.0 at time of writing), lazy-loaded | `06` |
| Boundary | One adapter class behind a `TourRenderer` interface | `07` §1, §3 |
| Targets | `[gzTour]` directive + registry; resolved on the visible Ionic page only; never CSS selector strings | `07` §5 |
| Definitions | One typed file per tour under `core/tour/definitions/` | `07` §2–3 |
| Public API | `TourCoordinator` only | `07` §3 |
| Mandatory adapter behaviours | Refresh on Ionic scroll · end on Ionic overlay · Android Back closes · RTL alignment mirroring · reduced-motion switch · DOM-clean assertion | `06` §3, `07` §8 |
| Multi-page | Not used in v1; supported by contract for later | `07` §6 |
| Checklist | App-native Angular component, not the engine's widget | `04` §10 |

### A3. State

| Decision | Choice | Ref |
|---|---|---|
| Store | `ScopeDocs.prefs.tour` in IndexedDB: per guest and per account, device-local, not synced | `07` §7 |
| Backend change | None | `07` §7.1 |
| Statuses | `not_started`, `offered`, `active`, `completed`, `skipped`, `declined`, `interrupted`, `not_needed` | `07` §4 |
| New-user rule | Armed by entry event (guest start, sign-up, new Google account, fresh-account check); cancelled by evidence of prior use | `03` §4 |
| Guest → account | Account adopts the guest's tour state once | `07` §7.2 |
| Account switch | No adoption; each account stands alone | `07` §7.2 |
| Offer limits | Welcome: 3 launches. Pill: 2 visits. One offer at a time. One tour per launch. | `03` §4.4 |
| Versions | Per-tour integer; re-offer only with `announceOnBump` | `07` §7.4 |

### A4. Tours in v1

| Tour | Screen | Steps | Targets |
|---|---|---|---|
| `welcome` | Home | 6 | Patterns tile · Projects tab · Tracker tab · Learn tab · Khayoota tab · Avatar (settings) |
| `patterns` | Pattern library | 3 | Sample row · type filter · add |
| `pattern-reader` | Pattern reader | 3 | Reading card · next round · track |
| `tracker-simple` | Tracker | 4 | Ring · big button (invited tap) · undo · project picker |
| `tracker-pattern` | Tracker | 5 | Round pills · instruction · current step · count-by · tap row |

Next: `project-create` (2), `tracker-parts` (2), `khayoota` (3). Full specs in `04`, copy in `05`.

### A5. Design

Plum dimmer at 58%, white 24 px-radius popover in Playpen Sans, dots for progress, filled purple Next, lavender Back, text Skip, 44 px targets, logical properties for RTL. Tokens only. `08`.

### A6. Safety rules that are not negotiable

1. No tour above splash, auth, OAuth, setup, lock screen, loading, a permission prompt, an alert or a sheet.
2. No stuck overlay: asserted after every exit.
3. No AI request, no consent prompt, no permission request, no purchase, no navigation caused by a tour.
4. No data created for the user. One invited tap, on her own project, with Undo next.
5. No claim the product cannot keep: not AI for everyone, not photo reading, not perfect import.
6. No user content in tour text or tour events.

### A7. Changes to existing code (v1)

One dependency, one stylesheet, one optional key in local prefs, three `arm()` calls, two milestone marks, 21 target ids across 5 templates, one card on Home, one pill on three screens, one Settings section. No backend. `07` §11.

---

## Part B — The twenty answers

**1. Is Driver.js the right solution for Gharzetak?**
Yes, as the drawing layer behind an app-owned wrapper, and conditionally on a device run. It highlighted Ionic hosts, scrolled inside `ion-content`, waited for a lazy page and advanced on a real tap in a live probe against the app. It does not provide persistence, routing, eligibility, RTL or Ionic awareness; those are built around it. It is MIT, dependency-free and about 15 KB gzipped, loaded only when a tour starts. Its release pace is very fast (1.14.0 is a week old), so the version is pinned and isolated. `ngx-ui-tour-ionic` is the fallback.

**2. What are the Ionic/Angular compatibility risks?**
Five were found and each has a fix: (a) plain selectors match elements on hidden cached pages; (b) the highlight does not follow `ion-content` scrolling until `refresh()` is called; (c) an Ionic sheet or alert opened during a tour appears above the dimmer but cannot be tapped; (d) no RTL code (one CSS rule and alignment mirroring are enough); (e) no Android Back handling. Confirmed on the device, with defaults to override: tapping the dimmer closes the tour, the highlighted element stays live, `instruction` / `advanceOn` make Next inert, default buttons are 23 px tall. Lesser ones: the focus trap ignores shadow roots, the animation ignores reduced-motion, text is injected as HTML, and a tab-button tap returns to a nested page rather than the tab root. Still untested: rotation, TalkBack, largest font, swipe-back.

**3. What should the first welcome tour contain?**
Six steps on Home, none requiring navigation: the Patterns tile, then the Projects, Tracker, Learn and Khayoota tabs, then the avatar that opens Settings and replay. The Patterns tile and the avatar are included because they are the two entry points with no visible label that says what they are.

**4. Which screens deserve their own tours?**
v1: Pattern library, Pattern reader, Tracker (separate tours for the simple and pattern layouts). Next: New project, multi-part tracker, Khayoota. Later, after first use: Smart paste.

**5. Which screens should NOT have a tour?**
Onboarding, auth, setup, lock screen, Design System (never). Projects list, Learn, Terminology, Achievements, multi-part pattern detail and Settings rows (clear enough). Video detail (the code forbids covering the video). Store (not a feature yet). Inside any sheet (v1). Khayoota's chips, camera and "Explain round" (they act immediately).

**6. How many steps should each tour contain?**
Welcome 6 · Patterns 3 · Reader 3 · Tracker simple 4 · Tracker pattern 5 · Multi-part 2 · New project 2 · Khayoota 3. Hard ceiling 6.

**7. Which interactions should users perform themselves?**
Inside a tour: one tap on the tracker's big button in simple mode, invited and optional. Through the Getting Started list: open a sample pattern, create a project, count, open a tutorial, ask Khayoota a question. Never automated or invited by a tour: anything in Khayoota, linking or switching that resets progress, pattern-mode taps, permissions, sign-in.

**8. How should multi-page tours work?**
In v1 they do not exist; every tour is one screen, and the Getting Started list is the cross-screen thread. The coordinator's contract already covers the future case: stop the highlight, navigate with `NavController`, wait for `NavigationEnd` and for the target to be registered and still on the visible page, all under one abortable deadline, then continue. No fixed delays.

**9. How should the app distinguish guests and new accounts?**
By data scope (`guest` vs `user:<id>`), which the app already has, plus an arming event at the moment someone starts as a guest or creates an account. A plain sign-in does not arm; it is treated as a returning user unless the account is demonstrably fresh (not onboarded, no data, recently created). Evidence of earlier use in the scope cancels the offer. A guest who creates an account carries her tour state with her.

**10. How should completion and skipping be persisted?**
In the scope's local preferences (`ScopeDocs.prefs.tour`), one record per tour with version, status, last step, offer and interruption counts and a timestamp. `completed` and `skipped` are different states and both stop automatic offers. `interrupted` (the app ended it) is different again and earns exactly one "Resume" offer. No backend change.

**11. How do we prevent repeated or annoying tours?**
Nothing dims the screen without a tap. One offer at a time, one tour per launch. Offers expire by themselves (welcome after 3 launches, pills after 2 visits). Terminal states never re-offer. Version bumps do not re-offer unless a definition explicitly says so. Returning and pre-existing users are seeded as "not needed" from their own data. Tours yield instantly to anything the app needs to show.

**12. Where can users replay a tour?**
Settings → Tours & help, next to the existing "Replay app intro": App tour, Tracker tour, Patterns tour, Khayoota tour, and a row to bring back the Getting Started list. The welcome tour's last step tells her this.

**13. What should the Getting Started Checklist contain?**
Five tasks, each ticked only by the real action: Explore a sample pattern · Create your first project · Try the tracker · Open a tutorial · Ask Khayoota a question. It lives as a card on Home, can be hidden with one tap, disappears when complete, and is not shown to established users.

**14. How will the UI look in Arabic and English?**
See `concepts/`. A white rounded popover in the app's Playpen Sans over a plum dimmer; progress dots; a filled purple Next, lavender Back and text Skip. In Arabic the text is right-aligned, the dots start on the right, Next is on the left and × is at the top-left; English mirrors all of it. Switching language in Settings changes the next step without a reload.

**15. What stable selectors or component changes are required?**
None exist today apart from Ionic's tab-button ids. v1 adds a `gzTour` attribute for 21 target ids in 5 templates (tabs layout, Home, pattern library, pattern reader, tracker), and the Home quick-tile list gets an optional `tour` key so the Patterns tile can be marked. The later New-project tour needs one extra wrapper element around its "Start from a saved pattern" block. New components: the Getting Started card, the offer pill, the directive. Full list in `02` §4 and `07` §11.

**16. What are the most important automated tests?**
(1) No stuck overlay after any exit path. (2) The eligibility table for the twelve user scenarios. (3) State transitions, especially skipped vs interrupted vs completed. (4) Target resolution ignores hidden cached pages. (5) A tour ends when an Ionic overlay opens or navigation starts. (6) The tracker action step counts exactly once. (7) The Khayoota tour makes zero AI requests. (8) Every target id used by a tour exists in a template.

**17. How will it behave on the real HONOR phone?**
Tested in Phase 0 on the phone (Android 16, WebView 157, isolated QA build): alignment, RTL and Arabic rendering, scroll-into-view, scroll-follow (needs the refresh hook), hidden-page resolution, ending on an Ionic overlay, hardware Back, background return, safe areas with immersive mode on, the keyboard, a real finger tap on the tracker (one tap, one count, one advance) and the production CSS all passed. Not yet verified: rotation, TalkBack, largest font, swipe-back, long background with biometric relock. Details in `phase-0-results.md`.

**18. What should be implemented in v1?**
Phase 0 (device spike), Phase 1 (foundation with all guards), Phase 2 (welcome tour and Getting Started card), Phase 3 (tracker simple and pattern, pattern library, pattern reader, pills), the Settings "Tours & help" section, and Phase 6 (tests, accessibility, device pass).

**19. What should be deferred?**
New-project, multi-part tracker and Khayoota tours; Smart paste and editor guidance; a practice counter; cross-device tour state; a remote metrics endpoint and the A/B comparison; tours inside sheets; a neutral-Arabic copy variant.

**20. What are the exact implementation phases?**

| Phase | Content | Size |
|---|---|---|
| 0 | Device spike: 14 checks on the phone, pin the engine version | S |
| 1 | Foundation: contracts, state, eligibility, gate, target registry, coordinator and guards, adapter, theme, local event log | L |
| 2 | Welcome tour + Getting Started card + arming | M |
| 3 | Tracker (2 tours), Patterns, Reader, offer pill | M–L |
| 4 | New project, multi-part tracker, Khayoota | M |
| 5 | List completion, replay rows, QA event viewer, copy review | S–M |
| 6 | Playwright, accessibility, full device checklist (overlaps 3–5, gates release) | M–L |

Details, files, acceptance and rollback for each: `11`.

---

## Part C — What to do next

1. Answer the four decisions in `00`.
2. Phase 0 has run ([results](phase-0-results.md)); decide whether the four open checks are done now or in Phase 6.
3. Start Phase 1 on a feature branch from `development`.
