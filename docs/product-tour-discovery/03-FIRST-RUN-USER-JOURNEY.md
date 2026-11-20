# 03 — First-Run User Journey, Eligibility and Interaction Rules

## 1. Principles

1. **One onboarding story, three chapters.** The existing slides say *why*. Setup asks *who are you*. The product tour shows *where things are*, on the real screens, after the user is inside. No chapter repeats another.
2. **Offer, do not ambush.** Nothing dims the screen until the user taps "Start".
3. **Evidence over assumption.** "New" is decided from what the app can actually observe, and when it cannot tell, it stays quiet.
4. **Tasks over tooltips.** The user becomes confident by doing five real things, not by reading thirty popovers.
5. **Never in the way.** A tour yields to anything the app itself needs to show.

## 2. The first-run journey

```
Onboarding slides ──► Sign up ──► Setup (4 steps, skippable) ──┐
        │                                                      ├──► HOME
        └────────────► Continue as guest ──────────────────────┘
                                                                 │
                              "Home is quiet"  (§4)              ▼
                    ┌──────────────────────────────────────────────────────┐
                    │  Getting Started card appears under the hero card     │
                    │  State A — welcome offer                              │
                    │    "A quick tour of where everything is: 6 steps"     │
                    │    [ Start the tour ]   [ Not now ]                   │
                    └───────────────┬───────────────────────┬──────────────┘
                              Start │                       │ Not now / ignored
                                    ▼                       ▼
                         Welcome tour (6 steps,      Card switches to State B
                         all on Home)                      │
                                    │                      │
                                    └──────────┬───────────┘
                                               ▼
                    ┌──────────────────────────────────────────────────────┐
                    │  State B — Getting Started list (5 tasks)             │
                    │   ○ Explore a sample pattern   → Pattern library      │
                    │   ○ Create your first project  → New project          │
                    │   ○ Try the tracker            → Tracker              │
                    │   ○ Open a tutorial            → Learn                │
                    │   ○ Ask Khayoota a question    → Khayoota             │
                    └──────────────────────────────────────────────────────┘
                                               │  each destination, first visit
                                               ▼
                         Small pill at the top of that screen:
                         "New here? 3-step tour  [Start]  ×"
```

Why the card carries the offer: a new account has just been through four slides, a form and four setup steps. A guest has been through four slides and a login screen. A further full-screen prompt at that moment is the most skippable screen in the app. A card that sits on Home can be accepted now, later, or never, and the app stays usable throughout.

### The Pattern → Project → Tracker thread

This is the relationship the user most needs, and the app's own flow hides it: the pattern library is a Home tile labelled "Pattern reader", and saving a new project returns to the projects list rather than the tracker.

| Step | What the user does | What teaches it |
|---|---|---|
| 1 | Opens the pattern library | Welcome step 1; Getting Started task 1 |
| 2 | Opens a **sample** pattern and reads a round | Patterns tour step 1; Reader tour |
| 3 | Creates a project and picks that pattern in "Start from a saved pattern" | Getting Started task 2; New-project tour step 2 (P1) |
| 4 | Opens the tracker (the new project is already current) | Getting Started task 3 |
| 5 | Taps the big button once, sees Undo | Tracker tour steps 2–3 |
| 6 | Leaves and returns through Home "Resume" or the Tracker tab | Tracker tour step 4; welcome step 3 |

No step creates data for the user. She creates her own project; the only prepared material is the two sample patterns that every account already has.

## 3. Trigger: the exact moment

The welcome offer and every pill are evaluated only when **all** of these hold. This is the "quiet" gate, implemented once in the coordinator.

| Condition | Why | Source of truth |
|---|---|---|
| Route is under `/tabs/` and navigation has ended | Never over splash, onboarding, auth, OAuth, setup, reset, Design System | `Router` events |
| `auth.ready()` and not `auth.locked()` and the privacy cover is off | Never over the lock screen | `core/auth/auth.service.ts:76, 89`; `app.ts:60-61` |
| `store.loaded()` and `store.scope() === auth.scope()` | Never over a loading state or the wrong account's data | `core/state/app.store.ts:55-56` |
| No Ionic overlay presented | Never over an alert, sheet, permission soft-ask, finale | DOM check on `ion-app` children |
| The guest-import decision is not pending | That alert appears after sign-in | `app.ts:115-122` |
| The soft keyboard is closed | Keyboard events (`@capacitor/keyboard`) or viewport height |
| No celebration banner or card is visible | `core/joy/joy-presenter.service.ts` signals |
| The page has been still for two frames | Ionic transitions |
| App is in the foreground | `visibilitychange` / Capacitor `resume` |

