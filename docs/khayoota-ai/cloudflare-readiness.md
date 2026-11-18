# Khayoota AI — Cloudflare Readiness

> Status: **planning only**. Nothing was deployed, created, migrated, purchased or reconfigured while writing this document. **No inference was run** (no billable or free-allocation Neurons were consumed).
> Every Cloudflare call made during the audit was read-only: `GET` endpoints, two `SELECT` statements against `d1_migrations` / `sqlite_master`, and two GraphQL analytics queries.

Legend: **[Verified]** = observed directly on 2026-11-18 (live API, or an official docs page fetched that day) · **[Recommendation]** · **[Assumption]** · **[Unverified]**.

---

## 1. Live account findings (inspected 2026-11-18)

| Item | Finding | Evidence |
|---|---|---|
| Account | One standard account reachable by the connected token (created 2026-11-16). | [Verified] `GET /accounts` |
| Plan / subscription | **Could not be read.** `GET /accounts/{id}/subscriptions`, `GET /user/subscriptions`, `GET /accounts/{id}/billing/profile`, `GET /accounts/{id}/billing/spend-policies` and `GET /accounts/{id}/billable-usage/info` all returned **HTTP 403 "Authentication error"**. `GET /accounts/{id}/pay-per-use/usage-stats` returned 403 "account is not entitled". | **[Unverified]** — see §2 |
| Indirect plan signals | (a) `GET /accounts/{id}/observability/usage/limit` → `{ "plan": "free", "limit": { "daily": 200000 } }` — the Workers Logs quota in force is the *Free* one. (b) The AI Gateway credit endpoint reports a zero prepaid balance, no auto top-up, and that a default payment method **is** on file. | [Verified] responses; **the conclusion "Workers Free" is still only an inference** |
| Workers | Exactly one script: `gharzetak-api-staging` (usage model `standard`, compatibility date `2026-11-01`, flag `nodejs_compat`, no Smart Placement, no tail consumers, Logpush off). | [Verified] |
| Deployed version | Version **#3** (`c0ba2689-…`), uploaded by Wrangler **2026-11-17 22:30:53 UTC**, 100 % of traffic. Earlier versions: #2 (2026-11-17 22:01 UTC), #1 (2026-11-16 21:31 UTC). | [Verified] `…/deployments`, `…/versions` |
| Routing | `workers.dev` subdomain enabled (account subdomain `gharzetak`), preview URLs enabled. No zones on the account, so no custom domain, no WAF rules and no zone-level rate limiting are available. | [Verified] |
| Cron Triggers / Queues / KV | none / none / none | [Verified] |
| Production Worker | **Does not exist.** Only the staging script is deployed. | [Verified] |
| Worker bindings | `DB` (D1), `MEDIA` (R2), plain vars `APP_ORIGINS`, `AUTH_BASE_URL`, `ENVIRONMENT`, `MEDIA_PREFIX`, `REQUIRE_EMAIL_VERIFICATION`; secrets `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ANDROID_CLIENT_ID` (names only). **No `AI` binding, no rate-limit binding, no Vectorize binding, no AI Gateway reference.** | [Verified] `…/settings` |
| Observability | Workers Logs enabled, persisted, head sampling 1.0, **invocation logs on**; traces off. | [Verified] |
| D1 | `gharzetak-db-staging` (WEUR, read replication disabled, 360 KB). **All four migrations applied**: `0000_init`, `0001_profile_avatar` (2026-11-16), `0002_collections_revisions_time`, `0003_pattern_source_text` (2026-11-17 21:59 UTC). 23 tables besides the D1/SQLite internals, incl. `patterns`, `pattern_collections`, `pattern_parts`, `pattern_revisions`, `pattern_rounds`, `projects`, `project_parts`, `project_progress`, `project_photos`, `media_objects`, `rate_limit`. | [Verified] |
| R2 | One bucket `gharzetak-media` (WEUR, Standard). `r2.dev` managed domain **disabled**, no custom domains, no CORS policy, only the default "abort multipart after 7 days" lifecycle rule. 3 objects / ≈ 90 KB. → the bucket is private; objects are reachable only through the Worker. | [Verified] |
| AI Gateway | **No gateways exist.** The gateway logging-state endpoint returned 503 ("temporarily unavailable"), so the account-level default could not be read. | [Verified] none exist · [Unverified] logging default |
| Vectorize | No indexes. | [Verified] |
| AI Search (ex-AutoRAG) | No instances. | [Verified] |
| Workers AI usage, last 30 days | **Zero** inference requests (`aiInferenceAdaptiveGroups` empty). | [Verified] |
| Workers AI catalog access | `GET /accounts/{id}/ai/models/search` works and returns 75 models (40 text-generation). Catalog *visibility* does not prove inference *entitlement*; no model was invoked. | [Verified] listing · [Unverified] entitlement |

### 1.1 What changed since the previous audit (`docs/crochet-joy/cloudflare-readiness.md`, 2026-11-17)

- Staging was redeployed twice on 2026-11-17 and migrations `0002`/`0003` are now applied — the "staging is behind development" gap is closed. [Verified]
- Billing/subscription endpoints still return 403. [Verified]

