# Khayoota AI — Crochet Knowledge Base & Retrieval

> Design only. No index, table or content was created. The aim is accurate crochet help from a general model — **not** training or fine-tuning a model.

Legend: **[Verified]** · **[Docs]** · **[Recommendation]** · **[Assumption]** · **[Unverified]**.

---

## 1. Five kinds of knowledge — kept strictly apart

| # | Class | Example | Where it lives | How Khayoota gets it | Shared across users? |
|---|---|---|---|---|---|
| 1 | Global curated crochet knowledge + app help | "What is an invisible decrease?", "How do I add a pattern?" | repository (reviewed content files), bundled with the Worker | knowledge pack / card lookup (this document) | yes — it contains no user data |
| 2 | The user's own patterns | the pinned text of round 7 | device (IndexedDB); D1 for signed-in users | **directly**, from `AppStore.trackerView` on the device, sent as request context | **never** |
| 3 | The user's project progress | active piece, current round, unfinished pieces | device | same context snapshot | never |
| 4 | Temporary uploaded images | a photo of an arm | request memory | attached to the single request | never; not stored |
| 5 | Chat history | the last few turns | device only | last ≤ 8 text turns in the request | never |

Rule: **classes 2–5 never enter any index, embedding, cache or log that another user's request could touch.** No consent screen can make a shared index of private patterns a good idea, so the design simply has none.

### Should user patterns be embedded?

**No.** [Recommendation]

- A pattern is small (≤ 20,000 characters [Verified `validators.ts`]) and already structured by piece and round. The question "what does round 7 say?" has an exact answer by index — similarity search would be a worse, probabilistic way to find it.
- The authoritative copy for an in-progress project is the **pinned revision on the device**, which a server-side index would not have (and guests have no server copy at all) [Verified].
- Embedding private text creates a second copy to secure, delete and keep in sync.

Citations of the user's pattern use the structure directly: the reply carries `citations: [{ partName, roundN }]`; the server drops any citation that does not match a round present in the request context; the app renders it as a chip ("R7 · الايد") that opens that round.

---

## 2. Retrieval options, evaluated

| Option | What it is | Fit |
|---|---|---|
| **Prompt-only baseline** | A fixed "knowledge pack" (≤ ~2,500 tokens) in the system prompt: abbreviations, US/UK table, stitch arithmetic, the top mistakes, app help summary. | **MVP (P2).** The whole curated corpus for the listed topics is small; a compact pack covers most questions at ≈ $0.00025 per request on Gemma 4 and can benefit from cached-input pricing where it applies. |
| **Structured lookup + keywords** | Cards with tags and bilingual synonym lists; pick the 2–3 best cards by normalised keyword match and append them to the prompt. | **P7 step 1.** Deterministic, testable, free, no new Cloudflare product. Reuses the app's Arabic normaliser and stitch synonym tables (`smart-parser.ts:125-144`, `normalizeLetters`). |
| D1 full-text search | An FTS virtual table over the cards. | Possible later if cards exceed what a bundled file should hold. D1's FTS5 support and Arabic tokenisation quality are **[Unverified]** here; cards would need a pre-normalised search column. |
| **Cloudflare Vectorize** | Vector index; embeddings from `@cf/baai/bge-m3` (multilingual) or `@cf/qwen/qwen3-embedding-0.6b`, both $0.0118 / M tokens [Live]. | **Only if needed (P7 step 2).** Limits are generous (Free: 5 M stored / 30 M queried dimensions per month; at 1,024 dimensions that is ≈ 4,800 vectors and ≈ 29,000 queries) [Docs]. But it adds an embedding call per question, an index to rebuild, and a second eval set — unjustified below a few hundred cards. |
| Hybrid (keyword + vector) | Union of both, optionally reranked. | The right shape **if** Vectorize is adopted: Egyptian-dialect phrasing ("غرزتي بتوسع") matches semantically; abbreviations (`hdc`, `BLO`) match lexically. |
| Reranking | `@cf/baai/bge-reranker-base` ($0.00311 / M) [Live]. | Unnecessary while candidate sets are ≤ 10 cards. |
| **Cloudflare AI Search** (ex-AutoRAG) | Managed ingestion + retrieval. | **Not recommended.** Billing starts 2026-12-01 with a monthly allowance of **1,000 semantic queries**, then $0.75 per 1,000 [Docs]. At 80,000 questions/month that is ≈ $60/month for retrieval alone — more than the estimated inference bill — and it is a black box over a corpus small enough to manage by hand. |

**Do not assume Vectorize is needed.** The decision rule: adopt vector search only if the keyword stage misses the retrieval gate (§6) on real pilot questions.

---

## 3. Knowledge source design

### 3.1 Card format

One file per card (JSON or front-matter Markdown), in the repository next to the Worker:

```jsonc
{
  "id": "stitch.invisible-decrease",
  "v": 3,
  "status": "reviewed",                 // draft | reviewed | retired
  "topic": "stitches",                  // see topic list below
  "tags": ["dec", "amigurumi"],
  "stitch": "dec",                      // optional: links to TERMS / ACTN keys
  "appliesTo": { "terms": ["us", "uk"], "level": ["beginner", "intermediate"] },
  "match": {                            // normalised lookup terms, both languages
    "en": ["invisible decrease", "invdec", "inv dec"],
    "ar": ["نقص مخفي", "تنقيص مخفي", "نقص غير ظاهر"]
  },
  "en": { "title": "Invisible decrease", "body": "≤ 120 words, original text…" },
  "ar": { "title": "النقص المخفي", "body": "≤ 120 كلمة، بالمصري البسيط…" },
  "related": ["stitch.sc2tog", "mistake.holes-in-amigurumi"],
  "appLink": { "kind": "video-topic", "id": "invisible-dec" },   // must be one of VIDEOS' ids
  "sources": [{ "title": "Craft Yarn Council — Standards & Guidelines", "use": "terminology reference" }],
  "author": "…", "reviewedBy": "…", "reviewedAt": "2026-…"
}
```

