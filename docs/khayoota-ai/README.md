# Khayoota AI (خيوطة) — Multimodal Crochet Companion: Plan

**Status:** research, audit and planning only (2026-11-18). No AI endpoint was implemented, nothing was deployed, no paid service was enabled, no migration was applied, and **no model was run**.
**Branch:** `feat/khayoota-ai-agentic-planning` · **Base:** `origin/development` @ `e753481af29d1d0b4ceab09d5f70b985635c3454`.

## Documents

| File | Contents |
|---|---|
| [current-state-audit.md](current-state-audit.md) | What exists in the code today, with file references, and what to reuse |
| [cloudflare-readiness.md](cloudflare-readiness.md) | Live read-only account audit, billing uncertainty, limits, whether Workers Free is enough |
| [model-comparison.md](model-comparison.md) | Live catalogue facts for the candidate models, what is undocumented, ranking hypotheses, Gemini position |
| [benchmark-plan.md](benchmark-plan.md) | 52-case benchmark, weights and go/no-go gates fixed in advance, runner and fixtures ([benchmark/](benchmark/)) |
| [multimodal-architecture.md](multimodal-architecture.md) | Endpoints, provider adapter, image handling, client-built context, quotas, typed contracts |
| [agentic-ui-design.md](agentic-ui-design.md) | A2UI vs AG-UI vs typed actions, the decision, the allowlisted action contract |
| [pattern-extraction-pipeline.md](pattern-extraction-pipeline.md) | Image → transcript → deterministic parser → review → editor; confidence rules; parser gaps |
| [rag-knowledge-base.md](rag-knowledge-base.md) | Knowledge classes and isolation, retrieval options, card format, evaluation |
| [product-ux-and-branding.md](product-ux-and-branding.md) | Name, personality, 15 UI specifications, journeys, copy |
| [security-privacy-cost.md](security-privacy-cost.md) | Threat model, logging controls, consent, retention, pricing, cost scenarios, usage caps |
| [implementation-roadmap.md](implementation-roadmap.md) | Phases P0–P8, three releases, files, tests, estimates, approvals |
| [qa-test-matrix.md](qa-test-matrix.md) | Release gates and test cases (model, API, cost, security, actions, device, offline, regression) |
| [decisions-and-blockers.md](decisions-and-blockers.md) | Verified facts, decisions, assumptions, unverified items, blockers, approvals, next steps |

Evidence labels used throughout: **[Verified]** (code read or executed, live read-only API, on 2026-11-18) · **[Live]** / **[Docs]** (account catalogue / official page on that date) · **[Recommendation]** · **[Assumption]** · **[Unverified]**.

---

## Executive summary

**The app is closer to this feature than it looks.** Three things already exist and do most of the hard, trust-critical work:

1. A deterministic **Smart Pattern Parser** that turns messy Arabic/English crochet text into tracker notation and labels each round *Validated / Needs Review / Unsupported* — never inventing a total.
2. A **draft hand-off** that opens the real Add Pattern / Collection editors populated and unsaved, behind an existing review screen.
3. **Revision pinning** that protects tracker progress whenever a pattern changes.

So Khayoota does not need to be trusted with numbers or with saving. The design rule is: **the model reads and explains; deterministic code counts; the user saves.**

**What Khayoota is.** A crochet-only AI companion inside Gharzetak with four abilities: expert chat in Arabic/English (Egyptian Arabic when spoken to in it), understanding photos of work and of patterns, turning pattern photos into reviewable drafts, and proposing a small fixed set of in-app actions that the user taps to run.

**Key findings**

- **Existing assistant:** a labelled demo with deterministic rules; no AI backend anywhere. Extend it — do not build a second chat. It currently reads the *live* pattern instead of the pinned revision (to be fixed).
- **Cloudflare:** one staging Worker, D1 (all four migrations applied), a private R2 bucket; no AI resources of any kind; zero Workers AI usage. **The account's plan could not be read (billing API returns 403)** and must be checked in the dashboard.
- **Models:** all four named candidates exist; **Kimi K2.6 is retired on 2026-11-20** and is dropped. The primary hypothesis is **Gemma 4 26B** — vision, tools, JSON schema, no Paid requirement, $0.10 / $0.30 per million tokens, the cheapest general vision model in the catalogue — with **Qwen 3.8 27B** as the quality alternative for extraction. Arabic handwriting quality, image limits and JSON enforcement are **undocumented** and must be measured.
- **Parser limits found by running it:** round 1 of a typical Arabic amigurumi pattern ("… في الحلقة السحرية") is *Unsupported* today, as are plural stitch names, spaced ranges and "2 sc in each st". Four small fixes (P5a) raise the ceiling for any extraction — and improve Smart Paste immediately.
- **Agentic UI:** typed actions rendered with existing components. A2UI's Angular renderer does not list Angular 22 (the app's version) and still changes monthly; AG-UI has no Angular SDK and targets multi-step agent/state problems this app does not have.
- **Knowledge:** a curated prompt pack first, keyword-matched cards later; no vector database needed; user patterns are never embedded or indexed.
- **Cost (estimates, Gemma 4):** about **$0 / $2–5 / $50 per month** of inference at 100 / 1,000 / 10,000 monthly active users, under stated assumptions; plus the $5 Workers Paid base that the existing app already needs at around 1,000 users.
- **Workers Free:** adequate for a closed, capped, text-chat pilot (the 10,000-Neuron daily allocation ≈ 250–300 chat turns); not for a public release.

## Product vision

A warm, precise companion who knows *your* project: which piece you are on, which round, what the pinned pattern says, and how many stitches you should have — and who says "I can't tell that from the photo" when that is the truth. Khayoota never edits, deletes or changes progress; she opens the right screen and hands you a draft.

## Recommended MVP — the smallest valuable Khayoota

**R1: project-aware text chat**

- Signed-in users, after a one-time consent.
- Crochet-only scope, Arabic and English, one model (decided by the benchmark; Gemma 4 expected).
- Opens from the tab, Project Details and the Tracker with the **pinned** current round as context.
- Three safe actions: *open my round*, *open a piece*, *explain a stitch*.
- Daily per-user caps, a global daily budget, a kill switch, and the existing deterministic helper as the offline / guest / over-limit fallback.
- No images, no streaming, no vector search, no new Worker, no third-party model.

Estimated at **13–17 AI-assisted working days** (P0–P3), plus benchmark fixtures and rating.

Then **R2** (photo troubleshooting) and **R3** (image-to-pattern drafts), each only if its pre-defined benchmark gate is met.

## Before any implementation

1. Check the Cloudflare plan in the dashboard.
2. Approve a benchmark run (uses Workers AI Neurons; free allocation suffices if spread over a few days).
3. Decide the name (recommended: Khayoota — خيوطة).
4. Update the privacy policy text for AI processing before real users see it.

Details and the full list: [decisions-and-blockers.md](decisions-and-blockers.md).
