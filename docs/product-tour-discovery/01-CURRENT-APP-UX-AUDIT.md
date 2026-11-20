# 01 — Current App UX Audit

Baseline: `origin/test` at `c3ca6a3` (2026-11-19). Its tree is identical to `origin/development` (`1e12b03`); `test` is only the merge commit on top. `origin/production` is 95 commits behind and was not used.

Everything here was read from source. File and line references are to `src/app/` unless they start with another folder. Where something was also observed in the running app (local dev server, guest mode, no backend, 375×812), it says "observed".

Stack as built: Angular 22.2, Ionic 9.0.11, Capacitor 8.6, TypeScript 6, Tailwind 4, signals throughout, `OnPush` everywhere, templates inline in `.ts` files (only the tracker and video detail have `.html` files).

---

## 1. The launch sequence, as coded

```
cold start
  └─ route ''  → redirectTo: canEnterApp() ? /tabs/home : /onboarding/welcome      (app.routes.ts:12)
       ├─ /onboarding/:slide   4 slides: welcome → learn → track → assistant        (core/data/flows.ts:2)
       │     Skip (slides 1-3) or "I have an account" (slide 4) → /auth/login       (onboarding.page.ts:41, 91, 234)
       │     last slide CTA → /auth/signup                                          (onboarding.page.ts:226)
       ├─ /auth/login | /auth/signup
       │     email sign-up      → /setup/avatar                                     (auth.page.ts:164)
       │     email sign-in      → /tabs/home          (no setup)                    (auth.page.ts:169)
       │     Google, new account→ biometric offer alert → /setup/avatar             (auth.page.ts:189-191)
       │     Google, existing   → biometric offer alert → /tabs/home                (auth.page.ts:189-191)
       │     Continue as guest  → /tabs/home          (no setup)                    (auth.page.ts:210-213)
       ├─ /setup/:step   4 steps: avatar → experience → interests → tools           (core/data/flows.ts:3)
       │     Skip (header, every step) or Finish → profile.onboarded = true → /tabs/home, toast "preferences saved"
       │                                                                             (setup.page.ts:31, 191-195)
       └─ /tabs/home
```

Facts that matter for a tour trigger:

| Question | Answer | Evidence |
|---|---|---|
| When is onboarding shown? | Whenever the user is neither signed in nor a guest. There is no "onboarding seen" flag. | `app.routes.ts:12`; `core/auth/guards.ts:20-27` |
| Can it be skipped? | Yes, "Skip" on slides 1–3 goes to login. Setup has a header "Skip" on every step. | `onboarding.page.ts:41`; `setup.page.ts:31` |
| When is setup "complete"? | `profile.onboarded = true` is written when setup is finished **or skipped**. Nothing reads this flag to gate anything. It is part of the synced profile. | `setup.page.ts:192`; `core/sync/sync.service.ts:330, 502` |
| Do guests see setup? | **No.** Guests go straight to Home. Their `onboarded` stays `false`. | `auth.page.ts:210-213` |
| Does an existing account see setup on a new device? | No. Sign-in goes straight to Home. | `auth.page.ts:169` |
| Does a new e-mail account always see setup? | Not if the server requires e-mail confirmation: sign-up shows "check your e-mail", and the later sign-in takes the *sign-in* path to Home. Such an account never sees setup. | `auth.page.ts:156-160`; `auth.service.ts:170` |
| Does the app reopen on the last screen? | No. A returning user always lands on `/tabs/home`. The *tracker* remembers the last project (`currentProjectId`), not the router. | `app.routes.ts:12`; `core/state/app.store.ts:132, 268-271` |
| Can navigation bypass setup? | Yes, by design: setup is optional and its header Back on step 1 goes Home. | `setup.page.ts:179-183`; `app.ts:143` |
| Is there a replay of the intro? | Yes: Settings → "Replay app intro" → `/onboarding/welcome?replay=1`. | `features/settings/settings.page.ts:129, 273-275`; `guards.ts:25` |

### What the existing onboarding already teaches

| Slide | Message (EN) | Overlap with a product tour |
|---|---|---|
| welcome | "Every stitch has a story" | Brand only |
| learn | "Learn and create your way" | Says *that* learning exists, not where |
| track | "Never lose a single stitch… even offline" | Says *that* the counter exists, not where or how |
| assistant | "A companion for every stitch" (+ `Demo` badge when no AI endpoint) | Says *that* Khayoota exists |

The slides are a value pitch shown **before** the user has an account or can see the app. Setup collects preferences. Neither shows where anything is. A product tour that runs **inside** the app, on the real screens, does not duplicate them as long as it never repeats the pitch. That is the rule adopted in `03`.

