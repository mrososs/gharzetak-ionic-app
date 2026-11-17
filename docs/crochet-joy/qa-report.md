# Crochet Joy — QA Report

**Date:** 2026-11-17 · **Branch:** `feat/crochet-joy-implementation` · **Base:** `origin/development` @ `f616ee9`
**Honest summary:** web/unit-level verification is done and evidenced. **No physical Android device was connected, so every hardware case is PENDING.** Emulators were not used (by instruction). iOS was not built or tested.

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

## 4. Physical Android — ALL PENDING ⏳

No device was connected (`adb devices -l` listed none). Nothing below is claimed as working.

| Area | Cases pending |
|---|---|
| Install | Fresh debug APK installs over the existing app **without clearing data** |
| Counting | Responsiveness feel on a real device; haptics strength; immersive mode with banner/card |
| Celebrations | Banner/card/part sheet/finale on a real screen, AR RTL and EN |
| Share | PNG share to WhatsApp (image + caption behaviour), cancel without error, text fallback; Arabic canvas shaping in the device's WebView; FileProvider cache file |
| Reminders | Soft-ask → system permission dialog only after "Yes"; deny / re-deny / revoke later; a reminder delivered with the app closed; tap → counter; tap while biometric-locked; tap on a different account; tap for a deleted project; force-stop behaviour; reminder after the phone is rebooted (**needs explicit permission to reboot**); stale burst after power-off; OEM battery savers; notification small icon and colour; lock-screen generic text |
| Guest import | Guest with real counts → sign in → badges, dates and counts preserved on a real device |
| Update | APK upgrade keeps IndexedDB data (v3→v4) |

## 5. Not tested 🚫

iOS (no build, no device) · other OEMs (Samsung/Xiaomi/Huawei) · Android 10–12 · TalkBack · a remote account on a real Cloudflare backend (not needed: no sync of joy data exists) · very large projects (1000+ rows) on a slow device.

## 6. Known limitations ⚠

1. Reminders are **inexact** (no exact-alarm permission by decision) and may be late or delayed by OEM battery savers; force-stop cancels them until the next launch.
2. After the phone was powered off, the plugin may fire stale one-shot reminders ~15 s after boot (R-29).
3. Achievements and joy history are **device-local** (cross-device sync deferred, Q2); reinstalling the app or clearing data loses them.
4. Share is user-initiated only; image + caption together depends on the target app, so a text fallback exists.
5. No push notifications, no server-side scheduling, no Cloudflare changes (Q8).

## 6b. Blocked

Physical-device QA is blocked until a phone is connected by USB with USB debugging enabled. Reboot tests are further blocked until the user explicitly allows a reboot.

## 7. Cloudflare

**No changes.** No Worker deploy, no remote D1 migration, no Cron/Queues, no Firebase, no plan change. The staging 0002/0003 mismatch was not touched.
