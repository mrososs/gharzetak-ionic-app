# 07 — Architecture and State

Design only. The TypeScript below is a contract to implement against, not implementation.

## 1. Shape of the solution

```
                         pages (Home, Tracker, Patterns…)
                               │  [gzTour]="'tracker.tap'"        (directive on each target)
                               ▼
   ┌──────────────────┐   ┌──────────────────────┐
   │ TourTargetRegistry│◄──│ TourTargetDirective  │
   └────────┬─────────┘   └──────────────────────┘
            │ resolve(id) → visible element | null
            ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │ TourCoordinator   (the only public API: offerFor, start, stop, state) │
   │   ├─ TourGate            is it safe to show anything right now?       │
   │   ├─ tour-eligibility    pure rules: who should be offered what       │
   │   ├─ TourStateService    read/write TourPrefs in the current scope    │
   │   ├─ TourRegistry        id → lazy definition                         │
   │   ├─ TourRenderer  ◄──── DriverTourRenderer (the only driver.js import)│
   │   └─ TourEventSink       content-free event log                       │
   └──────────────────────────────────────────────────────────────────────┘
            ▲                         ▲                         ▲
   gz-getting-started          gz-tour-offer (pill)      Settings: Tours & help
```

Design rules:

- **One public service.** Pages and UI components talk to `TourCoordinator` only.
- **Definitions are data.** A tour is a typed object in its own file. Adding a tour means adding one file, one registry line and the `gzTour` attributes on its screen.
- **The engine is replaceable.** `TourRenderer` is an interface; Driver.js sits behind one class.
- **Pure where possible.** Eligibility and state transitions are pure functions with unit tests; services only wire them to signals.
- **Nothing loads until needed.** The engine and each definition are dynamic imports.

## 2. Folder layout

```
src/app/core/tour/
  tour.types.ts                 contracts (below)
  tour-ids.ts                   TourId, TargetId, MilestoneId unions
  tour-registry.ts              id → () => import('./definitions/…')
  tour-eligibility.ts           pure: seed(), decideOffer(), nextStatus()
  tour-state.service.ts         TourPrefs ↔ AppStore.prefs
  tour-gate.service.ts          "quiet" computed signal
  tour-target.registry.ts       element registry + visible-page resolution
  tour-coordinator.service.ts   state machine, session budget, lifecycle guards
  tour-renderer.ts              TourRenderer interface + injection token
  driver-tour-renderer.ts       Driver.js adapter (lazy import)
  tour-event-sink.ts            TourEventSink interface + local ring buffer
  definitions/
    welcome.tour.ts
    patterns.tour.ts
    pattern-reader.tour.ts
    tracker-simple.tour.ts
    tracker-pattern.tour.ts
    tracker-parts.tour.ts        (P1)
    project-create.tour.ts       (P1)
    khayoota.tour.ts             (P1)
  getting-started.ts            pure: task completion from store signals
src/app/shared/ui/tour/
  tour-target.directive.ts      [gzTour]
  tour-offer.component.ts       gz-tour-offer (pill)
  getting-started.component.ts  gz-getting-started (Home card)
src/theme/tour.scss             theme for the engine's popover
```

The app has no `core/onboarding-tour` precedent; `core/tour` follows the existing `core/joy`, `core/reminders` pattern (domain logic in `core`, visual pieces in `shared/ui`).

## 3. Contracts

```ts
// tour-ids.ts
export type TourId =
  | 'welcome' | 'patterns' | 'pattern-reader'
  | 'tracker-simple' | 'tracker-pattern' | 'tracker-parts'
  | 'project-create' | 'khayoota';

export type MilestoneId = 'patternOpened' | 'tutorialOpened';

/** Every id used with [gzTour]. A union, so a typo is a compile error on both sides. */
export type TargetId =
  | `tab.${'projects' | 'tracker' | 'learn' | 'assistant'}`
  | 'home.patterns-tile' | 'home.avatar' | 'home.getting-started'
  | 'patterns.sample-row' | 'patterns.kind-filter' | 'patterns.add'
  | 'reader.focus-card' | 'reader.next-round' | 'reader.track'
  | 'project-new.name' | 'project-new.source'
  | 'tracker.ring' | 'tracker.tap' | 'tracker.undo' | 'tracker.tap-row'
  | 'tracker.project-picker' | 'tracker.round-pills' | 'tracker.instruction'
  | 'tracker.current-step' | 'tracker.count-by' | 'tracker.piece-tabs' | 'tracker.completion'
  | 'khayoota.status' | 'khayoota.composer' | 'khayoota.menu';
```