### Things that can appear on Home right after entry (a tour must wait for all of them)

| Interruption | When | Evidence |
|---|---|---|
| Biometric lock screen (`z-index: 100000`), router outlet `inert` | Cold start with biometric unlock on; after 30 s in background | `app.ts:38, 45-49, 187`; `features/auth/lock-screen.component.ts:45` |
| Biometric *offer* alert | After a successful Google sign-in, before navigation | `auth.page.ts:198-208` |
| Guest-data import confirm alert | After sign-in, once the store has loaded, if the guest scope holds projects or achievements | `app.ts:115-122, 191-201` |
| "Preferences saved" toast | After finishing setup | `setup.page.ts:194` |
| Sync-conflict toast, timer-recovered toast | Launch / resume | `app.ts:88-113` |
| Password-recovery redirect | Reset link opened | `app.ts:84-86` |
| Notification-tap deep navigation | App launched from a reminder | `core/reminders/notification-router.service.ts` (started at `app.ts:127`) |
| Store load flash | `store.loaded()` is false while a scope loads; pages render defaults/empty states first | `core/state/app.store.ts:108-135` |

Not in this list (verified): celebrations and the notification soft-ask never open at app start or on a fresh Home; they need a counting tap or an explicit button (`core/joy/joy-presenter.service.ts:128`; `core/reminders/reminder.service.ts:139-146`).

---

## 2. Navigation shell

- `ion-tabs` with five tabs, order (LTR): Home, Projects, **Tracker** (floating pink centre action), Learn, Khayoota. RTL mirrors the row. `layout/tabs-layout/tabs.config.ts:13-19`.
- Ionic gives every tab button a runtime id `tab-button-<id>` (confirmed in `node_modules/@ionic/core`, and observed: `#tab-button-home`, `-projects`, `-tracker`, `-learn`, `-assistant`).
- The tab bar is hidden only on `/tabs/projects/new` and `/tabs/home/patterns/new` (`tabs.config.ts:28-30`).
- **There is no Patterns tab.** The pattern library is reached from a Home quick tile labelled "Pattern reader" (`features/home/home.page.ts:171`), from the tracker and from project detail.
- **There is no Settings tab or labelled Settings button.** Settings opens from the avatar button at the top of Home; its only label is an `aria-label` (`home.page.ts:35`).
- Android hardware Back: Ionic pops stacks first; then the app's handler at priority −1 exits on Home and returns to Home from other tab roots (`app.ts:136-147`).
- Pages are cached (`IonicRouteStrategy`, `app.config.ts:11`); swipe-back is on.
- `body` is `position: fixed; overflow: hidden` and the window never scrolls; each page scrolls inside `ion-content`'s shadow root (observed: Home's inner scroller is 1145 px tall in a 748 px content area).

---

## 3. Screen-by-screen audit

Legend — **Guidance**: T = multi-step tour, H = single hint, N = nothing. **Cx** = first-use complexity 1–5. All `/tabs/**` pages are reachable by guests and signed-in users (`appGuard`), none is feature-flagged at route level.

