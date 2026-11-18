# Khayoota AI — Decisions, Assumptions & Blockers

Status on 2026-11-18. Planning branch `feat/khayoota-ai-agentic-planning`, from `origin/development` @ `e753481af29d1d0b4ceab09d5f70b985635c3454`.

---

## 1. What was verified (facts, not opinions)

| # | Fact | How |
|---|---|---|
| V-1 | `origin/development` head is `e753481`; Pattern Collections, multi-part tracker, revisions, Smart Parser, timers, Crochet Joy, achievements, reminders and Cloudflare auth/sync are all merged there. | `git fetch`, history, source |
| V-2 | The current assistant is a deterministic rule set labelled "demo"; no AI backend, binding, model id or provider key exists in the repo. | code read + repo-wide grep |
| V-3 | An in-memory draft hand-off (`ImportDraftService`) already opens Add Pattern / Collection editor populated and unsaved; Smart Import is the existing review screen. | code read |
| V-4 | The Smart Parser already emits `validated / needs-review / unsupported` per round and never invents totals. | code read + execution |
| V-5 | With today's converter, Arabic magic ring, `في MR`, plural `غرز قصيرة`, spaced ranges and `2 sc in each st` return `unsupported`; chains / slip stitches / BLO / `*…*` are unsupported. | **executed** `convertPatternText` on probes |
| V-6 | The bunny fixture in the repo is a self-described reconstruction of a different text; the Bunny Dress source video is not in the repo. | file read |
| V-7 | The existing assistant reads the live pattern, not the pinned revision or the active piece. | code read |
| V-8 | Cloudflare: one staging Worker (version #3, 2026-11-17 22:30 UTC), D1 with all 4 migrations, one private R2 bucket; no AI binding, AI Gateway, Vectorize, AI Search, KV, queues, zones; zero Workers AI usage in 30 days. | live read-only API |
| V-9 | Billing/subscription endpoints return 403. Workers Logs quota in force is the Free one (200,000 events/day). | live API |
| V-10 | Staging CPU p50 8.8 ms, p90 32 ms, p99 74 ms over 567 requests, 0 errors. | live GraphQL analytics |
| V-11 | All four named candidate models exist in the account catalogue; **Kimi K2.6 is retired on 2026-11-20**; Gemma 4, Qwen 3.8 and Llama 4 Scout have no Workers-Paid flag. | live catalogue + docs |
| V-12 | App is on Angular 22.2 / Ionic 9; `@a2ui/angular` 0.14 declares peer `@angular/core ^21.2.5`. | `package.json` + npm metadata |
| V-13 | The benchmark manifest validates and the runner's dry-run works (52 cases, no network). | executed |

---

## 2. Decisions recommended by this plan

| # | Decision | Status | Rationale (short) |
|---|---|---|---|
| D-1 | **Extend** the existing assistant page/service; do not build a second chat. | Recommended | Shell, route, tab, history, photo input already exist. |
| D-2 | **One Worker**, AI as an isolated Hono sub-app under `/v1/ai`. | Recommended | No benefit from a second Worker at this scale; split stays mechanical. |
| D-3 | **Client-built project context**; no server-side tool loop or lookups. | Recommended | Device holds the freshest state and the pinned revision; removes cross-user retrieval risk. |
| D-4 | **Images inline, in memory, not stored.** No R2 staging. | Recommended | Simplest privacy story; nothing to retain or delete. |
| D-5 | **Model reads; deterministic parser decides.** "Validated" only from deterministic checks; AI can only lower a status. | Recommended | Matches the app's existing guarantees. |
| D-6 | **Typed actions + existing components.** No A2UI, no AG-UI. | Recommended | Ten fixed actions; A2UI's Angular renderer does not list Angular 22 and changes monthly; AG-UI has no Angular SDK and solves problems this app does not have. |
| D-7 | **No mutation actions in v1.** All writes via existing screens' Save. | Recommended | Meets "must not silently edit or delete". |
| D-8 | **Primary model hypothesis: `@cf/google/gemma-4-26b-a4b-it`**, single-model; Qwen 3.8 only if the benchmark shows a ≥ 8-point extraction lead; Kimi K2.6 dropped. | Pending P0 | Cheapest by a wide margin; decided by pre-fixed rule. |
| D-9 | **No Gemini / third-party fallback** in the first releases; provider adapter kept. | Recommended | Not free, second privacy review, unneeded until measured. |
| D-10 | **No Vectorize / AI Search**; prompt pack first, keyword cards later. | Recommended | Corpus is small; AI Search query pricing would exceed inference cost. |
| D-11 | **Signed-in only**; guests keep the deterministic tools and offline helper. | Recommended | No anonymous inference endpoint. |
| D-12 | **No streaming in R1**; single validated JSON envelope. | Recommended, revisit on measured latency | JSON mode does not stream. |
| D-13 | **Name: Khayoota (خيوطة)**, branded as an AI feature of Gharzetak. | Owner's call | See `product-ux-and-branding.md` §1. |
| D-14 | Default caps: 20 chat / 5 photo / 3 extraction per user per day; global daily Neuron budget; kill switch. | Recommended | Bounds worst-case spend. |
| D-15 | Smallest valuable release = **R1: project-aware text chat with three navigation actions**. | Recommended | See roadmap §0. |

---

## 3. Assumptions (to be replaced by measurements)

| # | Assumption | Replaced by |
|---|---|---|
| S-1 | ~1,200 tokens per image on the Workers AI chat models | P0 measured `usage` |
| S-2 | Token sizes per request type; 40 % of MAU use Khayoota; 20 / 4 / 1.5 requests per user per month | P0 + pilot analytics |
| S-3 | Reasoning can be switched off/low and that keeps quality acceptable | P0 (ME-03) |
| S-4 | Base64 pass-through keeps Worker CPU low | P1 measurement on staging |
| S-5 | Gemma 4 handles Arabic and Egyptian dialect adequately | P0 chat + Arabic rating |
| S-6 | Qwen 3.8 is the stronger OCR model | P0 |
| S-7 | `env.AI.run` honours an abort signal | P1 |
| S-8 | Cached-input pricing applies automatically to repeated prefixes | P0 usage data |

---

## 4. Unverified items

| # | Item | How to resolve |
|---|---|---|
| U-1 | Account plan (Workers Free vs. Paid) | dashboard steps in `cloudflare-readiness.md` §2 |
| U-2 | Whether Gemma 4 / Qwen 3.8 accept `data:` image URIs; max images/size; image token accounting; max output tokens | benchmark step 0 + P0 |
| U-3 | Whether `response_format: json_schema` is enforced for the candidates | P0 schema-validity metric |
| U-4 | Inference location / data residency for Workers AI | Cloudflare documentation or support; legal review |
| U-5 | AI Gateway account-level logging default (endpoint returned 503) | dashboard, when/if a gateway is created |
| U-6 | Workers Logs pricing after 2026-12-01 | re-read the pricing page in December |
| U-7 | Name clearance (trademark, stores, dialect connotations) | owner / marketing |
| U-8 | Reuse terms for third-party reference standards in the knowledge base | read the standards body's terms |
| U-9 | Legal position on cross-border processing and on pattern copyright in the target markets | counsel |
| U-10 | `@a2ui/angular` behaviour on Angular 22 | only if D-6 is ever revisited |

---

## 5. Blockers

| # | Blocker | Blocks | Owner action |
|---|---|---|---|
| **B-1** | Cloudflare plan unknown (billing API 403) | Cost/CPU expectations; whether Paid-only models are callable; R2+ | Check the dashboard; record the plan here. |
| **B-2** | No approval yet to run inference | P0 benchmark | Approve A-2 (below). |
| **B-3** | Benchmark fixtures and two raters do not exist yet | P0 | Assign a writer/photographer and two crochet-literate Arabic raters. |
| **B-4** | Data-URI image input unconfirmed | P4, P5 (if rejected, image transport must be redesigned — e.g. short-lived signed URLs) | Resolved by step 0 of the benchmark. |
| **B-5** | Name not cleared | Store text, tab label | Decide D-13. |
| **B-6** | Privacy policy / store data-safety text does not mention AI processing | Any release to real users | Update before R1. |
| **B-7** | No production Worker / D1 exists (staging only) | Production release of anything, not only AI | Separate, existing decision. |
| **B-8** | Arabic-first-round gaps in the converter (V-5) | Quality ceiling of R3 for Arabic patterns | Schedule P5a (no approval needed). |
| **B-9** | Bunny Dress source video not available | Using REF-01 as a fidelity benchmark | Supply the video + a human transcript, or keep REF-01 as a consistency-only case. |

---

## 6. Approvals needed before implementation steps

| # | Approval | Needed for | Cost / effect |
|---|---|---|---|
| A-1 | Add the `AI` and rate-limit bindings, apply `0004_ai_usage.sql`, deploy to **staging** | P1 | No paid service by itself; uses the free daily Neuron allocation when called. |
| A-2 | Run the benchmark (inference) | P0 | ≈ 51 k Neurons per full pass of five models (estimate) — free if spread over days, or ≈ $0.56 per pass on Paid. |
| A-3 | Buy prepaid AI Gateway credits for a Gemini comparison | optional part of P0 | Paid; 5 % fee; third-party processing. |
| A-4 | Turn `AI_ENABLED` on for staging testers | P2 | Usage-priced within caps. |
| A-5 | Enable **Workers Paid** ($5/month) | public release; already indicated by the baseline app's CPU and D1-write profile | Changes billing. |
| A-6 | Product go for image-to-pattern after reading P0 results | P5 | — |
| A-7 | Create a Vectorize index | only if the keyword retrieval gate fails | Free tier likely sufficient. |
| A-8 | Create production resources and release | P8 | — |

Nothing in this planning task exercised any of these.

---

## 7. Repository notes from this task

- The planning branch was created directly from `origin/development` in an isolated worktree. **No other branch was modified**; `test` and `production` were not touched; nothing was force-pushed or reset.
- The main checkout's local `development` is **28 commits behind** `origin/development` and has two locally modified files (`android/app/capacitor.build.gradle`, `android/capacitor.settings.gradle`). The incoming commits change those same two files, so a fast-forward there would be refused until the local changes are committed, stashed or discarded. That checkout was deliberately left as it is.
- Documentation drift noticed (not fixed here, out of scope): `apps/api/wrangler.jsonc:36` still says "NOTHING here exists remotely yet"; `docs/architecture/overview.md:65` mentions `GZ_AI_FUNCTION` / a Supabase Edge Function while the code uses `GZ_AI_ENDPOINT`; `apps/api/README.md` omits the collections and revisions routes.

---

## 8. Recommended next steps (in order)

1. Read the plan in the dashboard (B-1) and decide the name (B-5).
2. Schedule **P5a** — it needs no approval and helps every Arabic Smart Paste today.
3. Approve A-2, produce fixtures, run **P0**; let the pre-fixed rule choose the model.
4. Approve A-1 and build **P1** on staging with the fake provider first.
5. Build **R1** (P2 + P3), run the R1 gates, pilot with a small signed-in group under the caps.
6. Decide R2 / R3 from pilot data and the P0 extraction results.
