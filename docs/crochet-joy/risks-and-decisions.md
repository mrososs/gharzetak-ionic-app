# Crochet Joy — Risks & Decisions

## 1. Decisions (recommended)

| ID | Decision | Alternatives considered | Rationale |
|---|---|---|---|
| D-1 | **Local notifications** (`@capacitor/local-notifications` 8.3.x) for the MVP | Remote push via Worker + D1 + FCM/APNs | Meets every brief requirement offline, $0, no backend, best privacy, personalization from local data (`cloudflare-readiness.md` §3). |
| D-2 | **No Cloudflare changes in the MVP** | D1 event log; server achievements | Celebrations are device moments; per-round server writes would burn Free-tier D1 writes and add sync conflicts. |
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
| R-26 | Gendered Arabic copy excludes male users | Low | Q1 decision; neutral variants pool ready | Copy review |

## 3. Open questions (need your decision)

| ID | Question | Default if no answer |
|---|---|---|
| Q1 | Keep feminine-only Arabic copy (app-wide today), or add a neutral/masculine variant (would need a profile setting)? | Keep feminine (consistent with existing app); avoid gendered words where easy |
| Q2 | Must achievements sync across devices (P2b: additive D1 migration `0004` + 1 route)? | No — device-local in MVP |
| Q3 | On guest → account import, carry over guest round counts? | No — durable achievements re-derived; round counts start fresh |
| Q4 | Celebrate in the video-tutorial practice counter too, or only on the tracker screen? | Same detection, lighter inline note (no banner) |
| Q5 | Should the share card include the Gharzetak link/QR (store listing not live yet)? | Small text mark only |
| Q6 | iOS in scope for this release? (Info.plist has no URL types; APNs not needed for local notifications) | Android-only QA; iOS compiles but unverified |
| Q7 | Default reminder days/time for Egypt-first audience (proposed Sun & Wed 19:30)? | As proposed |
| Q8 | Separately from Crochet Joy: redeploy staging + apply 0002/0003; Workers Paid timing? | Not touched by this plan |

## 4. Unverified items (must be checked during implementation)

- Cloudflare account plan (Free vs Paid) — API token lacks billing scope (403).
- `@capacitor/local-notifications` reboot/app-update restore behaviour on Android.
- Whether the local-notifications/haptics plugins merge `POST_NOTIFICATIONS` / `VIBRATE` into the manifest automatically.
- Cold-start delivery of `localNotificationActionPerformed` (retained until a listener registers?).
- WhatsApp behaviour for image + caption in one share intent on current versions.
- Canvas Arabic shaping in the Android System WebView versions on test devices.
