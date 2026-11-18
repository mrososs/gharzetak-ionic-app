# Khayoota AI — Implementation Progress

Branch `feat/khayoota-ai-implementation` (worktree `.claude/worktrees/affectionate-bhabha-5ddac5`), cut from `development` @ `88db9bc`.
Nothing merged, no PR, nothing deployed, no billing change.

## 1. Phase status

| Phase | Status | Commit | Notes |
|---|---|---|---|
| P0 free-model benchmark | **Pilot done** (not the full 52-case benchmark) | `8fcd7b4` | 27 live requests, 1,626.5 measured Neurons, synthetic data. Gemma 4 chosen provisionally. `benchmark-results.md`, `model-decision.md` |
| P1 secure backend | **Done, local only** | `7623691` | `/v1/ai` behind sign-in, consent, kill switch, flags, per-user + global caps, Neuron budget, fake provider, safe logging, additive migration 0004 (local D1). `backend-implementation-report.md` |
| P2 Khayoota chat | **Done** | `45cacd7`, `8b49d41` | Renamed tab/tile to خيوطة / Khayoota, consent sheet, hosted chat, friendly errors + retry, labelled offline helper fallback, guest hint, status badge |
| P3 project context + 3 actions | **Done** | `45cacd7` | Pinned-revision context, calculator facts, typed registry (`tracker.openCurrentRound`, `project.openPart`, `learn.explainStitch`) re-validated at render and tap; entry points from tracker, project detail, pattern reader |
| P4 vision (photo questions) | **Built, behind flag (OFF)** | `7623691`, `45cacd7` | Gate not met (no real photos / raters). `AI_VISION_ENABLED=false` on staging |
| P5 image → pattern extraction | **Built, behind flag (OFF)** | `7623691`, `45cacd7` | Transcript-only model output → real Smart Parser → AI caps → unsaved draft in the real editor. Handwriting untested. `AI_EXTRACT_ENABLED=false` |
| P6 agentic UI | **Done as typed actions only** | `45cacd7` | Fixed components render structured parts; no A2UI / AG-UI, no model HTML/JS, no silent saves, no deletes, no counter/progress changes |
| P7 knowledge pack | **v1 done** | `8fcd7b4` | 18 curated cards in the system prompt (`knowledge.ts`); no vector search (not needed at this size) |
| P8 hardening / QA | **Partly done** | this commit | Unit + API + build + local browser run done; real-device hosted test blocked on staging deploy. `qa-implementation-report.md` |

## 2. Safety rules as implemented

- The model **explains**; the deterministic parser **counts** (calculator facts from the device; extraction output is only a transcript).
- An AI-read round can only get **worse** status from AI caps, never better; P5b syntax stays Unsupported.
- Context always uses `store.trackerView(project)` — the **pinned** pattern revision, never the latest edit.
- Only the current project's context is sent, only when the user asks from it; never all projects.
- Actions: 3 allowlisted, ids must come from the request's own context, re-checked against the local store twice.
- Nothing is saved from AI output without the user pressing Save in the normal editor.

## 3. Remaining P5b limitations (unchanged by this work)

Row/garment syntax from `p5a-parser-implementation-report.md` §6 stays **Unsupported** or **Needs Review**: chains as stitches and foundation chains, skips, turning chains ("counts / does not count as a stitch"), slip stitches and slip-stitch joins, working into chain spaces, joins between garment pieces, rows vs rounds, `*…*` repeats, front/back-loop stitches, shells / clusters / popcorns. AI extraction does not make any of them valid; the preview shows them with a reason. P5b should be its own parser/tracker workstream.

## 4. Staging rollout

Executed on 2026-11-18 with approval (backup → migration 0004 → deploy AI-off → AI on for the verified tester only). Current state, limits and operating notes: [`release-status.md`](release-status.md).

## 5. Local-only files created (git-ignored, not committed)

`apps/api/.dev.vars` (random local `BETTER_AUTH_SECRET`), worktree `.env` (public values), `.claude/launch.json` entries `bench-fixtures` / `gharzetak-api`, benchmark `fixtures/` and `results/`.

## 6. Real Android device

Superseded: the first attempt (phone locked, nothing tested) was followed by a full real-device pass with real Gemma 4 — see [`real-android-ai-qa.md`](real-android-ai-qa.md) and [`real-vision-pattern-qa.md`](real-vision-pattern-qa.md). Hosted Khayoota passed on the HONOR for the allowlisted tester; limitations in [`release-status.md`](release-status.md) §3.