```ts
// tour.types.ts
export interface LocalText { readonly ar: string; readonly en: string }

/** Read-only view a definition may consult. No services, no DOM. */
export interface TourContext {
  readonly lang: 'ar' | 'en';
  readonly guest: boolean;
  readonly hasProjects: boolean;
  readonly trackerLayout: 'none' | 'simple' | 'pattern' | 'parts-simple' | 'parts-pattern';
  readonly khayootaMode: 'ai' | 'demo' | 'consent' | 'soon' | 'rules' | 'offline';
}

export type StepText = LocalText | ((ctx: TourContext) => LocalText);

export interface TourStep {
  /** Stable forever: used in saved progress and analytics. */
  readonly id: string;
  readonly target: TargetId;
  readonly title: StepText;
  readonly body: StepText;
  /** Shown on action steps only. */
  readonly instruction?: StepText;
  readonly side?: 'top' | 'bottom' | 'auto';
  readonly align?: 'start' | 'center' | 'end';      // logical; mirrored in RTL by the renderer
  /** 'blocked' (default): highlight only. 'action': the element is tappable and a tap advances. */
  readonly interaction?: 'blocked' | 'action';
  /** DOM event that counts as "done" on an action step. Default 'click'. */
  readonly advanceOn?: 'click';
  /** What to do when the target cannot be resolved in time. */
  readonly ifMissing: 'skip' | 'end';
  /** Step is included only while this holds (checked when the step is about to show). */
  readonly when?: (ctx: TourContext) => boolean;
  readonly stage?: { readonly padding?: number; readonly radius?: number };
  /** Reserved for multi-page tours; unused in v1. */
  readonly route?: { readonly url: string; readonly mode: 'root' | 'forward' };
}

export interface TourDefinition {
  readonly id: TourId;
  /** Bump only when the guidance is genuinely new. */
  readonly version: number;
  /** If true, a version bump may re-offer the tour to users who completed an older version. Default false. */
  readonly announceOnBump?: boolean;
  /** URL the tour belongs to. `exact` forbids nested pages (Home). */
  readonly route: { readonly path: string; readonly exact?: boolean };
  /** Extra conditions beyond the quiet gate. */
  readonly canRun: (ctx: TourContext) => boolean;
  readonly steps: readonly TourStep[];
  readonly offer: 'home-card' | 'pill';
  /** Runs once before the first step (welcome: ensure /tabs/home root). */
  readonly prepare?: 'navigate-root';
  readonly onComplete?: 'toast-welcome-done';
}

export type TourStatus =
  | 'not_started'
  | 'offered'       // an offer is or was on screen, not answered
  | 'active'        // steps are showing (persisted so a crash can be told apart from "never started")
  | 'completed'     // reached the last step and pressed Done
  | 'skipped'       // user pressed Skip, ×, or Android Back
  | 'declined'      // user said "Not now", or ignored the offer the maximum number of times
  | 'interrupted'   // ended by the app: navigation, overlay, background, missing target, error
  | 'not_needed';   // seeded from evidence of prior use

export type EndReason =
  | 'done' | 'skip' | 'close' | 'back'
  | 'navigation' | 'overlay' | 'background' | 'scope-change' | 'lock'
  | 'missing-target' | 'error' | 'replaced';

export interface TourRecord {
  readonly v: number;            // definition version this record refers to
  readonly status: TourStatus;
  readonly step?: string;        // last step id shown (for resume)
  readonly offers: number;       // times an offer was shown
  readonly interruptions: number;
  readonly at: number;           // last change, epoch ms
}

export interface TourPrefs {
  readonly v: 1;
  readonly tours: Partial<Record<TourId, TourRecord>>;
  readonly milestones: Partial<Record<MilestoneId, number>>;
  readonly gettingStarted?: { readonly hiddenAt?: number; readonly completedAt?: number };
  /** When evidence seeding ran for this scope. */
  readonly seededAt?: number;
  /** True if this scope was armed by an entry event (guest start, sign-up). */
  readonly armed?: boolean;
}
```

