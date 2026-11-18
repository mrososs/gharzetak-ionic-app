# Khayoota AI — Staging Rollout Readiness

> **HISTORICAL PLAN — superseded by [`release-status.md`](release-status.md).** This document was written before anything was
> deployed. What actually happened differs from the plan below: the migration was applied and the Worker deployed on 2026-11-18
> (Stage A, then B) with explicit approval; the allowlist is **not** the ID-only `AI_ALLOWED_USER_IDS` described here but a
> verified-e-mail allowlist held in the `AI_ALLOWED_EMAILS` Worker secret (deny-all by default); vision and extraction were
> switched on for the tester only; staging budgets were set to 3,000 Neurons/100 requests per day. "Nothing has been executed
> remotely" and the Stage A/B "blocked" statuses below are no longer true. Keep this file for the review findings (D1–D8), the
> CPU/privacy analysis and the rollback procedure.

---

## 1. Implementation HEAD

| | |
|---|---|
| Branch | `feat/khayoota-ai-implementation` (pushed) |
| Code reviewed | `77e274f` + the readiness commit that adds this document (see `git log`) |
| Base | `development` @ `88db9bc`; contains `test` @ `e753481` (what the staging Worker and the 1.1.0-test APK were built from) |
| API difference from `test` | AI files only: `routes/ai.ts`, `services/ai/*`, migration 0004, `schema.ts`, `env.ts`, one `index.ts` mount line, `wrangler.jsonc`. Auth, sync, media and collections code are byte-identical to what staging runs. |

### Defects found in this review and fixed (with tests)

| # | Defect | Risk | Fix | Test |
|---|---|---|---|---|
| D1 | A deployed Worker with `AI_PROVIDER` missing or misspelt silently served the **fake** demo provider | staging users get canned "demo" replies; masks a misconfiguration | Fake provider only when `ENVIRONMENT` is `development`/`test`; otherwise Khayoota is disabled | `ai.test.ts` "a deployed environment never serves the fake provider" |
| D2 | `settle()` capped recorded usage at the reservation (`min(actual, reserved)`) | under-counts the Neuron budget if the input estimate is low | Records the higher actual figure | "settling records usage ABOVE the reservation" |
| D3 | Chat bodies up to 1.56 MB and extract bodies up to 3.9 MB were read and JSON-parsed even with photos/extraction OFF | CPU-time and abuse surface | Text-only chat capped at 64 KB while photos are off; extraction flag checked **before** the body is read | "oversized chat body is refused before it is parsed", "extract body is never read" |
| D4 | No way to limit hosted AI to an internal group: enabling it on staging would open it to **all 7 staging accounts** | not a controlled internal test | `AI_ALLOWED_USER_IDS`, **fail-closed**: in a deployed environment empty = nobody, `*` = everyone, else listed user ids | "allowlist: deployed environments are fail-closed…", "allowlist parsing…" |
| D5 | Consent text under-described what is sent (it omitted project name, nearby/asked round text and recent chat messages) | consent not fully informed | Rewritten (AR + EN): lists exactly what is sent and what is never sent; says how to turn it off | visual check in the local app |
| D6 | Declining consent dropped a question tapped from a suggestion chip (it re-read the empty text box) | user's question vanished | The pending question is kept and answered by the offline helper; nothing is sent | `assistant.page.spec.ts` "declining consent answers the SAME question…" + browser check (0 `/v1/ai/chat` requests) |
| D7 | "Explain round 7" only worked when the counter was already on round 7 (context had current ±1 rounds only) | Test B fails whenever the counter is elsewhere | Rounds the user names (`R7`, `round 7`, `الدور ٧`, `الدور السابع`, max 2) are added from the **same pinned revision** | "a round the user names … SAME pinned revision", "roundsMentioned …" |
| D8 | No client-side time limit on AI calls (server worst case ≈ 45 s × capacity retry + repair) | spinner could hang on a stalled network | 150 s ceiling → friendly `ai_timeout` | "a hung request ends as ai_timeout" |
| D9 | Staging budget 8,000 Neurons left only 2,000 for the rest of the account's shared 10,000 | other Workers AI use on the account could push the account past the free allocation | Staging budget 3,000 Neurons/day, 100 requests/day; photo/extract daily quotas 0 (second lock after the flags) | config (dry-run output §4) |

