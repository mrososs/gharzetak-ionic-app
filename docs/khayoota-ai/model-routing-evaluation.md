# Khayoota AI — Hybrid model routing evaluation (Gemma 4 vs Qwen 3.8)

Date 2026-11-18 (UTC 23:20–23:40). Real Workers AI inference through `docs/khayoota-ai/benchmark/vision-compare.mjs` (production
prompts, JSON schemas and sanitising; same request profile as the Worker), identical images for both models, `temperature 0`,
Gemma `enable_thinking:false`, Qwen `reasoning_effort:'low'` + `enable_thinking:false` (0 reasoning tokens reported). Scored by
`vision-score.mjs` with the app's own Smart Parser pipeline (`previewFromTranscript`). Hard caps: 6 requests, 3,500 estimated
Neurons; no retries. Raw transcripts, images and the provisional giraffe reference stay **local** (git-ignored).

**Scope and honesty.** This is **one run per case, three inputs** (giraffe sheet, 4-page chicken pattern, one chicken-work photo). It
cannot support general quality claims; the giraffe reference is a provisional manual reading. Gemma varies run to run
(see §4), so a single comparison is indicative only.

## 1. Results

| | Gemma 4 26B | Qwen 3.8 27B |
|---|---|---|
| **Giraffe** — latency / tokens in·out / Neurons | 48.1 s · 910 / 2,314 · **71** | 97.6 s · 1,894 / 3,064 · **969** (13.6×) |
| Valid JSON | yes | yes |
| Sections found / quantities (legs ×4, ears ×2, horns ×2) | 8 / ✔ | 8 / ✔ |
| Text similarity to the provisional reference (mean) | **0.920** (36 exact, 11 misread, 3 "missing") | 0.889 (25 exact, 23 misread, 2 "missing") |
| Invented lines | 0 (the earlier 2 did not recur; unmatched lines are the wrapped ear steps and headings that carry the quantity) | 1 (logo text kept as kind `other`) |
| **Arabic repeat groups** («(1 حشو، تزايد) ×6») | **parentheses dropped on 8/8** («1 حشو، تزايد. 6×. (18)» — the group is unreadable for the parser) | **preserved on 7/8** («(1 حشو، زيادة) ×6») |
| Wrong repeat | horns R3 («حشو، تناقص) 4×») | horns R3 («(1× تناقص، حشو). (4)») |
| Other misreads | note words (تحدث/نحدد…), «8 أعمدة بلفة» | «8 أعمة بلفة»; «زيادة» for «تزايد» |
| Marked "clear" | 59/59 | 57/57 (+ warning `multi-column`) |
| Parser (Smart Parser) | 46 rounds: **2 validated · 13 needs review · 31 unsupported** | 48 rounds: **2 validated · 30 needs review · 16 unsupported** |
| **Chicken, 4 pages, ONE request** — latency / Neurons | 30.5 s · **60** | 39.9 s · **609** (10×) |
| All 4 pages read; parts | 4 parts, 19 round lines | 4 parts + 1 spurious part (a Comb step read as a heading), 22 round lines (3 extra) |
| Parser | 28 rounds: 26 validated · 2 needs review · 0 unsupported | 29 rounds: 26 validated · 2 needs review · 1 unsupported |
| **Photo + bunny project context** — latency / Neurons | 5.9 s · **36** | 6.5 s · **214** (5.9×) |
| Says the photo is chickens, not the open project | ✔ | ✔ |
| Follows the app's structure (observations / cannot-confirm arrays) | ✔ (`observations`, `cannotConfirm`, `hypotheses`) | ✘ (text only; none of the three arrays) |
| Extra: speculation | none | suggests "3 dec to reach 3 stitches (not 6)" — unsupported guess |
| Action proposed | `learn.explainStitch` + `tracker.openCurrentRound` (valid) | `tracker.openCurrentRound` (valid) |

Total Neurons for the comparison: Gemma 167 + Qwen 1,792 (account analytics: Qwen 3 calls 1,791). Free allocation today: 5,158 of
10,000 used after this evaluation (3,001 before it, plus the phone smoke test). No paid inference, no billing change.

## 2. Reading the results

- **Qwen's one real advantage is notation fidelity on right-to-left repeat groups** — exactly the failure that makes Gemma's giraffe
  lines Unsupported. Everything else is equal or worse: more misread words, one wrong repeat, one spurious part, no structured
  photo reply, 2× the latency and **6–14× the Neurons**.
- Neither model validates more lines: «حشو» lines stay Needs Review by the P5a rule, and the validated count is 2 for both.
- Latency matters: the Qwen giraffe took 97.6 s against a 120 s extraction timeout and a 150 s client ceiling.
- Cost matters more: ~970 Neurons per dense page would exhaust the staging 3,000-Neuron daily budget in 3 pages and spend ~10 % of the
  account's shared free allocation per page; the upper-bound reservation (4,000 output tokens × 290,909 Neurons/M ≈ 1,164 + input)
  would block a second extraction while one is reserved.

## 3. Decision

| Capability | Model | Why |
|---|---|---|
| Text chat | **Gemma 4** (unchanged) | not evaluated for Qwen: no reason to pay 5–14× for text |
| Photo troubleshooting | **Gemma 4** (unchanged) | Qwen did not follow the observation/cannot-confirm contract and speculated; 6× cost |
| Written-pattern extraction (single / multi-image) | **Gemma 4** (unchanged) | Qwen's bracket fidelity does not outweigh lower fidelity elsewhere, a spurious part, 10–14× cost and 2× latency on one sample |

**No routing change was made; no staging configuration change is required.** The per-capability variables
(`AI_MODEL_CHAT` / `AI_MODEL_VISION` / `AI_MODEL_EXTRACT`, allowlisted to Gemma 4 and Qwen 3.8) already allow independent routing if
future evidence justifies it. A second model must not be called automatically (that would double inference).

## 4. Findings that matter more than the model choice

1. **Gemma's output varies run to run on the same page.** Three giraffe extractions: 2,314 tokens (valid), 2,369 and 4,000 tokens
   (cap reached: truncated, invalid JSON, 93 s). Brackets were dropped in every run. The 4,000-token cap and the 120 s timeout are
   therefore a live reliability risk for dense pages (known limitation; needs per-page chunking before any release).
2. **An explicit prompt instruction did not fix the dropped "(".** One extra Gemma run with a dedicated repeat-group rule restored the
   multiplier order but still dropped every opening parenthesis (and hit the 4,000-token cap). A prompt change is not the fix.
3. **My bracket check under-reports.** Counting unbalanced brackets misses lines where *both* brackets were dropped (Gemma's «1 حشو،
   تزايد. 6×. (18)»); the parser still keeps them out of "validated", but the metric should also flag the pattern «`, … ×N`
   without any group».
4. Input encoding matters: the phone sends a canvas re-encoded JPEG, this harness sent the original file; results were not identical
   between the two paths for the same model.

## 5. Recommended next steps (not done here)

- Parser-side repair for the dropped-opener pattern (`X, Y) ×N` / `X, Y. N×`): propose the reconstructed group as **Needs Review**
  (never Validated) so the user fixes one character instead of retyping the round — cheaper than a second model call.
- Per-page extraction (one image per request, merged by page) to bound output tokens and latency; or raise the cap only with a
  matching budget change.
- If a second opinion is ever wanted, use Qwen **only** on lines flagged `ai-unbalanced`/Unsupported after the first pass, behind
  the same allowlist and budget — measured on at least the 52-case benchmark first.
- Re-run this comparison with several samples per case and the real handwriting/photo sets before any change.
