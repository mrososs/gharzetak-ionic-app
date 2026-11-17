# Crochet Joy — Implementation Plan

> **Approved 2026-11-17 for full MVP implementation (P0–P5).** Decisions Q1–Q8 are final (see `risks-and-decisions.md` §0). Deltas from this plan: **P2b is cancelled** (Q2 — no migration `0004`); **guest-ledger migration is added to P0** (Q3, approved change); the video counter fix (pinned revision) is part of P0 (Q4); no Cloudflare changes anywhere (Q8).

Estimates are **AI-assisted engineering days** (one developer + Claude Code), excluding waiting for physical-device access and design sign-off. They assume the architecture in `architecture.md` is approved as-is.

| Phase | Scope | Estimate | Cloudflare changes | Depends on |
|---|---|---|---|---|
| P0 | Event foundation (detector, ledger, prefs, origins) | 1.5–2 d | None | approval of this plan |
| P1 | In-app round celebrations + avatar reactions + Celebrations prefs | 2–2.5 d | None | P0 |
| P2 | Milestone / part / project celebrations + achievements | 2.5–3 d | None (P2b optional: 0.5–1 d, additive migration) | P0, P1 |
| P3 | Share cards (Canvas → PNG → share sheet) | 2–3 d | None | P2 (entry points), can start after P0 |
| P4 | Local reminders (plugin, planner, settings, opt-in, deep link) | 3–4 d | None | P0 (prefs); independent of P1–P3 |
| P5 | Hardening, a11y, battery/lifecycle, physical-device QA | 2–3 d | None | P1–P4 |
| P6 | Remote push (documented only) | not scheduled | Yes | real requirement |
| **Total MVP (P0–P5)** | | **≈ 13–17.5 d** | **None** | |

Parallelism: after P0, **P4 can run alongside P1–P3** (different files: `core/reminders/*`, settings section, `app.ts` listener). P3 can start once P0 lands (it only needs the progress data and a stub entry point).

Commit convention matches the repo (`feat(joy): …`, `feat(reminders): …`, `test(joy): …`, `docs(joy): …`). One feature branch per phase off `development` (e.g. `feat/crochet-joy-p0-foundation`).

Before any phase: invoke the `/angular-developer` skill (project hook requirement) and follow existing patterns (standalone components, signals, `inject()`, `I18nService.q`).

---

## P0 — Architecture & event foundation

**Scope**
1. `src/app/core/domain/joy.ts` — pure `detectJoy(before, after, ctx): JoyCandidate[]` implementing `architecture.md` §3.1 for simple, pattern (all 3 count modes) and multi-part; `roundOrdinal()` helper.
2. Origin plumbing: add an optional `opts?: { origin?: TrackerOrigin }` to `AppStore.updateTracker` and `updatePartTracker` (`src/app/core/state/app.store.ts:188`, `:397`); default `'edit'` (no detection). `TrackerPage.tap()` and `VideoDetailPage.tap()` pass `'tap'`. Fix `VideoDetailPage.tap()` to parse the **pinned** text (same helper the tracker uses) so detection and tapping agree.
3. Extract `AppStore.openTrackerFor(projectId, instanceId)` from `ProjectDetailPage.openPart` (reused by P4 router).
4. IndexedDB v4: `joy` store (+ `scope` index), `GzDb` schema, `clearScope` list (`src/app/core/storage/local-db.ts`). In-memory fallback map support.
5. `src/app/core/joy/joy-ledger.service.ts` — `record(row): Promise<boolean>` (insert-if-absent), `count(kind)`, `has(key)`, `forProject(id)`, scope-reactive like `AppStore`.
6. Prefs: extend `ScopeDocs.prefs` type with `joy`, `reminders`, `share` (all optional; defaults in `src/app/core/joy/joy.defaults.ts`). Small `PrefsService` wrapper (get/patch as signals) — **only if** no existing accessor; reuse `AppStore.saveDocs`.
7. `JoyService` skeleton: receives candidates after `record()` → emits `CelebrationRequest` (level, payload) signal. No UI yet.

