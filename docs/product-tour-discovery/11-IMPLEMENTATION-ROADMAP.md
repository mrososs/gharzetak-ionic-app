# 11 — Implementation Roadmap

Effort is relative: **S** about a day, **M** two to three days, **L** about a week, for one developer who knows the codebase. These are planning sizes, not commitments.

## 1. Phases ranked by product impact

The suggested order (foundation → welcome → core → contextual → checklist → hardening) is adjusted in two places, both because of what the audit found:

1. **The Getting Started card moves up, into Phase 2.** It carries the welcome offer, and it is what teaches Pattern → Project → Tracker. Without it the welcome tour has no entry point.
2. **Hardening is not a last phase.** The overlay, navigation and back-button guards are part of the foundation, because a tour without them can trap the user. Phase 6 is what remains: browser automation, accessibility and the device pass.

| Rank | Phase | Impact | Why |
|---|---|---|---|
| 1 | 0 Spike on the phone | Gate | Everything else is conditional on it |
| 2 | 1 Foundation | Enabler | Safety properties live here |
| 3 | 2 Welcome + Getting Started card | **Highest** | Reaches every new user; fixes the two hidden entry points (patterns, settings) |
| 4 | 3 Core tours: Tracker, Patterns, Reader | **High** | The tracker is the reason to stay; the pattern-mode layout is the hardest screen |
| 5 | 6 Hardening | High (quality) | Required before release, runs alongside 3 |
| 6 | 5 Checklist completion + help | Medium | Finishes what Phase 2 started |
| 7 | 4 Contextual: New project, multi-part tracker, Khayoota | Medium–low | Helpful, but Khayoota's real audience today is a tester list |

**v1 = Phases 0, 1, 2, 3 and 6.** Phases 4 and 5 can follow in the next release.

---

## Phase 0 — Technical spike on the device (S)

| | |
|---|---|
| Goal | Confirm on the HONOR phone what the desktop probe showed, before any feature code |
| Required files | None in `src/`. A throwaway branch with `driver.js` installed and one dev-only route or a DevTools snippet. Not merged. |
| Tasks | 1. Re-read the engine changelog; choose the exact version to pin (1.14.0 or a later patch). 2. Run tests S1–S14 from `06` §4 in a debug APK. 3. Confirm how the engine CSS is included in an Angular 22 production build. 4. Decide `advanceOn` vs own click listener for the action step. 5. Record results in `docs/product-tour-discovery/phase-0-results.md`. |
| Dependencies | Phone connected over USB; a debug build from the user's terminal |
| Tests | The 14 checks, each pass/fail with a screenshot (reviewed for private content) |
| Acceptance | All of S1–S9, S12, S14 pass, or have a documented adapter fix. S10–S11, S13 may pass with noted limits. |
| Risks | A WebView-only failure (touch, safe area) with no adapter fix |
| Rollback | Nothing to roll back. If it fails: evaluate `ngx-ui-tour-ionic` with the same 14 checks before committing to any engine. |

## Phase 1 — Tour foundation (L)

| | |
|---|---|
| Goal | Everything except tour content: the system can run a tour safely and remember it |
| Required files | New: `core/tour/` (types, ids, registry, eligibility, state service, gate, target registry, coordinator, renderer interface, Driver adapter, event sink), `shared/ui/tour/tour-target.directive.ts`, `theme/tour.scss`. Changed: `package.json`, `styles`/`angular.json`, `core/joy/joy.models.ts`, `core/storage/local-db.ts` (type only), `core/state/app.store.ts` (`updatePrefs`), `core/sync/guest-import.service.ts`, `core/i18n/strings.ts` (shared labels). |
| Tasks | Contracts from `07` §3 · pure eligibility and transitions · state service with scope adoption and seeding · quiet gate · target directive and registry · coordinator with all guards in `07` §8 · Driver adapter (function resolvers, scroll refresh, RTL mirroring, reduced motion, dots and Skip, DOM assertion) · theme · local event sink · build-time kill switch |
| Dependencies | Phase 0 passed |
| Tests | `10` §1.1–1.5, §1.7; integration teardown test; a dev-only one-step tour on Home to exercise the adapter |
| Acceptance | A hidden test tour starts, steps, skips, completes and is remembered per scope; every guard ends it cleanly; no `driver-*` node ever remains; unit suite green with and without an API URL; no tour is visible to users yet |
| Effort | L |
| Risks | Scope adoption and seeding rules are subtle; the first-sync wait for signed-in scopes |
| Rollback | Kill switch off: nothing renders. The stored `tour` key is optional and ignored by older builds. |

## Phase 2 — Welcome tour and Getting Started card (M)

| | |
|---|---|
| Goal | A new user is offered a 6-step tour on Home and then sees five first steps |
| Required files | New: `core/tour/definitions/welcome.tour.ts`, `core/tour/getting-started.ts`, `shared/ui/tour/getting-started.component.ts`. Changed: `features/home/home.page.ts`, `layout/tabs-layout/tabs.layout.ts`, `features/auth/auth.page.ts` (three `arm()` calls), `features/patterns/pattern-reader.page.ts` and `features/video-tutorials/video-detail.page.ts` (milestone marks), `features/settings/settings.page.ts` ("App tour" and "Getting-started list" rows). |
| Tasks | Six `gzTour` attributes · welcome definition with copy from `05` · card states A/B/C/hidden · task completion signals · arming at guest start, sign-up, new Google account · fresh-account check after first sync · end toast · Settings rows |
| Dependencies | Phase 1 |
| Tests | `10` §1.6; integration tests for Home and tabs; Playwright 1–10, 19 once available; device D1–D5, D9–D12 |
| Acceptance | Scenarios 1–12 of `03` §4.3 behave as specified · the offer never appears over splash, auth, setup, lock, an alert or a sheet · Skip leaves the app fully usable · completed and skipped are remembered across restarts · both languages correct |
| Effort | M |
| Risks | Home layout shift when the card appears; offer fatigue if the gate fires too early |
| Rollback | Remove the card from Home (one line) or set the kill switch; state is harmless |

