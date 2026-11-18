# Khayoota AI — Release status (single source of truth)

Updated 2026-11-19 for the promotion of `feat/khayoota-ai-implementation` into `development` and `test`.
Earlier documents describe plans and intermediate states; where they disagree, **this file wins**. In particular
`staging-rollout-readiness.md` was written *before* anything was deployed (ID-only allowlist, AI off, "nothing executed").

## 1. What is live on staging (tester-only)

| Item | State |
|---|---|
| Worker / D1 | `gharzetak-api-staging` / `gharzetak-db-staging` (the only Cloudflare resources on the account; production does not exist yet) |
| Migration | `0004_ai_usage.sql` applied remotely 2026-11-18 (additive: `ai_user_state`, `ai_usage_daily`, `ai_rate`) after a Time Travel bookmark + verified export |
| Provider / model | `workers-ai` via the `AI` binding; `@cf/google/gemma-4-26b-a4b-it` for chat, photo questions and extraction (see §5 for the hybrid-routing evaluation) |
| Master switch | `AI_ENABLED=true` (kill switch: set `false` and deploy — verified live: the app falls back to the labelled built-in rules and sends **no** AI request) |
| **Access** | **Deny all by default.** Allowed only: a session whose D1 user has a **verified e-mail** listed in the Worker **secret** `AI_ALLOWED_EMAILS` (or in `AI_ALLOWED_USER_IDS`). Everyone else, guests included, gets `401` (guest) / `403 ai_access_restricted`; `GET /v1/ai/status` says `{enabled:false, access:'restricted'}` and the app shows "coming soon". Checked **before** consent, body parsing, quotas and the model, on chat (text and photo), extract and consent. |
| Consent | version 1, per account, required before any hosted request; can be withdrawn from the Khayoota menu |
| Features | chat on; `AI_VISION_ENABLED=true`, `AI_EXTRACT_ENABLED=true` — **experimental, tester-only**; images up to 4 per message / 4 pages per extraction |
| Quotas | per user/day: chat 60 (QA value; default 20), image 10, extract 6 · burst 20 units/min · global 100 requests/day · global **3,000-Neuron/day** budget with an upper-bound reservation per call (the free allocation of 10,000 is shared by the whole account) |
| Limits | chat 600 / photo 700 / extract **4,000** output tokens; chat timeout 45 s, extract timeout **120 s**; client ceiling 150 s |
| Privacy | no image/chat/pattern text stored or logged (allowlisted log fields only); photos are resized on the phone and held in memory |

The staging secret is **not** in git and not in the APK. A new Worker environment (production) starts with AI off, no
allowlist and the fake provider refused: nothing is enabled by merging code.

## 2. Verification summary (2026-11-18/19)

Real Gemma 4 on the HONOR phone, allowlisted tester only: hosted chat, project/piece/round context from the pinned revision,
typed action (opens the tracker, no progress change), off-topic refusals, multi-image chat, giraffe sheet and 4-page chicken
extraction into the existing collection editor (unsaved draft), kill switch. Details and request ids:
`real-android-ai-qa.md`, `model-domain-evaluation.md`, `real-vision-pattern-qa.md`.
Automated: frontend 686, API 139 (47 AI), parser suites 231, typechecks and production build clean; ordinary tests use the fake
provider only (no AI binding in `wrangler.jsonc` outside staging).

## 3. Not production-ready — known limitations

1. **Arabic OCR mistakes.** Gemma 4 dropped the opening "(" of every repeat group on the giraffe sheet (RTL), misread one
   repeat, misspelt some note words and invented 2 lines, while marking everything "clear". The parser keeps such lines out of
   "validated" (`ai-unbalanced`, Needs Review), but the user must correct the draft; invented lines cannot be detected.
2. **Dense pages can exceed output limits.** One giraffe run reached the 4,000-token cap (93 s + repair, 142 s end-to-end,
   close to the 150 s client ceiling). Needs per-page chunking or streaming before any release.
3. **P5b notation.** Chains, skips, turning chains, slip-stitch joins, chain-space work, garment joins, `*…*` repeats, shells and
   clusters stay Unsupported/Needs Review; AI extraction never makes them valid. «حشو» stays Needs Review (P5a rule).
4. **Real-image quality evaluation is incomplete.** Three real sources, ~7 vision requests: the 52-case benchmark has **not** been
   run and **no** vision/extraction gate is passed. Photo troubleshooting was only tested with a chicken photo (no photo of the
   tester's own work-in-progress); the model once described a photo as the open project (fixed by prompt v4, one re-test).
5. **Multi-image continuity is under-measured.** One 4-page set passed; duplicate, missing, out-of-order and unrelated pages and
   image-borne injection were not measured. Source-photo attribution can be wrong for collage photos.
6. **Not exercised on device:** pinned-vs-edited revision (needs a fixture in the tester's account), a true two-project switch,
   saving an extracted draft (would add a pattern to the tester's real account), landscape with the keyboard open (tight).
7. Vision and extraction are **experimental and must stay tester-only**; chat is the only capability close to a limited rollout.

## 4. Operating the tester rollout

- Add/remove a tester: `wrangler secret put AI_ALLOWED_EMAILS --env staging` (comma-separated, verified e-mails only). No deploy needed beyond the secret.
- Emergency stop: set `AI_ENABLED` to `false` in `apps/api/wrangler.jsonc` (staging) and `wrangler deploy --env staging`.
- Cost watch: Cloudflare GraphQL `aiInferenceAdaptiveGroups` (account) vs `ai_usage_daily` (Worker ledger, conservative).
- Rollback: the Worker is additive-only; older code ignores the three tables. Notes in `backend-implementation-report.md`.

## 5. Model routing

Current routing: **all capabilities use Gemma 4**. A hybrid evaluation (Qwen 3.8 for photo troubleshooting / extraction, Gemma
for text chat) is a separate, bounded measurement: see `model-routing-evaluation.md` (created when the measurement is run). The
routing is already per-capability in config (`AI_MODEL_CHAT`, `AI_MODEL_VISION`, `AI_MODEL_EXTRACT`, allowlisted to Gemma 4
and Qwen 3.8); nothing changes until measured results justify it.