**Files likely affected**: `core/domain/joy.ts` (+spec), `core/joy/*` (new), `core/state/app.store.ts`, `core/storage/local-db.ts`, `features/tracker/tracker.page.ts`, `features/video-tutorials/video-detail.page.ts`, `features/projects/project-detail.page.ts`.

**Risks**: touching the hot tap path (keep detection O(1): compares two states, no parsing beyond what tap already parsed); DB upgrade on existing installs (additive, tested with v3 → v4 fixture).

**Acceptance criteria**
- Detector unit tests cover: simple complete / next-round (no event) / undo / reset / target lowered (no event); pattern action, group and round modes incl. last round; `ptr >= len` advance (no event); multi-part instance done; allParts; empty round.
- `record()` returns `true` once, `false` for duplicates, across a simulated restart.
- Existing specs (`tracker-engine.spec.ts`, `collections.store.spec.ts`, `scope-switch.store.spec.ts`, `timer.service.spec.ts`) still pass; `npm run typecheck` clean.

**Automated tests**: `src/app/core/domain/joy.spec.ts`, `src/app/core/joy/joy-ledger.service.spec.ts`, store spec for origin plumbing (sync `applyMerged` path produces zero ledger rows).
**Real-device tests**: upgrade an APK with v3 data → app opens, projects intact.

---

## P1 — In-app round celebrations

**Scope**: `<gz-joy-banner>` host in the tracker page; `<gz-avatar-reaction>`; 4 overlay SVGs; copy pool + rotation; rate limiter/coalescing; `@capacitor/haptics` 8.0.x with `HapticsService` (no-op on web); "Celebrations" settings group (`ux-specification.md` §7.2).

**Files**: `shared/ui/joy/joy-banner.component.ts`, `shared/ui/joy/avatar-reaction.component.ts`, `public/assets/joy/*.svg`, `core/joy/joy.copy.ts`, `core/services/haptics.service.ts`, `features/tracker/tracker.page.{ts,html}`, `features/video-tutorials/video-detail.page.ts` (banner there too, or a lighter inline note), `features/settings/settings.page.ts`, `src/theme/components.scss` (keyframes `gzHop`, `gzWiggle`, `gzSway` + reduced-motion), `package.json`, `android/` (cap sync).

**Dependencies**: P0. Plugin: `@capacitor/haptics` (verify its merged manifest adds `VIBRATE`; [Unverified] — check after `cap sync`).

**Risks**: banner overlapping the tap ring on small screens; animation jank on low-end devices; screen-reader double announcements (ring already has `aria-live`).

**Acceptance**: a round completion shows exactly one banner; undo + re-complete shows none; 5 rapid rounds in `'round'` mode → ≤ 1 banner per 20 s with the coalesced message; prefs Off → nothing; reduced motion → no movement; TalkBack announces once.

**Automated**: component tests (render/dismiss/rate limit with fake timers), copy rotation never repeats consecutively, AR/EN key parity.
**Real-device**: tap feel (latency unchanged; measure tap→paint before/after with Performance panel), haptics on 2 devices, RTL/LTR.
**Estimate**: 2–2.5 d. **Cloudflare**: none.

---

## P2 — Milestones, part & project celebrations, achievements

**Scope**: milestone rules; `PartDoneSheet` (`<gz-sheet>`), `ProjectFinale` (full-screen modal); replace the two existing congrats toasts (`tracker.page.ts:307`, `project-detail.page.ts:332`) with `origin:'finish'` → Level 4; `core/joy/achievements.ts` (definitions + evaluator + silent back-fill on first run per scope and after guest import); achievements page `/tabs/home/achievements` (route in `app.routes.ts`, entry row in settings/profile header).

**P2b — CANCELLED (Q2 deferred cross-device achievements).** No migration `0004`, no API route, no outbox kind. Achievements are device-local and account-scoped; the Achievements screen says so.

**Files**: `core/joy/achievements.ts` (+spec), `shared/ui/joy/part-done-sheet.component.ts`, `shared/ui/joy/project-finale.component.ts`, `features/achievements/achievements.page.ts`, `app.routes.ts`, `features/tracker/*`, `features/projects/project-detail.page.ts`, `core/sync/guest-import.service.ts` (call back-fill after import).

