# Gharzetak — Product Tour Discovery

Discovery, feasibility analysis, UX design and implementation plan for an in-app product tour and interactive onboarding. Documents 00–12 are the specification; **[13 — Implementation status](13-IMPLEMENTATION-STATUS.md)** records what was built, where it differs, and what was verified.

- Date: 2026-11-20
- Baseline: `origin/test` at `c3ca6a3` (tree identical to `origin/development` `1e12b03`)
- Branch: `claude/gharzetak-product-tour-discovery-cd256e` (local, not pushed); the Phase 0 spike code is on the separate local branch `spike/product-tour-phase0`

## Start here

| If you want | Read |
|---|---|
| The decision and the risks | [00 — Executive Recommendation](00-EXECUTIVE-RECOMMENDATION.md) |
| Everything on one page, plus the 20 answers | [12 — Final Product Tour Blueprint](12-FINAL-PRODUCT-TOUR-BLUEPRINT.md) |
| What it would look like | [`concepts/`](concepts/) |

## Documents

| # | Document | Contents |
|---|---|---|
| 00 | [Executive Recommendation](00-EXECUTIVE-RECOMMENDATION.md) | Is Driver.js suitable, the recommended model, risks, decisions needed |
| 01 | [Current App UX Audit](01-CURRENT-APP-UX-AUDIT.md) | Launch sequence, existing onboarding, every screen, cross-cutting findings |
| 02 | [Tour Opportunity Matrix](02-TOUR-OPPORTUNITY-MATRIX.md) | Every candidate location with a decision; verified targets and the hooks they need |
| 03 | [First-Run User Journey](03-FIRST-RUN-USER-JOURNEY.md) | Journey, trigger, eligibility for 12 user scenarios, interaction rules, Getting Started list |
| 04 | [Tour Specifications](04-TOUR-SPECIFICATIONS.md) | Step-by-step specs for all recommended tours |
| 05 | [Bilingual Tour Copy](05-BILINGUAL-TOUR-COPY.md) | Arabic and English wording for every step and label |
| 06 | [Driver.js × Ionic Technical Analysis](06-DRIVERJS-IONIC-TECHNICAL-ANALYSIS.md) | Library facts as of 1.14.0, live probe results, compatibility by topic, reproduction plans |
| 07 | [Architecture and State](07-ARCHITECTURE-AND-STATE.md) | Module layout, TypeScript contracts, state machine, persistence, analytics |
| 08 | [Design System and UX](08-DESIGN-SYSTEM-AND-UX.md) | Tokens, popover anatomy, RTL/LTR, component specs, theme stylesheet |
| 09 | [Edge Cases and Accessibility](09-EDGE-CASES-AND-ACCESSIBILITY.md) | 30 failure scenarios, the stuck-overlay guarantee, accessibility plan |
| 10 | [Test Strategy](10-TEST-STRATEGY.md) | Unit, integration, Playwright and real-device checklists; acceptance gates |
| 11 | [Implementation Roadmap](11-IMPLEMENTATION-ROADMAP.md) | Seven phases with files, tasks, tests, acceptance, effort, risks, rollback |
| 12 | [Final Blueprint](12-FINAL-PRODUCT-TOUR-BLUEPRINT.md) | All decisions and the 20 required answers |
| 13 | [Implementation status](13-IMPLEMENTATION-STATUS.md) | What was built, deviations from the blueprint, verification results, open items |
| — | [Phase 0 Results](phase-0-results.md) | Device spike on the HONOR phone: results, findings that change the design, what is still open; raw data in [`phase-0-raw/`](phase-0-raw/) |

## Concept previews

Genuine screens of the app running locally (guest mode, no backend), with the real Driver.js engine and a draft Gharzetak theme injected **in the browser only**. They are planning images, marked "CONCEPT" in the corner. The Getting Started card is a mock-up inserted into the page. Captures are 335×725 px from a desktop browser pane, not from a phone.

| Preview | File |
|---|---|
| 1. Welcome tour on Home (Arabic) | [01](concepts/01-welcome-tour-home-ar.png), [last step](concepts/01b-welcome-tour-last-step-ar.png) |
| 2. Tracker highlight: invited tap, then Undo | [02](concepts/02-tracker-interactive-step-ar.png), [02b](concepts/02b-tracker-undo-step-ar.png) |
| 3. Patterns page tour | [03](concepts/03-patterns-tour-ar.png) |
| 4. Getting Started checklist | [04](concepts/04-getting-started-checklist-ar.png) |
| 5. Arabic mobile popover | [05](concepts/05-popover-arabic-tab-bar.png) |
| 6. English mobile popover | [06](concepts/06-popover-english-tab-bar.png), [Home step](concepts/06b-welcome-tour-home-en.png) |
| Reference: engine default look; untouched tracker | [00](concepts/00-unstyled-library-default-ar.jpg), [ref](concepts/ref-tracker-real-screen.png) |

## How the evidence was gathered

| Source | Method |
|---|---|
| Application | Source read at the `test` baseline; the app was also run locally with `ng serve` and no API configured, in a fresh browser profile as a guest |
| Driver.js | Official docs, npm registry and the 1.14.0 source, all read on 2026-11-20 |
| Compatibility | A live probe: the published library was loaded from the public CDN into the running dev page with a script and driven against the real Ionic DOM. Nothing was installed in the repository. |
| Device | Phase 0 was run on the HONOR phone afterwards (isolated QA build, separate application id): [phase-0-results.md](phase-0-results.md). The discovery documents were written before it; where Phase 0 changed something it is stated in the document concerned. |

What was created locally and is **not** committed: `node_modules/` (from `npm ci` with the existing lockfile) and `src/environments/env.generated.ts` (from the existing env script); both are git-ignored. One throwaway project and one counter tap exist in the dev browser's guest storage for `localhost:4200`; they are not in the repository or on any server.

## Status of the open questions

| Question | Status |
|---|---|
| Does the engine work with Ionic + Angular here? | Yes in a desktop browser, with four adapter behaviours |
| Does it work in the Android WebView on the phone? | Yes for 9 of 14 checks, none failed; 4 not verified (`phase-0-results.md`) |
| Are the tour texts final? | Proposed; need a native-reader review |
| Is anything shipped? | No |