## Phase 3 — Core product tours (M–L)

| | |
|---|---|
| Goal | Short tours for the tracker (both layouts), the pattern library and the reader |
| Required files | New: `definitions/tracker-simple.tour.ts`, `tracker-pattern.tour.ts`, `patterns.tour.ts`, `pattern-reader.tour.ts`, `shared/ui/tour/tour-offer.component.ts`. Changed: `features/tracker/tracker.page.html` and `.ts`, `features/patterns/pattern-library.page.ts`, `pattern-reader.page.ts`, `features/settings/settings.page.ts` (two more rows). |
| Tasks | Fifteen target ids (17 placements) · four definitions · pill component and its visit counting · action step on the tracker · state-dependent copy for `reader.track` · tracker-tour `refresh()` on store change · "needs a project" path from Settings |
| Dependencies | Phase 2 (for the pill's one-at-a-time rule and the checklist rows that lead here) |
| Tests | Integration tests for tracker, library and reader targets; Playwright 11–18; device D4, D6, D16 |
| Acceptance | Each tour appears as a pill on the first qualifying visit only · the tracker action step counts exactly once · pattern-mode tour never allows a tap · no tour in the tracker empty state · finishing a round during the tour does not break it |
| Effort | M–L (the tracker's three layouts are the bulk) |
| Risks | Tracker layout variety; celebration overlays; long pattern-mode page on small screens |
| Rollback | Each tour is one registry line; remove the line or its pill |

## Phase 4 — Contextual tours (M)

| | |
|---|---|
| Goal | New project (2), multi-part tracker (2), Khayoota (3, highlight only) |
| Required files | New: `definitions/project-create.tour.ts`, `tracker-parts.tour.ts`, `khayoota.tour.ts`. Changed: `features/projects/new-project.page.ts`, `features/tracker/tracker.page.html`, `features/ai-assistant/assistant.page.ts`, Settings row. |
| Tasks | Seven target ids · definitions · Khayoota mode variants and status-settled wait · re-text on mode change · New-project wrapper element around the source block |
| Dependencies | Phase 3 |
| Tests | Playwright 20 (zero AI requests); unit test that the Khayoota tour calls nothing on `KhayootaService`; device D7 |
| Acceptance | Khayoota tour sends nothing and opens nothing in every mode; copy matches the screen's own status; New-project tour leaves the form pristine (no unsaved-changes alert on leaving) |
| Effort | M |
| Risks | Khayoota's six modes; a stale "demo" string next to tour copy (flag for a separate fix) |
| Rollback | Registry lines |

## Phase 5 — Getting Started completion and help (S–M)

| | |
|---|---|
| Goal | Finish the list experience and the replay surface |
| Required files | Changed: `getting-started.component.ts`, `features/settings/settings.page.ts`, `core/tour/tour-event-sink.ts`; dev-only event viewer in `features/design-system/design-system.page.ts` |
| Tasks | Completion state · hide and restore · all replay rows with precondition messages · event buffer viewer for QA · copy review with native readers |
| Dependencies | Phases 2–3 |
| Tests | Playwright 19, 6; unit tests for the sink's content rules (no free text fields exist in the type) |
| Acceptance | Each task ticks only on its real action · Hide is permanent until restored · every listed tour can be replayed from Settings |
| Effort | S–M |
| Risks | Low |
| Rollback | Hide the Settings section |

## Phase 6 — Hardening (M–L, overlaps Phases 3–5)

| | |
|---|---|
| Goal | Prove it is safe and accessible on a real phone |
| Required files | New: `playwright.config.ts`, `e2e-ui/*.spec.ts`, `@playwright/test` in `devDependencies`, QA record under `docs/` |
| Tasks | Playwright suite (`10` §3) · TalkBack pass and fixes · reduced motion, large font, landscape rule · full device checklist D1–D19 · performance check that the engine chunk is lazy · record evidence |
| Dependencies | Phone available; Phases 2–3 code |
| Tests | All of `10` |
| Acceptance | Gates in `10` §5 |
| Effort | M–L |
| Risks | TalkBack behaviour in the WebView with a non-inert background; time on device |
| Rollback | Not applicable; this phase decides whether the release proceeds |

---

## 2. Dependency graph

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
                            │           │
                            └───────────┴──► Phase 5
              Phase 6 starts with Phase 2 code and gates the release
```

## 3. Technical risks carried through the roadmap

| Risk | Phase that retires it |
|---|---|
| Engine behaviour in the Android WebView | 0 |
| Engine version churn | 0 (pin), 1 (adapter boundary) |
| Stuck overlay | 1 (guards), 6 (tests) |
| Wrong "new user" decisions | 1 (rules + tests), 2 (scenario tests) |
| Selector rot after redesigns | 1 (typed ids + template check) |
| Screen-reader usability | 6 |
| No measurement | 5 (local log); remote sink is a separate project |

## 4. Out of scope for this roadmap

- A metrics endpoint or any backend change.
- Syncing tour state across devices.
- A practice (sandbox) counter.
- Fixing the unrelated gaps listed in `01` §5.
- Rewriting existing onboarding slides or setup.