**Risks**: finale on a project marked done from project-detail while timer running (stop first, as today); back-fill wrongly celebrating (must be silent); achievements shown for guest then lost on erase (expected; documented).

**Acceptance**: part done → sheet once, "Next piece" switches instance; last piece → "mark finished" → finale once; reverting status to active and back to done → no second finale (quiet toast only); back-fill on an account with 2 done projects unlocks `first_finished` silently; rounds achievements only from live rows.

**Automated**: achievements evaluator spec (incl. undo/delete never relocks), store spec: guest import → no celebrations, back-fill marks `source:'backfill'`.
**Real-device**: full flow on a 3-piece amigurumi collection; Android Back closes sheet/finale without leaving tracker.
**Estimate**: 2.5–3 d (+0.5–1 d P2b). **Cloudflare**: none for P2; P2b = additive D1 migration + route (Free-tier compatible).

---

## P3 — Share progress cards

**Scope**: `ShareCardService` (Canvas renderer per `architecture.md` §9; card templates: progress, part, project, achievement); `ShareCardSheet` with toggles + preview; `@capacitor/share` 8.0.x + `@capacitor/filesystem` 8.1.x; cache cleanup; web fallback; text-only share.

**Files**: `features/share-card/share-card.service.ts` (+spec for layout maths/text fitting), `features/share-card/share-card.sheet.ts`, entry points in L2/L3/L4/achievements/project detail, `package.json`, Android `res/xml/file_paths.xml` (cache path already allowed by the Share plugin default — verify), `capacitor.config.ts` unaffected.

**Dependencies**: P0 (data), P2 entry points (can stub). Font loading: `@fontsource-variable/playpen-sans-arabic` already bundled.

**Risks**: Arabic shaping/bidi in canvas (Chromium WebView supports it — verify on device), memory for 1080×1350 on low-end devices (~5.8 MB RGBA, fine), WhatsApp dropping caption on some versions, `content://` vs `file://` URI handling, image > 2.5 MB.

**Acceptance**: card renders < 1 s on a mid device; no pattern text/notes/email ever in the card; toggles reflected in preview; cancel = silent; WhatsApp receives the image (caption if supported); share without photo works offline.

**Automated**: renderer unit tests with a mocked canvas context (text-fitting, RTL ordering, toggle → element presence), privacy test (spec asserts no `pattern.text`/`notes`/`email` fields are read by the card builder).
**Real-device**: WhatsApp, WhatsApp Business (if installed), Instagram, Gmail, Drive, Telegram; Android 10, 13, 14/15; no-WhatsApp device.
**Estimate**: 2–3 d. **Cloudflare**: none (no upload).

---

## P4 — Local reminders

**Scope**
- `@capacitor/local-notifications` 8.3.x; `capacitor.config.ts` `plugins.LocalNotifications { smallIcon: 'ic_stat_gharzetak', iconColor: '#…brand…' }`; monochrome small icon drawable in `android/app/src/main/res/drawable*/`.
- Manifest: `POST_NOTIFICATIONS` (plugin may merge it — verify), **no** `SCHEDULE_EXACT_ALARM`, **no** `USE_EXACT_ALARM`.
- `ReminderPlannerService` (pure planning function `planReminders(prefs, projects, now, tz) → PlannedNotification[]` + side-effect wrapper) per `architecture.md` §7; `schedule(..., { isExactNotification: false })`.
- `NotificationRouter` per `architecture.md` §8 (listener in `app.ts`), uses `AppStore.openTrackerFor` from P0.
- Settings "Crochet Reminders" section; soft-ask sheet; replace `NotificationsSheetBody` "coming soon" content (`src/app/shared/ui/dialogs/common-sheets.ts`); preview notification.
- Native helper "open app notification settings": add a method to the existing `ImmersivePlugin` pattern (`android/app/src/main/java/com/gharzetak/app/`) or a tiny `SystemSettingsPlugin` (`Settings.ACTION_APP_NOTIFICATION_SETTINGS`).
- Scope handling: device-level plan state in `localStorage 'gz.reminders.plan'`; cancel on logout/scope change; replan for the new scope.

