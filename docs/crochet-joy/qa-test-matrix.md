# Crochet Joy — QA Test Matrix

**Status: the automated (U/I) rows are implemented in `ng test` (541 tests). The device (D) rows are NOT executed yet.** Results and evidence are in [qa-report.md](qa-report.md); nothing is marked passed without evidence (spec output, screenshot or screen recording).

Columns: **ID · Scenario · Steps · Expected · Type** (U = unit/spec in `ng test`, I = integration/store spec, A = API test in `apps/api/tests`, D = Android physical device, W = web/dev build).

Device set (minimum): one stock/Pixel-like device on Android 14 or 15; one Samsung or Xiaomi on Android 13+; one Android 10–12 device if available (minSdk is 24). Both locales (ar RTL, en LTR).

---

## 1. Celebrations & events

| ID | Scenario | Steps | Expected | Type |
|---|---|---|---|---|
| C-01 | Complete one round (simple) | target 6, tap ×6 | 1 L1 banner on the 6th tap; 7th tap (next round) → no banner | U, D |
| C-02 | Complete one round (pattern, action mode) | tap to `ptr = len` | 1 banner at the completing tap; advancing tap → none | U, D |
| C-03 | Pattern `'round'` count mode | one tap per round ×3 | 1 ledger row per round; banners rate-limited (≤ 1/20 s, coalesced copy) | U, D |
| C-04 | Last round of pattern | complete last round | L1 + (single-tracker) "mark finished" stays a user choice; no L4 auto | U |
| C-05 | Undo completed round | complete → undo | no banner on undo; no ledger change | U, D |
| C-06 | Re-complete same round | complete → undo → re-complete | no second banner (`record` false) | U, D |
| C-07 | Reset round then complete | complete → reset → complete | no second banner | U |
| C-08 | Restart app | complete round, kill app, reopen | no banner on load; ledger row present | I, D |
| C-09 | Sync pull brings further progress | device B pulls A's progress | zero celebrations on B | I (`applyMerged` path), D |
| C-10 | Multi-part conflict merge | force 409 + `mergeMultiConflict` | zero celebrations | I |
| C-11 | Switch parts | switch Arm 1 → Arm 2 → Arm 1 | no events; keys per instance | U, D |
| C-12 | Complete a part | finish Arm 1/2 | L3 sheet once; "Next piece" activates Arm 2/2 | U, D |
| C-13 | Complete last part | finish final instance | L3 "all pieces" variant → "mark finished" → L4 once | I, D |
| C-14 | Complete project via project detail chips | status → done | L4 once; old congrats toast gone | D |
| C-15 | Revert done → active → done | | no second L4 (quiet toast only) | I |
| C-16 | Edit pattern so cursor maps beyond end | update pinned pattern | no celebration; later tap on same round index silent | I |
| C-17 | Lower simple target to current count | settings setter | no celebration | U |
| C-18 | Jump to last round then tap | `patternJump` + tap | event only for the tap-completed round | U |
| C-19 | Video tutorial tap surface | tap from `VideoDetailPage` | same detection as tracker; uses pinned text | I, D |
| C-20 | Switch accounts | user A completes round; switch to B | B's ledger empty; A's intact after switching back | I |
| C-21 | Guest import | guest completes rounds; sign up + import | no celebrations during import; **guest ledger rows + achievements migrated** (Q3), see G-01…G-11 | I |
| C-22 | Prefs: milestones only / off | toggle | L1 suppressed / everything suppressed; ledger still records | U |
| C-23 | Reduced motion (OS + in-app) | enable | no transforms; fade only | D, W |
| C-24 | Haptics off / web | | no vibration; no errors on web | D, W |
| C-25 | TalkBack | complete round | announced once, focus stays on tap target | D |
| C-26 | Tap latency regression | 100 rapid taps | no dropped taps beyond existing `TAP_GUARD_MS`; tap→paint not worse than baseline | D |

## 2. Achievements

| ID | Scenario | Expected | Type |
|---|---|---|---|
| A-01 | First round | `first_round` unlocks with L2-style badge toast | U |
| A-02 | 10 / 50 rounds | unlock at exactly 10 / 50 live round rows | U |
| A-03 | Back-fill on existing data | done projects / multi-part / amigurumi unlock silently, tagged "earned earlier" | I |
| A-04 | Undo / delete project after unlock | stays unlocked; counts don't drop | U |
| A-05 | Erase local data (scope) | achievements cleared with the scope | I |
| A-06 | ~~(P2b) Cross-device~~ **DEFERRED (Q2)** — no sync, no migration 0004. Instead verify the UI states that achievements are device-local. | D, W |
| A-07 | Achievements never leave the device: no network request is made for any ledger/achievement operation | I |

### 2b. Guest → account import (approved change Q3)

| ID | Scenario | Expected | Type |
|---|---|---|---|
| G-01 | Guest rounds + achievement, then import | rows land in the account, original unlock dates kept, no celebration, guest copy erased only after confirmation | I |
| G-02 | Account project with the same id but different content | guest project remapped; its ledger rows follow the new id; nothing left under the old id | I |
| G-03 | Account already holds the same project/rows | duplicates skipped (no double counting); earlier achievement date wins | I |
| G-04 | Rows of a guest project that no longer exists | kept under the original id; counts neither lost nor invented | I |
| G-05 | Rows in other users' scopes | never imported, never modified | I |
| G-06 | Malformed / tampered rows | kept in `joyRecovery`, reported, no counts created; re-run does not duplicate the recovery list | I |
| G-07 | Interruption after the project step (ledger step fails) | guest data kept; retry completes via the journal without duplicating projects | I |
| G-08 | A row cannot be written | `incomplete`; guest copy kept; retry succeeds | I |
| G-09 | Second import after success | no change (idempotent) | I |
| G-10 | Guest has achievements but no projects | still offered and migrated | I |
| G-11 | Preferences | celebration/share prefs carried to an account without them; reminder opt-in never carried | I |