- **Chunking:** the card *is* the chunk — one concept, ≤ ~120 words per language. No sliding windows.
- **Metadata filters:** `status = reviewed`, language, terms system, level, topic. Only reviewed cards are ever served.
- **Versioning:** `v` per card + a pack version (`KNOWLEDGE_PACK_VERSION`) recorded with each benchmark run.
- **Arabic/English:** written natively in both, not machine-translated; Arabic in the app's voice (Egyptian, feminine address), abbreviations kept in Latin letters.

### 3.2 Topics for the first pack (≈ 60–80 cards)

| Topic | Cards (examples) |
|---|---|
| Abbreviations | sc, hdc, dc, tr, dtr, ch, sl st, inc, dec, MR, BLO, FLO, sk, st, rnd — **seeded from the app's existing `TERMS` (15 entries, bilingual) [Verified `catalog.ts:65-89`]** |
| US / UK differences | conversion table, how to tell which a pattern uses, common traps (UK dc = US sc) |
| Core stitches | single, half double, double, treble — how to work, height, turning-chain conventions |
| Increases / decreases | sc inc, invisible decrease, stitch-specific increases, spacing increases to avoid a hexagon |
| Magic ring | making, tightening, alternatives (ch 2) |
| Flat vs. rounds | joined rounds vs. continuous spiral, the natural seam lean, turning chains |
| Reading patterns | `(…) × N`, `[N]` totals, ranges, "work even", how stitch counts chain round to round |
| Amigurumi shaping + joining parts | stuffing, closing, sewing limbs symmetrically, joining legs into a body round |
| Yarn + hook | weights, hook sizes (mm / US / UK), choosing a smaller hook for amigurumi |
| Common mistakes | work curling / ruffling, holes, miscounting the first stitch, losing the round start, twisted foundation chain |
| Gharzetak help | adding a pattern, Smart Paste, collections and pieces, the tracker's count modes, revisions and "Review the update", timers, reminders |

### 3.3 Rights and attribution

- **Original writing only.** Cards are written by the team (or with AI drafting followed by expert review); no copying from books, blogs or designers' tutorials.
- **Reference standards for facts:** abbreviation lists and hook/yarn size tables are checked against the Craft Yarn Council's public standards; facts are restated in our own words and layout, and the source is named in `sources`. The exact reuse terms of any standards body must be read before publishing tables **[Unverified — check the source's own terms]**.
- **No third-party pattern text** in the knowledge base, ever.
- `sources` is shown to users as "Gharzetak guide" plus, where relevant, "checked against <standard>".

### 3.4 Update workflow

1. Author edits or adds a card (`status: draft`) in a pull request.
2. A crochet-literate reviewer checks both languages → `reviewed`.
3. CI runs the retrieval eval (§6) and the schema check (ids unique, `appLink` targets exist in `VIDEOS` / routes, word limits).
4. Pack version bumps; the chat subset of the model benchmark is re-run before release.
5. Retiring a card sets `status: retired` (kept for history, never served).

---

## 4. How retrieval plugs into a request

```
question (ar/en) ─► normalise (same normaliser as the parser)
                 ─► match against card.match[] + stitch keys + topic keywords
                 ─► score, take top 3 (reviewed only, language-preferred)
                 ─► append "REFERENCE (Gharzetak guide): <cards>" after the base pack
model reply      ─► may cite card ids → rendered as a "From the Gharzetak guide" chip
                    + optional learn.explainStitch action
```

- The base pack stays constant (cacheable prefix); retrieved cards follow it.
- If nothing matches, nothing is appended — the model answers from the base pack and general knowledge, and the scope rules still apply.
- Cards are content authored by us, so they are *trusted* text — the only trusted text besides the system prompt.

---

## 5. Where exactness beats retrieval

Several "knowledge" questions should not go to retrieval or to free-form generation at all:

| Question type | Answer source |
|---|---|
| "How many stitches should round 7 have?" | `parsePattern` on the pinned text → number injected into context |
| "Explain this round" | `AssistantService.explainRound` already computes repeats, consumed/produced and the check mark deterministically [Verified `assistant.service.ts:82-98`] — Khayoota phrases around these facts |
| "Convert this to UK terms" | `convertText` (`terminology.ts`) — exact |
| "What is next in my project?" | `nextUnfinished` (`collections.ts:141`) |

---

## 6. Evaluation

| Set | Size | Gate |
|---|---|---|
| Retrieval set: real-style questions in Egyptian Arabic, MSA and English, each labelled with the card(s) that should be retrieved | 60 (20 per variety) | recall@3 ≥ 90 %; no retired/draft card ever returned |
| Negative set: off-topic or app-unrelated questions | 15 | no card returned for ≥ 90 % |
| Answer-with-reference set: does the reply stay consistent with the supplied card? | 30 | 0 contradictions with a supplied card (human-rated) |
| Cross-language: Arabic question whose best card match term is English (e.g. "يعني إيه BLO") | 10 | recall@3 ≥ 90 % |

If the keyword stage fails recall on the Egyptian-Arabic subset specifically, that is the trigger to add hybrid vector retrieval with `bge-m3` and re-measure.

---

## 7. Sources

[Vectorize pricing](https://developers.cloudflare.com/vectorize/platform/pricing/) · [Vectorize limits](https://developers.cloudflare.com/vectorize/platform/limits/) · [AI Search limits & pricing](https://developers.cloudflare.com/ai-search/platform/limits-pricing/) · Workers AI catalogue (live, 2026-11-18) for embedding and reranker prices.
