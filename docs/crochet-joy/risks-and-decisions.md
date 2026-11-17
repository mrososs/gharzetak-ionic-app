# Crochet Joy — Risks & Decisions

> **Status: the architecture and the product decisions in §0 were APPROVED on 2026-11-17 and are final for the MVP implementation (P0–P5).**
> Where this document or the other planning documents still show the original proposal, §0 and the "Approved change" notes win.

## 0. Approved product decisions (final)

| ID | Decision | Differs from the original plan? |
|---|---|---|
| Q1 | Keep the existing warm Egyptian Arabic tone, primarily feminine (matches the rest of the product). Use gender-neutral phrasing where it sounds natural. **No new gender-preference system.** English fully supported. | No (confirms default) |
| Q2 | **Achievement sync through Cloudflare is deferred.** Device-local, account-scoped IndexedDB only. **P2b and migration `0004` are NOT implemented.** The UI and documentation state clearly that achievements are device-local. | No (confirms default) |
| Q3 | **Guest achievements and legitimately recorded round counts MUST survive guest → account conversion on the same device** (see D-14 and `architecture.md` §4.3). | **YES — changed.** The plan said guest round counts start fresh. |
| Q4 | The video-tutorial counter (`VideoDetailPage`) uses the **same completion detection and ledger** as the main tracker, shows only a lightweight inline celebration, never interrupts playback, and is **fixed to count against the project's pinned pattern revision** (it read the live pattern text). | Refines (was "same detection, lighter note") |
| Q5 | Share cards use Gharzetak branding. **No QR code, no invented store URL.** | No |
| Q6 | Android is the primary tested platform. iOS compatibility is kept where practical but **not claimed validated** without a real iOS build/device test. | No |
| Q7 | Reminder defaults after opt-in: Sunday + Wednesday, 7:30 PM device-local time, two per week, quiet hours 10 PM–8 AM, generic lock-screen content. Reminders are **disabled until the user explicitly opts in**. | No |
| Q8 | **No Cloudflare changes**: no Worker deploy, no remote migrations, no Workers Paid, no Cron Triggers, no Queues, no Firebase, no push infrastructure, no round events in D1. The staging 0002/0003 mismatch is a separate deployment issue and is not fixed here. | No |

## 1. Decisions (recommended)