| # | Screen | Route | Component | User goal | Primary action | Empty state | Needs data? | Cx | Guidance |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Onboarding slides | `/onboarding/:slide` | `OnboardingPage` | Understand the value | Next / Start | — | No | 1 | N (already is the intro) |
| 2 | Log in / Sign up | `/auth/login`, `/auth/signup` | `AuthPage` | Enter the app | Submit / Google / Guest | — | No | 2 | N (never overlay auth) |
| 3 | Forgot / reset password | `/auth/forgot`, `/auth/reset` | `ForgotPasswordPage`, `ResetPasswordPage` | Recover account | Submit | — | No | 1 | N |
| 4 | Setup | `/setup/:step` | `SetupPage` | Personalise | Continue / Skip | — | No | 2 | N (never overlay setup) |
| 5 | Home | `/tabs/home` | `HomePage` | Resume work, find things | Resume, or New project | "Start your first project" card with button | No | 3 | **T (welcome)** |
| 6 | Projects list | `/tabs/projects` | `ProjectsPage` | Browse and open projects | Open a card | Per-tab empty card + 3 "new" buttons | No | 1 | N |
| 7 | New project | `/tabs/projects/new` | `NewProjectPage` | Create a project | Save (bottom of scroll) | — | No | 3 | **T (2 steps)** |
| 8 | Project detail | `/tabs/projects/:id` | `ProjectDetailPage` | Manage one project | Resume project | Not-found block | A project | 3 | H (Resume) |
| 9 | Tracker | `/tabs/tracker` | `TrackerPage` | Count stitches and rounds | Big tap button | "No active project" card | A current project | 2 simple / 4 pattern / 5 multi-part | **T (variant by mode)** |
| 10 | Pattern library | `/tabs/home/patterns` | `PatternLibraryPage` | Find or add a pattern | Open a row / Add | Never truly empty (2 samples) | No | 2 | **T (3 steps)** |
| 11 | Pattern reader | `/tabs/home/patterns/:id` | `PatternReaderPage` | Read round by round, link to a project | Next round / Track | Blank page if id unknown | A pattern (samples always exist) | 3.5 | **T (3 steps)** |
| 12 | Add / edit pattern | `/tabs/home/patterns/new`, `/:id/edit` | `AddPatternPage` | Save a pattern as text | Save (bottom) | — | No | 3 | H (example + smart paste) |
| 13 | Smart paste | `/tabs/home/patterns/import` | `SmartImportPage` | Convert free text to notation | Convert, then Confirm | — | No | 4 | T later (after first Convert) |
| 14 | Multi-part pattern editor | `/tabs/home/collections/new`, `/:id/edit` | `CollectionEditorPage` | Define parts and quantities | Save (bottom) | "No parts yet" note | No | 4.5 | H later (parts and quantities) |
| 15 | Multi-part pattern detail | `/tabs/home/collections/:id` | `CollectionDetailPage` | Preview and start a project | Start a project | Not-found block | A multi-part pattern (none seeded) | 2 | N |
| 16 | Learn | `/tabs/learn` | `LearnPage` | Find a tutorial topic | Open a topic | "No results / no saved" | No | 2 | N |
| 17 | Video detail | `/tabs/learn/:id` | `VideoDetailPage` | Follow a tutorial while counting | Open YouTube search (leaves app) | — | No | 4 | N (code forbids covering the video) |
| 18 | Terminology | `/tabs/home/terms` | `TerminologyPage` | Look up or convert terms | Tab switch | — | No | 2 | N |
| 19 | Khayoota | `/tabs/assistant` | `AssistantPage` | Ask a crochet question | Send | Greeting bubble | No | 3 | **T (highlight only)** |
| 20 | Achievements | `/tabs/home/achievements` | `AchievementsPage` | See milestones | — | "Start a project" | No | 1 | N |
| 21 | Store | `/tabs/home/store` | `StorePage` | — (teaser, "coming soon") | Register e-mail | — | No | 1 | N (exclude entirely) |
| 22 | Settings | `/tabs/home/settings` | `SettingsPage` | Adjust preferences | — | — | No | 3 | N inside; add a **Tours & help** section |
| 23 | Design System | `/design-system` (no guard) | `DesignSystemPage` | Internal preview | — | — | No | — | N (a tour must never run here) |

### 3.1 Home (`features/home/home.page.ts`)

No `ion-header`. One scrolling column:

| Element | Line | Purpose |
|---|---|---|
| Avatar button `button.gz-avatar-btn` | 35 | Opens Settings. Only cue is the avatar itself. |
| Greeting, name, level | 37-38 | Display |
| Bell (always shows a dot) | 40 | Reminders sheet |
| Heart | 41 | Learn, filtered to saved |
| Current project hero `div.gz-hero` **or** "Start your first project" card | 48-71 | Resume → tracker; or New project |
| "My tools" card | 73-84 | Tools sheet |
| Quick access grid, six `button.gz-qt` tiles | 87-93 | Stitch tracker, Khayoota, **Pattern reader**, Terminology, Video tutorials, New project |
| Previous projects strip | 95-112 | Open a project |
| Store teaser ("Soon") | 114-123 | Store page |

Observed at 375×812 for a brand-new guest: the hero empty card, tools card and the first row of quick tiles are visible without scrolling; the second row is partly under the tab bar.

### 3.2 Projects, New project, Project detail

- **Projects list**: three status tabs, cards sorted by last worked. Three separate "New project" buttons are visible at once when a tab is empty (`features/projects/projects.page.ts:20, 49, 52`).
- **New project** (`new-project.page.ts`): only the name is required (`:255`). The tab bar is hidden. The optional row "Start from a saved pattern" (`:44-54`) is **the** place a pattern becomes a project; it lists multi-part patterns and every standalone pattern that parses, so the two samples always appear. Save is the last element of a long scroll (`:118`). After saving the app goes to the **projects list**, not the tracker (`:282`), though the new project is already the tracker's current project (`core/state/app.store.ts:176-191`).
- **Project detail** (`project-detail.page.ts`): no fixed header. "Resume project" is near the top (`:46`). Long page: status, time, pieces, tracker card, attached pattern with link chips, materials, photos, notes, delete.

