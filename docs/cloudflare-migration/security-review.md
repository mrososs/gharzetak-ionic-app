# Security review (pre-staging)

Scope: the six areas flagged before any remote staging deployment, reviewed against the code on `development`. "Verified" means exercised by an
automated test or in a real browser; "Not verified" says what is missing.

## 1. Password hashing vs Cloudflare CPU limits - **blocker for the Free plan**

* Hashing is WebCrypto PBKDF2-SHA256, 100,000 iterations (the workerd maximum; OWASP's SHA-256 figure is 600,000).
* **Measured: ~12 ms median / ~13 ms p90 per hash** (25 runs, Node/OpenSSL; workerd uses the same primitive and its timers are frozen during compute, so a
  Workers-side figure can only come from the deployed Worker's CPU metric).
* The Workers **Free plan allows 10 ms CPU per request** -> sign-in / sign-up / password reset **will most likely fail** on Free (error 1102). Paid
  ($5/month) allows 5 minutes of CPU.
* **Decision needed:** staging and production on **Workers Paid**. Do not lower the iteration count to fit Free; that weakens every stored hash.
* Mitigations in place: 8-character minimum, DB-backed rate limits (sign-in 8/min, sign-up 5/min, reset 3/min per IP; enabled for **staging and production**,
  tested), uniform error for wrong email/password, versioned hash format (`pbkdf2-sha256$iter$salt$hash`) so the KDF can be upgraded without a reset.
* To confirm after deploy: `wrangler tail --env staging` while signing in; look at CPU time per request. Set a Workers spending limit / email alert.

## 2. Secure token storage on Capacitor - **implemented, device test pending**

* Native builds store the session in **iOS Keychain / Android Keystore** (`@aparajita/capacitor-secure-storage` 8.0.1): this-device-only, **iCloud Keychain sync
  disabled**. A token left in plaintext Preferences by an earlier build is migrated once and deleted.
* If the secure store fails the session lives **in memory only** (re-login next launch); it is never written to plaintext as a fallback.
* Verified: 8 unit tests with mocked native layers (store, migration, clear, failure mode, malformed data, web path). Real browser: token cleared on sign-out.
* **Not verified:** the plugin on a real device/emulator. `cap sync` registered it for Android and iOS (`Package.swift`, Gradle files updated), but the Android
  Gradle compile could not run in this environment (JVM "Unable to establish loopback connection"). Run `npm run android:build` locally, then test sign-in,
  kill the app, relaunch (session restored), sign-out.
* Web has no secure token store (localStorage); the token is an expiring, revocable session id and the API sets no cookies. Host the web app with a strict CSP.

## 3. Offline sync and 409 conflicts - **no silent loss**

Rules (`sync-strategy.md` has the table):

* Same `clientUpdatedAt` on the server = our earlier attempt already landed: silent, nothing lost (idempotent).
* **Tracker progress compares position, not just clocks**: the further-along state (round/count, or pattern row/pointer) always wins. A stale device that counted
  *more* keeps its stitches even with an older clock (e2e-tested: server 20 newer-clock vs local 25 older-clock -> 25 on the server).
* Otherwise last-write-wins; if the **server's version wins**, the local data is saved in IndexedDB (`docs.conflicts`, newest 25) and the user is told with a toast.
  A server rejection that exhausts retries is saved and announced too. **Nothing is dropped without a trace** (e2e: backup contains the exact stale count and the
  notice names the project).
* Offline / 5xx / 429 / 401 never consume attempts; a 401 keeps the outbox and local data.
* Browser-verified: offline taps survive a page reload (real IndexedDB v2, `revisions` store present, one coalesced `progress:upsert`, `attempts=0`), then sync
  automatically when the Worker returns.
* **Residual risks:** (a) the backups are stored but there is **no restore/browse UI yet** (recoverable via IndexedDB; a Settings screen is the follow-up);
  (b) a further-along stale device overwrites a newer-but-lower server position (e.g. an undo on another device) and that overwritten server state is not
  backed up; (c) "Erase data on this device" deletes backups by design; (d) multi-device simultaneity was tested with one app instance plus a raw API client.

## 4. Authorisation and user data isolation - **verified**

* Every `/v1/*` route sits behind `requireUser`; every statement is filtered by the authenticated user id; other users' resources answer the **same 404** as
  missing ones; child writes require an owned, non-deleted project; project links require a readable pattern; sample patterns are not writable.
* Verified by `sync.test.ts` / `media.test.ts` (two-user suites), the smoke test, the e2e account-switching test and, in the browser, two accounts + guest scope
  in one IndexedDB (each in its own `user:<id>` / `guest` scope, no cross-scope records).
* Known gaps: no **account-deletion** endpoint (store policies require one for apps with accounts); no audit log.

## 5. Email verification / password recovery - **limitation until a provider exists**

* No mail provider is configured. Production **throws** instead of silently dropping mail; dev/staging log the link to the Worker logs
  (`wrangler tail`), never to the requester, and the in-memory outbox is capped at 50.
* Consequences for staging: password reset works only if a developer reads the log; keep `REQUIRE_EMAIL_VERIFICATION=false`, otherwise nobody can finish sign-up.
* Reset links are single-use, 1 hour, revoke all sessions; wrong/unknown emails get the same 200 (tested). A duplicate-email sign-up is reported (enumeration-safe
  only once verification is on).
* To close: pick a provider, implement `services/mailer.ts`, enable verification, test with a real mailbox and the native deep link.

## 6. R2 private object access - **verified, with one structural caveat**

* Bucket `gharzetak-media`: `r2.dev` disabled, no custom domains (checked through the Cloudflare MCP). Objects are only reachable through
  `GET /v1/media/object`, authorised by `media_objects.user_id`; magic-byte type check, streaming size limits, `private` cache headers, `nosniff`, CSP `sandbox`.
* **Staging shares the bucket via a key prefix** (`staging/`). The prefix is enforced by a bucket wrapper (`prefixed-bucket.ts`) for every put/get/head/delete/list and
  tested (objects land under `staging/`, are invisible through another prefix, deleted with the project). **Caveat:** this is an application-level boundary. The staging
  Worker's binding can technically read the whole bucket, so a bug or compromise in staging could reach other prefixes. Before production uses the same bucket, prefer
  a separate bucket (or R2 API-token scoping) for staging.
* Never enable a public domain on this bucket: it would expose every environment.

## Additional hardening added in this pass

* The Worker **refuses to serve** while any `REPLACE_*` placeholder remains in `AUTH_BASE_URL`/`APP_ORIGINS`, and refuses the **development** configuration on a
  non-local host (an accidental `wrangler deploy` without `--env`). Both tested.
* Rate limiting enabled for the `staging` environment.
* Dependencies: root `npm audit` 0 vulnerabilities; `apps/api` 4 moderate advisories in dev-only `drizzle-kit` tooling (not shipped).
* Secret scan of all history on the merged branch: only placeholders. Personal account identifiers were removed from the docs **before** the first push.