## 3. Sharing

| ID | Scenario | Expected | Type |
|---|---|---|---|
| S-01 | Progress card without photo | avatar layout; renders offline | U, D |
| S-02 | With photo (`coverLocalUrl`) | photo cropped 4:5 correctly; no canvas taint error | D |
| S-03 | Photo only on server, offline | renders without photo + note | D |
| S-04 | Completed project card | name, time, pieces, badge | D |
| S-05 | Share to WhatsApp | image arrives; caption attached if supported (record per WhatsApp version) | D |
| S-06 | Share to another app (Gmail/Drive/Telegram/Instagram) | image (and text where supported) | D |
| S-07 | "Save" via share sheet (Drive/Files) | file saved, opens as PNG | D |
| S-08 | Cancel OS sheet | silent close, no toast | D |
| S-09 | No share targets / `canShare` false | text-only option + copy caption | D, W |
| S-10 | Privacy | card never contains pattern text, notes, email, account name; toggles respected | U |
| S-11 | Arabic + English rendering | correct shaping, RTL order, digits consistent | D |
| S-12 | Large image / low-memory device | < 1 s render mid device; JPEG fallback > 2.5 MB | D |
| S-13 | Cache cleanup | old `share/*.png` removed on next share | D |

## 4. Notifications

| ID | Scenario | Expected | Type |
|---|---|---|---|
| N-01 | Default state | reminders off; no permission requested at install/launch/onboarding | D |
| N-02 | Soft ask → granted | OS prompt only after "Yes"; plan scheduled; status line correct | D |
| N-03 | Denied | enabled stays false; "open settings" helper works | D |
| N-04 | Revoked in system settings | on resume: warning shown; `getPending` empty or no fires | D |
| N-05 | App foreground at fire time | notification shown (or in-app equivalent) without disrupting counting | D |
| N-06 | App background / terminated | fires within the inexact window (record actual delay) | D |
| N-07 | Device reboot | scheduled one-shots still fire after reboot **(verify plugin behaviour)**; launch re-plans regardless | D |
| N-08 | App update (install newer APK) | reminders still scheduled or re-planned on first launch | D |
| N-09 | Force-stop | documented: no fires until next launch; launch re-plans | D |
| N-10 | Time-zone change | re-plan on resume; next fire at new local preferred time | U, D |
| N-11 | DST transition (planner) | correct local time across DST boundary | U |
| N-12 | Quiet hours (incl. overnight wrap 22:00–08:00) | no notification inside | U |
| N-13 | Weekly cap | twice/thrice/daily never exceeded; nudges replace slots | U |
| N-14 | Recent session (< 6 h) | slot skipped | U |
| N-15 | Completed project target | no reminders for it; falls back to another unfinished project or generic | U |
| N-16 | Deleted project target | no reminders; tap on stale notification → projects list + toast | U, D |
| N-17 | Logout | all our ids cancelled | I, D |
| N-18 | Account switch | only the new scope's plan exists; tap on old notification ignored (scope mismatch) | I, D |
| N-19 | Biometric lock on | tap → lock screen first → tracker after unlock; nothing visible behind lock | D |
| N-20 | Tap: terminated / background / foreground | opens Project → active part → current round | D |
| N-21 | Multiple active projects | still one reminder per slot (no per-project fan-out) | U |
| N-22 | Lock-screen privacy | generic text by default; names only with toggle; channel visibility private | D |
| N-23 | Immersive navigation on | notification shade/tap flow works; layout restored | D |
| N-24 | Exact alarms | "Alarms & reminders" screen never opened | D |
| N-25 | Horizon | nothing scheduled > 28 days ahead | U |
| N-26 | Web build | section hidden / explains app-only; no errors | W |
| N-27 | Battery | `dumpsys alarm` shows only our one-shots; no wake locks | D |

## 5. Regression

| ID | Area | Check | Type |
|---|---|---|---|
| R-01 | Counters | `tracker-engine.spec.ts` unchanged and passing | U |
| R-02 | Multi-part progress | `collections.spec.ts`, `collections.store.spec.ts` | U, I |
| R-03 | Undo history | depth/limits unchanged (300 local, 100/50 on wire) | U |
| R-04 | Project timer | `timer.service.spec.ts`; finish stops timer | U, D |
| R-05 | Pattern editing & revisions | pin/unpin, `mapCursor` flows unchanged | I |
| R-06 | Offline mode | everything in §1–§4 works in airplane mode (except S-03 photo fetch) | D |
| R-07 | Local persistence | DB v3 → v4 upgrade preserves all stores; `clearScope` covers `joy` | I, D |
| R-08 | Cloudflare sync | `npm run api:test` green; `npm run e2e:sync` against local Worker; **no new outbox kinds in MVP** | A, I |
| R-09 | Arabic RTL / English LTR | screenshots of all new surfaces in both | D |
| R-10 | Typecheck & build | `npm run typecheck`, `npm run build`, `npm run android:build` | CI/local |
| R-11 | Android Back | sheets/finale close; tracker not left accidentally | D |
| R-12 | Scope switch | `scope-switch.store.spec.ts` still passes | I |