### Verified (no change needed)

- **Real provider**: `WorkersAiProvider` calls `env.AI.run(model, inputs)` through the Worker binding; no API token anywhere; the app holds no Cloudflare credential or model id.
- **Gemma 4**: `@cf/google/gemma-4-26b-a4b-it` for chat/vision/extract; models are an allowlist (`MODELS`), anything else falls back to Gemma; `enable_thinking: false`; JSON-schema output; `max_tokens` 600 chat / 600 repair.
- **Order of guards** (`routes/ai.ts`), every one **before** any model call: `requireUser` (401) → master switch + allowlist + provider (503 `ai_disabled`) → consent at the current version (403) → body size + Zod (400) → photo flag (403) → magic bytes (415) → burst window (429) → per-user daily cap + global request cap (429) → worst-case Neuron reservation against the global budget (429) → model.
  **No code path reaches `provider.generate` without passing all of them** — the only two call sites are inside `callModel`, which is only called after `takeQuota`, and `callModel` reserves Neurons first.
- **Concurrency**: every counter is one conditional upsert (`… WHERE counter + n <= limit RETURNING`); 6 parallel requests against a cap of 3 → exactly 3 succeed (test).
- **Kill switch**: `AI_ENABLED !== "true"` → everything but `status` and `DELETE consent` returns 503; status returns `{ v:1, enabled:false }`.
- **Errors**: typed codes (`ai_disabled`, `ai_consent_required`, `ai_feature_disabled`, `ai_unsupported_image`, `ai_rate_limited`, `ai_quota_exceeded` with scope/resetAt, `ai_busy`, `ai_timeout`, `ai_bad_output`, `ai_upstream_error`), all `no-store`. 3036 → quota, 3040 → one retry then busy, 5028/5035 → disabled.
- **Pinned revision**: context always comes from `AppStore.trackerView(p)` (pinned text / frozen piece snapshot); tests prove a newer edit never leaks in.
- **Three typed actions** only, payload-validated, ids must exist in the request's own context, re-resolved against the local store at render and at tap; the open-round action only navigates (no counter, timer or progress change).
- **Logging**: one allowlisted JSON line per request; free text becomes `[withheld]`; a test pushes markers through chat/photo/extract and asserts none reaches the console. The only other `console.*` calls are config warnings and `[api] unhandled <name>: <message>` (provider errors are classified first, so their message is `provider <kind> (<code>)`).

### Migration review

`0004_ai_usage.sql` is **additive**: 3 new tables (`ai_user_state`, `ai_usage_daily`, `ai_rate`) + 1 index; no existing table touched. `ai_user_state.user_id` → `user(id)` `ON DELETE CASCADE`.
Rehearsed on a fresh local D1 in the **exact staging state**: 0000–0003 applied + an existing user row → `migrations apply` → only 0004 pending → applied; user row intact; consent row inserted; deleting the user cascades the consent row; the rollback SQL (§13) removes every `ai_*` object, leaves the user, and 0004 re-applies cleanly.

---

## 2. Staging Worker (read-only audit, 2026-11-18 20:40 UTC)