| ID | Decision | Alternatives considered | Rationale |
|---|---|---|---|
| D-1 | **Local notifications** (`@capacitor/local-notifications` 8.3.x) for the MVP | Remote push via Worker + D1 + FCM/APNs | Meets every brief requirement offline, $0, no backend, best privacy, personalization from local data (`cloudflare-readiness.md` §3). |
| D-2 | **No Cloudflare changes in the MVP** (Q8) | D1 event log; server achievements (P2b / `0004` — deferred by Q2) | Celebrations are device moments; per-round server writes would burn Free-tier D1 writes and add sync conflicts. |
| D-3 | Detect completion **only at the command call site** (`origin: 'tap' \| 'finish'`) | `effect()` diffing signals; deriving events in sync | Sync/merge/load/import replace signals wholesale (`SyncService.applyMerged`), so diffing would misfire. |
| D-4 | **One** idempotent ledger (IndexedDB `joy`, DB v4) for rounds, milestones, parts, projects and achievements | Separate celebration + achievement stores; flags on `Project` | No duplicate systems; deterministic keys; persist-before-present. |
| D-5 | Prefer **under-celebrating** to false celebrating | Re-celebrate after edits | Brief requires no false celebrations; edits/jumps never fire. |
| D-6 | Round-count achievements count **only live taps after release** | Infer from cursor positions | Cursor positions are unreliable (jumps, edits, imports). |
| D-7 | Achievements **never re-lock** | Re-lock on undo/delete | Earned legitimately; re-locking feels punitive. |
| D-8 | Reuse the 6 existing avatar SVGs + CSS motion + 4 shared overlays | 18–24 new pose illustrations | Ships fast, tiny assets, consistent art; poses can come later. |
| D-9 | Share cards rendered **on device** (Canvas) and shared via OS sheet | Server-side rendering / R2 upload | No upload, no privacy exposure, works offline, $0. |
| D-10 | **Inexact** reminders; never request exact-alarm permission | `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` | Android 14 denies by default; Play policy restricts `USE_EXACT_ALARM`; minutes of drift are fine for nudges. |
| D-11 | Rolling **28-day one-shot** horizon, re-planned on launch/resume/activity | Infinite repeating notifications | Allows skipping slots after sessions/quiet hours; stops nagging users who left. |
| D-12 | Reminder/Joy prefs are **per device, per scope** in `ScopeDocs.prefs`; OS plan owner tracked device-wide | Sync prefs to D1 | Reminders are device-specific; no backend needed. |
| D-13 | Notification tap routes through auth + `untilUnlocked()` + scope check | Direct `navigateRoot` | Warm navigation isn't re-guarded today; must not bypass biometric lock or open another account's data. |
| D-14 | **Guest ledger + achievements migrate with the guest → account import (Q3)**: remap project ids with the same map as the project import, merge with the account's ledger insert-if-absent (never double-count; achievements keep the EARLIEST unlock date), never celebrate, resumable through a journal, verify before erasing the guest copy, keep unmappable rows in a recovery list, never infer counts from tracker positions | Start fresh (original plan); infer counts | Same-device continuity is a promise to the user; deterministic keys make the merge exact. Implemented in `JoyLedgerService.importFromGuest` + `GuestImportService`. |
| D-15 | Origin gating at **two** layers: the store only captures a "before" state for `tap`/`finish`; `detectJoy` independently returns `[]` for every other origin | Only one layer | Defence in depth: a future caller that passes a wrong origin still cannot create events from sync/undo/edit paths. |
| D-16 | Presentation is skipped (event still recorded) while the store is not `loaded()` or its scope differs from the event's scope | Present whenever persisted | Never show one account's celebration to another during an account switch. |

## 2. Risk register

Severity: Critical / High / Medium / Low.