```ts
// tour-renderer.ts
export interface RenderStep {
  readonly id: string;
  readonly resolve: () => Element | null;
  readonly title: string;
  readonly body: string;
  readonly instruction?: string;
  readonly side: 'top' | 'bottom' | 'auto';
  readonly align: 'start' | 'center' | 'end';
  readonly interaction: 'blocked' | 'action';
  readonly ifMissing: 'skip' | 'end';
  readonly stage?: { readonly padding?: number; readonly radius?: number };
}

export interface RenderLabels {
  readonly next: string; readonly prev: string; readonly done: string;
  readonly skip: string; readonly close: string; readonly progress: (n: number, total: number) => string;
}

export interface RenderCallbacks {
  stepShown(stepId: string, index: number, total: number): void;
  stepSkippedMissing(stepId: string): void;
  ended(reason: EndReason, lastStepId: string | undefined): void;
}

export interface TourRenderer {
  /** Resolves when the first step is on screen, or rejects if the engine failed to load. */
  start(steps: readonly RenderStep[], startIndex: number, labels: RenderLabels,
        dir: 'rtl' | 'ltr', reducedMotion: boolean, cb: RenderCallbacks): Promise<void>;
  /** Re-text the current step (language or status changed). */
  retext(step: Pick<RenderStep, 'title' | 'body' | 'instruction'>, labels: RenderLabels): void;
  /** Re-measure after layout changed. */
  refresh(): void;
  /** Idempotent. Always leaves the DOM clean. */
  stop(reason: EndReason): void;
  readonly active: boolean;
}
```

```ts
// tour-coordinator.service.ts — public surface
export interface TourOffer { readonly tour: TourId; readonly kind: 'first' | 'resume'; readonly steps: number }

export abstract class TourCoordinatorApi {
  /** Offer to render for this screen right now, or null. Pages bind the pill to it. */
  abstract offerFor(route: string): Signal<TourOffer | null>;
  /** State for the Home card. */
  abstract readonly welcomeOffer: Signal<boolean>;
  abstract readonly running: Signal<{ tour: TourId; stepId: string } | null>;

  abstract accept(tour: TourId): Promise<void>;       // user tapped Start
  abstract decline(tour: TourId): Promise<void>;      // user tapped Not now / ×
  abstract replay(tour: TourId): Promise<'started' | 'needs-project' | 'unavailable'>;
  abstract stop(reason: EndReason): void;
  abstract mark(milestone: MilestoneId): Promise<void>;
  /** Called by auth flows at the three arming events. */
  abstract arm(): Promise<void>;
}
```

```ts
// tour-event-sink.ts
export type TourEvent =
  | { readonly name: 'tour_offered'; readonly tour: TourId; readonly kind: 'first' | 'resume' | 'home-card' }
  | { readonly name: 'tour_started'; readonly tour: TourId; readonly source: 'offer' | 'settings' }
  | { readonly name: 'tour_step_viewed'; readonly tour: TourId; readonly step: string; readonly index: number }
  | { readonly name: 'tour_skipped'; readonly tour: TourId; readonly step: string; readonly via: 'skip' | 'close' | 'back' }
  | { readonly name: 'tour_completed'; readonly tour: TourId }
  | { readonly name: 'tour_interrupted'; readonly tour: TourId; readonly step?: string; readonly reason: EndReason }
  | { readonly name: 'tour_replayed'; readonly tour: TourId }
  | { readonly name: 'tour_declined'; readonly tour: TourId; readonly via: 'not-now' | 'ignored' }
  | { readonly name: 'tour_target_missing'; readonly tour: TourId; readonly step: string }
  | { readonly name: 'gs_task_done'; readonly task: 'pattern' | 'project' | 'tracker' | 'learn' | 'khayoota' }
  | { readonly name: 'gs_hidden' } | { readonly name: 'gs_completed' };

export interface TourEventSink { record(e: TourEvent & { readonly at: number; readonly v: number; readonly lang: 'ar' | 'en' }): void }
```

## 4. State machine

```
                    arm / first visit
   not_started ───────────────────────► offered ──── Start ───► active
        │                                  │                      │
        │ seed: evidence                   │ Not now              ├── Done ─────────► completed
        ▼                                  │ or ignored N times   ├── Skip/×/Back ──► skipped
    not_needed                             ▼                      └── app ended it ─► interrupted
                                        declined                                        │
                                                          next visit: one "Resume" pill │
                                                          Start ───────────────────────►active (from saved step)
                                                          ignored or interrupted again ─► skipped
```

