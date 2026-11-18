# Khayoota AI — Implementation Roadmap

> A plan, not a record. Nothing below has been built. Estimates are **AI-assisted working days for one developer** (design already done by this plan), excluding waiting time for approvals, fixture production and human rating. They are estimates, not commitments.

Related: scope and contracts in `multimodal-architecture.md`, `agentic-ui-design.md`, `pattern-extraction-pipeline.md`; gates in `benchmark-plan.md`; tests in `qa-test-matrix.md`; approvals in `decisions-and-blockers.md`.

---

## 0. Three releases

| Release | Contains | Phases | Estimate | Why this cut |
|---|---|---|---|---|
| **R1 — Khayoota Chat (the smallest valuable version)** | Signed-in, text-only, project-aware crochet chat with three safe actions (open my round, open a piece, explain a stitch), usage caps, offline helper fallback | P0, P1, P2, P3 (+ the first three actions of P6) | **≈ 13–17 days** | Delivers a real specialised assistant on the cheapest request type; exercises the whole safety and cost machinery before any image is sent. |
| **R2 — Khayoota Sees** | Photo troubleshooting with the observed / possible / cannot-confirm structure | P4 | + 3–4 days | Adds vision without any write path. |
| **R3 — Khayoota Reads** | Image-to-pattern drafts through the existing review + editor; correction proposals; remaining cards | P5a, P5, rest of P6 | + 9–12 days | Highest value and highest risk; ships only if the benchmark gates pass. |
| Later | Curated knowledge retrieval; hardening continues every release | P7, P8 | + 3–5 days engineering (plus content writing), + 4–6 days | |

Full feature set: **≈ 32–44 working days**, plus content authoring (≈ 5–8 days of a crochet-literate writer/reviewer) and benchmark fixtures/rating (≈ 2–3 person-days).

Independent quick win that needs **no approval and no Cloudflare change**: **P5a** (four small converter fixes) improves today's Smart Paste for Arabic patterns immediately.

---

## P0 — Model evaluation & proof of concept

| | |
|---|---|
| **Scope** | Produce fixtures; run step 0 (data-URI acceptance); run the 52-case benchmark on Gemma 4, Qwen 3.8, Llama 4 Scout, Mistral Small 3.1 (+ a Paid-tier reference if available); score; decide the model per capability; replace assumed token counts with measured ones. |
| **Reuse** | `benchmark/cases.json`, `run-benchmark.mjs`, `system-prompt.txt`; the app's `convertPatternText` as the automated judge. |
| **Likely files** | `docs/khayoota-ai/benchmark/*` (scorer script, results summary). No app code. |
| **Backend / migrations** | none |
| **Dependencies** | Approval A-2; an API token with Workers AI Read/Run; fixtures; two raters. |
| **Risks** | Data URIs rejected (→ needs another transport, see B-4); Arabic handwriting below gate (→ R3 ships printed-only or not at all); `json_schema` not enforced (→ already designed for). |
| **Acceptance** | A filled summary table; a written decision per capability using the pre-fixed rule; measured tokens/latency recorded; cost table in `security-privacy-cost.md` updated. |
| **Automated tests** | Manifest validation (dry run); scorer unit tests on synthetic outputs. |
| **Device scenarios** | none |
| **Estimate** | 3–4 days engineering + fixtures (1–2 person-days) + rating (≈ 1 day) |
| **Cloudflare cost** | ≈ 51,000 Neurons for one full pass of all five models (estimate): inside the free allocation if spread over ~5 days, or ≈ $0.56 on Workers Paid; × 3 runs for variance. |
| **Approvals** | A-2 (run inference), A-3 only if a Gemini comparison is wanted. |

## P1 — Secure AI backend

