# Google sign-in and biometric app unlock

Both features sit on top of the existing Better Auth bearer-session design ([auth-strategy.md](auth-strategy.md)). Neither adds a new session type,
database or third-party auth service (no Firebase, no Supabase).

## 1. Google sign-in

```
Android/iOS app                         Worker (Hono + Better Auth + D1)                Google
 SocialLogin.login({nonce}) ───────────────────────────────────────────────────────────▶ account picker
 ◀─────────────────────────────────────────────────────────────── Google-signed ID token (aud = WEB client id)
 POST /api/auth/sign-in/social {provider:'google', idToken:{token, nonce}} ─▶ verify: RS256 signature (Google JWKS),
                                                                               iss, aud ∈ {web, android} client ids,
                                                                               exp (<= 1 h old), nonce
 ◀─ set-auth-token: <bearer session> ─────────── user + google account + profile rows (D1)
 SessionStore.save(...)  (Keystore-backed secure storage)
```

* **Client secret stays on the Worker.** `GOOGLE_CLIENT_SECRET` is a Worker secret (`apps/api/.dev.vars` locally, `wrangler secret put` when deployed).
  The app only receives the **public Web client id** (`GZ_GOOGLE_WEB_CLIENT_ID` → `env.generated.ts`). The build script refuses malformed ids, and the
  production bundle was scanned: the Web client id is present, the secret and the Android client id are not.
* **Audience.** `socialProviders.google.clientId` is the list `[web client id, android client id]` (`googleAudiences()`); a token minted for any other
  client id is rejected with 401 (tested).
* **Nonce.** The app sends a per-attempt random nonce to the picker and to the Worker; Better Auth rejects a token whose `nonce` claim differs (tested).
* **Data minimisation.** `databaseHooks.account.{create,update}.before` null out `idToken`, `accessToken`, `refreshToken` and expiry columns, so no Google
  token is persisted in D1 (tested). In the app the ID token is used once and `SocialLogin.logout` runs after every attempt.
* **Account linking.** A Google login is linked to an existing email account only when Google vouches for the email **and** the local account's email is
  verified (`requireLocalEmailVerified`, `trustedProviders: []`). Email/password accounts are unverified today (no mail provider), so signing in with
  Google using an email that already has a password account is **refused** with a clear message ("sign in with email and password") instead of taking
  the account over. Same email → one user id → no duplicate profile, projects or tracker progress (tested for the verified case).
* **Rate limit.** `/sign-in/social` is limited to 10/min per IP in staging/production; the existing email limits are unchanged.
* **Web.** Google sign-in is native-only: browsers have no supported embedded flow, and Google's redirect flow needs an authorised redirect URI on the
  Web client plus a one-time-token hand-off for the bearer session. The button is simply not shown on web (no dead button).
* **iOS.** Needs `GZ_GOOGLE_IOS_CLIENT_ID`; while it is empty the button is hidden on iOS.

### Google Cloud checklist (all in ONE project)

| Item | Value |
|---|---|
| OAuth client: **Web application** | its id → `GZ_GOOGLE_WEB_CLIENT_ID` and Worker `GOOGLE_CLIENT_ID`; secret → Worker `GOOGLE_CLIENT_SECRET` |
| OAuth client: **Android** | package `com.gharzetak.app`; SHA-1 of the signing key of the APK you install. Debug key of this repo: `91:8B:DF:EE:9E:11:0C:8E:2C:34:65:C8:32:F0:AB:B3:D2:E0:55:43` (public certificate data). Add the release / Play App Signing SHA-1 later |
| Consent screen | External; scopes `openid`, `email`, `profile`; while in *Testing* add every test Google account under **Test users** |
| Never | pass the Android client id as `webClientId` (the app uses the Web id) · put the Web secret in the app or in git |

The Android client cannot be checked from the repository (Google Console has no read API here). The Web id + secret pair was validated against Google's
token endpoint with a dummy code (`invalid_grant`, not `invalid_client`). Whether the Android client carries the right package + SHA-1 is proven only by a
real sign-in on the phone (`[28444] Developer console is not set up correctly` means it does not).

## 2. Biometric app unlock (opt-in)

