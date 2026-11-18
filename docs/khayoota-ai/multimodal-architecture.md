# Khayoota AI — Backend & Multimodal Architecture

> Design only. No route, binding, migration or resource described here exists. Code blocks are **contracts to implement later**, not code that was added.

Legend: **[Verified]** (code/live/docs, see `current-state-audit.md`, `cloudflare-readiness.md`) · **[Recommendation]** · **[Assumption]** · **[Unverified]**.

---

## 1. Shape of the solution

```
 Ionic/Angular app (device)                         Cloudflare Worker gharzetak-api-*
 ───────────────────────────                        ─────────────────────────────────────────────
 AssistantPage / Ask-Khayoota entry points          /v1/*  → requireUser (existing)
   │                                                  └─ /v1/ai/*  (new Hono sub-app)
   ├─ buildKhayootaContext()  ← AppStore.trackerView       1 kill switch (AI_ENABLED)
   │    (pinned revision, active part, current round)      2 consent check        (D1 ai_user_state)
   ├─ readImageFile()  → JPEG, no EXIF                     3 burst limit          (ratelimit binding)
   │                                                       4 size cap + Zod       (parseBody pattern)
   └─ POST /v1/ai/chat | /v1/ai/extract  ───────────────►  5 daily quota + budget (D1 ai_usage_daily)
        Bearer token, JSON, inline images                  6 prompt assembly      (system + pack + context)
                                                           7 provider adapter ──► env.AI.run(model, …)
   ◄───────────────  { requestId, reply | transcript }     8 Zod-validate output, sanitise actions, 1 repair
   │                                                       9 usage ledger (counts/tokens only)
   ├─ validateAction() → allowlisted executor
   └─ convertPatternText()  (deterministic, on device)
        → SmartImport review → ImportDraftService → editor (unsaved)
```

Three decisions carry the design:

1. **The model is advisory. Deterministic code owns the numbers and the mutations.** Stitch arithmetic comes from `pattern-parser.ts` / `smart-parser.ts`; saving goes through the existing editors.
2. **The client assembles project context; the server retrieves nothing on the model's behalf.** No tool loop, no server-side lookups driven by model output (§5).
3. **Images are processed in memory and not stored** — not in R2, not in D1, not in logs (§4).

---

## 2. API surface

Two work endpoints, two small housekeeping endpoints. All under `/v1/ai`, all behind the existing `requireUser`.

| Method + path | Purpose | Body cap |
|---|---|---|
| `POST /v1/ai/chat` | Crochet Q&A, project-aware help, photo troubleshooting (0–2 images). Returns a reply envelope with optional cards and action proposals. | 1.5 MB |
| `POST /v1/ai/extract` | Image(s) or pasted text → faithful transcript with legibility flags. Returns **no** stitch maths. | 3 MB |
| `GET /v1/ai/status` | `{ enabled, consentVersion, consented, remaining: { chat, image, extract }, resetAt, limits }` so the UI can show limits/unavailability without spending a request. | — |
| `PUT /v1/ai/consent` | Records acceptance of the current consent version. | 1 KB |

Why not the candidate routes from the brief:

- `analyze-image` is folded into `chat` — a photo question *is* a chat turn with an image, and the persona, context and action rules are identical. One prompt family, one eval set.
- `validate-draft` is **not a server route**: the validator already exists as pure TypeScript on the device (`convertPatternText`), works offline and costs no Worker CPU. Sending a draft to the server to be validated would add a round trip and duplicate the parser in two runtimes.
- POST is new for `/v1` (existing routes are idempotent PUTs). It is appropriate here — an inference is not an idempotent resource write — and CORS already allows POST [Verified `index.ts:35-44`].

### 2.1 `POST /v1/ai/chat`

