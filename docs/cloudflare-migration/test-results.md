# Test results

All numbers below were produced by running the commands on 2026-11-16 against the migrated branch. Nothing is claimed that was not executed.

## Executed

| Suite | Command | Result |
|---|---|---|
| Angular typecheck | `npm run typecheck` | pass |
| Domain unit tests (unchanged assertions) | `npm test` (`ng test`, Node 24.22.3) | **38/38 pass** |
| Angular production build | `npm run build` | pass; 0 `supabase` strings in `www/` |
| API tests in the Workers runtime (miniflare) | `npm run api:test` | **42/42 pass** (auth 13, sync 14, media 15) |
| API typecheck | `npm run api:typecheck` | pass |
| Wrangler local end-to-end smoke (real HTTP, local D1+R2) | `npm run api:dev` + `npm run api:smoke` | **20/20 pass** |
| Angular sync services vs the live local Worker | `npm run e2e:sync` | **11/11 pass** |

### Mapping to the critical-test list

| # | Requirement | Evidence |
|---|---|---|
| 1 | Registration and login | `auth.test.ts`, e2e "registers..." |
| 2 | Session restoration | e2e (new `AuthService` restores cached bearer session), API `get-session` |
| 3 | Create project | API + e2e |
| 4 | Save stitch progress | API + e2e + smoke |
| 5 | Reload and resume | e2e "new device restores cloud progress" |
| 6 | Sign out and back in | API sign-out revocation; e2e account-isolation (sign out, sign in as another user, back) |
| 7 | Restore cloud progress | e2e "NEW device" |
| 8 | Offline counting | e2e "queues taps while offline, pushes nothing" |
| 9 | Reconnection sync | same test, then outbox empty and server count updated |
| 10 | Guest account import | e2e "imports guest projects..." |
| 11 | Two-user ownership isolation | `sync.test.ts` isolation suite, `media.test.ts`, e2e, smoke |
| 12 | Private R2 object access | `media.test.ts` (404/401 for other/anon, no public route), smoke, e2e blob download |
| 13 | Concurrent stale progress writes | API (4 parallel writers: exactly 1 wins), e2e stale device |
| 14 | Android Back navigation | **NOT RUN** |
| 15 | Arabic RTL / English LTR smoke | **NOT RUN** (no UI markup was changed; only auth/pattern-upload logic) |

Also covered: CORS allow-list without credentials, security headers, PBKDF2 hashing, password reset round trip incl. token reuse and session revocation, rate
limiting (429), expired/revoked sessions, file type/size validation (415/413/400), path traversal, ETag/304, Arabic upload file names, R2 object cleanup on delete,
CHECK-constraint-equivalent validation, soft deletes, idempotent retries, clock-skew clamping.

## Not executed (and why)

| Item | Reason |
|---|---|
| Supabase RLS suite (`test:rls`) | local Supabase not running (no Docker); superseded by the API ownership tests |
| Android hardware Back, deep links on device, WebView cookie/CORS behaviour, iOS | no device/emulator driven in this session |
| Arabic RTL / English LTR visual smoke | not driven in a browser |
| Real email delivery, email verification flow | no mail provider configured |
| Google / Apple sign-in | not implemented |
| IndexedDB durability across a real app kill | e2e uses jsdom's in-memory fallback |
| Production-like load / D1 free-tier limits / PBKDF2 CPU time on the Free plan | needs a deployed Worker |
| Remote D1/R2/Worker behaviour | nothing deployed (approval-gated) |

## Test-only deviations (not product behaviour)

`e2e/setup.ts` adds an `Origin` header and uses Node's `Blob` / a `createObjectURL` stub because jsdom/Node `fetch` differ from a real WebView. The jsdom
origin is set to `http://localhost:4200` (the Ionic dev origin) because Better Auth rightly rejects callback URLs outside `APP_ORIGINS`.