| Item | Value |
|---|---|
| Worker | `gharzetak-api-staging` — `https://gharzetak-api-staging.gharzetak.workers.dev` (the only Worker on the account) |
| Live version | `c0ba2689-e8e1-409f-8664-f43a97cf7182`, deployed 2026-11-17 22:30 UTC by Wrangler (100%) |
| Previous versions | `07df6517-60d1-4447-807a-8e643a82ce6e` (2026-11-17 22:01), `245518c1-…` (2026-11-16) |
| Compatibility | `2026-11-01`, `nodejs_compat`, usage model `standard` |
| Bindings | `DB` (D1 `gharzetak-db-staging`), `MEDIA` (R2 `gharzetak-media`, prefix `staging/`), vars `ENVIRONMENT=staging`, `AUTH_BASE_URL`, `APP_ORIGINS`, `MEDIA_PREFIX`, `REQUIRE_EMAIL_VERIFICATION=false` |
| Secrets (names only) | `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ANDROID_CLIENT_ID` — none new are needed for Khayoota |
| AI binding | **none yet** (added by the deploy) |
| Logging | Workers Logs on, `head_sampling_rate 1`, `persist true`, invocation logs on, traces off, Logpush off, no tail consumers |
| Traffic (7 days) | 571 requests, 0 errors |
| Auth / sync routes | `/api/auth/*` (Better Auth, email + Google), `/v1/sync/*`, `/v1/media/*`, `/v1/*` entities — unchanged by this branch |

## 3. D1 migration status

| | |
|---|---|
| Database | `gharzetak-db-staging` (`23160160-69cf-4d4c-ad1e-38889b4eb351`), WEUR, 360 KB, 24 tables, 7 users, read replication off |
| Applied remotely | `0000_init`, `0001_profile_avatar` (2026-11-16 21:30), `0002_collections_revisions_time`, `0003_pattern_source_text` (2026-11-17 21:59) |
| Pending | **`0004_ai_usage.sql`** only; no `ai_*` table exists yet |

## 4. Required AI binding and configuration

The deploy adds exactly this (from the local `wrangler deploy --env staging --dry-run`, no upload):

```
env.AI                            AI
env.AI_ENABLED                    "false"      ← master switch (Stage A)
env.AI_PROVIDER                   "workers-ai"
env.AI_MODEL_CHAT/VISION/EXTRACT  "@cf/google/gemma-4-26b-a4b-it"
env.AI_VISION_ENABLED             "false"
env.AI_EXTRACT_ENABLED            "false"
env.AI_USER_DAILY_CHAT            "20"
env.AI_USER_DAILY_IMAGE           "0"
env.AI_USER_DAILY_EXTRACT         "0"
env.AI_DAILY_NEURON_BUDGET        "3000"
env.AI_DAILY_REQUEST_CAP          "100"
env.AI_CONSENT_VERSION            "1"
env.AI_ALLOWED_USER_IDS           ""           ← nobody (fail-closed)
```

Total upload 2,800 KiB / **496 KiB gzip** (Free limit 3 MB, Paid 10 MB).
Third-party AI fallback: **does not exist in the code** (no Gemini/OpenAI/other provider, no AI Gateway).

## 5. Configuration and secrets checklist (no values)

- [ ] No new secret is required. `BETTER_AUTH_SECRET` and the 3 Google secrets stay as they are (Wrangler does not touch secrets on deploy).
- [ ] `wrangler.jsonc` `env.staging` is the single source of vars; a deploy **replaces** vars edited in the dashboard.
- [ ] `ENVIRONMENT` stays `staging` (keeps auth hardening and disables the fake provider).
- [ ] App build for Stage C: root `.env` with `GZ_API_URL=https://gharzetak-api-staging.gharzetak.workers.dev`, `GZ_GOOGLE_WEB_CLIENT_ID` (public), `GZ_AI_ENDPOINT=/v1/ai`. No key, token or model id goes into the app.

## 6. Free-tier and billing verification

| Fact | Status |
|---|---|
| Workers plan (Free or Paid) | **NOT VERIFIED.** `/subscriptions` and billing endpoints still return HTTP 403 for this token. Entitlements are readable but say nothing about Workers Paid. |
| Indirect evidence | Over 7 days the staging Worker used CPU P50 8.9 ms, P90 32.7 ms, P99 74 ms, max 141.7 ms with **0 errors**. Free allows 10 ms CPU per request, so this suggests Workers Paid, but Free does not always enforce the limit strictly. **Inconclusive — treat as possibly Paid.** |
| Free allocation | 10,000 Neurons/day on both plans, reset 00:00 UTC. Free: over the limit → error 3036, **no charge**. Paid: over the limit → **$0.011 per 1,000 Neurons** for the **whole account**. |
| Today's account usage | 1,626.5 Neurons, 27 inferences (the approved pilot only). Nothing else on the account uses Workers AI (0 in the previous 30 days). |
| Gemma 4 | listed, no paid-only flag, $0.10 / $0.30 per M tokens (9,091 / 27,273 Neurons per M). |
| AI Gateway / credits | 0 gateways, credit balance 0, auto top-up off (checked during P0). |

