# Khayoota AI — Backend Implementation Report (P1)

Branch `feat/khayoota-ai-implementation`, commit `7623691` (plus the shared contracts/prompts from `8fcd7b4`).
**Not deployed anywhere.** The migration is applied to the **local** D1 only. Staging config is written but inactive (`AI_ENABLED=false`).

## 1. Shape

A Hono sub-app mounted at `/v1/ai` (`apps/api/src/routes/ai.ts`), behind the existing `requireUser` middleware, so
**every AI route needs a signed-in account** — guests and anonymous callers get 401 before any AI code runs.

| Route | Purpose |
|---|---|
| `GET /v1/ai/status` | enabled?, provider kind (`fake` / `workers-ai`), feature flags, consent state, today's limits and remaining counts, reset time. Never calls a model. |
| `PUT /v1/ai/consent` · `DELETE /v1/ai/consent` | accept the **current** consent version only / withdraw. Stored per account. |
| `POST /v1/ai/chat` | question + optional project context + calculator facts + optional ≤ 2 inline images → validated `ChatReplyV1` |
| `POST /v1/ai/extract` | ≤ 4 inline page images → faithful `TranscriptV1` only (no counting, no validity claims) |

All responses: `Cache-Control: no-store`. No AI route exists outside `/v1`.

## 2. Guards, in order (each one stops the request before the model)

1. `requireUser` (401).
2. Kill switch `AI_ENABLED` — anything but `"true"` → `503 ai_disabled` (status still answers).
3. Provider resolution: `AI_PROVIDER=workers-ai` with no `AI` binding is treated as **disabled**, never a crash.
4. Consent at the current `AI_CONSENT_VERSION` → else `403 ai_consent_required`.
5. Feature flags: images need `AI_VISION_ENABLED`, extraction needs `AI_EXTRACT_ENABLED` → else `403 ai_feature_disabled`.
6. Zod 4 strict validation of the whole body (`contracts.ts`): sizes, counts, enum values, context field lengths → `400 validation_error`.
7. Image checks: base64 size cap, and **magic-byte sniffing** (JPEG/PNG/WebP must match the declared MIME) → `415 ai_unsupported_image`.
8. Burst window: weighted units per minute per user (chat 1, image 3, extract 6; 20 units/min) → `429 ai_rate_limited`.
9. Per-user daily caps (chat 20, image 5, extract 3) → `429 ai_quota_exceeded {scope:'user', resetAt}`.
10. Global daily request cap across all accounts (`AI_DAILY_REQUEST_CAP`; code default 300, staging 100) → `429 ai_quota_exceeded {scope:'global'}`.
11. Global daily Neuron budget (`AI_DAILY_NEURON_BUDGET`; code default 8,000, staging 3,000 — the 10,000 free Neurons are shared by the whole account): the request's **worst-case** Neurons (input estimate + images upper bound + `max_tokens`) are reserved first; if they do not fit, the model is **not called**. After the call the reservation is settled to the actual usage.

Quota writes are **conditional upserts** in D1 (`... ON CONFLICT DO UPDATE ... WHERE count + n <= limit`), so concurrent requests can never exceed a cap (tested with 6 parallel requests against a cap of 3: exactly 3 succeed). A failed global step compensates the per-user step.

## 3. Model call

- `WorkersAiProvider` uses the Worker binding `env.AI.run(model, inputs)` — no API token exists anywhere, and the Angular / Android app holds no Cloudflare credential or model id.
- Models from config (`AI_MODEL_CHAT`, `AI_MODEL_VISION`, `AI_MODEL_EXTRACT`; staging: Gemma 4 26B for all three, see `model-decision.md`).
- Request profile per model (`thinking` off for Gemma, `reasoning_effort: low` for Qwen), JSON-schema `response_format`, hard `max_tokens` per kind, timeout (45 s).
- Error mapping: allocation exhausted (3036) → `429 ai_quota_exceeded {scope:'global'}`; capacity (3040) → one bounded retry, then `503 ai_busy`; timeout → `504 ai_timeout`; anything else → `502 ai_upstream_error`. **No unbounded retries anywhere.**
- Output: parsed and validated with Zod. Invalid JSON → **one** repair call; still invalid → a degraded, plain-text, **action-free** reply (`degraded: true`), or `502 ai_bad_output` for extraction.
- Actions: only the three allowlisted ids, each payload schema-checked, and every id must appear in the request's own context (a model cannot point at another project or account). Max 2. Everything else is dropped.
- Model text is returned as plain text; the client renders it with interpolation only (no HTML, no code execution).

## 4. Provider for development and tests