### 3.3 Tracker (`features/tracker/tracker.page.ts` + `.html`)

The tracker has **no route id**. It shows `store.currentProject`: the persisted current project, else the most recently worked active one, else the empty state (`app.store.ts:81-85`).

Three layouts depending on how the project was made:

| Layout | When | What is on screen |
|---|---|---|
| Simple | Project without a pattern, or user switched mode | Ring with round label, count and target; badges (remaining, per tap, rounds); **undo — big tap button — reset**; built-in tip text |
| Pattern | Project linked to a parseable pattern | Round pills (jump to any round), instruction card with stitch code and a check badge, small ring, three stat cards, current-step card, "count by" (stitch / group / whole round), **undo — big button — reset** |
| Multi-part | Project made from a multi-part pattern | Everything above **plus** a project completion line, a piece switcher (e.g. "Arms 1/2"), per-piece time |

Verified feature list (what tour copy may and may not claim):

| Capability | Exists? | Note |
|---|---|---|
| Current round | Yes | Both modes |
| Expected stitches per round | Yes | Target (simple) / round total (pattern) |
| Remaining stitches | **Simple mode only** | No explicit "remaining" in pattern mode |
| Increment | Yes | Big button; label is `+N` |
| **Decrement** | **No** | Only Undo (history of 300, survives restart). No redo. |
| Round complete, next round | Yes | The same button becomes "Start round N+1" |
| Previous / jump round | Pattern mode: round pills. Simple mode: only via settings, which zeroes the count and clears undo. |
| Pattern instructions | Yes, pattern mode | Plus "Open pattern reader" |
| Switch pieces, piece quantities | Yes, multi-part projects only | |
| Overall project progress | On the tracker only for multi-part projects | Single projects show it on cards and project detail |
| **Notes** | **Not in the tracker** | Notes live on project detail |
| Timer | Yes, manual | Counting does not start it |
| Auto-save | Yes, every tap, no debounce | IndexedDB; queued for sync when signed in |
| Resume later | Yes | Tracker tab, Home hero, project detail, reminder tap |
| Keep screen awake | Not found | |
| Haptics on a normal tap | No | Only on celebrations |

Side effects of a single tap that a tour must respect: it is written to storage immediately, re-sorts project lists, and can create **permanent** achievement rows (`first_round`) and celebration overlays. A pattern project set to "whole round" completes a round with one tap.

### 3.4 Patterns area

- **Library** (`pattern-library.page.ts`): title reads "Pattern reader". First thing on screen is a notation note. Two chip rows (type: All / Multi-part / Standalone; difficulty). Two sample patterns are always present for every user, including guests (`core/state/factories.ts:76-82`). Add is in the header (`:38`) and again at the bottom of the list (`:96`); both open a sheet asking "Multi-part pattern" or "Standalone pattern".
- **Reader** (`pattern-reader.page.ts`): reading card with the current round, a plain-language explanation, previous/next round; "Link to a project" chips (silently empty when the user has no projects); "Track with this pattern" (works only when a project is linked; otherwise a toast). The first sample opens on round 5.
- **Add pattern**: strict notation textarea; "Fill an example" and "Smart paste" sit below it. PDF and image sources are kept as a reference only; the app states extraction "is not connected", and the file **cannot be opened** afterwards. For guests and offline users the file bytes are not stored at all.
- **Smart paste**: a local, rule-based converter (the UI says "no AI"). Result states: Validated / Needs review / Unsupported. Nothing is saved on this page; Confirm hands a draft back to the editor, where a second Save is required.
- **Multi-part editor**: the longest form in the app; parts have a name, quantity, instructions and assembly notes; three ways to add parts.
- **Vocabulary the UI actually uses**: a collection is never called a "collection"; it is a **"Multi-part pattern"** (باترون بأجزاء). A **part** (جزء) is a definition; a **piece** (قطعة) is one physical item to make, so "Arms ×2" is one part and two pieces. Arabic spelling alternates between باترن and باترون in the code.

### 3.5 Learn, Video, Terminology

- Learn is a static catalogue of 10 topics. The page states that topics open YouTube search results in a new window and that the app does not embed or download videos.
- Video detail's primary button leaves the app. An iframe appears only after the user pastes her own link. The page comment says the video must never be covered or interrupted (`features/video-tutorials/video-detail.page.ts:116`).
- Terminology is local and pre-filled.