**How the 3,000-Neuron budget relates to the account allowance.** The budget is a counter in the staging D1 and sees **only this Worker's calls**. It cannot see the dashboard playground, other Workers, REST calls, or benchmark scripts — all of which draw from the same 10,000. It is enforced on **estimates** (a worst-case reservation before the call, settled to the reported token usage after it). In the pilot these were within 0.2 % of Cloudflare's measured total, and Gemma was over-estimated by 12 %. So: staging alone can use at most ≈ 3,000 Neurons/day (≈ 75–95 text chats). The account stays non-billable only if **everything else on the account stays under ≈ 7,000 Neurons/day**. On Workers Paid, a worst-case overrun is tiny (3,000 Neurons ≈ $0.033), but it is **not zero**, and nothing in the code can enforce an account-wide cap.

**Manual verification required before Stage B (you, in the dashboard):**
1. *Workers & Pages → Overview* (right column, "Plan"): note **Workers Free** or **Workers Paid**.
2. *Manage Account → Billing → Subscriptions*: confirm whether a "Workers Paid" subscription is active.
3. *AI → Workers AI* (usage): confirm today's Neurons match ≈ 1,626.
4. If Paid: *Notifications → Add → Usage Based Billing* alert for Workers AI, so any billable usage emails you. This creates a notification rule, so it is your action.
5. Run no other Workers AI experiments (playground, scripts) on days when staging chat is enabled.

## 7. CPU-limit risk

- Waiting on `env.AI.run` is I/O, not CPU. CPU per AI request is: reading and parsing a ≤ 64 KB JSON body, a Zod check, building a ≈ 10 KB prompt string, parsing a ≤ 4 KB model reply, and 4–6 D1 statements. **Estimate: low single-digit ms** (not measured remotely).
- The heavy endpoints today are auth (password hashing): P90 32.7 ms. If staging is on Free and the 10 ms limit were enforced, sign-in would already be failing. Khayoota adds no new class of CPU risk.
- D3 removes the only large-body path while photos and extraction are off.
- Wall time: no limit for HTTP requests. Server worst case ≈ 2 × 45 s plus one 0.4 s retry pause; the app gives up at 150 s.

## 8. Consent and privacy readiness

| Requirement | Status |
|---|---|
| Consent explains what is sent | ✅ (D5) Question, recent chat messages, any photo, and — when asking about a project — its name, current round, nearby or asked rounds from the pinned pattern version. Also what is **not** sent: other projects, notes, name, e-mail. Says Cloudflare runs it, nothing is stored by us, it can be wrong, there's a daily limit, and it can be turned off. |
| Declining prevents AI requests | ✅ The app sends nothing until "Agree" (unit test + browser network log). The server refuses chat without consent (403) before any model call (API test). |
| Only required project context | ✅ Only the open project; fields are fixed by a strict Zod schema (≤ 6 KB): project id/name/category/kind, active piece, current round (≤ 300 chars), up to 4 nearby/asked rounds, unfinished piece labels, percent. Never the full pattern, notes, photos, other projects, name or e-mail. |
| No images while image features are off | ✅ The app does not send a photo unless the server reports the feature on. The server returns 403 for an image while the flag is off, the image quota is 0, and bodies over 64 KB are refused unread. |
| Content not logged | ✅ Allowlisted logger + log-privacy test. Workers **invocation logs** capture request metadata **and headers** but not bodies (Cloudflare docs); AI routes have no query strings, so no question or project text can be in them. ⚠ Pre-existing, not AI-specific: whether the `Authorization: Bearer` header is redacted in invocation logs is **not documented** — check one invocation log in the dashboard during Stage A. If the token is visible, set `observability.logs.invocation_logs: false` for staging (our own allowlisted lines still log). |
| Account/session isolation | ✅ Consent, quotas and usage are per user id (tests); context ids must come from the request; chat history is stored per account scope on the device. |
| Sign-out stops AI | ✅ The server returns 401 right after sign-out (new test). The app's `hosted` state needs `signedIn()`. |
| Privacy policy | ❌ **None exists** (blocker B-6). |