### 1.2 Staging Worker load, last 7 days

| Metric | Value |
|---|---|
| Requests / errors / subrequests | 567 / 0 / 4 |
| CPU time | p50 **8.8 ms**, p90 **32.3 ms**, p99 **74.2 ms**, p99.9 141.7 ms |
| Wall time | p50 108 ms, p99 423 ms |
| D1 | 2,610 read queries (5,900 rows read), 590 write queries (2,050 rows written) |

[Verified] GraphQL `workersInvocationsAdaptive`, `d1AnalyticsAdaptiveGroups`. The traffic is QA traffic (auth-heavy), not a production profile.

---

## 2. The billing question — what to check by hand

The plan decides three things for Khayoota: the CPU ceiling per request, whether inference can exceed 10,000 Neurons/day, and which models are callable at all. It **must not** be inferred. Manual steps (owner of the Cloudflare login):

1. **Dashboard → Workers & Pages → (right column) "Plan"** — shows *Workers Free* or *Workers Paid*.
2. **Dashboard → Manage Account → Billing → Subscriptions** — lists active subscriptions.
3. **Dashboard → AI → Workers AI** — shows today's Neuron usage against the daily free allocation, and whether paid usage is enabled.
4. **Dashboard → AI → AI Gateway** — confirm no gateway exists; if one is created later, review *Settings → Logs* before the first request.
5. **Dashboard → Manage Account → Billing → Billable Usage / Budget alerts** — check whether budget alerts exist.

Record the answers in `decisions-and-blockers.md` (blocker B-1).

---

## 3. Limits that matter for an AI endpoint

All rows [Verified] against the official pages on 2026-11-18 unless marked.