| | |
|---|---|
| **Scope** | `/v1/ai` sub-app: `GET status`, `PUT consent`, `POST chat` (text only at first); provider adapter with `WorkersAiProvider` + `FakeProvider`; kill switch; consent gate; burst limiter; D1 daily quota + global budget; Zod validation of requests and of model output with one repair retry; typed errors; request ids; content-free logging. |
| **Reuse** | `requireUser`, `parseBody`, `ApiError` envelope, `requestId` middleware, vitest Workers setup, cross-user test helpers. |
| **Likely files** | `apps/api/src/routes/ai.ts`, `src/services/ai/*`, `src/index.ts`, `src/env.ts`, `src/errors.ts`, `src/db/schema.ts`, `wrangler.jsonc`, `tests/ai.test.ts`, `scripts/smoke-remote.mjs` (new checks). |
| **Backend changes** | `AI` binding; `ratelimits` binding; vars `AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL_*`, `AI_DAILY_NEURON_BUDGET`, `AI_CONSENT_VERSION`. |
| **Migration** | `0004_ai_usage.sql` — `ai_user_state`, `ai_usage_daily` (additive, no change to existing tables). |
| **Dependencies** | P0 model decision (a provisional id is enough to start); B-1 (plan) for CPU expectations. |
| **Risks** | CPU on Workers Free; the vitest runtime calling real Workers AI if the fake is not wired (guard: tests fail if `AI_PROVIDER !== 'fake'`). |
| **Acceptance** | Unauthenticated → 401; no consent → 403 `ai_consent_required`; caps enforced exactly at the boundary; budget exhaustion → `ai_quota_exceeded` (`scope: global`); invalid model output never reaches the client; logs contain no content (asserted); `AI_ENABLED=false` → 503 `ai_disabled`. |
| **Automated tests** | `ai.test.ts`: auth, consent, quota (per user and global), burst, validation, output repair, error mapping (3036 / 3040 / 5028 via fake), cross-user isolation of usage rows, log hygiene. Extend `smoke-remote.mjs`. |
| **Device scenarios** | none yet (API-level) |
| **Estimate** | 4–5 days |
| **Cloudflare cost** | Free-allocation Neurons for staging smoke tests only (a handful of requests). |
| **Approvals** | A-1 (add binding + apply migration + deploy to **staging**). |

## P2 — Khayoota chat

| | |
|---|---|
| **Scope** | Rebrand the assistant; new `ask()` contract and reply rendering; consent sheet; remaining-quota line; clear chat; error/unavailable/limit states; offline helper relabelled; guest gate; AR/EN strings; scope and persona. No streaming unless P0 latency demands it. |
| **Reuse** | `AssistantPage`, `AssistantService` (demo rules kept as offline helper), `AppStore.chat`, `gz-sheet`, `UiFeedback`, `.gz-msg`, `ApiClient`, `I18nService`. |
| **Likely files** | `src/app/core/ai/assistant.service.ts`, `core/ai/khayoota.types.ts` (new), `core/api/api.types.ts`, `features/ai-assistant/assistant.page.ts` (+ split template), `core/models/models.ts` (`ChatMessage`), `core/state/app.store.ts` (`setChat`), `core/i18n/strings.ts`, `layout/tabs-layout/tabs.config.ts` + its specs, onboarding slide copy. |
| **Backend / migrations** | none beyond P1 |
| **Dependencies** | P1; name decision (D-9 / B-5). |
| **Risks** | Arabic tone; over-long replies; users reading "AI" as authoritative. |
| **Acceptance** | Chat gate met in benchmark; all 6 states of UX §3.12–3.14 reachable and correct; RTL/LTR correct; no layout shift with the keyboard; suite passes with **and** without an API URL. |
| **Automated tests** | First specs for `AssistantService` and `AssistantPage` (fake `ApiClient`, real `AppStore`): happy path, each error code → state, consent flow, guest gate, history cap, clear chat. Tab config specs updated. |
| **Device scenarios** | Chat in Arabic and English; keyboard + safe areas; offline toggle mid-conversation; limit reached; kill switch flipped while the app is open. |
| **Estimate** | 3–4 days |
| **Cloudflare cost** | Usage-priced inference (see `security-privacy-cost.md` §6). |
| **Approvals** | A-4 (enable `AI_ENABLED` for testers on staging). |

## P3 — Project-aware assistance