If the app was launched from a reminder notification, or the user arrives on the tracker with unfinished work, no welcome offer is made in that session. The card simply appears on her next visit to Home.

## 4. Who is "new": eligibility rules

"New account" and "first launch of this install" are different things, and the app can only observe some of it. The rule is: **the welcome offer is armed by an entry event and cancelled by evidence.**

### 4.1 Arming events

| Event | Where it happens | Arms welcome? |
|---|---|---|
| "Continue as guest" | `features/auth/auth.page.ts:210` | Yes |
| E-mail sign-up that signs in immediately | `auth.page.ts:153-164` | Yes |
| Google sign-in reported as a new account | `auth.page.ts:185-191` | Yes |
| Any other sign-in | `auth.page.ts:166-169` | Only through the "fresh account" check below |
| App launch with an existing session or guest flag | `app.routes.ts:12` | No new arming; an existing unanswered offer remains |

**Fresh account check** (covers a new account that confirmed its e-mail and then used *Sign in*): after the first sync pull completes, arm only if the profile's `onboarded` is false **and** the account has no projects, no patterns other than samples, no multi-part patterns and no chat. If the session response's account creation time is available, also require it to be less than 7 days old.

### 4.2 Cancelling evidence

Evaluated per data scope when tour state is first created for that scope ("seeding"). Any hit marks the welcome tour and the matching feature tours `not_needed`.

| Evidence in this scope | Marks `not_needed` |
|---|---|
| Any project | welcome, tracker tours if any project has progress |
| Any non-sample pattern or any multi-part pattern | welcome, patterns, pattern-reader |
| Any chat message from the user | khayoota |
| Any achievement or round in the Crochet Joy ledger | welcome, tracker tours |
| `profile.onboarded === true` on an account that was **not** just created in this session | welcome |

### 4.3 The twelve scenarios

| # | Scenario | What the app observes | Result |
|---|---|---|---|
| 1 | Brand-new guest | Guest arming event; empty guest scope | Welcome offer; Getting Started list; pills on first visits |
| 2 | Brand-new registered user | Sign-up arming event; empty account | Same, after setup finishes |
| 3 | Existing guest who signs up or signs in | Scope changes `guest → user:<id>` in this session | The account **adopts the guest's tour state** if it has none. Nothing is offered twice. Separate from the data-import prompt and independent of its answer. |
| 4 | Existing account on a new device | Plain sign-in; sync brings projects or `onboarded` | Seeded `not_needed`. No welcome offer, no list. "Tours & help" in Settings is available. |
| 5 | Existing user reinstalls | Signed in: same as 4. Guest: local data is gone and nothing distinguishes her from a new guest. | Signed-in: nothing. Guest: one welcome offer in the card, dismissible with one tap. This is stated as a known limit, not hidden. |
| 6 | Returns after several months | Tour state is still stored | Nothing repeats. Only a tour whose definition is explicitly marked "announce" on a version bump can show a pill. |
| 7 | Skipped a tour | State `skipped` | Never offered again automatically. Replay from Settings. |
| 8 | Completed a tour | State `completed` | Same. |
| 9 | Left a feature tour half-way | State `interrupted` with the last step id | On the next visit to that screen: one pill "Resume the tour". If ignored or interrupted again: `skipped`. |
| 10 | Switches language | Language is a device setting (`gz.lang`) | State is unaffected. Copy is resolved when each step is shown, so the next step is in the new language. A language change while a popover is open re-texts it. |
| 11 | Signs out, another account signs in | Scope changes `user:A → user:B` (no guest in between) | No adoption. Account B is judged on its own arming event and evidence. Account A's state stays under A. |
| 12 | Used the app before tours existed | No tour state; scope has data | Seeded from evidence: features already used are `not_needed`. A user with no data at all is treated as new. |

### 4.4 De-duplication rules

- A tour id has one record per scope. A record that is `completed`, `skipped`, `declined` or `not_needed` blocks every automatic offer for that tour version.
- At most **one** offer is visible at a time, and at most **one tour is started per app launch** without an explicit tap in Settings.
- The welcome offer is shown on at most **3** launches. After the third unanswered appearance it is recorded as `declined` and the card switches to the list.
- A pill is shown on at most **2** visits to its screen, then recorded as `declined`.
- A pill never appears in the same screen visit in which the user arrived by tapping a Getting Started task and immediately started acting (first interaction within 1.5 s hides the pill for that visit; it counts as one of the two).
- Replays from Settings ignore all of the above and never change a `completed` record to anything else.

