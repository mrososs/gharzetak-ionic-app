# Crochet Joy — QA Report

**Date:** 2026-11-17 · **Branch:** `feat/crochet-joy-implementation` · **Base:** `origin/development` @ `f616ee9`
**Honest summary:** automated checks (544 tests, production build, Android debug build) pass. A **physical HONOR phone (Android 16)** was then used to count a test project through every celebration, render and open the share sheet, enable reminders (real alarms, real notification, tap to counter) and measure the counting tap. That pass found **3 real bugs, all fixed** (§4b). Still PENDING (§4d): a scheduled reminder firing with the app closed, lock-screen look, biometric-locked tap, a real WhatsApp send, reboot restore, account-based flows. No emulator was used. iOS was not built or tested.

Legend: ✅ verified with evidence · ⏳ pending (needs the phone) · 🚫 not tested · ⚠ known limitation

---

## 1. Automated (Vitest via `ng test`)

| Check | Result |
|---|---|
| Type-check (app + spec) | ✅ clean |
| Unit/integration tests | ✅ **544 passed, 35 files, 0 failed** (baseline before this work: 208) |
| Production build (`ng build`) | ✅ OK — initial 1.32 MB raw / 288.24 kB transfer |
| `cap sync android` | ✅ 13 plugins (incl. filesystem, haptics, local-notifications, share) |
| Cloudflare API / D1 tests | 🚫 not run — no backend file was changed (`git diff` shows nothing under worker/api/migrations) |

Tests per phase (cumulative): P0 274 → P1 296 → P2 342 → P3 412 → P4 541 → phone-driven fixes 544.

**Mutation checks.** The safety rules were verified by deliberately breaking the code and confirming a test fails: origin gating, dedupe, import journal, keep-guest-until-complete, loaded/scope guards, video pinned-revision fix, rate limit, haptic preference, coalescing, scope clear, share-card privacy rules, reminder planner/service guards (never prompt, exact alarms off, cancel on logout/scope change), router ordering. Survivors were fixed or are compile-protected. One survivor remains by design: the ledger `dedupe` mutant survives in unit tests because they run on the in-memory LocalDb fallback — see §2.

## 2. Browser (Claude browser pane, web build, 320×640 emulated viewport, ar + en)

✅ Counting pipeline end to end · ✅ banner / milestone card / finale geometry (no overlap of the counter ring, 44 px targets) · ✅ tap-path cost **0.04–0.05 ms mean** with the celebration hook attached or detached · ✅ real Arabic and English share cards rendered in 144–164 ms (801 ms first, incl. fonts), 1080×1350 PNG, 319–386 KB · ✅ share sheet with toggles persisted · ✅ Achievements page (device-local note shown) · ✅ Settings: reminders section shows the "works in the phone app" note with no switch on web · ✅ bell sheet no longer says "coming soon" for reminders.

Still to verify in a real browser/device: ⏳ IndexedDB v3→v4 upgrade on an existing database, ⏳ the real `putJoyIfAbsent` transaction (race of two simultaneous writers).

## 3. Android build

| Check | Result |
|---|---|
| Java/Kotlin compile of `SystemSettingsPlugin` + all plugins (`assembleDebug`, built in the user terminal) | ✅ BUILD OK — `android/app/build/outputs/apk/debug/app-debug.apk`, 14.3 MB, 2026-11-17 15:53. Not installed anywhere. |
| Merged manifest has **no** `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` | ✅ checked in `intermediates/merged_manifest/debug/.../AndroidManifest.xml` (0 matches) |
| Permissions in the **merged** manifest | `INTERNET`, `ACCESS_NETWORK_STATE`, `USE_BIOMETRIC`/`USE_FINGERPRINT`/`USE_CREDENTIALS` (existing), plus from the new plugins `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED` (re-arm reminders after boot), `VIBRATE` (haptics), `WAKE_LOCK`. App manifest: `SCHEDULE_EXACT_ALARM` removed (`tools:node="remove"`). `POST_NOTIFICATIONS` comes from the plugin and is requested only after the soft-ask "Yes". |

## 4. Physical Android — HONOR DNY-NX9, Android 16 (API 36), real device

Driven over USB (`adb` + read-only DevTools queries); evidence in `qa-evidence/`. A **guest** profile was used (this build has no API configured), with two clearly named test projects (**"Qa test"**, **"Qa test 2"**) that the owner can delete. The phone's other data was not touched. Reminders were turned **off**, alarms are 0 and the notification permission was revoked at the end.

### 4a. Verified on the phone ✅