**Internal staging test is acceptable** only for testers who know it is a test and who accepted the in-app consent (you and named teammates on the allowlist). **This is not legal or privacy approval.** Before any external tester or public release, you need:
- a privacy policy and Play Store data-safety entry naming AI processing by Cloudflare;
- retention wording, and a review of Cloudflare's Workers AI data terms by whoever owns privacy;
- a decision on consent versioning: bump `AI_CONSENT_VERSION` whenever the consent text changes.

## 9. Exact deployment steps (Stage A — AI deployed but OFF)

Run from `D:\mostqel\Gharzetak\.claude\worktrees\affectionate-bhabha-5ddac5\apps\api` (portable Node: `$env:PATH = 'D:\mostqel\.tools\node24;' + $env:PATH`).
`W` below = `node node_modules/wrangler/bin/wrangler.js`. Wrangler is already logged in.

1. **Backup**
   ```powershell
   node node_modules/wrangler/bin/wrangler.js d1 time-travel info gharzetak-db-staging --env staging
   node node_modules/wrangler/bin/wrangler.js d1 export gharzetak-db-staging --remote --env staging --output D:\mostqel\backups\gharzetak-db-staging-2026-11-18.sql
   ```
   Record the bookmark. The export contains account data (e-mails, password hashes): keep it **outside the repository**.
2. **Schema verification**
   ```powershell
   node node_modules/wrangler/bin/wrangler.js d1 migrations list gharzetak-db-staging --remote --env staging
   ```
   Expect **only** `0004_ai_usage.sql` pending. Stop if anything else is listed.
3. **Apply the AI migration**
   ```powershell
   node node_modules/wrangler/bin/wrangler.js d1 migrations apply gharzetak-db-staging --remote --env staging
   ```
4. **Pre-deploy check** (local, no upload): `deploy --env staging --dry-run` — the binding list must equal §4 (`AI_ENABLED "false"`, `AI_ALLOWED_USER_IDS ""`).
5. **Deploy the Worker** (same Worker, new version)
   ```powershell
   node node_modules/wrangler/bin/wrangler.js deploy --env staging
   ```
   Record the new version id.
6. **Remote smoke tests** (no model call is possible with AI off)
   ```powershell
   $env:STAGING_URL='https://gharzetak-api-staging.gharzetak.workers.dev'; node scripts/smoke-remote.mjs
   $env:STAGING_URL='https://gharzetak-api-staging.gharzetak.workers.dev'; node scripts/smoke-ai-remote.mjs --stage A
   ```
   The first is the existing 29 auth/sync/media checks. The second checks the 4 AI routes return 401 anonymously, status is `enabled:false`, chat and consent return 503 `ai_disabled`, and sync still works. Both create throw-away `smoke-*@gharzetak.test` accounts in staging. Note the `smoke-ai-…` e-mail and user id printed: they are needed for Stage B.
7. On the HONOR phone (it now runs the branch debug build from `8b49d41`, which points at staging) — after you unlock it: sign-in, projects and sync work as before; the Khayoota badge shows "قواعد غرزتك" and the offline helper answers.
8. Dashboard → *gharzetak-api-staging → Observability*: open one invocation log of the smoke run and check whether the `authorization` request header is shown redacted (see §8).

Stage A is complete when both smoke runs pass and GraphQL shows **0** new inferences.

## 10. Safe feature-flag rollout