```ts
// Request (Zod-validated; everything optional except `message` or `images`)
interface ChatRequestV1 {
  v: 1;
  message: string;                    // ≤ 2,000 chars
  images?: InlineImage[];             // ≤ 2
  history?: { role: 'user' | 'assistant'; text: string }[];   // ≤ 8 turns, ≤ 6,000 chars total, text only
  context?: KhayootaContextV1;        // ≤ 6 KB serialized, see §5
  intent?: 'ask' | 'explain-round' | 'diagnose-photo' | 'next-piece' | 'explain-stitch';
  lang: 'ar' | 'en';
}
interface InlineImage { mime: 'image/jpeg' | 'image/png' | 'image/webp'; data: string /* base64, ≤ 700 KB */ }

// Response
interface ChatResponseV1 {
  requestId: string;
  reply: {
    v: 1;
    lang: 'ar' | 'en';
    text: string;                     // plain text, ≤ 1,500 chars
    observations?: string[];          // photo turns only: what is visible
    hypotheses?: string[];            // possible causes
    cannotConfirm?: string[];         // explicit limits
    citations?: { partName?: string; roundN: number }[];   // rounds of the context the answer relies on
    actions: ActionProposal[];        // ≤ 2, see agentic-ui-design.md
  };
  usage: { remaining: { chat: number; image: number; extract: number }; resetAt: string };
}
```

### 2.2 `POST /v1/ai/extract`

```ts
interface ExtractRequestV1 {
  v: 1;
  images?: InlineImage[];             // 1–4 pages, in reading order
  text?: string;                      // alternative input: messy pasted text, ≤ 20,000 chars
  hint?: { lang?: 'ar' | 'en' | 'mixed'; terms?: 'us' | 'uk' };
  lang: 'ar' | 'en';                  // language for warnings
}
interface ExtractResponseV1 {
  requestId: string;
  transcript: PatternTranscriptV1;    // defined in pattern-extraction-pipeline.md §4
  usage: { remaining: …; resetAt: string };
}
```

### 2.3 Errors (same envelope as today: `{ error: { code, message, details? } }`)

| Code | HTTP | Meaning → UI state (`product-ux-and-branding.md`) |
|---|---|---|
| `unauthorized` | 401 | existing; guest or expired session → sign-in prompt |
| `ai_disabled` | 503 | kill switch / not configured → "unavailable" |
| `ai_consent_required` | 403 | show consent sheet |
| `ai_rate_limited` | 429 | burst limit; `details.retryAfterSec` |
| `ai_quota_exceeded` | 429 | daily cap; `details: { scope: 'user' | 'global', resetAt }` → "limit reached" |
| `ai_payload_too_large` | 413 | image/body over cap |
| `ai_unsupported_image` | 415 | magic bytes are not jpeg/png/webp |
| `ai_busy` | 503 | provider capacity (Workers AI 3040) |
| `ai_timeout` | 504 | provider exceeded the deadline |
| `ai_bad_output` | 502 | output failed validation twice |
| `validation_error` | 400 | existing |

Workers AI error 3036 (free allocation exhausted) maps to `ai_quota_exceeded` with `scope: 'global'`; 5028 (model retired) maps to `ai_disabled` plus an operator alert.

---

## 3. Provider adapter

One narrow interface; one implementation for the MVP; a fake for tests.

```ts
interface AiProvider {
  readonly id: 'workers-ai' | 'ai-gateway' | 'fake';
  generate(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResult>;
}
interface ProviderRequest {
  model: string;
  system: string;
  turns: { role: 'user' | 'assistant'; text: string; images?: InlineImage[] }[];
  jsonSchema?: object;                // requested structure; never trusted
  maxOutputTokens: number;
  reasoning: 'off' | 'low';
  temperature: number;
}
interface ProviderResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  finish: 'stop' | 'length' | 'filtered' | 'error';
  providerCode?: number;              // e.g. 3036, 3040, 5028
}
```

- **`WorkersAiProvider`**: `env.AI.run(model, { messages, response_format, max_completion_tokens, chat_template_kwargs | reasoning_effort, temperature })`. Images become `{ type: 'image_url', image_url: { url: 'data:<mime>;base64,<data>' } }` by string concatenation — **no decode/re-encode in the Worker**. Whether data URIs are accepted is benchmark step 0 [Unverified].
- **`FakeProvider`**: deterministic canned results keyed by a request hash. Mandatory, because `wrangler dev` and the vitest Workers runtime would otherwise call the **real** Workers AI and consume Neurons ("model inferences in local mode using Wrangler will also count towards these limits" — [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/)). Selected by `AI_PROVIDER=fake`, the default outside staging/production.
- **`AiGatewayProvider`** (later, only after approval): same binding with `{ gateway: { id, collectLog: false } }`, or third-party models. Not built in the MVP.

