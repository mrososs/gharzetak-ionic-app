# Crochet Joy — Architecture

Base commit audited: `f616ee9` (`origin/development`, 2026-11-17). Legend: **[Verified]** observed in code · **[Recommendation]** · **[Assumption]**.

---

## 1. Existing architecture findings

### 1.1 Tracker engine — completion is *derived*, never *recorded* [Verified]

`src/app/core/domain/tracker-engine.ts` is pure and immutable (every call returns a new state).

| Mode | State | "Round complete" | "All complete" | Advance |
|---|---|---|---|---|
| Simple | `SimpleCounter {round, target, perTap, count, totalRounds, history}` | `simpleRoundComplete(s)` = `count >= target` | `simpleAllComplete(s)` = round complete ∧ `totalRounds > 0` ∧ `round >= totalRounds` | explicit: the tap *after* completion calls `simpleNextRound` |
| Pattern | `PatternCursor {roundIndex, ptr, mode: 'action'\|'group'\|'round', history}` | `patternStats(...).roundComplete` = `ptr >= round.acts.length` | `patternComplete` = round complete ∧ last round | `'action'`/`'group'`: last tap leaves `ptr === len`, next tap advances. **`'round'` mode on a non-last round jumps straight to `{roundIndex+1, ptr:0}` — a "complete" state is never stored.** |

Consequences for Crochet Joy:
- There is **no** completion event, completed flag or per-round timestamp anywhere (local or D1). The only stored completion is `Project.status = 'done'` (`ProjectStatus = 'active' | 'paused' | 'done'`), set manually and reversible (`ProjectDetailPage.setStatus`).
- Detection must compare **before → after** of a user command, not observe a state.
- Existing ad-hoc "congrats" exist and must be replaced, not duplicated:
  - `TrackerPage.finishProject()` → `ui.say('مبروك! المشروع اتحوّل إلى «مكتمل».', …)` (`src/app/features/tracker/tracker.page.ts:302-307`)
  - `ProjectDetailPage.setStatus('done')` → `ui.say('مبروك على المشروع المكتمل!', …)` (`src/app/features/projects/project-detail.page.ts:332`)
  - `doneMsg` + `gz-pulse` note in `tracker.page.html` (lines ~56/110) — keep, it is state, not a celebration.

### 1.2 Who mutates the tracker [Verified]

All writes go through `AppStore.updateTracker(id, fn)` / `AppStore.updatePartTracker(projectId, instanceId, fn)` (`src/app/core/state/app.store.ts:188`, `:397`), which call `updateProject` and queue outbox kind `progress`. **Callers mix user taps with non-tap edits**:

| Caller | Is a user "crochet progress" tap? |
|---|---|
| `TrackerPage.tap()` (`TAP_GUARD_MS = 120` debounce) | **Yes** |
| `VideoDetailPage.tap()` (`src/app/features/video-tutorials/video-detail.page.ts:133-146`) — second tap surface; re-parses the **live** pattern text, ignoring `patternPin` | **Yes** |
| `TrackerPage.undo/confirmReset/setMode/setCountMode/jump/linkPattern` | No |
| `PatternReaderPage` (`:205`, `:218` — jump to round) | No |
| `ProjectDetailPage` (unpin/update pattern → `mapCursor`, set `totalRounds`) | No — **can flip a round/pattern to complete** (`mapCursor` `beyond-end` → `ptr = acts.length`) |
| `AppStore.applyCollectionUpdate`, `unpinProject`, simple setters (`simpleSetTarget` clamps count → may complete the round) | No |
| `SyncService.pull()` → `applyMerged()` → `store.projects.set(...)`; `mergeMultiConflict`; `AppStore.load(scope)`; `GuestImportService` | No — these replace signals wholesale |

→ **An `effect()`/`computed()` that diffs completion would misfire** on sync, merge, restart, account switch, pattern update and guest import. Detection must be opt-in at the command call site.

### 1.3 Multi-part [Verified]

`src/app/core/domain/collections.ts`: `PartInstance {id, partId, index, mode, simple, cursor, workedSeconds, updatedAt, retired?}`; `instanceProgress(inst, snap).done`; `projectCompletion()` → `{fraction, percent, doneCount, total}`; `activeInstance()`, `nextUnfinished()`; switching via `store.setActiveInstance` (bumps `updatedAt`, queues `progress`). Conflicts: `mergeInstances` (newer `updatedAt` wins per piece, time = max).

