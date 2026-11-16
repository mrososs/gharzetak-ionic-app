# Authentication strategy

## Choice

**Better Auth 1.7.25 on Cloudflare Workers + D1 + Drizzle**, email + password, with the `bearer` plugin.
Compatibility was verified by running it, not assumed: sign-up, sign-in, session lookup, sign-out, password reset and rate limiting all pass in the
Workers runtime (`apps/api/tests/auth.test.ts`, 13 tests) and against `wrangler dev` (`apps/api/scripts/smoke-local.mjs`).

## Session model for Capacitor: bearer tokens, not cookies

The app is a WebView (`capacitor://localhost` on iOS, `http(s)://localhost` on Android, `http://localhost:4200` in dev) calling a
cross-origin API. Cookies are unreliable there (SameSite, third-party cookie blocking, custom schemes), so:

* Sign-in / sign-up return the session token in the `set-auth-token` response header (exposed via CORS).
* The app sends `Authorization: Bearer <token>`; `requireUser` resolves it with Better Auth.
* No ambient credentials -> classic **CSRF does not apply** to `/v1/*`. CORS is an **exact allow-list** (`APP_ORIGINS`), **without**
  `Access-Control-Allow-Credentials` (tested).
* Sessions last 30 days (refreshed daily) and are revocable server side (sign-out and password reset revoke them; tested). The bearer value is Better Auth's
  signed session token; the session row (`session.token`) lives in D1.

### Offline behaviour

`AuthService.init()` restores the cached `{token, user}` from Capacitor Preferences **without waiting for the network**, then revalidates in the
background. Only an explicit `401` (or an empty session) ends the session; offline/5xx never log the user out. When the server later answers 401,
`SyncService` calls `auth.expire()`: the session is dropped but **local data and the unsent outbox are kept** for the next sign-in
(covered by the `session expiry` e2e test).

### Token storage

* **Native:** iOS Keychain / Android Keystore via `@aparajita/capacitor-secure-storage` 8.0.1 (this-device-only, iCloud Keychain sync off). A plaintext token from an
  earlier build is migrated once and removed. If the secure store fails the session stays in memory only; there is **no plaintext fallback**. Unit-tested with mocked
  native layers; **not yet exercised on a device** (the Android Gradle compile could not run in the review environment).
* **Web:** Capacitor Preferences (localStorage): browsers have no secure token store. The token is an expiring, revocable session id and the API sets no cookies;
  serve the web app with a strict CSP. See [security-review.md](security-review.md).

## Flows

| Flow | Implementation | Verified |
|---|---|---|
| Sign up | `POST /api/auth/sign-up/email` (+ profile row via DB hook) | API + e2e |
| Sign in / out | `/sign-in/email`, `/sign-out` | API + e2e |
| Session restore | cached token + `GET /get-session` | e2e (new `AuthService` instance) |
| Expired/revoked session | 401 -> `expire()`, data kept | e2e |
| Password reset | `/request-password-reset` -> emailed link -> `/reset-password` (single-use token, 1 h) | API (full round trip incl. token reuse and session revocation) |
| No account enumeration on reset | always 200 | API |
| Email verification | `REQUIRE_EMAIL_VERIFICATION=true` (off by default); sign-up returns no token -> app shows "check your email" | **config only - not exercised**; needs a mail provider |
| Guards, guest mode, scope switching | unchanged (`AuthService` surface preserved) | e2e (account isolation) |
| Google sign-in | native account picker -> Google ID token -> `POST /sign-in/social` (Better Auth verifies it); see [google-biometric-auth.md](google-biometric-auth.md) | API (mock JWKS) + unit; real phone: see that doc |
| Biometric app unlock | opt-in, native only; session kept in a biometric-bound Keystore/Keychain entry; see [google-biometric-auth.md](google-biometric-auth.md) | unit; real phone: see that doc |
| Apple | removed from the UI (button, icon, provider code); the Apple SDK is not bundled | n/a |

### Password hashing

Better Auth's default scrypt (pure JS) can exceed Workers CPU limits, so a custom hasher uses **WebCrypto PBKDF2-SHA256**, random 16-byte salt,
constant-time comparison, self-describing format `pbkdf2-sha256$<iter>$<salt>$<hash>`. **Trade-off:** workerd caps PBKDF2 at 100,000 iterations, below the
OWASP figure for SHA-256 (600,000). Mitigations: 8-char minimum, database-backed rate limits (sign-in 8/min, sign-up 5/min, reset 3/min per IP, tested),
and a versioned hash format so the algorithm can be upgraded without a forced reset.

### Email

`services/mailer.ts` captures mail in development/tests and **throws in production** until a provider is configured (so a missing provider is
loud, never a silent drop). Pick one (Cloudflare Email Service, Resend, ...) before enabling email verification or announcing password reset.

## Deep links and reset links

* Web: the emailed link lands on `<origin>/auth/reset?token=...`; `AuthService.init()` reads the token and removes it from the address bar.
* Native: `com.gharzetak.app://auth/reset?token=...` -> `handleDeepLink()` -> `/auth/reset`. `com.gharzetak.app://` is in `APP_ORIGINS` so Better Auth
  accepts it as a redirect target. Set `GZ_AUTH_REDIRECT_URL=com.gharzetak.app://` for native builds.
* A reset revokes all sessions; the user is sent to the login page with the new password (Supabase auto-signed in).
* **Not tested on a device**: Android intent filters / iOS URL scheme, WebView behaviour, hardware Back after login (see [test-results.md](test-results.md)).

## Existing users

No hosted Supabase project exists (see [audit.md](audit.md)), so there are **no accounts to migrate** and no password hashes were touched. Local
IndexedDB scopes named `user:<supabase-uuid>` on developer devices become unreachable after the migration (new ids); see
[sync-strategy.md](sync-strategy.md#legacy-local-scopes).
