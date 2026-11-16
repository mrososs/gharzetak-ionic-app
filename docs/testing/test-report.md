# Test report — 2026-11-16

Only tests that were actually executed are marked ✅. Environment: Windows 11, portable Node 24.22.3,
Angular CLI 22.2.7, local Supabase stack (CLI 3.1.0, Docker 29.7.2).

## Automated

| Suite | Command | Result |
|---|---|---|
| Unit — tracker engine (26), pattern parser + converter (14)* | `npm test` | ✅ 38/38 passed (*the 2 scaffold tests were removed with the scaffold component) |
| Type check (app + specs) | `npm run typecheck` | ✅ clean |
| Production build | `npm run build` | ✅ success, ≈277 kB initial transfer |
| RLS / storage / LWW integration | `npm run test:rls` | ✅ 36/36 passed (local Supabase) |
| Lint | — | ⚠ not configured (Angular 22 scaffold ships no ESLint); not run |
| Component / E2E suites | — | ⚠ not written; the flows below were exercised manually in the browser |

### Tracker cases covered by unit tests
Increment by 1 · target 30 +5 → 5…30 and stops · target 32 +5 → …30, 32 · undo incl. remainder tap · undo no-op ·
reset keeps round · round completion + next round + undo across boundary · cannot advance early · all-rounds
complete · lowering target clamps count · progress with total rounds · `R5: (3sc, inc) × 6 [30]` = 24 actions /
24 consumed / 30 produced / 6 groups · mid-round actions ≠ output · inc 1→2, dec 2→1 · magic ring 0→6 ·
group mode · round mode incl. last round · tap on finished round advances · undo across rounds · reset round ·
jump + undo · overall progress · unparseable pattern is inert.

### RLS cases (two real users + anon)
Profile auto-created; cross-user read/update/delete/insert/take-over blocked on projects; child rows
(progress, notes) can't attach to another user's project; `count ≤ target` enforced; stale (older) upsert
ignored, newer applied; anon reads samples only; private patterns hidden; fake/edited samples rejected;
foreign private pattern can't be linked, samples can; favourites isolated; non-YouTube bookmark URL rejected;
storage: own upload OK, foreign upload/download blocked, anon blocked, bad MIME rejected, wrong path depth
rejected, bucket not public; cascade delete.

## Manual (browser pane, local Supabase)

| Flow | Result |
|---|---|
| Real sign-up → setup (3 steps) → Home | ✅ |
| Profile + tools + project + progress + pattern rounds persisted in Postgres | ✅ verified with SQL |
| Pattern tracker R5 group counting in UI (24/24, 6/6, 24 → 30, pattern complete) | ✅ |
| Offline: API stopped → undo ×3 + tap → reload app → state kept → API restarted → server updated (ptr 24 → 13) | ✅ |
| Session restore after reload | ✅ |
| Arabic RTL and English LTR | ✅ on the screens listed in `visual-qa.md` |
| No horizontal scroll at 320 (tracker) and 360/412 px (14 routes × AR/EN) | ✅ |
| Password recovery email end-to-end | ⚠ not run (Mailpit available at :55424) |
| Logout, guest mode, guest → account import, delete project, photo upload via UI | ⚠ implemented, not exercised |
| Android Back after login | ⚠ logic implemented (`navigateRoot` + `replaceUrl`, guard, exit at root); not tested on a device |

## Android

Debug build via `scripts/android-debug.ps1` (Android Studio JBR 21, SDK `D:\Android\Sdk`).
Note: in this desktop session the sandboxed shell sees a virtualised `AppData\Local\Android\Sdk`; the real SDK is
`D:\Android\Sdk` — `android/local.properties` points there. Gradle cannot run inside the sandbox (loopback
sockets are blocked), so it was run in the visible terminal. Result: see the final report of this session.
✅ `BUILD SUCCESSFUL` — `android/app/build/outputs/apk/debug/app-debug.apk` (273 tasks). No emulator/device smoke test was run.