| Stage | Change | Gate to enter | Who can use it |
|---|---|---|---|
| **A** | migration 0004 + deploy, `AI_ENABLED=false` | your approval of the remote migration and deploy | nobody (AI off) |
| **B** | commit `AI_ENABLED="true"` and `AI_ALLOWED_USER_IDS="<your staging user id>,<smoke-ai user id>"`, deploy, run `smoke-ai-remote.mjs --stage B --email …` (guards only, no model call) | Stage A passed; plan verified (§6); your approval for "enable text chat for the allowlist" | only listed accounts; photos/extraction stay off (flags + 0 quotas) |
| **C** | bounded live checks: `KHAYOOTA_LIVE_APPROVED=yes … --stage B --live 3` (max 5 per run, hard-coded), then the app tests in §11 and the phone QA in §12 | your **separate** approval for live inference, with a stated cap (suggested: ≤ 40 live requests ≈ 1,600 Neurons for the whole Stage C day) | same allowlist |
| **D** | vision, then extraction, each separately | their quality gates in `benchmark-plan.md` §5 pass with real photos and human raters; privacy policy | — not now |

Your staging user id is needed for the allowlist. With your OK I can read it read-only (`SELECT id FROM user WHERE email = ?` on staging D1), or you can send it. It is an opaque id, not an e-mail.

## 11. Real-model smoke-test procedure (Stage C — only after live inference is approved)

Through the **app** (debug APK built from this branch, signed in with an allowlisted account, consent accepted). Each test: send once, screenshot, record the reply, actions and `remaining`. Do not repeat a failing prompt more than once.

| # | Prompt (AR / EN) | Setup | Pass criteria |
|---|---|---|---|
| A | «خيوطة، إيه الفرق بين sc و hdc؟» / "What's the difference between sc and hdc?" | no project | Accurate (hdc taller, yarn over first), beginner-friendly; Egyptian Arabic for AR; abbreviations kept in Latin; no invented facts |
| B | «أنا واقفة عند الدور السابع، ممكن تشرحيهولي؟» / "I'm on round 7, can you explain it?" | project pinned to an **older** revision whose R7 differs from the latest edit; counter on R7 and, as a second run, on another round | Explains **the pinned R7 text**; totals equal the app's calculated total; never the edited text |
| C | «افتحيلي الدور اللي أنا شغالة عليه.» / "Open the round I'm working on." | project open | Reply proposes `tracker.openCurrentRound` with that project (and piece); tapping opens the tracker at the current round; **counter, timer and progress unchanged** (compare before/after) |
| D | «مش فاهمة غرزة التناقص.» / "I don't understand decrease." | any | Clear explanation; optional `learn.explainStitch {stitch: dec}` that opens the stitch card; no navigation without a tap |
| E | «مين كسب ماتش امبارح؟» / "Who won the match yesterday?" | any | Polite redirect to crochet; no sports answer; no action |
| F1 | (API) anonymous request | — | 401 (smoke script) |
| F2 | first question before consent | fresh allowlisted account | consent sheet; 0 chat requests until "Agree"; "Not now" → offline answer |
| F3 | quota | temporarily `AI_USER_DAILY_CHAT="2"` on staging **or** a test account that already used 20 | friendly "limit reached" with reset time; no model call (GraphQL count unchanged) |
| F4 | kill switch | Stage A version rollback or `AI_ENABLED="false"` | app shows "Built-in rules", offline helper answers |
| F5 | logs | Workers Logs for the test window | only `{"khayoota":{…}}` metadata lines; search for a unique word from a prompt returns nothing |
| F6 | non-allowlisted account | any other staging account | status `enabled:false`; app shows the offline helper |

After Stage C: read GraphQL `aiInferenceAdaptiveGroups` for the day and record measured Neurons next to the D1 counter (`SELECT * FROM ai_usage_daily WHERE scope='__all__'`).

## 12. Physical Android QA (HONOR DNY-NX9, after Stage B/C approval)

Preconditions: you unlock the phone **and** the app's fingerprint lock yourself; I never bypass biometrics, uninstall, clear data or reset projects. Install the rebuilt APK with `adb install -r` (data kept). The debug build currently on the phone (from `8b49d41`) **predates D5–D8**, so it must be rebuilt.

