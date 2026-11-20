# Release gates — Gharzetak 1.1.0 (status as of 2026-11-20)

Each status below is a different thing; one being green never implies the next.

| Status | State | Evidence / what is missing |
|---|---|---|
| **Development complete** | **Done** for the release candidate | Branch `release/play-1` = integrated Cloudflare line `1e12b03` + account deletion + restore ledger + crash recovery + operator tool + support mailbox + legal links + Play signing config. Product Tour and the Supabase `production` branch deliberately NOT included (see below). |
| **Local automated QA** | **Passed** | API: full suite (see final report for counts) · App: unit suite + production `ng build` · Showcase: unit, legal-only e2e (13), legal e2e (178). Local browser end-to-end of deletion (synthetic accounts). |
| **Staging verified** | **Done 2026-11-20 (with your approval), except one cron tick** | Migration `0005` applied to `gharzetak-db-staging` (restore bookmark before it: `00000054-00000000-00005129-378ae2366fcef1fd98bd7cc9710ac4d7`); Worker deployed (version `5ec05a98-2787-4044-af12-bab04422a0d8`, cron `17 * * * *`); `deletion-check.mjs` **16/16** and `smoke-remote.mjs` **29/29** against real D1/R2; independently confirmed: user rows 0, uploaded photo gone from R2 (`The specified key does not exist`), restore-proof ledger object present, journal `swept`. **Still to confirm after the next cron tick (minute :17):** the `swept` journal rows are removed (`select count(*) from account_deletion_job` → 0) and the ledger entries stay. |
| **Real-device QA (HONOR, isolated QA id)** | **Not done** | No QA build was installed. Procedure incl. the Google-only re-authentication test is in `play-release-runbook.md` section 4. |
| **Legal pages public** | **Not published** | Blocking facts: `inAppDeletionReleaseCandidate` (you chose to wait for staging + device QA), `effectiveDate`, `lastUpdatedDate` (set on publish day). Mailbox test = confirmed by you; rehearsal = done locally. The legal-only build, the Vercel project and the public deployment are ready to do the moment those are recorded. |
| **Backend operational (production)** | **Not created** | You chose "prepare only": `env.production` block, runbook, additive migrations verified, AI OFF. Needs: create D1/Worker/secrets, set `AUTH_BASE_URL`, deploy, run `deletion-check.mjs --allow-production`. |
| **Signed AAB ready** | **Not ready** | Needs (1) a production API URL, (2) the public legal URL, (3) your upload keystore (`android/keystore.properties`). `scripts/android-release.ps1` refuses to run without 1 and 2 and builds an UNSIGNED bundle without 3. |
| **Play Console submission ready** | **Not ready** | Needs the rows above plus the worksheet items only you can do. |
| **Closed testing complete** | **Not started** | New personal account: ≥ 12 testers opted in for 14 continuous days. |
| **Production access granted** | **Not started** | After closed testing: "Apply for production". |
| **Publicly released** | **No** | Nothing has been submitted or published. |

## Product Tour decision
`feat/gharzetak-product-tour` (≈ 10 commits, 972 unit + 72 browser tests) is **not integrated**: its own status document lists device QA (TalkBack, rotation, large font, swipe-back) as an open gate, it carries an independent parser change, and it edits the Settings page this release also changes. Integrate it in a later release after its device gate passes.

## Sequence that closes the circular dependency
1. Staging verified + HONOR QA pass → record `inAppDeletionReleaseCandidate = 1.1.0 (build 3)` and the publication dates in `Gharzetak-showcase/src/legal/facts.ts`.
2. `PUBLIC_LEGAL_RELEASE=final npm run build:legal` passes → deploy the legal-only project (public) → note the URL.
3. Production backend created and smoke-tested.
4. `android-release.ps1 -ApiUrl … -LegalBaseUrl …` → signed AAB → internal track → closed test (14 days) → production access → release.
The legal pages therefore go public **before** the Play release and the app only ever links to live pages.