* **Where it is offered:** a prompt after a Google sign-in ("تحبي تفتحي غرزتك بالبصمة بعد كده؟" / *Enable biometrics* / *Not now*, asked once per
  account) and **Settings → فتح التطبيق بالبصمة** (On / Off). Only on the native app, and only if `NativeBiometric.isAvailable()` says a real
  biometric is enrolled. Web keeps the unchanged login experience.
* **What is protected.** Turning it on calls `NativeBiometric.setData` with `AccessControl.BIOMETRY_CURRENT_SET` and `authValidityDuration: 0`. On Android
  this creates an AES key in the Keystore that requires user authentication **for every use**, and the BiometricPrompt is bound to that operation through
  a `CryptoObject`. The bearer session is stored in that entry; the plain `gz.session` copy is then deleted. Without a successful fingerprint the token
  cannot be read from disk by the app. Enabling therefore requires a real biometric check, and a cancelled prompt changes nothing (tested).
* **App launch (cold start).** `SessionStore.load()` returns no session and puts nothing in memory; `AuthService.locked` is true; the route guards
  (`appGuard`, `signedOutGuard`, `entryGuard`) await `untilUnlocked()`, so **no private page is instantiated, no store loads data, and no authenticated API
  call is made** until the OS releases the token. The lock screen is an opaque overlay on top of an inert (`inert`, `aria-hidden`) router outlet.
* **Unlock.** `readProtected()` → OS prompt → token → `GET /api/auth/get-session` (6 s timeout). 401 → the session is wiped and a normal Google/email
  login is required. Offline → the cached session is used (policy: offline projects stay reachable; every API call is still authorised by the server).
* **Background / resume.** On pause a privacy cover hides the screen (task switcher). After 30 s in the background the app re-locks and asks for the
  biometric again; the re-lock requires the protected token to equal the live session.
* **Cancel / failure / lockout** keep the app locked with a message; **no fingerprint enrolled / sensor unavailable** hides or disables the option.
* **Enrollment change** (a fingerprint is added or removed) invalidates the `BIOMETRY_CURRENT_SET` key. The next unlock detects it (code 21), wipes the
  protected session and asks for a normal sign-in; the user can re-enable biometrics afterwards.
* **Disable** needs a fresh biometric (reading the protected session) and writes the session back to the normal secure store; if the entry is already
  invalidated, the live session is kept instead.
* **Logout / expiry / account switch** (`expire()` → `SessionStore.clear()`) delete the protected entry, the flag and the token. A different session
  saved while protection is on drops the old protection instead of mixing sessions.
* **Never stored:** biometric templates (the OS keeps them), Google passwords, Google ID/access tokens, a plaintext token fallback.

### Limits you should know

1. **Local IndexedDB data is not encrypted.** The lock protects the *session* and the *UI*. Someone with file-system access to a rooted device could read
   cached projects from IndexedDB; the lock screen cannot stop that. (Sensitive data on the server is protected by the bearer session.)
2. **Rooted / hooked devices** can bypass any client-side check (Frida, Xposed). The Keystore-bound key blunts this (the token cannot be decrypted
   without the OS-level authentication) but root detection is out of scope.
3. The task-switcher cover is best-effort (the WebView must paint it before Android captures the thumbnail). `FLAG_SECURE` was not used because it also
   blocks legitimate screenshots.
4. A server-side session that was revoked while the phone is offline is only noticed on the next online request.
5. Disabling after an enrollment change cannot revoke the old server session (the token was unreadable); it expires on its own (30 days).

## 3. Tests

| Layer | What | Status |
|---|---|---|
| Worker (Workers runtime, mocked Google JWKS with a locally generated RSA key) | new user + account + profile, idempotent login, android audience, wrong audience, expired, wrong issuer, forged key, malformed JWT, nonce, unverified-account takeover refused, verified linking keeps the user id, no provider tokens persisted, config helpers | 12 tests, pass |
| Angular unit (`ng test`) | `SessionStore` biometric protection (18), `AuthService` Google + lock/unlock/enable/disable/logout (28) with mocked plugins | pass |
| Real phone | Google picker, ID token, Better Auth session, biometric prompt, lock/unlock, Settings toggle | see the final report for what was executed |

Mocked tests prove the logic only. They are **not** native validation.