- [ ] Sign-in works; the session persists after force-stop and relaunch.
- [ ] Khayoota tab badge: "مستنية موافقتك" before consent; consent text readable in RTL; "Not now" → offline answer, nothing sent.
- [ ] "Agree" → badge "ذكاء اصطناعي" (not "تجريبي": the real provider).
- [ ] Tests A–E in Arabic, then switch the app to English and repeat A, D, E.
- [ ] Project context: ask from the tracker's "Ask Khayoota" button; the context card shows the right project and piece.
- [ ] Pinned revision: test B on a pinned project after editing its pattern.
- [ ] Typed action: tap "open the counter" → tracker opens at the right round; Back returns to Khayoota.
- [ ] Counter value, timer and progress identical before and after (screenshot both).
- [ ] Airplane mode → "بدون نت" badge, offline helper answers, no crash; back online → hosted again.
- [ ] Daily remaining count decreases by one per question; menu shows the remaining counts.
- [ ] Keyboard does not cover the input; RTL layout of replies, chips and action buttons correct; long replies scroll.
- [ ] Photo button: shows "Photo analysis is not available yet"; no upload in DevTools network.
- [ ] No private notifications or lock-screen captures are kept.

## 13. Rollback procedure

| Situation | Action | Time |
|---|---|---|
| AI misbehaves, everything else fine | `wrangler rollback <Stage A version id> --env staging`, or dashboard *Variables* `AI_ENABLED=false` → Deploy. Then set `AI_ENABLED` back to `"false"` in `wrangler.jsonc` so the next deploy keeps it off. | ~1 min |
| Stage A deploy breaks auth/sync | `node node_modules/wrangler/bin/wrangler.js rollback c0ba2689-e8e1-409f-8664-f43a97cf7182 --env staging` (today's live version). Version c0ba2689 ignores the new tables. | ~1 min |
| Migration problem | Restore: `d1 time-travel restore gharzetak-db-staging --bookmark=<bookmark from step 1> --env staging`. Or remove only the AI tables, after the Worker no longer uses them: `DROP TABLE IF EXISTS ai_rate; DROP TABLE IF EXISTS ai_usage_daily; DROP TABLE IF EXISTS ai_user_state; DELETE FROM d1_migrations WHERE name = '0004_ai_usage.sql';` — rehearsed locally. | minutes |
| Unexpected Neurons | Kill switch (row 1), then read GraphQL usage; the request cap and budget stop new calls by themselves at 100 requests / 3,000 Neurons. | ~1 min |

Losing the AI tables is harmless: users re-consent and counters restart.

## 14. Remaining blockers

1. **Your approval** for the Stage A remote migration + deploy (nothing remote has been done).
2. **Billing plan not verified** — the dashboard check in §6 is needed before any live inference (Stage B/C).
3. **Allowlist ids**: your staging user id (and the smoke-ai id from Stage A).
4. **Privacy policy (B-6)** — none exists. OK for an internal allowlisted test only; blocks any external or public use.
5. **Phone**: you unlock the phone and the app; the APK must be rebuilt (D5–D8 are not on the phone).
6. Vision/extraction quality gates (real photos, handwriting, human raters) — they block Stage D, not B/C.
7. `smoke-ai-remote.mjs` is syntax-checked but has **not run remotely** (doing so creates staging accounts, which is part of Stage A).

## 15. GO / NO-GO

- **Stage A — GO** (technically ready). It needs only your approval of: (a) D1 backup + `migrations apply` of 0004 on `gharzetak-db-staging`, (b) `wrangler deploy --env staging` of this branch with `AI_ENABLED=false`, (c) running the two smoke scripts (creates throw-away staging accounts).
- **Stage B — NO-GO until** Stage A passes, you confirm the plan in the dashboard, and you approve enabling text chat for the allowlist.
- **Stage C — NO-GO until** a separate approval for live inference with a cap.
- **Stage D — NO-GO.**

## 16. Tests run for this readiness pass

See the commit message and `qa-implementation-report.md` §6 for exact counts.
