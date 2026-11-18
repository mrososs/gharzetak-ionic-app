# Khayoota AI — Provisional Model Decision

Status: **PROVISIONAL**, based on the PRELIMINARY pilot in `benchmark-results.md` (27 live requests, synthetic inputs, no human raters). The pre-fixed decision rule from `model-comparison.md` §5 was applied unchanged.

## Decision

| Capability | Provisional model | Released to users? | Why |
|---|---|---|---|
| Text chat | `@cf/google/gemma-4-26b-a4b-it` | No — internal/local only until the chat gate (human-rated) passes and staging is approved | Correct on every pilot case after the calculator-facts fix; valid JSON every time; 1–3 s; ≈ 23 Neurons per turn |
| Image troubleshooting | `@cf/google/gemma-4-26b-a4b-it` | **No — feature flag OFF** (`AI_VISION_ENABLED=false`) | Right structure and honesty on a synthetic illustration, but no real photos and no raters: gate not met |
| Pattern transcription | `@cf/google/gemma-4-26b-a4b-it` | **No — feature flag OFF** (`AI_EXTRACT_ENABLED=false`) | Perfect on synthetic printed Arabic/English pages; handwriting, real photos, charts untested: gate not met |

**One model for everything**, as the plan prefers. No second model is justified by measured evidence.

## Rule applied

1. Eligible = passes the hard gates on the cases run (G1–G7 in `benchmark-plan.md` §5.2). Gemma 4 and Qwen 3.8: no gate violation in the pilot. Llama 4 Scout: **ineligible for extraction** — on the Arabic page it flipped parentheses and dropped a written total while labelling every line "clear" (a silent-confidence failure the confidence rules exist to prevent); it also left `cannotConfirm` empty on the photo case.
2. Among eligible models prefer the cheapest unless another leads by ≥ 8 points on that capability. Measured cost per chat turn: Gemma ≈ 23 Neurons, Qwen ≈ 128 (5.5×). Qwen showed **no measurable quality lead** on the cases both ran (both correct on P-AR, P-COUNT, P-ACT, P-PA, P-PHOTO under prompt v2). → Gemma.
3. Qwen 3.8 remains the documented fallback if the full benchmark later shows a quality gap on handwriting (configurable per capability: `AI_MODEL_CHAT`, `AI_MODEL_VISION`, `AI_MODEL_EXTRACT`).

## What would change the decision

- The full benchmark (52 cases, 3 runs, two human raters, real handwriting and photographs) — required before any user-facing release of vision or extraction.
- A Gemma 4 retirement notice (watch the Workers AI changelog; error 5028 maps to `ai_disabled` + operator attention).

## Request profile used in production

`{ messages, max_tokens, temperature: 0.2, response_format: { type: 'json_schema', json_schema: { name, schema, strict: false } }, chat_template_kwargs: { enable_thinking: false } }` — reasoning off (reasoning tokens are billed as output and were not needed). Inline images as `data:` URIs.