Model routing is a server-side table, never client-supplied:

```ts
const ROUTES = {
  chat:    { model: env.AI_MODEL_CHAT,    maxOutputTokens: 500,  reasoning: 'off', timeoutMs: 25_000 },
  vision:  { model: env.AI_MODEL_VISION,  maxOutputTokens: 700,  reasoning: 'off', timeoutMs: 35_000 },
  extract: { model: env.AI_MODEL_EXTRACT, maxOutputTokens: 4000, reasoning: 'low', timeoutMs: 55_000 },
} as const;
```

All three default to the same model id until the benchmark says otherwise (`model-comparison.md` §5).

---

## 4. Image handling

| Step | Where | Rule |
|---|---|---|
| Pick | client | Existing `<input type="file" accept="image/*">`. On Android this offers camera and gallery. A native camera plugin is optional later (`product-ux-and-branding.md` §4). |
| Validate | client | `readImageFile` rules: ≤ 8 MB source; jpeg/png/webp/heic/heif [Verified `utils/image.ts`]. |
| Resize / compress | client | Photo question: max edge **1280**, q 0.8. Extraction: max edge **1568**, q 0.85. If the result exceeds 700 KB, re-encode at q 0.7, then at 1280 px. [Recommendation; sizes to be tuned by the benchmark] |
| Metadata | client | The canvas re-encode in `readImageFile` produces a fresh JPEG with **no EXIF** (no GPS, device, timestamp). Orientation is applied by the browser before drawing. |
| Transport | client → Worker | Inline base64 in the JSON body over TLS with the bearer token. No URL, no query string, no public link. |
| Validate | Worker | Body cap by `content-length` and actual length (existing `parseBody` pattern); per-image length cap; **magic-byte sniff of the first bytes only** (decode ~16 bytes of base64, reuse `sniffMime` — `services/media.ts:21-30`); count ≤ 2 / ≤ 4. |
| Inference | Worker → Workers AI | Passed as data URIs. Cloudflare states standard inference inputs/outputs "are not retained after the request" and are not used for training ([data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)). |
| Storage | — | **None.** Not written to R2 or D1. The chat history on the device already drops images on save [Verified `app.store.ts:560-564`]. |
| Logging | Worker | Never `console.log` request or response content. Workers Logs with invocation logs are **on** for the staging Worker [Verified] — they record request metadata, so nothing sensitive may be put in URLs (the live setting is `redact_query_string: false`). |

**Using an existing project photo.** The client already holds the photo (`ProjectPhoto.localUrl`) or can fetch its own object through the owner-checked `GET /v1/media/object` (`SyncService.mediaUrl`). It re-encodes and sends it inline like any other image. The AI endpoints **never accept an R2 key** — that removes a whole class of "make the model fetch someone else's object" attacks.

**Temporary R2 staging — deliberately not used.** It would be needed only if extraction became asynchronous (Queues/Workflows) or exceeded request limits. If that day comes: key `ai-tmp/${userId}/${uuid}`, written and read only by the Worker, a 24-hour R2 lifecycle rule, and deletion on completion. Until then it would add storage, a retention policy and a cleanup path for no user benefit.

**PDF.** Not in the MVP. Pattern PDFs are overwhelmingly third-party copyrighted documents, multi-page (cost multiplies), and need rasterisation that the Worker cannot do cheaply. The supported path is "photograph / screenshot the page(s)". Cloudflare's Markdown-conversion endpoint exists but is unevaluated here [Unverified]; revisit after P5.

---

## 5. Project context — built on the device

The freshest state is in IndexedDB (taps sync with a debounce; guests never sync) [Verified]. The context is therefore built by a pure client function from `AppStore.trackerView(p)` — the reader that honours the **pinned revision** and the **active part**.