`FakeAiProvider` is the default (`AI_PROVIDER=fake` in the top-level `wrangler.jsonc`, and in every test). It is deterministic, uses the calculator facts and context like the real prompt asks, and has triggers for every failure path (bad JSON, prose, unknown action, foreign id, quota, capacity, timeout). **No ordinary automated test calls a real model.** Status reports `provider: 'fake'` and the app labels those replies "Demo reply — not from an AI model".

## 5. Logging

`aiLog` (`services/ai/log.ts`) prints one JSON line per request with an **allowlist** of fields only: `requestId, route, kind, status, code, images, degraded, repaired, actions, tokensIn, tokensOut, neurons, ms`. Any other key, or a free-text value, becomes `[withheld]`. Never logged: images, pattern text, chat text, tokens, account data, model output. A test sends recognisable markers through chat, photo and extraction requests and asserts none reaches the console. Seen in the local browser run:

```
{"khayoota":{"requestId":"8161c766-…","route":"chat","kind":"chat","status":"reply","images":0,"degraded":false,"repaired":false,"actions":0}}
```

## 6. Database — migration `0004_ai_usage.sql` (additive)

| Table | Key | Holds |
|---|---|---|
| `ai_user_state` | `user_id` (FK → `user`, cascade delete) | consent version + time |
| `ai_usage_daily` | `(scope, day)`; scope = user id or `__all__` | daily chat/image/extract counts, requests, tokens, Neurons reserved/used — **counts only, no content** |
| `ai_rate` | `(user_id, window_start)` | burst-window units |

Applied: **local D1 only** (`wrangler d1 migrations apply gharzetak-db --local`). Not applied to staging or production.

### Rollback / recovery notes

- The migration only **creates** three new tables and one index; no existing table or column is touched. Older Worker code ignores them, so rolling the Worker back needs **no** schema change.
- To remove the feature's data entirely (only after the Worker no longer uses it):
  ```sql
  DROP TABLE IF EXISTS ai_rate;
  DROP TABLE IF EXISTS ai_usage_daily;
  DROP TABLE IF EXISTS ai_user_state;
  DELETE FROM d1_migrations WHERE name = '0004_ai_usage.sql';
  ```
- Before any future remote apply: take a D1 Time Travel bookmark (`wrangler d1 time-travel info <db> --env staging`) so the database can be restored to the minute before.
- Losing these tables is harmless: users are asked for consent again and today's counters restart (the global Neuron budget and the free allocation still protect cost).
- Deleting an account cascades its consent row; usage rows are counters keyed by user id and can be purged with `DELETE FROM ai_usage_daily WHERE scope = ?` / `DELETE FROM ai_rate WHERE user_id = ?`.

## 7. Configuration

| Var | Dev (top level) | Staging (`env.staging`) |
|---|---|---|
| `AI_ENABLED` | `true` | **`false`** (kill switch off) |
| `AI_PROVIDER` | `fake` | `workers-ai` |
| `AI_VISION_ENABLED` / `AI_EXTRACT_ENABLED` | `true` (fake only) | **`false`** |
| `AI_MODEL_CHAT` etc. | — | `@cf/google/gemma-4-26b-a4b-it` |
| `AI_DAILY_NEURON_BUDGET` | 8000 (default) | **3000** |
| `AI_DAILY_REQUEST_CAP` | 300 (default) | **100** |
| `AI_USER_DAILY_IMAGE` / `_EXTRACT` | 5 / 3 (default) | **0 / 0** |
| `AI_ALLOWED_USER_IDS` | unset = everyone (dev/test only) | **"" = nobody** (fail-closed) |
| `AI_CONSENT_VERSION` | 1 | 1 |
| `ai` binding | none (fake) | `AI` |

Turning staging on later = deploy + set `AI_ENABLED=true` — a separate, approved step (see `implementation-progress.md`).

## 8. Tests

`apps/api/tests/ai.test.ts` — 21 `it` blocks / 29 checks covering access, kill switch, missing binding, consent (accept/withdraw/version/per-account), chat envelope, calculator facts, action sanitising, repair + degraded, provider failures, vision flag + magic bytes, per-user cap, global cap, Neuron budget, burst, concurrency, per-account isolation, extraction flag + transcript-only, log privacy.
API suite: **8 files, 121 tests passed**. `tsc --noEmit` clean.

> **Updated 2026-11-18 (staging-readiness review):** the fake provider is refused outside development/test; usage above a reservation is recorded; text-only chat bodies are capped at 64 KB while photos are off and the extraction flag is checked before reading the body; a fail-closed `AI_ALLOWED_USER_IDS` allowlist was added. See `staging-rollout-readiness.md` §1.