**Files**: `core/reminders/reminder-planner.ts` (+spec), `core/reminders/reminder-planner.service.ts`, `core/reminders/notification-router.service.ts` (+spec), `app.ts`, `features/settings/settings.page.ts` (+ maybe `features/settings/reminders-section.component.ts`), `shared/ui/dialogs/common-sheets.ts`, `features/home/home.page.ts`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/java/com/gharzetak/app/*.java`, `capacitor.config.ts`, `package.json`.

**Dependencies**: P0 (prefs, `openTrackerFor`). Independent of P1–P3.

**Risks**: plugin 8.3 auto-requests permission inside `schedule()` (gate it); reboot restore unverified; OEM battery killers; cold-start tap event delivery before listener registration; biometric gate; account switch leaking another scope's reminder; time-zone shifts.

**Acceptance**
- Disabled by default; no permission prompt until the user says yes in the soft ask.
- Plan never exceeds the weekly cap; nothing in quiet hours; nothing for done/deleted projects; nothing within 6 h after a session; horizon 28 days.
- Logout → `getPending()` returns none of our ids; sign into another account → its own plan only.
- Tap (terminated/background/foreground) → lock screen if enabled → tracker on the right part.
- Generic copy unless "show details" on.

**Automated**: planner pure-function tests (caps, quiet hours incl. overnight wrap, DST/time-zone, inactive/almostDone replacing a slot, done/deleted exclusion, horizon), router tests (scope mismatch, deleted project, retired instance, locked), plugin mocked.
**Real-device**: full notification matrix (`qa-test-matrix.md` §3) on ≥ 2 OEMs (Pixel/stock + Samsung or Xiaomi), Android 13 and 14/15.
**Estimate**: 3–4 d. **Cloudflare**: none.

---

## P5 — Hardening & QA

**Scope**: execute `qa-test-matrix.md`; fix findings; battery check (no wake locks, no repeating timers when idle; `adb shell dumpsys alarm | grep gharzetak` shows only our one-shots); TalkBack pass; large-font (200 %) pass; RTL/LTR screenshots into `docs/crochet-joy/device-qa/`; update `docs/crochet-joy/qa-report.md` with honest results; perf regression check on tap path.
**Estimate**: 2–3 d (device-time bound). **Cloudflare**: none — but staging must first be redeployed + migrated (0002/0003) if QA includes sync (prerequisite, user-approved).

---

## P6 — Remote push (not in MVP)

Documented in `cloudflare-readiness.md` §3.2. Start only if a requirement appears (server-originated announcements, one-device-per-account delivery). Rough estimate when needed: 4–6 d + Firebase project + likely Workers Paid.

---

## Prerequisites & decisions needed before P0

1. ~~Approve Option A (local notifications) and "no Cloudflare changes for MVP".~~ **Approved.**
2. ~~Decide Q1, Q2, Q3.~~ **Decided** — see `risks-and-decisions.md` §0 (Q3 changed: guest ledger is preserved).
3. Separately (not Crochet Joy): decide whether/when to redeploy staging from `development` and apply D1 migrations 0002/0003, and whether to move to Workers Paid for auth CPU and D1 writes.

---

## Implementation status (2026-11-17)

| Phase | Commit | State |
|---|---|---|
| P0 event foundation (+ guest-ledger migration, video counter fix) | `8b6548d` | Done, unit-tested, mutation-checked |
| P1 round celebrations, avatar reactions, haptics, Celebrations settings | `601b9d7` | Done |
| P2 milestones, part sheet, finale, 8 achievements | `f08fd0e` | Done (P2b cancelled by Q2) |
| P3 share cards | `96f0cc0` | Done on web; native share sheet **pending device** |
| P4 local reminders | `422e687` | Done on web/unit level; native delivery **pending device** |
| P5 hardening | this commit | Automated checks done; physical-device QA **pending** — see `qa-report.md` |

All phases were built on one branch (`feat/crochet-joy-implementation`) with one commit per phase, instead of one branch per phase. Not part of this plan's scope and not changed: Cloudflare Worker, D1, R2.