### 1.4 Undo/reset [Verified]

Per-tracker snapshot stack (`history`, `HISTORY_LIMIT = 300`), persisted in IndexedDB, truncated on the wire (`.slice(-100)`, `.slice(-50)` per instance). `simpleReset`/`patternReset` clear history. No append-only log exists.

### 1.5 Time [Verified]

`TimerService` (`src/app/core/services/timer.service.ts`): segments, durable `ScopeDocs.timer` with 5 s beat, `recover()` on launch; commit adds to `Project.workedSeconds` and `PartInstance.workedSeconds` and queues an immutable `session` (`work_sessions` in D1). `compareTime()` in `src/app/core/domain/time.ts`. → "Recorded time" for share cards = `Project.workedSeconds` (+ live running segment).

### 1.6 Persistence & scope isolation [Verified]

`src/app/core/storage/local-db.ts`: DB `gharzetak`, `DB_VERSION = 3`, additive upgrades. Stores `projects`, `patterns`, `collections`, `patternRevs`, `docs`, `outbox`, `revisions`, keyed `${scope}|…` with `Scope = 'guest' | 'user:${id}'`. `ScopeDocs` (in `docs`) already has **`prefs: { immersive?: boolean }`** — declared, effectively unused → natural home for Joy/reminder prefs. `clearScope(scope)` deletes everything for a scope; logout does **not** wipe IndexedDB (scope switch reloads). Guest scope never queues outbox writes. Precedent for an idempotent append-only ledger: `putPatternRev` (deterministic id, insert-if-absent, returns boolean).

### 1.7 Photos [Verified]

Cover: `Project.coverLocalUrl` (JPEG data URL, max edge 1280, from `readImageFile` in `src/app/core/utils/image.ts`) + `coverPath` (R2 key). Gallery: `Project.photos: ProjectPhoto {id, localUrl?, storagePath?, createdAt}`. Offline-displayable: `coverLocalUrl` / `localUrl`; otherwise `SyncService.mediaUrl(path)` → authenticated `blob:` URL (online, memory-cached). After a pull, `coverLocalUrl` may become `null` when `coverPath` changed. Both data: and blob: URLs are same-origin → **canvas is not tainted**, so on-device share-card rendering is possible.

### 1.8 UI, navigation, native [Verified]

- Feedback: `UiFeedback` (`src/app/shared/ui/feedback/toast.service.ts`) — `toast`, `say(ar,en)`, `confirm`; Ionic toast 2600 ms, anchored to the tab bar; no icon/action variants.
- Sheets: `<gz-sheet>` (`src/app/shared/ui/dialogs/sheet.component.ts`) — `ion-modal` breakpoints `[0,1]`, `gzActions` slot, `.gz-dlg-actions` sticky, `role="dialog"`. No full-screen celebration primitive (only `LockScreenComponent`).
- Buttons/tokens: `.gz-btn` (primary), `.gz-btn2` (outlined secondary), `.gz-btn3` (tonal), `.gz-btn-text`, `.gz-note.*`, `.gz-card.*`, `.gz-badge`; `src/theme/tokens.css` (motion tokens `--gz-dur-pop 600ms`, `--gz-dur-glow 1400ms`, …); global `prefers-reduced-motion` kill-switch in `src/theme/components.scss`. `<gz-ring [done]>` with `aria-live="polite"`.
- Avatars: 6 SVGs `public/assets/avatars/{bunny,cat,bear,sheep,flower,yarn}.svg` (160×160 viewBox, 3.2–5.6 KB, one "happy closed eyes" face each, generated by `scripts/avatars/build-avatars.mjs`); model `src/app/core/data/avatars.ts` (`AVATAR_IDS`, `AVATARS[id].tint`, `avatarSrc`); `<gz-crochet-avatar [id] [size] [decorative]>`; persisted in `Profile.avatarId` (synced, D1 `profiles.avatar_id`).
- i18n: `I18nService.q(ar,en)` inline (≈271 uses) or `strings.ts` keys; Arabic copy is consistently feminine Egyptian; no gender switch.
- Routes (`src/app/app.routes.ts`): `/tabs/tracker` has **no params**; the tracker shows `store.currentProject` + active instance. Opening a part today = `setActiveInstance` → `timer.switchInstance` → `setCurrentProject` → `navigateRoot('/tabs/tracker')` (`project-detail.page.ts openPart`).
- Guards (`src/app/core/auth/guards.ts`): `appGuard`/`entryGuard` await `auth.init()` and `auth.untilUnlocked()`. Biometric relock after 30 s in background (`RELOCK_AFTER_MS`, `app.ts`), outlet `inert` while shielded. **A warm `navigateRoot` to an already-matched route is not re-guarded** → the notification router must itself await `untilUnlocked()`.
- Deep links: `appUrlOpen` → `auth.handleDeepLink` (auth reset only). Android Back: `subscribeWithPriority(-1)` in `app.ts`.
- Native: `minSdk 24`, `compile/targetSdk 36`; manifest permissions only `INTERNET`, `USE_BIOMETRIC`; `MainActivity` `singleTask`; custom `ImmersivePlugin` (precedent for small native helpers); FileProvider present. **No notification, haptics, share or filesystem plugin installed.** Lifecycle listeners only in `src/app/app.ts` (`pause`, `resume`, `visibilitychange`). iOS project exists (no URL types registered).
- A placeholder already exists: `NotificationsSheetBody` (`gz-notif-sheet-body` in `src/app/shared/ui/dialogs/common-sheets.ts`, opened from `home.page.ts:128`) showing "Work reminders are not available yet — coming soon." → becomes the reminder entry point.

