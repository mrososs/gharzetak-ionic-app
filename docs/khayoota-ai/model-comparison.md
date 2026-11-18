# Khayoota AI — Model Comparison

> **No model was run for this document.** Everything below is catalogue data, official documentation and reasoning. Quality claims about Arabic, handwriting and crochet knowledge are **hypotheses to be tested** by `benchmark-plan.md`; none is a measurement.

Legend: **[Live]** = read from this account's Workers AI catalogue API on 2026-11-18 (`GET /accounts/{id}/ai/models/search`, `…/ai/models/schema`) · **[Docs]** = official page read on 2026-11-18 (some through a summarising fetcher — re-check a number before a purchase decision) · **[Recommendation]** · **[Assumption]** · **[Unverified]**.

---

## 1. Catalogue facts for the four named candidates

| | `@cf/google/gemma-4-26b-a4b-it` | `@cf/qwen/qwen3.8-27b` | `@cf/meta/llama-4-scout-17b-16e-instruct` | `@cf/moonshotai/kimi-k2.6` |
|---|---|---|---|---|
| Exists in the account catalogue | yes [Live] | yes [Live] | yes [Live] | yes, **until 2026-11-20** [Live] |
| Added | 2026-04-02 | 2026-08-17 | 2025-04-05 | 2026-04-20 |
| Retirement | none announced; named by Cloudflare as a recommended replacement for "smaller model needs" [Docs] | none announced; same recommendation [Docs] | none announced | **`planned_deprecation_date: 2026-11-20`** — requests then fail with HTTP 410 / error 5028 [Live + Docs] |
| Requires Workers Paid | no flag [Live] | no flag [Live] | no flag [Live] | **yes** (`require_workers_paid`) |
| Vision (`vision: true`) | yes | yes | yes | yes |
| Function calling | yes | yes | yes | yes |
| Reasoning | yes, on by default, not mandatory | yes, **default effort `xhigh`**, efforts `low/medium/xhigh`, `supports_max_tokens: false` | no | yes |
| Context window | 256,000 | 262,144 | 131,000 | 262,144 |
| Price per M tokens (in / out) | **$0.10 / $0.30** (cached in $0.05) | $0.45 / $3.20 (cached in $0.05) | $0.27 / $0.85 | $0.95 / $4.00 |
| Neurons per M tokens (in / out) | 9,091 / 27,273 [Docs] | 40,909 / 290,909 [Docs] | 24,545 / 77,273 [Docs] | — |
| Request shape | OpenAI-style chat: content parts `text`, `image_url {url, detail}`, also `video_url`, `input_audio`, `file`; `tools`, `tool_choice`, `parallel_tool_calls`; `response_format` `text / json_object / json_schema` (+`strict`); `stream` + `stream_options.include_usage`; `chat_template_kwargs.enable_thinking` [Live schema + Docs] | same schema family | `messages`, `tools`, `functions`, `response_format`, **`guided_json`**, `stream`; `max_tokens` default **256** [Live schema] | — |
| Async batch | yes (`async_queue`) | yes | yes | yes |
| Rate limit | 300 req/min (text generation default) [Docs] | 300 req/min | 300 req/min | 20 req/min |
| Zero-data-retention badge on model page | yes [Docs] | yes [Docs] | yes [Docs] | — |

**Conclusion on Kimi K2.6: remove it from the plan.** It stops answering two days after this document was written. If a paid-tier reference point is wanted, use `@cf/deepseek-ai/deepseek-v4.1-flash-1017` (vision, function calling, 1 M context, $0.30 / $1.20, Workers Paid required, named by Cloudflare as the frontier replacement) or `@cf/thinkingmachines/inkling-2-small` ($0.30 / $1.00, Paid). [Live + Docs]

### What could not be verified from documentation

