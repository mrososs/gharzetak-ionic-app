# Test results

Produced by running the commands on 2026-11-16 against merged `development` plus the security-hardening changes. Nothing is claimed that was not executed.

## Automated

| Suite | Command | Result |
|---|---|---|
| Angular typecheck | `npm run typecheck` | pass |
| Angular unit tests (`ng test`, Node 24.22.3) | `npm test` | **46/46** (38 domain tests with unchanged assertions + 8 `SessionStore` tests) |
| Angular production build | `npm run build` | pass; 0 `supabase` strings in `www/` |
| API tests in the Workers runtime (miniflare) | `npm run api:test` | **50/50** (auth 13, sync 14, media 15, staging 8) |
| API typecheck | `npm run api:typecheck` | pass |
| Wrangler dev HTTP smoke test (local D1 + R2) | `npm run api:dev` + `npm run api:smoke` | **20/20** |
| Real Angular sync services vs the live local Worker | `npm run e2e:sync` | **12/12** |
| Local D1 migration from an empty database | `wrangler d1 migrations apply --local` + seed | 41 statements ok; 2 patterns, 17 rounds, 22 tables |
| Staging config | `wrangler deploy --env staging --dry-run` | bundles (475 KiB gz), correct bindings, nothing deployed |
| Original `production@b95981f` baseline | typecheck, `ng test`, build | pass, 38/38 |

### Critical-test list

| # | Requirement | Evidence |
|---|---|---|
| 1 | Registration and login | API tests, e2e, **browser** (sign-up form, sign-in form) |
| 2 | Session restoration | e2e, **browser** (full reload stays signed in, also while offline) |
| 3 | Create project | API, e2e, **browser** (project saved, 201 in D1) |
| 4 | Save stitch progress | API, e2e, smoke, **browser** (counter -> D1 count/revision) |
| 5 | Reload and resume | e2e, **browser** (count restored after reload while the server was down) |
| 6 | Sign out and back in | API, e2e, **browser** (token cleared from storage, redirect to onboarding) |
| 7 | Restore cloud progress | e2e (new device) |
| 8 | Offline counting | e2e, **browser** (server stopped: 1 -> 5 stitches, one coalesced `progress:upsert`, `attempts=0`) |
| 9 | Reconnection sync | e2e, **browser** (Worker restarted: outbox emptied, D1 count 5, revision 3) |
| 10 | Guest account import | e2e, **browser** (guest project moved into the account scope, guest scope emptied, in D1) |
| 11 | Two-user ownership isolation | API suites, smoke, e2e, **browser** (guest / two accounts in one IndexedDB, separate scopes) |
| 12 | Private R2 object access | `media.test.ts`, `staging.test.ts`, smoke, e2e blob download |
| 13 | Concurrent stale progress writes | API (4 parallel: 1 wins), e2e (stale loses + backup; **further-along stale keeps its stitches**) |
| 14 | Android Back navigation | **NOT RUN** (no device/emulator) |
| 15 | Arabic RTL / English LTR | **browser**: Arabic `dir=rtl lang=ar` + Playpen Sans Arabic, English `dir=ltr lang=en` + Playpen Sans; sign-up, onboarding, home, new-project, tracker, settings, login, import alert rendered correctly at 375x812. Not run on hardware |

### Real-browser run details (Ionic dev server :4200 + local Worker :8787, real CORS preflights)

Sign-up -> onboarding (3 steps; profile + tools synced) -> new project -> tracker taps -> server stopped -> taps offline -> page reload (IndexedDB v2 verified:
stores `docs, outbox, patterns, projects, revisions`) -> Worker restarted -> auto-sync -> language switch -> sign out -> guest project -> sign in -> import alert ->
import verified in D1. A first sign-in attempt with a mistyped test password returned 401 as designed; fields were then set through the DOM events Angular listens to.

## Security-specific checks

CORS allow-list without credentials, security headers, PBKDF2 hashing, password-reset round trip (token reuse, session revocation), rate limiting (429) in production
and staging modes, expired/revoked sessions, file type/size validation (415/413/400), path traversal, ETag/304, Arabic upload names, R2 cleanup on delete, R2 prefix
isolation, placeholder and development-on-public-host guards, `SessionStore` native/web/migration/failure behaviour, conflict backup + notice.

## Not executed (and why)

| Item | Reason |
|---|---|
| Android Gradle build / secure-storage plugin on a device | the Gradle daemon cannot open a loopback socket in this environment ("Unable to establish loopback connection"); `cap sync` for Android and iOS succeeded. Run `npm run android:build` locally |
| Android hardware Back, native deep links, iOS | no device/emulator |
| Supabase RLS suite | Supabase local stack not running; superseded by API ownership tests |
| Real email delivery / verification flow | no provider configured |
| Google / Apple sign-in | not implemented |
| Workers-side CPU time of PBKDF2 | only measurable on a deployed Worker (Node measurement: ~12 ms) |
| Anything against remote Cloudflare resources | nothing deployed (approval-gated) |

## Test-harness notes (not product behaviour)

`e2e/setup.ts` adds an `Origin` header and uses Node's `Blob`/a `createObjectURL` stub because jsdom/Node `fetch` differ from a WebView; the jsdom origin is
`http://localhost:4200`. The Vite dev server needs a restart (clear `.angular/cache`) after adding a dependency ("504 Outdated Optimize Dep" otherwise).