| | |
|---|---|
| **Scope** | `buildKhayootaContext` from `trackerView` (pinned revision, active piece, current round, neighbours, unfinished pieces); context card; entry points in Project Details and Tracker; route inputs; citations; first three actions (`tracker.openCurrentRound`, `project.openPart`, `learn.explainStitch`) with the validation pipeline; fix the existing live-pattern inconsistency. Flows A, C, D. |
| **Reuse** | `AppStore.trackerView`, `parsePattern`, `patternContext`, `patternStats`, `nextUnfinished`, `instanceLabel`, `TrackerNavigator.open`, `TERMS`, `VIDEOS`. |
| **Likely files** | `core/ai/khayoota-context.ts` (new, pure), `core/ai/action-registry.ts` (new), `features/ai-assistant/*`, `features/projects/project-detail.page.ts`, `features/tracker/tracker.page.html/.ts`, server `services/ai/schemas.ts` (action schemas, id ⊆ context check). |
| **Backend / migrations** | none |
| **Dependencies** | P2 |
| **Risks** | Context larger than the cap for long rounds (truncate deterministically); stale context if the user advances while a reply is pending (tap-time re-validation). |
| **Acceptance** | For a pinned project, Khayoota quotes the **pinned** round, not the live one; multi-piece projects resolve the active piece; an action with an id not in context is never rendered; opening a piece changes no progress; context size ≤ 6 KB in all fixtures. |
| **Automated tests** | Pure-function specs for the context builder (simple / standalone pinned / outdated / collection / retired piece / no project); registry specs: every action × valid, missing target, wrong scope, stale revision; server tests for action sanitising. |
| **Device scenarios** | Open from tracker mid-count and return (timer continuous); switch piece via action; project deleted while its action is still in history. |
| **Estimate** | 3–4 days |
| **Cloudflare cost** | none beyond inference |
| **Approvals** | none new |

## P4 — Image understanding

| | |
|---|---|
| **Scope** | Images on `/v1/ai/chat` (≤ 2); purpose chooser; preview; client resize profiles; server magic-byte sniff and caps; photo reply structure and card; privacy line; "pick from project photos". Flow B. |
| **Reuse** | `readImageFile`, `sniffMime`, `gz-photo`, `SyncService.mediaUrl`, `gz-sheet`. |
| **Likely files** | `features/ai-assistant/*`, `core/utils/image.ts` (size profiles), server `routes/ai.ts`, `services/ai/prompt.ts`. |
| **Backend / migrations** | none (no storage) |
| **Dependencies** | P0 vision gate; P3 |
| **Risks** | Worker CPU with multi-megabyte JSON; over-confident diagnoses; photos of people. |
| **Acceptance** | Vision gate met; no reply states a stitch count from a photo; 8 MB / wrong-type / 3-image attempts fail with designed messages; no image persists anywhere (verified by inspecting IndexedDB, R2 object count and logs). |
| **Automated tests** | Size/count/MIME boundary tests on the server; client spec for the resize profiles; reply-shape specs. |
| **Device scenarios** | Camera and gallery on the physical Android phone; low light; a 12-MP photo; rotation; permission denied; back button during upload. |
| **Estimate** | 3–4 days |
| **Cloudflare cost** | inference only |
| **Approvals** | A-5 if CPU measurements show Workers Paid is required first. |

## P5a — Converter fixes (independent, small)

Arabic magic ring and `في MR`; plural Arabic stitch names; spaced ranges (`5 - 7`); `2 <stitch> in each st`; "Start / Foundation" lines as notes. Files: `src/app/core/domain/smart-parser.ts`, `smart-parser.spec.ts`. Acceptance: the probe table in `pattern-extraction-pipeline.md` §7 flips to the expected statuses, all existing specs still pass, the `ballAr` baseline becomes 10 rounds validated. **Estimate 1–1.5 days. No Cloudflare impact, no approval.**

## P5 — Image to pattern

| | |
|---|---|
| **Scope** | `POST /v1/ai/extract`; transcript schema; source classification; on-device conversion; confidence merge; Smart Import seed + banner + line flags + source viewer; preview card; `pattern.createDraft`; finished-object handling; copyright notice. Flow F. |
| **Reuse** | `convertPatternText`, `convertPartText`, `SmartImportPage`, `ImportDraftService`, `AddPatternPage`, `CollectionEditorPage`, `Pattern.sourceText`, `source: 'image'`. |
| **Likely files** | server `routes/ai.ts`, `services/ai/schemas.ts`; client `features/patterns/import-draft.service.ts` (seed), `smart-import.page.ts`, `core/ai/draft-merge.ts` (new, pure), `features/ai-assistant/*`. |
| **Backend / migrations** | none |
| **Dependencies** | P0 extraction gates (per input type); P4; P5a strongly recommended first. |
| **Risks** | Hallucinated rounds; long outputs truncated; users trusting an unreviewed draft; copyright. |
| **Acceptance** | Extraction gates met for each enabled input type; no path saves without the editor's Save; AI-read rounds without a checksum are never "Validated"; abandoning discards the draft; a finished-object photo never produces an "extracted" pattern. |
| **Automated tests** | Pure specs for the merge rule (every row of the confidence table); Smart Import seed specs; server transcript validation (extra fields stripped, >400 lines, missing fields); e2e: transcript fixture → review → editor populated and dirty. |
| **Device scenarios** | Printed page, handwritten page, screenshot, two-page pattern, chart, finished toy; Arabic and English; cancel at each step; rotate device in review. |
| **Estimate** | 5–7 days |
| **Cloudflare cost** | extraction ≈ 3× a chat turn each (estimate) |
| **Approvals** | A-6 (product go for extraction after reading the P0 results). |