| Question | Status |
|---|---|
| Does `image_url.url` accept a `data:` URI, an https URL, or both, for Gemma 4 / Qwen 3.8? | **[Unverified]** — the published schema has no description. OpenAI-compatible convention says both; Moondream's page explicitly allows "public HTTPS URL or base64 data URI". **Benchmark step 0 must confirm data URIs work**, because private R2 objects have no public URL. |
| Maximum images per request, maximum image bytes / pixels, how images are tokenised and billed | **[Unverified]** for Gemma 4, Qwen 3.8, Llama 4 Scout, Mistral Small 3.1. Documented only for `clef` / `clairic` (see §2). The cost model in `security-privacy-cost.md` uses an **assumed 1,200 tokens per image**. |
| Maximum output tokens | **[Unverified]** (no default/maximum stated for Gemma 4 / Qwen 3.8). |
| Is `response_format: json_schema` actually enforced (constrained decoding)? | **[Unverified].** The model schemas expose it, but the [JSON Mode page](https://developers.cloudflare.com/workers-ai/features/json-mode/) lists six supported models and **none of the candidates**, says the model may fail with "JSON Mode couldn't be met", and says **JSON Mode does not support streaming**. Design consequence: never trust structure — always validate with Zod and allow one repair retry. |
| Arabic (and Egyptian dialect) quality; Arabic handwriting OCR | **[Unverified]** for every model — no model page states languages. |
| Multi-turn tool calling reliability, tool calls while streaming | **[Unverified]**; "Function calling" is still marked Beta in the docs navigation. |
| Latency (time to first token, total) | **[Unverified]** — must be measured; reasoning models can be slow to first token. |
| Where inference physically runs | **[Unverified]** — the data-usage page does not state a location; Workers AI is "not compatible" with Regional Services (see `security-privacy-cost.md` §4). |

---

## 2. Other vision-capable models worth knowing about [Live]

| Model | Why it is interesting | Why it is not the default |
|---|---|---|
| `@cf/mistralai/mistral-small-3.1-24b-instruct` ($0.351 / $0.555, 128k) | Vision + function calling, `guided_json`. | No `response_format`; no Vision badge on the model page although the description mentions vision; more expensive than Gemma 4 on input. Include in the benchmark as a control. |
| `@cf/cloudflare/clairic` ($0.10 / M input, output not charged, 65k context, "in preview") | A typed **extraction** model: you pass images + a list of typed `fields` (text, date, number, list, estimate) and get values **with confidence scores**. Image rules are documented: max 4 images, 4 MiB each, embedded only, 1 token per 32×32 px block. | Not a chat model, preview status, unknown Arabic ability. Candidate for an optional *OCR-first* stage (benchmark track B). |
| `@cf/cloudflare/clef` / `clef-flash` / `clef-omni` ($0.24 / $0.038 / $0.15 per M input) | A typed **decision** model: state + questions → `choice` / `score` probabilities. Could classify an upload as *written pattern / chart / finished object / tutorial frame* very cheaply (≤ 1,024 tokens per image, documented). | Narrow purpose. Only worth it if the main model misclassifies source type in the benchmark. |
| `@cf/moondream/moondream3.1-9B-A2B` ($0.30 / $1.00) | Small dedicated VLM with `query` / `caption` / `detect` / `point` tasks; accepts data URIs explicitly. | No function calling, no JSON schema, single image field; more expensive than Gemma 4. |
| `@cf/swiss-ai/apertus-v1.5-8b` | Catalogue marks it multilingual + vision + function calling, **no price listed**. | Its input schema shows no image field [Live] — vision support through the API is unconfirmed. Skip. |
| `@cf/meta/llama-3.2-11b-vision-instruct` ($0.0485 / $0.676) | Cheapest input price. | Older, no function calling flag, licence acceptance step historically required. Skip. |
| `@cf/utter-project/eurollm-9b-it` | Text only; **lists Arabic explicitly** among its languages; function calling. | No vision, no price listed. Possible cheap text model for a later multi-model set-up; not now. |

Text-only models that could serve a split architecture later: `@cf/zai-org/glm-4.7-flash` ($0.0605 / $0.40, multilingual, function calling), `@cf/openai/gpt-oss-20b` ($0.20 / $0.30).

Embedding / reranking models (for `rag-knowledge-base.md`): `@cf/baai/bge-m3` (multilingual, $0.0118 / M), `@cf/qwen/qwen3-embedding-0.6b` ($0.0118 / M), `@cf/baai/bge-reranker-base` ($0.00311 / M). `@cf/google/embeddinggemma-300m` is retiring on 2026-11-20 — do not use.

---

## 3. Gemini Flash through AI Gateway (optional comparison only)

| Model (Cloudflare catalogue id) | In / out per M tokens | Notes |
|---|---|---|
| `google/gemini-2.5-flash-lite` | $0.10 / $0.40 | ZDR listed. Older generation. |
| `google/gemini-3.1-flash-lite` | $0.25 / $1.50 | ZDR listed. |
| `google/gemini-3.5-flash-lite` | $0.30 / $2.50 | |
| `google/gemini-3.8-flash` | $0.75 / $3.75 until 2026-12-31, then $1.50 / $7.50 | Price doubles on 2027-01-01. |

[Docs: [Cloudflare AI model catalogue](https://developers.cloudflare.com/ai/models/), [Google pricing](https://aistudio.google.com/docs/pricing)]

Facts that decide the policy:

- **Third-party inference is never free here.** Through Cloudflare it needs prepaid AI Gateway credits (**Unified Billing**, 5 % fee on credit purchases, provider rates passed through) or your own Google key (BYOK). [Docs]
- **Google's free tier must not be used for user content**: free-tier content is "used to improve our products", may be read by human reviewers, and only *paid* services may serve EEA/UK/Swiss users. [Docs: [terms](https://aistudio.google.com/docs/terms)]
- Gemini image tokens are documented (258 tokens per 768×768 tile), unlike the Workers AI chat models. [Docs]

**Recommendation.** Do not include Gemini in the first release. Keep the provider adapter (`multimodal-architecture.md` §3) so it *can* be added. Include `google/gemini-3.1-flash-lite` in the benchmark **only** if the owner separately approves buying a small credit balance; its role is a quality ceiling ("how far are the Workers AI models from a mainstream hosted VLM on Arabic handwriting?"), not a planned dependency. If it is ever enabled as a fallback it must be: paid, ZDR, behind an explicit per-user consent line that names the provider, and off by default.

---

## 4. Architecture options

| | Single model | Multi-model (text + vision) | Workers AI + third-party fallback |
|---|---|---|---|
| What it is | One multimodal model handles chat, photos, extraction and action proposals. | A cheaper text model answers plain chat; the VLM handles images/extraction. | Workers AI primary; Gemini via AI Gateway when the primary fails or scores low. |
| Cost at Gemma 4 prices | Lowest already: Gemma 4 is *cheaper than the text-only alternatives* on output ($0.30 vs $0.40 for GLM-4.7-Flash). | No saving while Gemma 4 is the VLM. Saves only if the VLM has to be Qwen 3.8. | Adds prepaid credits + 5 % fee + a second privacy review. |
| Complexity | One prompt family, one eval set, one failure mode. | Router, two prompt families, two eval sets, consistency issues (persona drift between models). | Two providers, two consent paths, cross-provider schema differences. |
| When justified | Default. | If the benchmark shows only Qwen 3.8 is good enough for extraction — then route **by capability** (extraction → Qwen, everything else → Gemma), not by guessing question difficulty. | Only after an approved decision that Workers AI quality is insufficient for a capability users are asking for. |

**[Recommendation] Start single-model. Decide a capability-routed second model only from benchmark data. No third-party fallback in the first release.**

---

## 5. Ranking going into the benchmark (hypotheses, not results)

| Rank | Model | Role | Rationale |
|---|---|---|---|
| 1 | **`@cf/google/gemma-4-26b-a4b-it`** | **Primary candidate for everything** — and already the most economical option | 4.5× cheaper input and ~10.7× cheaper output than Qwen 3.8; vision + tools + `json_schema`; no Paid requirement; newest "recommended replacement" from Cloudflare; reasoning can be switched off (`enable_thinking: false`). |
| 2 | `@cf/qwen/qwen3.8-27b` | **Quality alternative for extraction** (capability-routed) | The Qwen VL lineage is widely regarded as strong at document/OCR tasks **[Assumption — to be tested]**. Cost risk: reasoning defaults to `xhigh`, and output is $3.20 / M. Must be called with an explicit low effort. |
| 3 | `@cf/meta/llama-4-scout-17b-16e-instruct` | Mature fallback / control | Oldest of the three (April 2025), `guided_json` documented, mid price, no reasoning overhead. If it matches Gemma 4 it is a spare; it is **not** cheaper. |
| — | `@cf/cloudflare/clairic` | Optional OCR-first stage (track B) | Only if track A models fail text-fidelity gates on Arabic handwriting. |
| — | `google/gemini-3.1-flash-lite` | Optional quality ceiling | Needs separate approval and prepaid credits. |
| ✗ | `@cf/moonshotai/kimi-k2.6` | removed | Retired 2026-11-20. |

"Best economical alternative": there is nothing cheaper than the primary candidate among general chat-capable VLMs. If Gemma 4 fails, the next-cheapest *general* option is Llama 4 Scout; the cheapest *specialist* options are `clef-flash` (classification) and `clairic` (typed extraction).

### Decision rule (fixed before any benchmark run)

1. A model is **eligible** for a capability only if it passes that capability's hard gates (`benchmark-plan.md` §5).
2. Among eligible models, prefer the cheapest unless another beats it by **≥ 8 points** on that capability's composite score.
3. If no model is eligible for a capability, that capability **does not ship** (or ships in a reduced form — e.g. extraction for printed text only, handwritten input answered with "I can't read this reliably yet").
4. A second model is added only if rule 2 selects different models for different capabilities.

---

## 6. Per-model operating notes

- **Reasoning tokens are billed as output.** For Gemma 4 send `chat_template_kwargs: { enable_thinking: false }` for chat and action turns; evaluate thinking *on* vs *off* for extraction in the benchmark. For Qwen 3.8 always send `reasoning_effort: "low"` unless the benchmark proves `medium` is worth roughly 3× the output cost. [Recommendation; parameter names from Live schema/Docs, behaviour Unverified]
- **Always set an explicit output cap** (`max_completion_tokens` / `max_tokens`). Llama 4 Scout defaults to 256 tokens, which would truncate any extraction. [Live]
- **Pin model ids in one server-side constant** and add a monthly check of the [Workers AI changelog](https://developers.cloudflare.com/changelog/product/workers-ai/): this catalogue retired 16 LLMs in one batch with about two weeks' notice (2026-11-05 → 2026-11-20). Handle error 5028 / HTTP 410 as "model retired → use configured fallback id + alert". [Docs]
- **Cached-input pricing** exists for Gemma 4 and Qwen 3.8 ($0.05 / M). Keep the system prompt + knowledge pack byte-identical and first in the message list so repeated prefixes can benefit. Whether caching is automatic is **[Unverified]**.

---

## 7. Sources

- Live catalogue and schemas: Cloudflare API, this account, 2026-11-18.
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) (updated 2026-11-12) · [limits](https://developers.cloudflare.com/workers-ai/platform/limits/) (2026-09-17) · [errors](https://developers.cloudflare.com/workers-ai/platform/errors/) (2026-11-06) · [JSON Mode](https://developers.cloudflare.com/workers-ai/features/json-mode/) (2026-09-14) · [data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/) (2026-10-16)
- [Planned model deprecations, 2026-11-05](https://developers.cloudflare.com/changelog/post/2026-11-05-planned-model-deprecations/) · [Select models now require Workers Paid, 2026-07-28](https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/)
- Model pages: [gemma-4-26b-a4b-it](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/) · [qwen3.8-27b](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/) · [llama-4-scout-17b-16e-instruct](https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/) · [clairic](https://developers.cloudflare.com/workers-ai/models/clairic/) · [clef](https://developers.cloudflare.com/workers-ai/models/clef/) · [moondream3.1-9B-A2B](https://developers.cloudflare.com/workers-ai/models/moondream3.1-9B-A2B/)
- [AI Gateway Unified Billing](https://developers.cloudflare.com/ai-gateway/features/unified-billing/) · [AI model catalogue](https://developers.cloudflare.com/ai/models/) · [Google AI Studio pricing](https://aistudio.google.com/docs/pricing)