| ID | Risk | Sev. | Mitigation | Verification |
|---|---|---|---|---|
| R-01 | Android 13+ notification permission denied or never asked well | High | Soft ask at a positive moment; gate `schedule()` (plugin 8.3 auto-requests inside `schedule`); settings helper | N-01…N-04 |
| R-02 | Doze / background restrictions delay reminders | Medium | Inexact by design; copy is time-tolerant; `allowWhileIdle` not needed at ≤ 1/day | N-06 (record delays) |
| R-03 | OEM battery managers (Xiaomi/Huawei/Oppo/Samsung) drop alarms | High | Re-plan on every launch/resume; FAQ text in settings ("if reminders don't arrive…"); no promises of exact timing | N-06 on ≥ 2 OEMs |
| R-04 | Device reboot clears alarms; plugin restore **unverified** | High | Re-plan on launch; verify boot restore; if missing, add `RECEIVE_BOOT_COMPLETED` receiver (small native) | N-07 |
| R-05 | Force-stop cancels alarms until next launch | Low | Documented limitation | N-09 |
| R-06 | Stale/duplicate notifications after cancel/replan | Medium | Deterministic id ranges; cancel-then-schedule in one `replan`; plan hash | N-13, N-17 |
| R-07 | Duplicate celebrations (undo, restart, sync, switching parts) | Critical | Origin-gated detector + insert-if-absent ledger (`architecture.md` §3.3) | C-05…C-11 |
| R-08 | False celebrations from pattern edits / setters | High | Non-tap origins never detect; under-celebrate policy | C-16, C-17 |
| R-09 | Second tap surface (`VideoDetailPage`) bypasses detection or uses live (unpinned) text | Medium | Pass `origin:'tap'`; switch to pinned-text parse | C-19 |
| R-10 | Offline sync of achievements (P2b) conflicts | Low | Insert-if-absent, union merge, no revisions | A-06 |
| R-11 | Account switching leaks reminders or celebrations across scopes | High | Scope-keyed ledger; device-level plan owner; cancel on scope change; router scope check | C-20, N-17, N-18 |
| R-12 | Notification tap bypasses biometric lock | Critical | Router awaits `auth.untilUnlocked()`; outlet stays `inert` | N-19 |
| R-13 | Immersive mode layout glitches with full-screen finale/sheets | Low | Use existing safe-area tokens + `gz-immersive` floor | N-23, R-11 |
| R-14 | Battery/CPU from animations | Medium | Transform/opacity only, run-once, paused when hidden, reduced-motion | C-23, N-27 |
| R-15 | Accessibility: double announcements, focus theft | Medium | One polite region; non-modal L1/L2; sheets use `<gz-sheet>` semantics | C-25 |
| R-16 | Share-card privacy (pattern text, notes, identity) | High | Card builder has no access to those fields (enforced by spec); preview + toggles; user-initiated only | S-10 |
| R-17 | Large image generation (memory/time), WhatsApp caption handling varies | Medium | 1080×1350 fixed; JPEG fallback; text-only fallback; record per-app behaviour | S-05, S-12 |
| R-18 | Cloudflare Free CPU limit (10 ms) vs auth hashing (~12 ms, observed p99 ≈ 89 ms) — **pre-existing** | High | Decide Workers Paid before public launch (not a Crochet Joy dependency) | `wrangler tail` CPU per sign-in |
| R-19 | D1 Free 100k rows written/day vs per-tap progress pushes (400 ms debounce) — **pre-existing**; ~1k users may exceed | High | Out of scope: coalesce progress pushes (5–10 s + flush on pause) or Workers Paid; Crochet Joy adds **no** per-tap writes | Analytics after beta |
| R-20 | Remote push cost if ever adopted | Low | Deferred (P6); FCM is no-cost; Workers Paid $5/mo base | — |
| R-21 | Existing tracker performance degraded by detection | Medium | O(1) compare of two states already in memory; ledger write async after paint | C-26 |
| R-22 | Staging Worker/D1 behind `development` (migrations 0002/0003 missing) — **pre-existing** | High (for QA) | Redeploy + migrate staging (user-approved) before device QA that involves sync | `d1_migrations` shows 0000–0003 |
| R-23 | Staging logs persist reset/verification links (`apps/api/src/services/mailer.ts:25`) — **pre-existing** | Medium | Redact in non-local envs; separate fix | Log review |
| R-24 | IndexedDB v3 → v4 upgrade on installed devices | Medium | Additive store only; upgrade spec with v3 fixture | R-07 |
| R-25 | Plugin 8.3 `isExactNotification` default `true` opens Alarms settings | Medium | Always pass `isExactNotification: false` | N-24 |
| R-26 | Gendered Arabic copy excludes male users | Low | Q1 (approved): keep the product's existing feminine tone, prefer neutral phrasing where natural, no preference system | Copy review |
| R-27 | Guest → account ledger migration loses or double-counts rows (Q3) | High | Deterministic keys, insert-if-absent merge, journal, verify-before-erase, recovery list; unit-tested incl. interruption/retry | `guest-import.service.spec.ts` (G-01…G-11) |
| R-28 | IndexedDB v3 → v4 upgrade on installed devices (unit tests use the in-memory fallback, which does not exercise the real IndexedDB transaction / upgrade path) | Medium | Additive store only; verify the upgrade and the insert-if-absent transaction in a real browser and on the device | QA report: browser + device sections |

## 3. Questions — all answered (see §0)

Q1–Q8 were resolved by the approved decisions in §0. Only one item remains open and it is **outside Crochet Joy**: when to redeploy staging and apply D1 migrations 0002/0003, and when to move to Workers Paid (not touched by this work).

## 4. Unverified items (must be checked during implementation)

- Cloudflare account plan (Free vs Paid) — API token lacks billing scope (403).
- `@capacitor/local-notifications` reboot/app-update restore behaviour on Android.
- Whether the local-notifications/haptics plugins merge `POST_NOTIFICATIONS` / `VIBRATE` into the manifest automatically.
- Cold-start delivery of `localNotificationActionPerformed` (retained until a listener registers?).
- WhatsApp behaviour for image + caption in one share intent on current versions.
- Canvas Arabic shaping in the Android System WebView versions on test devices.
