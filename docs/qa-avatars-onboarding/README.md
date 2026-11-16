# Illustrated onboarding + crochet avatars — QA evidence

Branch `feat/illustrated-onboarding-avatars`. Real device: Android 16, 1264×2736 @ 560 dpi, 3-button navigation, USB, debug APK, local Worker via `adb reverse tcp:8787`.
Screenshots are downscaled to 480 px wide. `00-avatar-collection.png` is the six-avatar set (large + 40 px).

## Verified on the phone
| Area | Result |
|---|---|
| Four onboarding scenes (AR) | art fully visible, nothing under the nav bar, CTA reachable (01–04) |
| English / LTR | back arrow, Skip, copy, Demo badge on the assistant slide (05–06) |
| Hardware Back on slides | initially **exited the app**; fixed (explicit step-back in `app.ts`); now 4→3→2→1 |
| Sign-up → avatar step first | shown, pick + confirm, "I'll choose later" (07) |
| Skip avatar | server row `avatar_id = NULL`, `onboarded = 1`, Home shows default bunny |
| Existing account (no avatar) | default bunny + "Choose" badge in Settings |
| Picker sheet | preview, selected ring + check, Save, **Cancel leaves saved value unchanged** (08, 11) |
| Sheet buttons vs nav bar | initially overlapped the nav bar (content scrolled at 86 % height); fixed with compact picker + sticky footer |
| Setup avatar step vs nav bar | initially pressed against nav bar; fixed with auto-compact picker on short viewports |
| Save → force-stop → reopen | avatar restored (09) |
| API down: change avatar → force-stop → reopen | stays on device ("not connected, changes saved on the device"), then reaches D1 once the API is back (10) |
| Sign out / sign in same account | straight to Home (no avatar step), avatar restored (12) |
| Account isolation (server rows) | each account keeps its own `avatar_id`; a fresh account starts at NULL |

## Not verified on the phone
- Tab-through of every English setup step and every slide at 320/360/412 px (browser emulation covered 320×568 and 390×844 only).
- A second physical device (restore on another device is covered by the e2e test against the local Worker).
- Offline was simulated by stopping the local API, not by switching the phone's radios.