### 3.6 Khayoota (`features/ai-assistant/assistant.page.ts`)

The tab is always visible and always usable, but what answers depends on a mode computed from server status:

| Mode | Who | What the UI says |
|---|---|---|
| `rules` | Guests; anyone when AI is off or the status call failed | "Khayoota is unavailable — answers from Gharzetak's rules"; guests also see "needs an account" + Sign in |
| `soon` | Signed-in accounts not on the tester list | "Coming soon" / "still in testing" |
| `consent` | Testers who have not agreed yet | "Needs your OK" |
| `ai` | Testers who agreed | "Khayoota is connected · left today N" |
| `offline` | Anyone without network | "Offline" |
| `demo` | Local development only | "Demo mode" |

Hosted AI is gated on the server by a kill switch, a tester allow-list, consent and quotas (`apps/api/src/routes/ai.ts`). Only a staging environment defines AI; no production environment exists in `apps/api/wrangler.jsonc`. So **for real users today Khayoota is the built-in rules helper**, honestly labelled "not AI".

Tour-relevant behaviour:

- Suggestion chips and "Explain round" **send immediately** on tap. In `ai` mode that spends quota; in every other mode it writes bubbles into the user's saved chat.
- The camera button is never hidden and opens the OS file picker in every mode, although photo analysis works only in `ai` mode.
- Consent is asked on first send, never on page entry. "Agree" immediately sends the pending question.
- The only place to turn AI off is the Khayoota options sheet. Nothing about AI consent exists in Settings.
- The status element exposes the mode as `data-mode` (`:189`), the one machine-readable state hook in the app.
- Observed in the local build (no backend): badge "قواعد غرزتك", status line "خيوطة غير متاحة حاليًا".

### 3.7 Settings (`features/settings/settings.page.ts`)

Rows in order: profile block, sync status or "Create account", name, avatar, **language** (live switch, flips `dir` with no reload), terminology, level, biometric lock (signed-in + supported), immersive display (Android), reminders, celebrations, achievements, edit tools, **Replay app intro**, erase device data, **Sign out** (shown to guests too; sends them back to onboarding), About, Design System link.

Not found anywhere: Help, FAQ, feedback, contact, privacy policy, terms, app version, data export, account deletion, a privacy-controls section.

---

## 4. Cross-cutting findings

| Finding | Detail | Consequence for the tour |
|---|---|---|
| **No stable selectors** | No `data-testid`/`data-tour` in `src/`. Buttons have no ids. `aria-label`s are translated. Classes are shared design-system classes. Only ids: a few form fields and Ionic's `tab-button-*`. | Targets must be added (see `04`, `07`). |
| **No analytics** | No telemetry library, endpoint or event logging in the client. | Metrics need a plan (see `07` §9). |
| **No tour/coach/hint code** | Nothing to reuse or collide with. | Greenfield. |
| **A fitting store for per-user UI state exists** | `ScopeDocs.prefs` (`core/storage/local-db.ts:68-69`; `core/joy/joy.models.ts:67-72`): device-local, per scope (guest and each account separately), not synced, carried from guest to account by the import service. Already holds "soft-ask last shown". | Tour state goes here; no backend change. |
| **Sample patterns are always available** | Two read-only samples in every scope. | Safe material for guided exploration. |
| **No sample project and no sandbox** | The only demo data is a QA button on the unguarded Design System page; it persists into the guest scope. | A practice mode would be new work (see `03` §6). |
| **Primary buttons scroll** | No page uses a fixed footer; Save/Confirm/tap row are in the scrolling content. | Steps need scroll-into-view inside `ion-content`. |
| **Sheets are lazy overlays** | `gz-sheet` is an `ion-modal`; its content does not exist until opened. | No tour steps inside sheets in v1. |
| **Stale "demo" wording** | Settings → About and the Khayoota menu still describe the assistant as fixed replies / demo. | Tour copy must not contradict nearby text; flag for a separate copy fix. |
| **Guest "Sign out"** | Present for guests; returns them to onboarding. | Never point a guest at it. |

## 5. Gaps noticed that are outside this feature

Recorded for the product owner; none is changed by this work.

1. A new e-mail account that confirms its address later never sees profile setup.
2. Pattern reader shows a blank page for an unknown id.
3. The library's page title is "Pattern reader".
4. `/design-system` is unguarded and linked from Settings for every user, with a demo-data button.
5. There is no in-app way to delete an account or reach a privacy policy.
6. `.env.example` gives `/v1/assistant` as the AI endpoint example; the Worker mounts `/v1/ai`.