## 5. Interaction rules

| Rule | Detail |
|---|---|
| Controls on every step | Next, Back (not on the first step), Skip (not on the last), Close (×), progress dots |
| Skip and Close | Both end the tour as `skipped`. The app is fully usable immediately. |
| Tapping the dimmed area | Does nothing. An accidental touch should not throw the tour away. |
| Android Back | Closes the tour (`skipped`). It does not navigate. |
| Highlighted control | Not tappable, except on a step explicitly marked as an action step |
| Action step | The user may tap the real control; the tour then advances by itself. **Next stays enabled**: doing the action is invited, never required. |
| App backgrounded | Up to 30 s: the tour is still there on return. Longer, or if the app relocks: ended as `interrupted`. |
| Unexpected navigation, overlay, logout, account change | Ended as `interrupted` at once |
| Missing target | Optional step: skipped silently. Required step: tour ended as `interrupted` and logged. Never a popover pointing at nothing. |
| Finishing | Last button reads "Done". Welcome ends with a short toast and the card switches to the list. Feature tours end silently. |

### Which interactions the user performs herself

| Interaction | In v1? | Why |
|---|---|---|
| Tap the tracker's big button once (simple mode) | **Yes**, invited | It is the product's core gesture; one tap is +1 stitch on her own project; Undo is the next step |
| Tap in pattern mode | No (highlight only) | With "whole round" counting one tap completes a round, fires a celebration and can unlock a permanent achievement |
| Open a sample pattern | Yes, as a Getting Started task | Read-only material |
| Create a project | Yes, as a Getting Started task | Her data, her decision |
| Next round in the reader | Highlight only | Saves reading position; harmless but not worth an action step |
| Switch pieces | Highlight only (P1) | Moves a running timer |
| Anything in Khayoota | **Never** | Sends a message; in tester mode spends quota |
| Grant a permission, sign in, purchase | **Never** | Outside the scope of a tour |

## 6. A safe practice mode (evaluated, not in v1)

The tracker engine's functions are pure (`core/domain/tracker-engine.ts`), so a small "practice counter" could run them on in-memory state with no store, no sync and no achievements. That would let a user try counting, completing a round and undoing with nothing saved.

It does not exist today. The store has no "do not persist" path: the first tap on any project the tracker shows is written to IndexedDB and, for signed-in users, queued for sync (`core/state/app.store.ts:197-224`). Injecting a fake project into the store would leak into Home, the projects list and the picker.

Recommendation: do not build it for v1. Revisit only if the data shows users reaching the tracker and not tapping.

## 7. The Getting Started list

| Task | Completed when | How it is known | Tapping the row |
|---|---|---|---|
| Explore a sample pattern | The reader has been opened on any pattern | Milestone recorded by the reader page | Opens the pattern library |
| Create your first project | The scope has at least one project | Derived from the store | Opens New project |
| Try the tracker | Any project shows counting progress | Derived from tracker state (count, round, cursor or undo history) | Opens the tracker (or New project if none exists) |
| Open a tutorial | A tutorial topic page has been opened | Milestone recorded by the video page | Opens Learn |
| Ask Khayoota a question | The saved chat contains a user message | Derived from the store | Opens Khayoota |

Rules:

- A task is ticked by the action, never by viewing a popover.
- The card can be hidden with one tap ("Hide"); it returns only from Settings → Tours & help.
- When all five are done the card shows a one-line completion state for that session and is gone on the next launch.
- The card is not shown to users seeded as established (scenarios 4 and 12 with data).
- "Ask Khayoota" is completed by any question, including one answered by the built-in rules. The task does not mention AI.

## 8. Replay and help

Settings gets a section **Tours & help**, placed next to the existing "Replay app intro":

| Row | Action |
|---|---|
| App tour | Goes to Home and starts the welcome tour |
| Tracker tour | Opens the tracker and starts the matching variant; if there is no project, says so and offers New project |
| Patterns tour | Opens the pattern library and starts it |
| Khayoota tour (P1) | Opens Khayoota and starts it |
| Getting-started list | Shows the card on Home again |

"Replay app intro" stays as it is; it replays the slides, which is a different thing.