| From | Event | To | Notes |
|---|---|---|---|
| `not_started` | Evidence found at seeding | `not_needed` | Per `03` §4.2 |
| `not_started` | Offer rendered | `offered` | `offers += 1` |
| `offered` | Start | `active` | |
| `offered` | Not now / × | `declined` | |
| `offered` | Offer limit reached (welcome 3 launches, pill 2 visits) | `declined` | via "ignored" |
| `active` | Done on last step | `completed` | |
| `active` | Skip, ×, Android Back | `skipped` | |
| `active` | Navigation, overlay, background > 30 s, lock, scope change, missing required target, engine error | `interrupted` | `interruptions += 1`, `step` kept |
| `active` | App killed | (stays `active` on disk) | On next load an `active` record is rewritten to `interrupted` |
| `interrupted` | Screen visited again, `interruptions === 1` | `offered` (resume) | One resume pill |
| `interrupted` | Second interruption, or resume ignored | `skipped` | Stops nagging |
| any terminal | Replay from Settings | runs without changing `completed`; a `skipped`/`declined` record becomes `completed` only if the replay is finished | |
| `completed` | Definition version bumped with `announceOnBump` | `not_started` for the new version | Otherwise the old record still blocks offers |

Terminal for automatic offers: `completed`, `skipped`, `declined`, `not_needed`.

## 5. Targets on Ionic's cached pages

```html
<!-- one attribute per target -->
<button type="button" class="gz-bigbtn flex-1" [gzTour]="'tracker.tap'" …>
```

`TourTargetDirective`:

- `host: { '[attr.data-tour]': 'id()' }` so tests and DevTools can see it.
- Registers `(id, element)` in `TourTargetRegistry` when created, removes it when destroyed.
- Works on plain elements and on Ionic hosts (`ion-tab-button`).

`TourTargetRegistry.resolve(id)` returns the first registered element for that id which is:

1. connected to the document;
2. inside an `.ion-page` that has no `.ion-page-hidden` ancestor (for the tab bar: inside `ion-tabs`, not inside a page);
3. not `hidden`, with a bounding box larger than 0×0.

Because registration follows the component lifecycle, a target on a page Ionic has cached is still registered but fails rule 2, and a target Angular removed with `@if` is simply gone. A `ready(id)` signal is exposed for the gate ("resolvable and same rectangle on two consecutive frames").