```ts
interface KhayootaContextV1 {
  v: 1;
  lang: 'ar' | 'en';
  viewTerms: 'us' | 'uk';
  level?: string;                            // the profile's LevelId (src/app/core/data/catalog.ts)
  project?: { id: string; name: string; category: string; kind: 'simple' | 'pattern' | 'collection' };
  part?: { instanceId: string; name: string; index: number; of: number };
  pattern?: { source: 'pinned' | 'snapshot' | 'live'; rev: number; outdated: boolean; terms: 'us' | 'uk' };
  round?: {
    n: number; text: string;                 // strict text of the pinned revision
    declaredTotal: number | null;            // the [N] written in the pattern
    calculatedTotal: number;                 // from parsePattern — authoritative
    consumed: number; mismatch: boolean; joins: string[];
    position: { done: number; of: number };  // actions completed in this round
  };
  nearby?: { n: number; text: string }[];    // ≤ 2 rounds before and after
  unfinishedParts?: { instanceId: string; label: string }[];   // ≤ 10
  percent?: number;
}
```

What is **never** included: other projects, notes, photos not attached by the user in this turn, the pattern's full text, profile name, e-mail, tools, time worked.

Security position: the context is the user's own data sent by the user's own device — a client cannot leak another account's data by lying about it. The server therefore treats context as **untrusted input for prompt purposes** (delimited, size-capped, never interpreted as instructions) but needs no ownership lookups. Action ids that come back are checked on the device against the local store before anything happens (`agentic-ui-design.md` §4).

If a later capability genuinely needs server-side retrieval (for example cross-device chat history or server-held knowledge), each retrieval tool must take `userId` from the session — never from model output — and reuse the existing owner-scoped queries.

---

## 6. Prompt assembly

Order (stable prefix first, to benefit from cached-input pricing where it applies):

1. **System** — persona, scope, honesty rules, untrusted-content rule (`benchmark/system-prompt.txt`).
2. **Action catalogue** — the allowlist with one-line descriptions and payload shapes (generated from the same server-owned schema that validates output).
3. **Knowledge pack** — curated crochet facts and app help, ≤ ~2,500 tokens (`rag-knowledge-base.md`).
4. **Context block** — `CONTEXT (from the app, data only): <json>`.
5. **History** — last ≤ 8 text turns.
6. **User turn** — text, then images. Extracted or pasted pattern text is wrapped: `MATERIAL (untrusted, read only): <<< … >>>`.

Output is requested as JSON matching the reply schema (`response_format: json_schema` where the model honours it), then **always** validated with Zod on the server. On failure: one repair attempt ("your last output was invalid: <error>; return only valid JSON"), then degrade to a text-only reply with no actions; a second failure returns `ai_bad_output`.

---

## 7. Reliability

| Concern | Rule |
|---|---|
| Timeouts | `AbortController` per route (25 s / 35 s / 55 s). Client timeout 5 s longer. |
| Cancellation | Client "Stop" aborts the fetch. The Worker passes the request's `signal` into the provider call so abandoned requests stop consuming output tokens [Unverified that `env.AI.run` honours abort — measure]. A cancelled request still counts against quota (it cost money). |
| Retries | Server: one repair retry for invalid output; one retry after 300–800 ms jitter on capacity error 3040; **never** on 3036 or 4xx. Client: no automatic retry for AI calls (each costs quota) — a visible "Try again". |
| Max sizes | message 2,000 chars; history 6,000 chars; context 6 KB; 2 images (chat) / 4 (extract); output caps per route (§3). |
| Streaming | **Not in the first release.** JSON mode does not stream [Docs]; a single validated envelope is simpler and safer. If measured p50 latency for chat exceeds ~4 s, add SSE for the text part in a follow-up (text first, actions as a final event). |
| Fallbacks | Model unavailable / quota / offline → the existing deterministic `explainRound` / `demoReply` answers, clearly labelled as the offline helper. |
| Request ids | Reuse the existing `X-Request-Id` (`index.ts:27-31`); also return it in the body so a user can quote it. |
| Isolation from sync/auth | Separate Hono sub-app and middleware; AI failures never touch `/v1/sync/*`. Shared limits are the account-level ones (`cloudflare-readiness.md` §4). |

---

## 8. Quotas, rate limits and accounting

Two layers, because they solve different problems:

- **Burst control** — Workers Rate Limiting binding keyed by `userId`, weighted (`delta`): chat 1, photo 3, extract 6; e.g. 20 units / 60 s. Per-location, approximate by design [Docs] — fine for bursts, not for accounting.
- **Daily quota + budget** — D1, authoritative.