| Limit | Workers Free | Workers Paid | Source |
|---|---|---|---|
| Requests | 100,000 / day | 10 M / month included, then $0.30 / M | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| CPU per HTTP request | **10 ms** (isolates have "some built-in flexibility" for infrequent overruns) | 30 s default, up to 5 min; 30 M CPU-ms / month included | same |
| Memory | 128 MB | 128 MB | same |
| Subrequests | 50 external + 1,000 to Cloudflare services | 10,000 | [changelog 2026-02-11](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/) |
| Request body | 100 MB (zone plan Free/Pro) | — | Workers limits |
| Workers AI free allocation | **10,000 Neurons / day**, hard stop ("Upgrade to Workers Paid") | 10,000 Neurons / day included, then **$0.011 / 1,000 Neurons** | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) (updated 2026-11-12) |
| Workers AI rate limit — text generation | 300 req/min per account for models that do **not** require Workers Paid | same; paid-only models: 20 req/min (50 with prepaid AI Gateway credits) | [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/) (updated 2026-09-17) |
| Workers AI rate limit — image-to-text task | 720 req/min | same | same |
| Workers Logs | 200,000 events / day | higher | live `observability/usage/limit` response |
| AI Gateway | core features free on all plans; 10 gateways (Free) / 20 (Paid) | | [AI Gateway pricing](https://developers.cloudflare.com/ai-gateway/reference/pricing/), [limits](https://developers.cloudflare.com/ai-gateway/reference/limits/) |

Wall-clock time waiting on `env.AI.run()` is I/O and does **not** count as CPU time ("Waiting on network requests … does not count toward CPU time" — Workers limits page). What does count: session lookup, JSON parsing of the request, base64 handling of images, schema validation of model output and the deterministic pattern validator.

---

## 4. Can the existing staging Worker host the AI endpoint?

**Findings**

1. **The Worker already runs above the Free CPU ceiling for a sizeable share of requests** (p90 32 ms vs. a 10 ms limit). That traffic is auth-dominated (Better Auth password hashing), and it succeeded only because of the platform's burst tolerance. This is a pre-existing risk, documented in `docs/crochet-joy/cloudflare-readiness.md` §1.1(3). [Verified numbers · Assumption on cause]
2. **A text chat turn adds little CPU**: one session read, one small D1 context read, JSON in/out, SSE pass-through. [Assumption — to be measured in P0/P1]
3. **An image turn adds real CPU**: a 1024-px JPEG at quality ~0.8 is 150–400 KB; reading it, base64-encoding it into a data URI and serialising the model request touches every byte two or three times. With `nodejs_compat` (`Buffer`) this is expected to be single-digit milliseconds, but on Workers Free that alone can exceed the budget. [Assumption — to be measured]
4. **A pattern extraction adds the most CPU**: two images in, a multi-kilobyte JSON document out, Zod validation, plus the deterministic parser/validator. [Assumption]
5. **A long AI request does not block other requests** — Workers are not single-threaded per account; each request has its own invocation. The shared resources are the per-account Workers AI rate limit, the daily Neuron allocation, the daily request quota (Free) and D1. [Verified from platform semantics]

**Recommendation — one Worker, isolated by design, not by deployment.**

- Keep a single Worker (`gharzetak-api-*`). Mount the AI routes as a separate Hono sub-app (`/v1/ai/*`) with its own middleware chain (auth → consent → quota → rate limit → body-size cap). Do **not** create a second Worker now: it would duplicate auth/session code, need a service binding or shared secret, double the deploy surface, and buy nothing while traffic is tiny.
- Add `"limits": { "cpu_ms": … }` only after Workers Paid is confirmed (the setting is a *cap*, useful against runaway cost; it is not available as a raise on Free).
- Revisit a dedicated `gharzetak-ai-*` Worker only if one of these becomes true: (a) AI CPU pushes the shared Worker's error rate up, (b) AI needs a different release cadence, or (c) per-Worker CPU caps must differ. The route boundary proposed in `multimodal-architecture.md` makes that split a mechanical move.

**Is Workers Free adequate?**

| Scope | Verdict | Why |
|---|---|---|
| Closed pilot, text chat only, ≤ ~20 testers | **Yes, with caps** | ≈ 30–40 Neurons per chat turn on the recommended model ⇒ the 10,000-Neuron daily allocation covers roughly 250–330 turns/day. CPU impact small. [Assumption — token sizes in `security-privacy-cost.md` §6] |
| Pilot with photo troubleshooting | **Marginal** | Neurons still fit (≈ 50–60 per image turn); CPU per request is the risk. |
| Image-to-pattern extraction | **Not recommended on Free** | Highest CPU and highest output tokens; a handful of extractions per day is fine for Neurons, but CPU overruns would surface as `Error 1102` to real users. |
| Public release at any scale | **No** | A hard daily Neuron stop with no overage path, plus the pre-existing CPU and D1-write risks. Workers Paid ($5/month) is the realistic floor. |

When the free allocation is exhausted on Workers Free, further inference fails until 00:00 UTC ("If you exceed any one of the above limits, further operations will fail with an error" — Workers AI pricing page). The [Workers AI errors page](https://developers.cloudflare.com/workers-ai/platform/errors/) (updated 2026-11-06) documents the relevant codes: **3036 / HTTP 429 "Account limited"** = daily free allocation used up; **3040 / HTTP 429 "Out of capacity"**; **5035 / HTTP 403** = model requires Workers Paid; **5028 / HTTP 410** = model retired. The backend must translate 3036 into the "Khayoota is resting until tomorrow" state (UX state 14) and 3040 into "busy, try again", never into a generic 500.

---

## 5. Eligibility of other AI products

| Product | Live status | Eligibility | Needed for MVP? |
|---|---|---|---|
| Workers AI binding (`env.AI`) | not bound | Available on Free and Paid plans per docs. | **Yes** (P1) |
| AI Gateway | none created | Free on all plans; a `default` gateway is auto-created on first authenticated use. Logs are **on by default** and store prompts/responses unless `cf-aig-collect-log-payload: false` / `collectLog: false` is sent or the gateway's Logs setting is turned off. | Optional in P1; **required** before any third-party fallback. If used, payload logging must be off from the first request. |
| Vectorize | no indexes | See `rag-knowledge-base.md` for limits/pricing. | **No** |
| AI Search | no instances | See `rag-knowledge-base.md`. | **No** |
| Rate Limiting binding | not bound | Config-only (`ratelimits` in `wrangler.jsonc`); supports weighted `delta` since 2026-11-04. Counters are per Cloudflare location and "requests can exceed this threshold" — good for burst control, **not** an accounting ledger. | **Yes** for burst limiting (P1); daily quotas stay in D1. |

Sources: [AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/), [collect-log-payload changelog](https://developers.cloudflare.com/changelog/post/2026-03-17-collect-log-payload-header/), [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [weighted requests changelog](https://developers.cloudflare.com/changelog/post/2026-11-04-rate-limit-weighted-requests/).

---

## 6. Spending controls available

| Control | Where | Notes |
|---|---|---|
| Daily Neuron ceiling | implicit on Workers Free | Acts as a free kill-switch during a pilot. |
| App-level budget (recommended primary control) | D1 table `ai_usage_daily` + env var `AI_DAILY_NEURON_BUDGET` | Server refuses new AI work when the estimated daily spend is reached. Works on any plan. Designed in `security-privacy-cost.md` §7. |
| AI Gateway **spend limits** | per gateway, up to 20 rules; scope by model/provider/custom metadata (e.g. per user); returns 429 at the limit | Added 2026-06-05. Cost tracking is "best-effort estimation". Requires routing inference through a gateway. [Spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/) |
| Worker CPU cap | `limits.cpu_ms` in `wrangler.jsonc` | Paid only. |
| Account budget alerts | Dashboard → Billing | [Unverified] whether any exist (403). |

---

## 7. Readiness verdict

- **Ready today (no approval needed):** design, fixtures, the provider-adapter interface, client UI behind a feature flag with the AI endpoint absent.
- **Needs an explicit approval before it can happen:** adding the `AI` binding and deploying (uses the free daily allocation at minimum); running the benchmark; creating an AI Gateway; enabling Workers Paid; any third-party provider.
- **Blocked on information:** the account plan (§2).