| Area | Result |
|---|---|
| Device / install | ✅ physical device (`ro.kernel.qemu` empty). `adb install -r` over the existing app keeps data (no uninstall, no clear). |
| IndexedDB **v3→v4 upgrade on real data** | ✅ DB `gharzetak` is v4 with the new `joy` store; existing data intact (8 projects, 36 revisions, 2 collections, 1 pattern, 8 docs, 2 outbox rows). |
| No permission prompt at install / launch | ✅ `POST_NOTIFICATIONS granted=false`, no channel, 0 alarms. Opening the bell sheet and the soft-ask also did **not** request it. |
| **Celebrations** (`03`–`07`) | ✅ first tap earns the **"First round" achievement banner** (replaces the plain round banner) · ✅ milestone cards at **25 % / 50 % / 75 %** with avatar, share icon and "Continue" · ✅ marking the project finished opens the **finale** ("5 rounds counted", new achievements "First finished piece" and "Amigurumi!") · ✅ cards do not cover the counter button. |
| **Ledger on device** | ✅ after 4 round taps the `joy` store held 4 round rows, 3 milestone rows and 2 achievement rows, all in scope `guest` (one row per event, no duplicates). |
| **Share card** (`08`) | ✅ Arabic card renders in the WebView with correct shaping, emoji and Gharzetak branding; no email/account data · ✅ "Share" opens the system chooser with `gz-card-….png` (398 kB) · ✅ **cancelling** returns to the sheet with no error shown (the plugin's "Share canceled" is handled silently). **Nothing was sent to anyone.** |
| **Reminders — opt-in** (`09`, `10`) | ✅ bell sheet shows "off for now"; soft-ask explains before anything; pressing **Yes** is the only thing that reached the permission controller (`GrantPermissionsActivity` in logcat). `POST_NOTIFICATIONS` ended `granted=true`. (On this ROM I did not observe a visible dialog in the screenshot; the grant is confirmed by `dumpsys`.) |
| **Reminders — scheduling** | ✅ both channels created · ✅ 8 pending alarms for the next 28 days on **Sun/Wed 19:30**, 2 per week, `RTC_WAKEUP` with a 1 h window = **inexact**, no exact-alarm permission · ✅ the first-reminder text is 7:30 PM (read from the DOM, not just the pixels). |
| **Reminder notification** | ✅ "Preview" posts a real notification with **generic text, no project name** · ✅ **tapping it opens the counter on the right project** (`12`). |
| **Turn off** | ✅ "Turn off all reminders" → **0** pending alarms (`dumpsys alarm`); re-enabling re-creates 8. |
| **Force-stop** | ✅ force-stop → 0 alarms (Android drops them — known OS limit); next launch → 8 re-armed. |
| **Performance (counter tap)** | ✅ 30 stitch taps on the real WebView (8 cores): handler **mean 0.69 ms, p95 2.0 ms, max 6.6 ms**; time to next painted frame **mean 7.2 ms, p95 22.7 ms, max 25.4 ms**. No network in the path. |
| **Quiet-hours layout** (`13`) | ✅ after the fix both time fields fit side by side. |

### 4b. Bugs the phone found — all fixed ✅

| # | Bug | Fix |
|---|---|---|
| 1 | `"LocalNotifications.then() is not implemented on android"` — the transport returned the native plugin proxy from an async function, so reminder checks failed silently while all unit tests passed | `70563a6` — plugin wrapped in a plain object; the test mock now throws on `.then` like the real proxy |
| 2 | After "Yes", reminders were on but the **soft-ask sheet stayed open** (the sheet refuses to close while `busy`) | `e07edf5` — sheet no longer bound to `busy`; regression spec; verified on the phone |
| 3 | **Quiet-hours "to" field clipped** at the screen edge (`<input type=time>` intrinsic width in a flex row) | `b3f9090` — `min-width:0`; verified (`13`) |

Also fixed: a **flaky test** (fixed 8 ms settle wait) failed once in a full run; all affected specs now wait several short turns. 544 tests pass twice in a row.

### 4c. Findings (not failures, but worth knowing)

- Both channels report `lockscreenVisibility=-1000` (unset) in `dumpsys` on this ROM although the app passes private/public. The plugin also marks every notification `VISIBILITY_PRIVATE` and the default text is generic, but **lock-screen appearance was not observed** (see pending).
- The app's own build is guest-only (API not configured), so **sign-in, account switching and the real guest→account import could not be run on the phone** (the logic is covered by 28 unit tests).

### 4d. Still PENDING ⏳ (not claimed)

| Area | Cases pending |
|---|---|
| Reminders | delivery of a **scheduled** reminder with the app closed at its time · lock-screen look (generic text, private channel) · tap while the **biometric lock** is on · tap for a different account / deleted project · permission **deny / re-deny / revoke-while-enabled** flows · **reboot restore** and the stale burst after power-off (**needs your explicit permission to reboot**) · HONOR battery-saver effects over days |
| Share | an actual send to WhatsApp (image + caption behaviour) and the text-only fallback sent for real |
| Guest import | guest with real counts → sign in → badges/dates/counts preserved (needs an API-enabled build and an account) |
| Ledger | concurrent writers under very fast tapping (the store works; stress not run) |
| Other | iOS · other OEMs/Android versions · TalkBack |

## 5. Not tested 🚫

iOS (no build, no device) · OEMs other than HONOR (Samsung/Xiaomi/Huawei) · Android 10–15 · TalkBack · a remote account on a real Cloudflare backend (not needed: no sync of joy data exists) · very large projects (1000+ rows) on a slow device.

## 6. Known limitations ⚠

1. Reminders are **inexact** (no exact-alarm permission by decision) and may be late or delayed by OEM battery savers; force-stop cancels them until the next launch.
2. After the phone was powered off, the plugin may fire stale one-shot reminders ~15 s after boot (R-29).
3. Achievements and joy history are **device-local** (cross-device sync deferred, Q2); reinstalling the app or clearing data loses them.
4. Share is user-initiated only; image + caption together depends on the target app, so a text fallback exists.
5. No push notifications, no server-side scheduling, no Cloudflare changes (Q8).

## 6b. Blocked

Remaining hardware cases (§4d) need time to pass (a scheduled reminder firing), an account-enabled build, or explicit permission (reboot). Reboot tests are blocked until the user explicitly allows a reboot.

## 7. Cloudflare

**No changes.** No Worker deploy, no remote D1 migration, no Cron/Queues, no Firebase, no plan change. The staging 0002/0003 mismatch was not touched.