Why a directive rather than `document.querySelector('[data-tour=…]')`: the probe showed a plain selector returning an element on a hidden page. A registry can also hold two instances of the same id (the tracker's tap button exists in both mode branches; the same page can be cached twice in two tab stacks) and choose the visible one.

## 6. Route coordination

v1 tours are single-screen. The coordinator enforces that rather than assuming it.

| Situation | Behaviour |
|---|---|
| Tour definition has `prepare: 'navigate-root'` and the URL is not its route | `NavController.navigateRoot(route)`, await `NavigationEnd`, await `ready(firstTarget)`, then start |
| `NavigationStart` while a tour is active and the tour did not request it | `stop('navigation')` synchronously, before the transition animates |
| Tour's route no longer matches after `NavigationEnd` | Same |
| Step has `route` (future) | `renderer.stop` is **not** called; the coordinator hides the current highlight, navigates with the requested mode, waits for `NavigationEnd` and `ready(target)` under one `AbortController`, then shows the step. Deadline 4 s, then `interrupted`. Closing the tour aborts the controller. |

Waits are conditions with deadlines. There are no fixed sleeps anywhere in the design.

## 7. Persistence

### 7.1 Where

`ScopeDocs.prefs` in IndexedDB (`core/storage/local-db.ts:68-69`), extended with one optional key:

```ts
// core/joy/joy.models.ts — ScopePrefs gains:
tour?: TourPrefs;
```

`AppStore.updatePrefs` (`core/state/app.store.ts:521-531`) gains a `tour` branch that replaces the stored object. That is the only change to the store.

Why here:

| Property | `ScopePrefs` | localStorage | Synced profile |
|---|---|---|---|
| Separate for guest and for each account | Yes | No (device-wide) | Account only |
| Survives app restarts | Yes | Yes | Yes |
| Awaited, ordered writes | Yes (store write queue) | Sync but unordered with the rest | Yes |
| Backend or schema change | **None** | None | D1 migration, API type, sync mapping |
| Precedent | Reminder "asked at", celebration and share preferences | Language, guest flag | Profile fields |
| Follows the user to a new device | No | No | Yes |

The one thing lost is cross-device memory. That is covered by evidence seeding (`03` §4.2): an account that arrives on a new device with projects is not offered the welcome tour. Syncing tour state is deferred until there is a real complaint, because it needs a backend change.

### 7.2 Guest, account, switching

| Event | Handling |
|---|---|
| Guest uses the app | State lives in the `guest` scope |
| Guest signs up or signs in (scope `guest → user:<id>` within one app session) | If the account scope has no `tour` prefs, copy the guest scope's `tour` prefs into it once. Done by the tour state service on scope change, reading `db.loadDocs('guest')`; independent of whether the user accepts the data import. |
| User accepts the guest-data import | `GuestImportService` already copies `joy` and `share` prefs (`core/sync/guest-import.service.ts:134-141`). Add `tour` to that list as a second path to the same result. The import then clears the guest scope, including its tour state. |
| Sign-out | Nothing written. The account's state stays under its scope. |
| Different account signs in (`user:A → user:B`) | No copy. B has its own record or is seeded. |
| "Erase data on this device" | Clears the scope, including tour state. The user asked for a clean slate; a welcome offer afterwards is acceptable. |
| Reinstall | All local state is gone. Signed-in: seeded from synced data. Guest: indistinguishable from new. |

### 7.3 Seeding and migration

On the first load of a scope that has no `tour` prefs:

1. Wait for `store.loaded()`. For a signed-in scope also wait for the first sync pull to settle (or 5 s, or offline).
2. Run `seed(evidence)` (`03` §4.2) and write `TourPrefs` with `seededAt`.
3. An `active` record found on load becomes `interrupted`.

`TourPrefs.v` allows a later shape change. Unknown tour ids in stored data are ignored, not deleted.

### 7.4 Tour versions

- `TourDefinition.version` starts at 1.
- A copy tweak or a reordered step does **not** bump the version.
- A bump means "there is new guidance". With `announceOnBump` it can re-offer through a pill to users who completed the old version; without it, only users who never handled the tour see it.
- Step ids are stable, so a saved `step` from version 1 that no longer exists in version 2 falls back to the first step.

## 8. Lifecycle guards the coordinator owns

| Signal | Source | Action |
|---|---|---|
| Unexpected navigation | `Router` `NavigationStart` | `stop('navigation')` |
| Ionic overlay presented | `ionModalWillPresent`, `ionAlertWillPresent`, `ionActionSheetWillPresent`, `ionPopoverWillPresent`, `ionLoadingWillPresent` on `document`, plus a `MutationObserver` on `ion-app` children | `stop('overlay')` |
| App locked or privacy cover on | `auth.locked()`, `App.cover` | `stop('lock')` |
| Backgrounded | Capacitor `pause` / `visibilitychange` | Start a 30 s timer; on resume before it fires call `renderer.refresh()`; after it fires `stop('background')` |
| Scope changed (sign-in, sign-out, account switch) | `auth.scope()` | `stop('scope-change')` |
| Language changed | `i18n.lang()` | `renderer.retext(...)` with new copy and labels; direction class updated |
| Android Back | `Platform.backButton.subscribeWithPriority(100, …)` registered only while a tour is active | `stop('back')`, do not call `processNextHandler` |
| Active page scrolled | `scroll` on the active page's `ion-content` scroll element | `renderer.refresh()` in the next frame |
| Window resized / rotated / keyboard | Engine handles `resize` | If the viewport height drops under 420 px while a step shows: `stop('background')` semantics → `interrupted` |
| Engine threw | try/catch around every renderer call and inside every callback | `stop('error')`, log, never rethrow into the page |
| Khayoota mode changed during its tour | `KhayootaService` signals | `retext` |

`stop` is idempotent and always ends with a DOM check: no element with a `driver-` class may remain, and `body` must not carry `driver-active`. If the check fails, the coordinator removes them itself and logs `error`.

## 9. Analytics

### 9.1 What exists

Nothing. The client has no analytics library, no event endpoint and no logging of user behaviour (`01` §4).

### 9.2 Plan

| Stage | What | Network |
|---|---|---|
| v1 | `LocalTourEventSink`: a ring buffer of the last 200 events in the scope's `ScopeDocs` (new optional key `tourEvents`), plus `console.debug` in development | None |
| v1 | A hidden developer view (in the existing Design System page, development builds only) listing the buffer, for QA | None |
| Later, separate decision | `RemoteTourEventSink`: batches events to a new Worker route when signed in and online; drops them otherwise | New endpoint and table; needs its own privacy review |

The tour never waits on, or fails because of, the sink.

### 9.3 Event payload rules

Allowed: event name, tour id, step id, index, reason code, definition version, language, timestamp, app version.

Never: pattern text, project or pattern names, images, chat text, e-mail, display name, device identifiers, the tester allow-list or any server response.

### 9.4 Product milestones

These already have reliable sources and do not need new events to exist; the remote sink would only report them.

| Metric event | Source today |
|---|---|
| `first_pattern_opened` | New milestone `patternOpened` |
| `first_project_started` | `first_project` row in the Crochet Joy ledger, written on creation (`core/joy/achievements.ts`) |
| `first_tracker_session` | First counting tap: derivable from tracker state; record once as a milestone when the Getting Started task flips |
| `first_round_completed` | `first_round` row in the ledger |

### 9.5 Success metrics

| Metric | Definition | Tells us |
|---|---|---|
| Offer acceptance | `tour_started(source: offer)` ÷ `tour_offered` | Whether the offer is attractive |
| Completion rate | `tour_completed` ÷ `tour_started` | Whether the tour is the right length |
| Skip rate and drop-off by step | `tour_skipped` grouped by `step` | Which step loses people |
| Interruption rate by reason | `tour_interrupted` grouped by `reason` | Engineering quality of the gate |
| Broken targets | `tour_target_missing` count | Selector regressions after UI changes |
| **Activation** | Share of new scopes that reach `first_project_started` and `first_tracker_session` within 24 h and 7 d | The actual goal |
| Time to first tracker tap | From arming to `first_tracker_session` | Speed of understanding |
| D1 / D7 return | Scope active on day 1 / day 7 after arming | Retention |

Tour engagement (the first five rows) and product activation (the last three) are reported separately. A tour with a 90% completion rate and no change in activation has failed.

### 9.6 Controlled comparison (when the user base allows)

- Assignment: a stable 50/50 bucket from a hash of the account id (guests: a random value stored with the scope). Control sees today's onboarding only, plus the Settings entry; treatment sees the full system.
- Primary outcome: `first_tracker_session` within 7 days. Secondary: `first_round_completed`, D7 return.
- Needs the remote sink, and enough new users per week that a difference of a few points is detectable; with a small base, run it for a fixed calendar period rather than peeking.
- Until then: a before/after cohort comparison by app version, using data the server already has for signed-in users (project creation and progress timestamps relative to account creation), read as indicative only.

## 10. Error containment

- Every engine interaction is wrapped; an exception ends the tour and is logged as `interrupted/error`.
- The engine import can fail (corrupt cache, offline with a stale service). `accept()` then resolves without starting and the offer stays available.
- A feature kill switch `environment.tours` (build-time, default on) and a runtime `TourCoordinator.disabled` signal (set after two engine errors in one session) stop all automatic offers. The Getting Started card does not depend on the engine and keeps working.
- The tour code never calls the API, never reads server responses, and never changes feature flags.

## 11. Changes to existing files (complete list for v1)

| File | Change |
|---|---|
| `package.json` | `driver.js` exact version |
| `angular.json` or `src/styles.scss` | Engine CSS + `theme/tour.scss` |
| `core/joy/joy.models.ts` | `ScopePrefs.tour?` (and `tourEvents?` on `ScopeDocs` in `local-db.ts`) |
| `core/state/app.store.ts` | `updatePrefs` accepts `tour` |
| `core/sync/guest-import.service.ts` | Copy `tour` prefs with `joy` and `share` |
| `features/auth/auth.page.ts` | Call `tour.arm()` at the three arming points |
| `layout/tabs-layout/tabs.layout.ts` | `[gzTour]` on tab buttons |
| `features/home/home.page.ts` | `[gzTour]` on tile and avatar; `<gz-getting-started />` |
| `features/patterns/pattern-library.page.ts` | 3 × `[gzTour]`; `<gz-tour-offer />` |
| `features/patterns/pattern-reader.page.ts` | 3 × `[gzTour]`; pill; `tour.mark('patternOpened')` |
| `features/tracker/tracker.page.html` / `.ts` | 9 target ids (11 placements); pill |
| `features/video-tutorials/video-detail.page.ts` | `tour.mark('tutorialOpened')` only |
| `features/settings/settings.page.ts` | "Tours & help" section |
| `core/i18n/strings.ts` | Shared labels (`05` §2, §12–14); step copy stays in definitions |
| `app.ts` | None required; the coordinator is created on first use |

No backend, Worker, schema, flag or sync-protocol change.
