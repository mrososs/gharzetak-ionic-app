# Gharzetak 1.1.0 — Google Play release runbook (backend, staging verification, Android build)

Status words used here are DIFFERENT things: **development complete** · **staging verified** · **legal pages public** · **backend operational** · **signed AAB ready** · **Play Console submission ready** · **closed testing complete** · **production access granted** · **publicly released**. Never report one as another. The live status table is `docs/play-release/release-gates.md`.

Release candidate identity: application id `com.gharzetak.app` (unchanged, `capacitor.config.ts` and `android/app/build.gradle`), **versionName 1.1.0, versionCode 3**, minSdk 24, **targetSdk 36 / compileSdk 36** (Google Play: new apps and updates must target API 36 from 2026-08-31; page read 2026-11-20).

## 1. Backend

### 1.1 What exists today
Only **staging** (`gharzetak-api-staging`, D1 `gharzetak-db-staging`, R2 `gharzetak-media` with prefix `staging/`). There is **no production Worker**. `wrangler.jsonc` now contains an `env.production` block with `REPLACE_*` placeholders: the Worker refuses to serve while any placeholder remains, so a half-configured deploy cannot go live.

### 1.2 Staging verification (needs your approval: remote change; the assistant was refused permission to run it)
Pending staging migration: **only `0005_account_deletion_job.sql`** (additive: one new table, no existing table touched). Restore bookmark recorded 2026-11-20 before any change:
`00000052-00000000-00005129-25beea6ef9d732397170605573a9a5ae` (`wrangler d1 time-travel restore gharzetak-db-staging --bookmark=<it>` to roll the database back).

```powershell
cd apps\api
node node_modules\wrangler\bin\wrangler.js d1 migrations list  gharzetak-db-staging --remote --env staging   # expect exactly 0005
node node_modules\wrangler\bin\wrangler.js d1 migrations apply gharzetak-db-staging --remote --env staging
node node_modules\wrangler\bin\wrangler.js deploy --env staging                                             # also registers the hourly cron
node scripts\deletion-check.mjs --url https://gharzetak-api-staging.gharzetak.workers.dev --origin https://localhost --allow-remote
$env:STAGING_URL='https://gharzetak-api-staging.gharzetak.workers.dev'; node scripts\smoke-remote.mjs         # existing 29 checks
```
Then verify the R2 key printed by `deletion-check.mjs` is gone (`wrangler r2 object get gharzetak-media/staging/<key> --remote` must fail) and `select state from account_deletion_job` is empty or `swept`. Wait for one cron tick (<= 1 h) and re-check `pending` jobs: none.

### 1.3 Production (first-time creation; every step needs a person's go)
Pre-flight (all must be true): `whoami` shows the intended account · `d1 migrations list` on the NEW empty database lists 0000-0005 · full API suite green (160+ tests) · staging verified (1.2) · Google OAuth Web client id and secret ready · decision on `GZ_API_URL`.

```powershell
cd apps\api
node node_modules\wrangler\bin\wrangler.js whoami
node node_modules\wrangler\bin\wrangler.js d1 create gharzetak-db-production            # prints the id -> put it in wrangler.jsonc env.production
node node_modules\wrangler\bin\wrangler.js d1 migrations apply gharzetak-db-production --remote --env production   # applies 0000..0005 to an EMPTY database
node node_modules\wrangler\bin\wrangler.js secret put BETTER_AUTH_SECRET --env production         # random 32+ bytes
node node_modules\wrangler\bin\wrangler.js secret put GOOGLE_CLIENT_ID --env production
node node_modules\wrangler\bin\wrangler.js secret put GOOGLE_CLIENT_SECRET --env production
# set AUTH_BASE_URL in wrangler.jsonc to the Worker URL printed by the first deploy, then:
node node_modules\wrangler\bin\wrangler.js deploy --env production
node scripts\deletion-check.mjs --url https://<production worker> --origin https://localhost --allow-production
```
Why this cannot corrupt data: the production database is new and empty, so there is no existing user data to lose; migrations are additive `CREATE TABLE`/`CREATE INDEX` only (verified: `grep -L "DROP\|DELETE" drizzle/*.sql`). Rollback = redeploy the previous Worker version (`wrangler rollback --env production`) and, for data, `d1 time-travel restore` to the pre-change bookmark (`d1 time-travel info` before every later migration).
Never: use the `--remote` flag against production for ad-hoc SQL except the documented operator tool; enable AI (`AI_ENABLED` stays `"false"`); share the R2 bucket publicly.

### 1.4 What the release depends on at runtime
Rate limiting is on for `production` (`auth.ts` `hardened`), `delete-user` 5/min, sign-in 8/min. Secrets only via `secret put`. Logs: `observability.enabled`; AI log lines are content-free; auth requests do carry bearer tokens in headers (not logged by the app code). Deletion: hooks + hourly cron + restore ledger are configured in the production block.

## 2. Google sign-in with Play App Signing
Play re-signs the app with **Google's app-signing key**. Sign-in by Google breaks in the Play build until the **Android OAuth client** also lists the Play app-signing certificate fingerprint: after the first upload, Play Console > Test and release > App signing > copy the **SHA-1** (and, because new apps use hybrid signing, the fingerprints Google lists) and add them to the Android OAuth client in Google Cloud. The debug keystore SHA-1 (`91:8B:DF:EE:…`) must stay registered for test APKs. This cannot be done before the first upload.

## 3. Android build (signed AAB)
1. Create an **upload keystore** once, outside git (Android Studio > Build > Generate Signed Bundle, or `keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`). RSA ≥ 2048. Back it up; losing it means a support request to Google.
2. Create `android/keystore.properties` (git-ignored): `storeFile=D:/path/upload.jks`, `storePassword=…`, `keyAlias=upload`, `keyPassword=…`.
3. In a terminal tab: `.\scripts\android-release.ps1 -ApiUrl https://<production worker> -LegalBaseUrl https://<legal site> -GoogleWebClientId <web client id>`. It refuses a local API URL and a missing legal URL, builds the web app with `GZ_RELEASE=1`, syncs Capacitor, runs `bundleRelease`, prints the path and SHA-256. Without `keystore.properties` the AAB is **unsigned** and Play Console will not accept it.
4. Upload manually in Play Console (the assistant never uploads).

## 4. Isolated HONOR QA (does not touch the installed real app)
Use the QA-identity method from the product-tour QA: an init script that appends an application-id suffix (e.g. `com.gharzetak.app.delqa`) and a different label, built with `scripts/android-debug.ps1`-style steps; install side by side. Point `GZ_API_URL` at **staging** (after 1.2), `GZ_LEGAL_BASE_URL` at the public legal site. Use a **synthetic Google test account** and synthetic e-mail accounts only.
Google-only re-authentication test: sign in with the synthetic Google account (creates an account with no password), use the app, then age that session on staging: `UPDATE session SET created_at = created_at - 172800000 WHERE user_id = (SELECT id FROM user WHERE email = '<synthetic google e-mail>')`. Settings > Privacy & account > Delete account should now show the Google hint; confirming opens the Google picker; the same account completes the deletion; a different Google account must be refused with "different account" and must not create a stray account.
Checklist: fresh install does not crash · Android Back from every deletion screen · legal links open the mobile browser (Arabic and English) · support mail row opens the mail app · sign-up shows the consent line · guest data survives a user deletion · offline: the delete button is disabled with the explanation.
