# Crochet Joy — QA Report

**Date:** 2026-11-17 · **Branch:** `feat/crochet-joy-implementation` · **Base:** `origin/development` @ `f616ee9`
**Honest summary:** web/unit-level verification is evidenced. A **physical phone (HONOR DNY-NX9, Android 16 / API 36) was connected late in the work**: the debug APK was installed over the existing app (data kept, nothing cleared or uninstalled) and a first on-device pass was done over USB. That pass found one real bug (fixed, see §4). Most hardware cases (notification delivery, share sheet, haptics feel, biometric/tap routing) are still PENDING because they need hands-on use of the phone. No emulator was used. iOS was not built or tested.

Legend: ✅ verified with evidence · ⏳ pending (needs the phone) · 🚫 not tested · ⚠ known limitation

---

## 1. Automated (Vitest via `ng test`)

| Check | Result |
|---|---|
| Type-check (app + spec) | ✅ clean |
| Unit/integration tests | ✅ **541 passed, 34 files, 0 failed** (baseline before this work: 208) |
| Production build (`ng build`) | ✅ OK — initial 1.32 MB raw / 288.24 kB transfer |
| `cap sync android` | ✅ 13 plugins (incl. filesystem, haptics, local-notifications, share) |
| Cloudflare API / D1 tests | 🚫 not run — no backend file was changed (`git diff` shows nothing under worker/api/migrations) |

Tests per phase (cumulative): P0 274 → P1 296 → P2 342 → P3 412 → P4 541.

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

### 4a. Verified on the phone ✅ (evidence: adb output, read-only DevTools queries, screenshots in `qa-evidence/`)

| Check | Result |
|---|---|
| Device is physical | ✅ serial `AU3NVB5916001229`, `ro.kernel.qemu` empty, manufacturer HONOR |
| APK installs over the existing app **keeping data** (`adb install -r`, no uninstall, no clear) | ✅ Success, twice |
| App launches, Arabic RTL and fonts render | ✅ `qa-evidence/01-launch.png`, `02-after-fix.png` |
| **IndexedDB v3→v4 upgrade on real data** | ✅ DB `gharzetak` is version 4 with the new `joy` store (empty, as expected before any tap); existing data intact: 8 projects, 36 revisions, 2 collections, 1 pattern, 8 docs, 2 outbox rows |
| Notification permission is **not requested** at install / first launch | ✅ `POST_NOTIFICATIONS: granted=false` with no user-set flag; no notification channel created; **0** alarms registered for the app |
| Merged manifest has no exact-alarm permission | ✅ (also §3) |
| No crash and no app error on launch after the fix | ✅ logcat clean (only an unrelated `Keyboard.setResizeMode not implemented`, pre-existing) |

### 4b. Bug found by the phone ✅ fixed (commit `70563a6`)

First launch logged `"LocalNotifications.then()" is not implemented on android`. The reminder transport returned the native plugin proxy from an async function, so Android threw when the promise machinery looked up `.then`. Reminder permission/plan checks would have failed silently on a device while all unit tests passed. Fixed by wrapping the plugin in a plain object; the spec's mock now throws on `.then` like the real proxy. After reinstalling the fixed APK the error is gone from logcat. (Haptics/Share/Filesystem destructure from the module and were never affected.)

### 4c. Still PENDING ⏳ (needs hands-on use of the phone; none of this is claimed)

| Area | Cases pending |
|---|---|
| Counting | Responsiveness feel; haptics strength; banner/card/part sheet/finale on the real screen in immersive mode, AR and EN |
| Share | PNG share to WhatsApp (image + caption behaviour), cancel without error, text fallback, Arabic canvas shaping in this WebView, FileProvider cache file |
| Reminders | Soft-ask → system permission dialog only after "Yes"; deny / re-deny / revoke later; reminder delivered with the app closed; tap → counter; tap while biometric-locked; tap on a different account; tap for a deleted project; force-stop behaviour; lock-screen generic text; small icon; **reboot restore (needs explicit permission to reboot)**; stale burst after power-off; HONOR/MagicOS battery-saver behaviour |
| Guest import | Guest with real counts → sign in → badges, dates and counts preserved on the phone |
| Ledger | Real `putJoyIfAbsent` transaction under rapid taps (the store exists and is empty; no taps were made, to avoid changing the existing projects on the phone) |

## 5. Not tested 🚫

iOS (no build, no device) · OEMs other than HONOR (Samsung/Xiaomi/Huawei) · Android 10–15 · TalkBack · a remote account on a real Cloudflare backend (not needed: no sync of joy data exists) · very large projects (1000+ rows) on a slow device.

## 6. Known limitations ⚠

1. Reminders are **inexact** (no exact-alarm permission by decision) and may be late or delayed by OEM battery savers; force-stop cancels them until the next launch.
2. After the phone was powered off, the plugin may fire stale one-shot reminders ~15 s after boot (R-29).
3. Achievements and joy history are **device-local** (cross-device sync deferred, Q2); reinstalling the app or clearing data loses them.
4. Share is user-initiated only; image + caption together depends on the target app, so a text fallback exists.
5. No push notifications, no server-side scheduling, no Cloudflare changes (Q8).

## 6b. Blocked

Hands-on phone cases (§4c) need the user to operate the phone or to allow test taps on their data. Reboot tests are blocked until the user explicitly allows a reboot.

## 7. Cloudflare

**No changes.** No Worker deploy, no remote D1 migration, no Cron/Queues, no Firebase, no plan change. The staging 0002/0003 mismatch was not touched.