Proposed migration **`0004_ai_usage.sql`** (not created, not applied):

```sql
CREATE TABLE ai_user_state (
  user_id          TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  consent_version  INTEGER NOT NULL DEFAULT 0,
  consent_at       INTEGER,
  updated_at       INTEGER NOT NULL
);
CREATE TABLE ai_usage_daily (
  user_id    TEXT NOT NULL,            -- a user id, or '__all__' for the account-wide row
  day        TEXT NOT NULL,            -- UTC 'YYYY-MM-DD' (Workers AI allocation also resets at 00:00 UTC)
  chat       INTEGER NOT NULL DEFAULT 0,
  image      INTEGER NOT NULL DEFAULT 0,
  extract    INTEGER NOT NULL DEFAULT 0,
  tokens_in  INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  neurons    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
```

- Reserve before calling the model: one conditional upsert (`… ON CONFLICT DO UPDATE SET chat = chat + 1 WHERE chat < ?limit`); if no row changes → `ai_quota_exceeded`. Same for the `__all__` row against `AI_DAILY_NEURON_BUDGET`.
- Settle after: add real tokens/Neurons from `usage`.
- **No prompt, reply, image or context is stored** — counters only. D1 cost: ≤ 4 row writes per AI request.
- Rows older than 90 days can be deleted by a manual maintenance query (no cron needed).

Default limits are in `security-privacy-cost.md` §7.

---

## 9. Configuration changes that implementation would need (all approval-gated)

```jsonc
// apps/api/wrangler.jsonc — per environment
"ai": { "binding": "AI" },
"ratelimits": [{ "name": "AI_BURST", "namespace_id": "1001", "simple": { "limit": 20, "period": 60 } }],
"vars": {
  "AI_ENABLED": "false",                       // kill switch, default off
  "AI_PROVIDER": "fake",                       // 'workers-ai' only on staging/production
  "AI_MODEL_CHAT": "@cf/google/gemma-4-26b-a4b-it",
  "AI_MODEL_VISION": "@cf/google/gemma-4-26b-a4b-it",
  "AI_MODEL_EXTRACT": "@cf/google/gemma-4-26b-a4b-it",
  "AI_DAILY_NEURON_BUDGET": "8000",
  "AI_CONSENT_VERSION": "1"
}
```

Plus `AI: Ai` in `apps/api/src/env.ts`, and on the client `GZ_AI_ENDPOINT=/v1/ai` (the variable already exists). No new secret is required for Workers AI — the binding is credential-free, so **no Cloudflare credential or provider key ever reaches the mobile app**. A third-party key, if ever approved, lives in AI Gateway's key store or a Worker secret.

---

## 10. Guest mode

| Capability | Guest | Signed-in |
|---|---|---|
| Deterministic tools (Smart Paste, parser, tracker, offline round explanation) | yes — unchanged | yes |
| Khayoota chat / photo / extraction (hosted model) | **no** — "sign in to talk to Khayoota", with the offline helper still available | yes, after consent |

Reasons: every `/v1` route already requires a session [Verified]; an anonymous inference endpoint is a free, scriptable model API for the whole internet; the account has no zone, so no WAF/Turnstile-style front door is available [Verified — no zones]. An anonymous tier would need device attestation or similar and is out of scope.

---

## 11. Files an implementation would touch (for sizing; nothing was created)

| Area | Likely files |
|---|---|
| Worker | `apps/api/src/routes/ai.ts` (new), `src/services/ai/{provider.ts,workers-ai.ts,fake.ts,prompt.ts,schemas.ts,quota.ts}` (new), `src/index.ts` (mount), `src/env.ts`, `src/errors.ts` (codes), `wrangler.jsonc`, `drizzle/0004_ai_usage.sql`, `src/db/schema.ts`, `tests/ai.test.ts` (new) |
| Client | `src/app/core/ai/assistant.service.ts` (contract), `core/ai/khayoota-context.ts` (new, pure), `core/ai/khayoota.types.ts` (new), `core/ai/action-registry.ts` (new), `core/api/api.types.ts`, `features/ai-assistant/assistant.page.ts`, `core/models/models.ts` (`ChatMessage`), `core/i18n/strings.ts` |