### 1.9 Backend [Verified]

Hono Worker `apps/api` — per-entity versioned `PUT`s (CAS on `revision`), full-snapshot `GET /v1/sync/pull`, Better Auth bearer sessions, `owner_id` scoping, private R2 proxied through the Worker. D1 has **no** events/achievements/devices tables. See `cloudflare-readiness.md` for the live environment.

### 1.10 Reuse vs. missing

| Need | Reuse | Missing (new) |
|---|---|---|
| Completion maths | `simpleRoundComplete`, `patternStats`, `instanceProgress`, `projectCompletion` | pure transition detector |
| Event dedupe | `putPatternRev` pattern, scope-keyed stores | `joy` IndexedDB store (DB v4) |
| Preferences | `ScopeDocs.prefs` | `joy` + `reminders` sub-objects |
| Feedback UI | `<gz-sheet>`, `.gz-note`, `.gz-btn*`, motion tokens, `<gz-ring>` | mini-banner host, part sheet body, finale overlay |
| Avatars | 6 SVGs + `<gz-crochet-avatar>` | CSS reaction layer + 4 shared overlay SVGs |
| Sharing | photos (data/blob URLs), `workedSeconds`, `projectCompletion` | Canvas renderer, `@capacitor/share` + `@capacitor/filesystem` |
| Reminders | `NotificationsSheetBody` placeholder, `app.ts` lifecycle hooks, `ImmersivePlugin` native precedent | `@capacitor/local-notifications`, planner, router |
| Haptics | — | `@capacitor/haptics` |

No duplicate systems are introduced: one ledger (not separate "celebration" and "achievement" stores), one prefs object (inside existing `ScopeDocs.prefs`), one feedback service extended (not a second toast system), one lifecycle hook site (`app.ts`).

---

## 2. Proposed component map

```
                    user tap (TrackerPage.tap / VideoDetailPage.tap)
                                   │  origin: 'tap'
                                   ▼
AppStore.updateTracker / updatePartTracker(…, fn, { origin })   ← only 'tap' and 'finish' run detection
                                   │ before, after
                                   ▼
core/domain/joy.ts  detectJoy(before, after, ctx) → JoyCandidate[]   (pure, unit-tested)
                                   │
                                   ▼
core/joy/joy-ledger.service.ts  record(candidate) → boolean (insert-if-absent, IndexedDB 'joy')
                                   │ only newly inserted
              ┌────────────────────┼─────────────────────────┐
              ▼                    ▼                         ▼
 core/joy/achievements.ts   core/joy/joy.service.ts   core/reminders/reminder-planner.service.ts
 evaluate(ledger, store)    level → presenter          replan() (debounced)
              │                    │
              ▼                    ▼
   unlock (ledger 'a|…')   shared/ui/joy/  JoyBannerHost · PartDoneSheet · ProjectFinale · AvatarReaction
                                   │
                                   ▼
                     features/share-card/ ShareCardService (Canvas → PNG → Filesystem cache → Share)
```

New folders (proposal): `src/app/core/joy/`, `src/app/core/reminders/`, `src/app/shared/ui/joy/`, `src/app/features/share-card/`, `src/app/features/settings/reminders/` (or a section in `settings.page.ts`), `src/app/features/achievements/`.

---

## 3. Event model (idempotent milestones)