**P5b (separate decision, not part of this feature):** chains / skips / slip stitches / turning chains in the strict parser and tracker — ≈ 5–8 days, its own design and regression plan.

## P6 — Agentic UI (completion)

| | |
|---|---|
| **Scope** | Remaining allowlist: `project.open`, `pattern.openReader`, `card.stitchCountCheck`, `card.patternPreview`, `pattern.proposeCorrection`, `project.reviewPatternUpdate`; action state machine and local audit; proposal card on the edit screens. Flow E. No A2UI / AG-UI. |
| **Reuse** | `savePatternEdit`, `saveCollectionEdit`, "Review the update" sheet, `mapCursor`, `.gz-card`, `.gz-note`. |
| **Likely files** | `core/ai/action-registry.ts`, `features/patterns/add-pattern.page.ts`, `collection-editor.page.ts`, `features/projects/project-detail.page.ts`, card components under `features/ai-assistant/cards/` (new). |
| **Backend / migrations** | none |
| **Dependencies** | P3 (registry), P5 (preview/draft) |
| **Risks** | A proposal applied against a newer revision; scope creep towards mutation actions. |
| **Acceptance** | Actions gate (≥ 95 % exact, 0 unsafe); every action has tests for valid / missing / stale / wrong scope; applying a correction always goes through revision + pin; tracker progress unchanged by any action. |
| **Automated tests** | Registry matrix; edit-screen proposal specs; regression: revision count +1, projects pinned, cursor untouched. |
| **Device scenarios** | Propose → apply → save → "Review the update" on a project with progress; tap an old action after the pattern changed. |
| **Estimate** | 3–4 days |
| **Approvals** | none new |

## P7 — Crochet knowledge

| | |
|---|---|
| **Scope** | Card format + CI checks; base pack; keyword/structured lookup; card citations; retrieval eval. Vector search only if the retrieval gate fails. |
| **Reuse** | `TERMS` as seed; `normalizeLetters` and the parser's synonym tables. |
| **Likely files** | `apps/api/knowledge/*.json` (new), `apps/api/src/services/ai/knowledge.ts` (new), tests. |
| **Backend / migrations** | none for the keyword stage. (Vectorize index + binding only if adopted — separate approval.) |
| **Dependencies** | A crochet-literate author/reviewer; P2. |
| **Risks** | Content quality and rights; translation-sounding Arabic. |
| **Acceptance** | Retrieval gates in `rag-knowledge-base.md` §6; only reviewed cards served; every card has both languages and a named reviewer. |
| **Estimate** | 3–5 days engineering + ≈ 5–8 days content |
| **Cloudflare cost** | none for the keyword stage |
| **Approvals** | A-7 only if Vectorize is proposed later. |

## P8 — QA & release hardening (runs alongside every release)

| | |
|---|---|
| **Scope** | Full `qa-test-matrix.md`; physical-device pass; cross-account isolation; load/CPU measurement on staging; budget and kill-switch drills; privacy policy and store text; runbook (how to read the ledger, switch model id, disable AI). |
| **Reuse** | `scripts/smoke-remote.mjs`, `e2e/*.e2e.ts`, release process in `docs/release-qa/report.md`. |
| **Acceptance** | All release gates green; a recorded device QA report; budget drill shows safe shutdown; rollback rehearsed (`AI_ENABLED=false`). |
| **Estimate** | 4–6 days across releases |
| **Approvals** | A-8 (production: there is no production Worker today — creating one is its own decision). |

---

## Dependencies at a glance

```
P5a ───────────────────────────────┐ (independent; any time)
P0 ──► P1 ──► P2 ──► P3 ──► P4 ──► P5 ──► P6(rest)
                      └──────────────► P7
P8 accompanies R1, R2, R3
```

## What deliberately is *not* in the roadmap

A second Worker · streaming in R1 · A2UI / AG-UI · Vectorize / AI Search · third-party model fallback · server-side chat history · PDF import · video extraction · mutation actions · subscriptions/billing · an anonymous (guest) AI tier · fine-tuning.
