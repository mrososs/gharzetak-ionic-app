# Release QA — Crochet Joy + Pattern Collections to `test` / staging (2026-11-18)

Scope: promote `development` (with Crochet Joy) to `test`, bring the **staging** Cloudflare backend up to date, and verify the online client build on a real phone.
Everything below was observed; anything not observed is listed under "Not verified".

## Git

| Step | Result |
|---|---|
| Feature branch | `feat/crochet-joy-implementation` @ `d005bbc` |
| Merged into `development` | merge commit `b7c743c` (tree identical to the feature branch), pushed |
| `development` ↔ `test` | had diverged (test had 6 commits development lacked; 1 conflict in `new-project.page.ts`) |
| Conflict resolution | kept development's collection/estimate/guard work **and** test's draft-leak fix; 3 draft-leak specs pass unchanged |
| PR #5 | `release/development-to-test` → `test`, merged as `d3e7864`; `development` fast-forwarded to the same commit |
| `production` | untouched (`b95981f`) |

## Cloudflare (staging only)

| Item | State |
|---|---|
| Worker | `gharzetak-api-staging` → https://gharzetak-api-staging.gharzetak.workers.dev |
| D1 | `gharzetak-db-staging` — migrations **0002_collections_revisions_time** and **0003_pattern_source_text** applied (0000/0001 were already there). Both are additive (`CREATE TABLE`, `ADD COLUMN`); no row was rewritten or dropped. Staging had 0 users before. |
| Restore point | D1 Time Travel bookmark taken before the change: `0000000c-00000000-00005126-e2edfd1d6abe7ca81b81af12a61be4eb` |
| R2 | existing private `gharzetak-media` bound, isolated by the `staging/` prefix (health: `r2Bound: true`) |
| Secrets | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ANDROID_CLIENT_ID` present (names only checked) |
| Worker version | first redeploy `07df6517-60d1-4447-807a-8e643a82ce6e`; a later redeploy carries the log-hygiene fix below |
| Paid services | none activated. Plan could not be read (billing API 403). |
| CPU | last 6 h: 35 requests, all `success`, 0 errors, no `exceededCpu`; CPU p50 ≈ 15 ms, p99 ≈ 98 ms (above the documented Free 10 ms, yet nothing failed — **confirm the plan in the dashboard**). Hashing was not weakened. |

## Automated

| Check | Result |
|---|---|
| App typecheck (app + spec) | clean |
| Angular unit tests | **547 passed / 36 files** |
| API tests (`apps/api`) | **92 passed / 7 files** (89 + 3 new for the mailer) |
| Sync integration (`e2e:sync`, local Worker) | **23 / 23** (one stale expectation fixed, see below) |
| Hosted smoke (`smoke-remote.mjs`) | **29 / 29** against the deployed staging Worker |
| Production frontend build | OK |

## Real phone (HONOR DNY-NX9, Android 16), build 1.1.0-test (versionCode 2)

APK: `com.gharzetak.app`, debug certificate SHA-1 `91:8B:DF:EE:9E:11:0C:8E:2C:34:65:C8:32:F0:AB:B3:D2:E0:55:43` (same identity as the previous client build, so it installs over it). Embedded config: staging URL + public Google web client id only; no localhost, no client secret.

| Area | Result |
|---|---|
| Email **sign-up** against hosted staging | PASS |
| **Guest → account import** (2 projects + 18 ledger rows incl. achievements, real device) | PASS — projects reached D1; guest ledger cleared after a complete import; the new account's scope holds only its own data |
| Session persistence (force-stop + relaunch) | PASS |
| Logout, then email **login** | PASS — project and progress restored from the cloud |
| User isolation | PASS — the new account sees only its own 2 projects; other accounts' cached projects on the phone are not shown |
| Pattern collection (smart paste, 2 parts, quantities) | PASS — saved and synced to D1 |
| Multi-part project (3 pieces) + part-completion sheet | PASS |
| Project started from a collection (merge-resolution path) | PASS — collection preselected, name filled |
| Offline counting → reconnection sync | PASS — airplane mode, 6 stitches counted, D1 progress revision 7 → 8 after reconnect |
| Notification permission: system dialog only after "Yes" | PASS |
| Notification permission **denied** | PASS — app explains, 0 alarms |
| "Open settings" (native plugin) | PASS — lands on the app's notification settings |
| Permission granted in system settings | PASS — reminders stay OFF until the user opts in |
| Reminders on | PASS — 8 inexact alarms, Sun/Wed 19:30 |
| **Delivery with the app process killed** | PASS — AlarmManager woke the app and posted the notification |
| **Cold-start tap** | PASS — opens the right project, piece (Ears 1/2) and round |
| Logout cancels reminders | PASS — 8 → 0 alarms, no leftover notification |
| Google account chooser | opens correctly (OAuth client + signing identity are wired); **cancel handled cleanly**; completing sign-in needs a human to pick an account |

## Bugs found by this release pass (fixed in the follow-up PR)

1. **Hosted logs leaked one-time links**: staging printed the full reset/verification link and the recipient with `console.log`. Now printed only for local development (3 tests).
2. `e2e/sync.e2e.ts` still expected `refresh()` to return a number (it returns `{projects, joy}`); fixed, 23/23.

## Not verified

- **Google sign-in completion** (needs a human to choose an account), session persistence of a Google session, Google account switching.
- **Biometric unlock + notification tap** (needs the owner's fingerprint). Covered by unit tests only.
- Lock-screen appearance of the notification (generic text; not observed on the lock screen).
- Reboot restore (not done without permission), HONOR battery-saver behaviour over days.
- Password reset / email verification (no mail provider; hidden in this build).
- iOS, other phones, other Android versions.