### 3.1 Definitions — when is something "complete"?

Detection runs **only** when the caller passes `origin: 'tap'` (counting) or `origin: 'finish'` (explicit "mark project done"). For every other origin (`undo`, `reset`, `jump`, `edit`, `sync`, `merge`, `load`, `import`, `settings`) no candidate is produced.

| Event | Fires when (before → after of one `origin:'tap'` command) |
|---|---|
| `round` (simple) | `before.count < before.target` ∧ `after.round === before.round` ∧ `after.count >= after.target`. The *next* tap (`simpleNextRound`) is **not** an event. Round id = `before.round`. |
| `round` (pattern) | `before.ptr < len(before.roundIndex)` ∧ (`after.roundIndex > before.roundIndex` ∨ `after.ptr >= len`). Covers `'round'` mode's direct jump. The advance-from-complete tap (`before.ptr >= len`) is **not** an event. Round id = `before.roundIndex`. Requires the parse used for detection = the parse used for the tap (pinned text). |
| `milestone` | evaluated after a `round` event: part/pattern percent crosses 25 / 50 / 75 % (pattern mode or simple with `totalRounds > 0`), or every 10th round in open-ended simple mode. |
| `part` | multi-part: `instanceProgress(before).done === false` ∧ `instanceProgress(after).done === true`. |
| `allParts` | multi-part: `projectCompletion(before).doneCount < total` ∧ `after.doneCount === total` (prompts "mark project done"). |
| `project` | `origin:'finish'` — `TrackerPage.finishProject()` or `ProjectDetailPage.setStatus('done')` (user explicit). Single-tracker projects reach "complete" only via this explicit action (consistent with today's `canFinish` button). |

### 3.2 Dedupe keys (deterministic, scope-prefixed by the store)

```
round      r|{projectId}|{instanceId ?? '-'}|{roundId}
milestone  m|{projectId}|{instanceId ?? '-'}|{pct|r10n}
part       p|{projectId}|{instanceId}
allParts   P|{projectId}
project    j|{projectId}
achievement a|{achievementId}
```

`JoyLedger.record(key, payload)` = IndexedDB `add` inside a transaction; returns `true` only when the key was absent. **Persist first, present second** — a crash after persist loses a celebration (acceptable), never duplicates it.

### 3.3 How each hazard is neutralized

| Hazard | Why it cannot double-fire |
|---|---|
| Every counter tap | Only the transition into "round complete" is a candidate; mid-round taps produce nothing. |
| Undo → re-complete | `undo` origin produces nothing; re-completing yields the same key → `record()` returns false. |
| App restart | Ledger is persisted; nothing is diffed on `load()`. |
| Sync / merge / pull | Those paths never call the detector. A round completed on device A is never re-celebrated on device B. |
| Switching parts | `setActiveInstance` is not `origin:'tap'`; keys include `instanceId`. |
| Pattern edits / `mapCursor` / `applyCollectionUpdate` / target or total-rounds setters | Not `origin:'tap'` → no event even if the state becomes "complete". If a later tap completes a round whose index already has a key, it stays silent (we prefer under-celebrating to false celebrating). |
| Incomplete/invalid rounds | Pattern rounds with `acts.length === 0` or unparsable patterns → `patternContext` null → no candidate. Simple rounds with `target <= 0` impossible (`clampInt`). |
| Account switch | Ledger rows are scope-prefixed; `clearScope` deletes them with the scope's data. |
| Guest import | `GuestImportService` doesn't call the detector. The guest ledger is migrated (not re-derived) with remapped project ids, silently; durable achievements are additionally back-filled silently (§4.3). |
| Rapid "round" mode taps | Presenter coalesces: ≤ 1 Level-1 banner per 20 s; if suppressed, the next banner says "3 rounds done!" (still one ledger row per round). |

### 3.4 Persisted vs. ephemeral

| Data | Where | Why |
|---|---|---|
| Ledger rows (round/milestone/part/allParts/project/achievement) | **IndexedDB `joy` store** (persisted, scope-keyed) | dedupe across restarts; source of truth for counters/achievements |
| Banner queue, animation state, "suppressed count" | **in-memory signals** (`JoyService`) | UI only; losing it is harmless |
| Achievement unlocks across devices | IndexedDB; optionally D1 `user_achievements` (P2b) | only small, rare, idempotent rows ever leave the device |
| Round events | **never** sent to D1 | volume (Free-tier writes), privacy, zero value cross-device |

Ledger size: ≈ 1 row per completed round (+ few per project). A heavy user (50 projects × 60 rounds) ≈ 3,000 rows × ~150 B ≈ 0.5 MB. Rows of a project are deleted when the project is erased (`clearScope` / hard delete); soft-deleted projects keep theirs (achievements stay unlocked).

---

## 4. Achievements

### 4.1 Definitions (MVP)

| id | Unlock condition | Source of truth | Back-fill at feature launch? |
|---|---|---|---|
| `first_round` | first `round` ledger row | ledger | No (can't know history) |
| `rounds_10` / `rounds_50` | count of `round` rows ≥ 10 / 50 | ledger | No |
| `first_project` | first project ever created (any `Project` in scope, incl. soft-deleted? → no, live only) | durable project data | **Yes** (silent, marked "earned earlier") |
| `first_multipart` | first project with `collectionId` and ≥ 2 part instances | durable | Yes |
| `first_piece` | first `part` ledger row **or** any multi-part instance already `done` at launch | ledger + durable | Yes |
| `first_finished` | first project with `status === 'done'` (`project` ledger row or existing done project) | durable | Yes |
| `first_amigurumi` | first project with `category === 'amigurumi'` and `status === 'done'` (`CAT_IDS` in `src/app/core/data/catalog.ts`) | durable | Yes |

Round-count achievements count **only rounds completed by a tap after the feature ships** — they are never inferred from cursor positions (jumps, edits and imports make those unreliable). Copy says "since you started counting with Gharzetak".

### 4.2 Rules

- Unlock = ledger row `a|{id}` (insert-if-absent) → celebration only when the unlock came from a live event; back-filled unlocks are silent.
- **Never re-locked**: undo, reverting a project from `done`, or deleting a project does not remove an achievement (it was legitimately earned). The `round`/`part` ledger rows also stay, so re-doing doesn't double count.
- Deleted projects: their round rows remain (counts don't drop) until the scope is erased.
- **Approved change (Q3) — guest → account import preserves the guest ledger.** `GuestImportService.importGuestData()` now migrates the guest `joy` rows through `JoyLedgerService.importFromGuest(target, projectMap)`:
  - **project mapping** — the same `guest id → account id` map the project import builds (identical projects map to themselves; an id collision with a different account project is remapped to a new uuid; rows of guest projects that no longer exist keep their original id);
  - **merge** — insert-if-absent into the account ledger (`LocalDb.mergeJoyRow`): a row the account already has is a duplicate (never counted twice); an achievement keeps the **earliest** unlock date; keys are rebuilt from the row's content (`joyKey`), never by string surgery;
  - **no celebrations** — the import writes through the DB layer, never through `JoyService`;
  - **no invented counts** — rows come only from the ledger; tracker positions are never read to create round counts;
  - **idempotent and resumable** — a journal `ScopeDocs.importMap` (guest project id → account project id) is written to the guest scope after each project, so a retry after an interruption maps the same ids instead of importing duplicates;
  - **verify before erase** — after merging, every intended row is re-read from the account; `failed > 0` ⇒ the guest scope is **not** cleared (`ImportReport.incomplete`), the user is told, and a retry is safe;
  - **recoverable limitation** — a row that is malformed or whose stored key no longer matches its content is NOT guessed at: it is appended to the account's `ScopeDocs.joyRecovery` and reported (`recovered`);
  - **scope isolation** — only the `guest` scope is read; other accounts' rows are never touched;
  - **preferences** — the guest's celebration and share-card preferences are carried to an account that has none; the **reminder opt-in is never carried** (an OS notification schedule needs its own explicit opt-in per account);
  - a guest with achievements but **no projects** is still offered the move (`refresh()` reports `{projects, joy}`).

### 4.3 Cross-device — DEFERRED (Q2)

Achievements are **device-local and account-scoped**; they do not follow the user to another phone in this MVP (the Achievements screen says so). **P2b and migration `0004` are not implemented.** If it is ever approved: `PUT /v1/achievements/:id` (idempotent), `achievements` in `GET /v1/sync/pull`, local merge = union.

---

## 5. Data models (TypeScript, proposed)

```ts
// src/app/core/joy/joy.models.ts
export type JoyKind = 'round' | 'milestone' | 'part' | 'allParts' | 'project' | 'achievement';
export interface JoyRow {
  readonly key: string;            // e.g. 'r|p1|-|5'  (store key = `${scope}|${key}`)
  readonly kind: JoyKind;
  readonly projectId: string | null;
  readonly instanceId: string | null;
  readonly at: number;             // epoch ms
  readonly source: 'live' | 'backfill';
  readonly meta?: { round?: number; pct?: number; achievementId?: AchievementId };
}
export type CelebrationLevel = 1 | 2 | 3 | 4;

// ScopeDocs.prefs (src/app/core/storage/local-db.ts) — additive, all optional
prefs: {
  immersive?: boolean;
  joy?: {
    celebrate: 'every' | 'milestones' | 'off';   // default 'every'
    messages: boolean;                           // motivational lines in-app, default true
    haptics: boolean;                            // default true
    motion: 'system' | 'reduced';                // default 'system' (honours OS reduced-motion)
  };
  reminders?: ReminderPrefs;
  share?: { photo: boolean; avatar: boolean; time: boolean; parts: boolean; name: boolean }; // last used toggles
};

export interface ReminderPrefs {
  readonly v: 1;
  readonly enabled: boolean;                       // default false (opt-in)
  readonly time: string;                           // 'HH:mm', default '19:30'
  readonly days: readonly (1|2|3|4|5|6|7)[];       // ISO weekday, default two days (Sun, Wed)
  readonly cadence: 'twice' | 'thrice' | 'daily' | 'custom';
  readonly quiet: { start: string; end: string };  // default 22:00–08:00
  readonly nudges: { inactive: boolean; almostDone: boolean; photo: boolean };
  readonly projectId: string | null;               // null = "my most recent unfinished project"
  readonly showDetails: boolean;                   // project/part names on the lock screen — default false
  readonly askedAt?: number;                       // last soft-ask shown
}

// ScopeDocs (src/app/core/storage/local-db.ts) — additive, as implemented in P0:
//   prefs: ScopePrefs                    // { immersive?, joy?, reminders?, share? } — all optional, safe defaults in joy.models.ts
//   importMap: Record<string,string>     // guest → account project-id journal (lives in the GUEST scope during an import)
//   joyRecovery: JoyRow[]                // ledger rows that could not be migrated safely (account scope)
```

Device-level (not scope) state — OS alarms are device-global:

```ts
// localStorage 'gz.reminders.plan'  (like 'gz.lang' / 'gz.guest')
interface ReminderPlanState { owner: Scope; ids: number[]; hash: string; tz: string; plannedAt: number }
```

IndexedDB v4 upgrade (additive): `if (oldVersion < 4) db.createObjectStore('joy', { keyPath: 'k' }).createIndex('scope', 'scope')`; add `'joy'` to the `GzDb` schema and the `clearScope` transaction list.

D1 — **NOT IMPLEMENTED (deferred by Q2). Kept only as a future option** (`apps/api/drizzle/0004_crochet_joy.sql` does not exist):

```sql
CREATE TABLE user_achievements (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('live','backfill')),
  PRIMARY KEY (user_id, achievement_id)
);
```

No other schema change. Nothing destructive.

---

## 6. Offline-first design

- Everything in P1–P4 works with no network and for guests: detection, ledger, celebrations, achievements, share cards (photo must be locally available — `coverLocalUrl`/`localUrl`; if only `storagePath` exists and we're offline, the card renders without the photo and says so), reminders.
- No Crochet Joy write enters the outbox in MVP → no new sync conflicts. P2b achievements use insert-if-absent semantics (no `revision`, no conflicts; union merge).
- Reminders are planned from local state, so they reflect offline progress immediately.

## 7. Reminder planner (local notifications)

- `ReminderPlannerService.replan(reason)` — debounced 1 s; triggers: prefs change, app launch, `resume`, scope change, project status/delete, tracker activity (throttled to once per 10 min), timer stop, time-zone change (compare `Intl.DateTimeFormat().resolvedOptions().timeZone` with `plan.tz`).
- Algorithm: cancel `plan.ids` (any scope) → if `!enabled` or no permission → stop. Otherwise produce **one-shot `at` notifications for the next 28 days** (rolling horizon — deliberately no infinite repeats: if the app isn't opened for 4 weeks, reminders stop on their own). Per ISO week ≤ cap (`twice`=2, `thrice`=3, `daily`=7). Skip a slot if `now`-side activity happened within 6 h before it (known at plan time; re-plan on activity), if it falls in quiet hours, or if the target project is `done`/deleted. One contextual nudge (`inactive` after 3 days idle at the preferred time, or `almostDone` when the target part/pattern is ≥ 85 % and ≤ 3 rounds left) **replaces** — never adds to — the next scheduled slot.
- IDs: deterministic ints `7_000_000 + dayIndex*10 + slot` so cancel/replace is exact and other future notification types can use other ranges.
- Content chosen at plan time from the copy pool (`ux-specification.md` §7); generic unless `showDetails`.
- Channel `gz_reminders_v1` (importance DEFAULT 3, visibility PRIVATE 0), created once at startup when reminders are enabled.
- `extra: { v: 1, kind, scope, projectId, instanceId }` — never pattern text.

## 8. Notification tap routing

`NotificationRouter` (registered in `app.ts ngOnInit`, before first navigation, alongside existing `CapApp` listeners):

1. `localNotificationActionPerformed` → store `pending = extra`.
2. `await auth.init(); await auth.untilUnlocked();` (biometric gate respected for cold and warm starts).
3. If `extra.scope !== auth.scope()` (logged out / switched account) → drop intent, go to normal start route. No data from another account is opened.
4. `await store.whenScopeLoaded(scope)`; resolve project: missing/soft-deleted → `/tabs/projects` + toast "This project isn't here anymore"; `done` → project detail; else `setActiveInstance(instanceId)` if the instance exists and isn't retired (else `nextUnfinished`) → `timer.switchInstance` → `setCurrentProject` → `navigateRoot('/tabs/tracker')`. The current round is the tracker's own cursor (rounds are not URL-addressable and don't need to be).
5. Reuses the exact sequence of `ProjectDetailPage.openPart` → extract it into `AppStore.openTrackerFor(projectId, instanceId)` so both paths share code.

## 9. Share-card pipeline (on device)

`ShareCardService.render(spec) → Blob` using an offscreen `<canvas>` 1080×1350 (4:5, WhatsApp/Instagram friendly; scaled draw, `devicePixelRatio`-independent). Await `document.fonts.load('700 48px "Playpen Sans Arabic Variable"')` before drawing; `ctx.direction = dir`. Images: project photo (data:/blob:), avatar SVG (`assets/avatars/{id}.svg`), brand mark — all same-origin. `canvas.toBlob('image/png')` (fallback `image/jpeg` 0.9 if > 2.5 MB). Native: base64 → `Filesystem.writeFile({ directory: Directory.Cache, path: 'share/gz-card-<ts>.png' })` → `Share.share({ files: [uri], text, dialogTitle })`; clean old files in `share/` on next run. Web/dev: `navigator.share({ files })` if `canShare`, else download link.

---

## 10. As built (P0–P4, implemented 2026-11-17)

This section records where the implementation differs from, or makes precise, the proposal above. The code is the source of truth.

### 10.1 Detection and ledger
- `core/domain/joy.ts` — pure `detectJoy(before, after, ctx)`. Only the origins `tap` and `finish` can produce events; `undo`, `reset`, `edit`, `sync`, `load`, `import` and `settings` produce none. This is defended twice: `AppStore` only captures the "before" state for `tap`/`finish`, and `detectJoy` independently returns `[]` for every other origin.
- Pattern "round" mode jumps to the next round, so detection compares before/after positions rather than counting increments. An empty round never completes. "Advance from an already-complete round" is not an event.
- Milestones carry the round count (`round`), and open-ended simple counting has a milestone every 10th round (`OPEN_ENDED_MILESTONE_EVERY`). 25/50/75 % needs at least 4 rounds.
- IndexedDB **v4** adds the `joy` store (key `${scope}|${row.key}`, insert-if-absent in one readwrite transaction). Scopes are `guest` and `user:<id>`. Persist **before** presenting. Ledger failures are swallowed — counting is never affected.
- Video counter: `VideoDetailPage` now counts through the same `AppStore` path and detection as the main tracker and reads the **pinned** pattern revision (`store.trackerView`) instead of the live pattern text (bug fixed). It only gets a lightweight inline line, never an interruption of playback.

### 10.2 Presentation
- `JoyService` turns store events into batches (`requests`, `badges`, `repeats`); `JoyPresenter` shows them. Level 1 is a banner (rate-limited: 20 s window, coalesced summary), level 2 a **compact one-row milestone card** (~53 px, 44 px targets, sits above the counter ring instead of covering it), level 3 the part sheet, level 4 the project finale. In "Off" mode a finished project still gets one plain confirmation.
- A new badge **replaces** the plain round banner for that tap. Presentation is skipped when the store is not loaded or the scope changed.

### 10.3 Achievements
- Eight badges. Live evaluation is restricted to what the triggering action can actually earn (`EARNED_BY_EVENT`, `EARNED_BY_CREATION`) so a round tap can never celebrate an unrelated badge (e.g. "First project"). Everything else is back-filled **silently** on scope load and on app resume. Badges are never re-locked; round counts come only from real ledger rows.
- Device-local and account-scoped. No Cloudflare sync (Q2); the UI says so.

### 10.4 Guest → account import (Q3)
- `GuestImportService` keeps a journal (`ScopeDocs.importMap`) so the import is resumable and never double-counts. `JoyLedgerService.importFromGuest` remaps project ids, merges with existing account rows (`mergeJoyRow`: earliest achievement date wins, existing rows are untouched) and never celebrates. Rows that cannot be mapped go to `ScopeDocs.joyRecovery` (a recoverable copy). The guest scope is cleared **only if nothing failed**. Counts are never fabricated from tracker positions. Guest joy/share preferences are carried over; **reminder settings are never carried**.

### 10.5 Share cards (P3)
- The pure model (`share-card.ts` + `share-source.ts`) is the privacy boundary: a whitelisted `ShareSource` with narrow input types plus five toggles (photo, avatar, time, parts, project name). Email, account id, notes, pattern instructions and auth data cannot reach the model.
- Canvas renderer 1080×1350 against a minimal `Ctx2D` interface (RTL text, fit-to-width, wrapping). Images load through `onload` + timeout (**not** `img.decode()`, which never resolves in a hidden page). Render, image and encode timeouts exist; a failed render shows a retry state and the app keeps working.
- Native: PNG written to the cache directory (the app's FileProvider already exposes `<cache-path>`), then `@capacitor/share`. Cancelling is silent. Fallback is a text share. Nothing is uploaded anywhere. No QR code and no store URL (Q5).

### 10.6 Reminders (P4)
- `planReminders` is pure and DST-safe (zone maths via `Intl`). A rolling **28-day** window of **one-shot** notifications is re-planned on launch, resume and any change, debounced and off the counting path. Weekly caps: twice 2 / thrice 3 / daily 7 / custom. Quiet hours support overnight wrap. Nothing within 6 h of a session. Nudges (almost done ≥ 85 % > inactive ≥ 3 days > photo) **replace** the first slot and never add one. Generic text unless "show details" is on. IDs live in the reserved range `[7_000_000, 8_000_000)`. Channels: `gz_reminders_v1` (private) and `gz_reminders_details_v1` (public).
- Payload has five fields (`v`, `kind`, `scope` = one-way fingerprint of the owner, `projectId`, `instanceId`). It never holds the account id, names or pattern text.
- `ReminderService` never prompts by itself: the only path to the system dialog is `enable()`, called after "Yes" in the soft-ask. Everything is cancelled on logout, account switch, "disable all", revoked permission and when there is nothing to continue.
- **Plugin facts (verified from `@capacitor/local-notifications` 8.3.1 source):** `schedule()` auto-requests POST_NOTIFICATIONS if it is missing, so it is never called without a granted permission. `isExactNotification` defaults to **true** and would open the exact-alarm settings screen, so every reminder sets `isExactNotification: false` + `allowWhileIdle: true`. The plugin manifest declares `SCHEDULE_EXACT_ALARM`; the app removes it with `tools:node="remove"`. The plugin re-arms on BOOT_COMPLETED; one-shots whose time passed while the phone was off fire about 15 s after boot — a stale-burst limitation (see risks).
- `NotificationRouter` (§8) is implemented in this order: validate payload → `auth.init()` → wait for the biometric unlock → signed-in user or guest → fingerprint equals the current scope → wait for that scope's data → validate project and piece → navigate. Navigation goes through `TrackerNavigator` (extracted from `ProjectDetailPage.openPart`). Outcomes: `ignored`, `superseded`, `blocked`, `wrong-account`, `opened`, `missing`, `done`, `projects`.

### 10.7 Test infrastructure
- Vitest through `@angular/build:unit-test`. `angular.json` sets `"isolate": true` — without it `vi.mock('@capacitor/core')` stopped applying when another spec evaluated the module first (order-dependent failures).
- Unit tests use the in-memory LocalDb fallback, so the **real IndexedDB** path (v3→v4 upgrade, the insert-if-absent transaction) is covered only by browser/device verification, not by unit tests.
