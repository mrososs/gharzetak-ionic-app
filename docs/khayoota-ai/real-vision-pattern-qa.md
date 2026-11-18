# Khayoota AI — Real vision, pattern extraction & multi-image QA (HONOR phone, real Gemma 4)

Date 2026-11-18. Model `@cf/google/gemma-4-26b-a4b-it` through `env.AI` on staging, allowlisted tester only, attached
from the Android photo picker in the real app. Source images: the user-supplied Arabic giraffe sheet and the user-approved
6-image chicken pattern folder (copies placed in the phone's Download/GharzetakQA for picking). Extracted pattern text and
transcripts are kept **local** (third-party published patterns — not committed). Only counts and short examples here.

Labels: **REAL MODEL PASS/FAIL** (model output), **DETERMINISTIC PARSER PASS**, **APPLICATION UI PASS**, **FAKE TEST PASS**,
**BLOCKED**. This is a pilot (3 sources, 7 vision requests), **not** the 52-case vision benchmark — no vision gate is passed.

## 1. Requests (server log: provider `workers-ai`, safe metadata only)

| ID | What | Request | Images | Model latency | Tokens in/out | Neurons | Result |
|---|---|---|---|---|---|---|---|
| G1 | Giraffe sheet → extract | (504) | 1 | >45 s | — | reserved | FAIL: 45 s timeout → fixed (120 s extract, 4000 out) |
| G2 | Giraffe sheet → extract | 9b1c8ddc | 1 | 52.7 s | 910 / 2369 | 73 | 200, 61 lines |
| G3 | Giraffe sheet → extract (2nd sample) | 1d125f63 | 1 | 92.9 s (+repair) | 910 / **4000 (cap)** | 118 | 200, 60 lines, 141.8 s end-to-end |
| C1 | Chicken, 4 pages in ONE request | 807378e5 | 4 | 16.7 s | 1686 / 1570 | 59 | 200, all 4 pages present |
| P1 | Chicken photo + bunny project open | 9cbc04d0 | 1 | 5.7 s | 3775 / 248 | 42 | MODEL FAIL (called it the bunny) |
| P2 | Same after prompt v4 | 6890b545 | 1 | 25.2 s | 3901 / 230 | 42 | REAL MODEL PASS |
| P3 | 3 photos together, no project | 2205893d | 3 | 8.8 s | 3961 / 318 | 45 | REAL MODEL PASS (attribution flaw) |

## 2. Giraffe sheet (single image) — extraction quality vs a provisional manual reference

Reference (read by eye, provisional): 8 sections + the «تكوين الرقبة» sub-step, 27 round lines (before range expansion).

| Check | G2 / G3 |
|---|---|
| Classified as written pattern (not finished object) | ✔ / ✔ |
| Title | «باترون زرافة كروشيه» exact / exact |
| Sections detected | all 8 + «تكوين الرقبة» / same, but «الأرجل» read as «القدم» |
| Quantities | (4 قطع), (قطعتان) ×2 kept in headings → parser: 4, 2, 2 ✔ (after the dual fix) |
| Colour changes, assembly notes | all present (yarn colour, change to yellow, cut long tail, stuffing, repeat) ✔ |
| **Opening bracket of repeat groups** | dropped on all 8 «(… ، تزايد/تناقص) ×6» lines (RTL) — REAL MODEL FAIL |
| Misread repeat | horns R3 «(3 حشو، تناقص) ×1» → «حشو، تناقص) 4×» |
| Invented lines | 2 (a yarn note under الفم, a spots «R2») — hallucination |
| Misread words in notes | تحدث/نحدد, ونفلق/ونغلق, «8 أعمال بلغة» for «8 أعمدة بلفة», «بالكامل» for «بالفيبر» |
| Legibility honesty | 61/61 "clear" (G2), 59/60 (G3) despite the errors — **incorrectly confident** |
| Arabic OCR | headings/numbers/totals largely right; systematic bracket loss; ~5 word-level errors in notes (no CER computed — provisional reference) |

Deterministic layer on G3 (after the fixes): 9 parts, 48 rounds → **2 validated, 34 Needs Review, 12 Unsupported** (DETERMINISTIC
PARSER PASS: nothing mis-read was validated — every bracket loss is `ai-unbalanced`, every «حشو» line Needs Review (P5a rule),
the ear construction and «غرز حشو ثابت» stay Unsupported/P5b).

## 3. Chicken pattern — 4 pages in one request (multi-image)

All 4 images reached the model in one call; every line carries its page (1–4); none omitted. Model output: 4 parts (Body + head,
Wings «make two», Comb, Beak), 19 round lines, assembly steps kept as assembly. Faithful English, totals kept.
Deterministic: **28 rounds, 26 validated, 2 Needs Review, 0 Unsupported** — both flags are real count jumps after "fold the piece
in half" steps (DETERMINISTIC PARSER PASS). `warnings`: non-pattern-text ×4 (photos on the pages). No title (the pages have none).
Wings quantity 2 ✔. Not run (limit, budget): 2-page, duplicate page, missing page, wrong order, unrelated patterns, injection
image — prompt rules and warning codes exist; **multi-image accuracy beyond this one 4-page set is not claimed.**

## 4. Preview card → Pattern Collection editor (APPLICATION UI PASS)

Phone: tray (1/4 → 4/4, remove ✕, reorder by real taps verified, camera tile) → send → «لقيت «باترون زرافة كروشيه» 🧶 — فيه N أجزاء …»
→ card with thumbnail, parts × quantity, validated / needs-review / unsupported counts, incomplete-reading warning, «إضافة إلى
الباترونات» + «مراجعة الباترون» (rounds with status, per-round 📷 source photo, notes) → tap → **existing** collection editor
`/tabs/home/collections/new` with title, parts, quantities, rounds and notes prefilled (unsaved) → «إلغاء» → existing
**unsaved-changes guard** → «تجاهلي التعديلات» → back in Khayoota; IndexedDB: `patterns` 3 / `collections` 4 unchanged, no
giraffe anywhere except the chat sentence. Save of a disposable draft: **not done** (would add a pattern to the tester's real
account) — BLOCKED by choice. Project/tracker data unchanged throughout.

Defects found here and fixed (with tests): 504 timeout; notes turned into parts; wrapped ear instruction → 4 fake parts;
numbered-list rounds unrecognised; source photo lost on normalised lines; parser vocabulary (السطر، تزايد، تناقص، full stop before
total, «قطعتان»); tray number hidden under the reorder button.

## 5. Photo troubleshooting (real crochet-work photos from the approved folder)

| Case | Result |
|---|---|
| P1 chicken photo, bunny project open | Said «شغالة على جسم الأرنوبة» — followed CONTEXT, not the image. REAL MODEL FAIL |
| P2 same after prompt v4 («photo first») | «الصورة فيها فراخ مش أرنوبة»; observation: 4 photos of a crochet chicken (beige, brown, white); cannot confirm counts; still points to the real project's R31 issue with the correct action. REAL MODEL PASS |
| P3 three photos, no project | Described all three (chickens, body page, wing page + brown wing); causes vs cannot-confirm separated; no action. Numbered the collage's 4 sub-photos as images 1–4 (6 "images" for 3 photos) — source-attribution flaw |

Not covered: a real photo of the tester's own work-in-progress on the bunny (none supplied); "this part is wider than expected"
on an actual defect. BLOCKED pending an approved photo.

## 6. Usage, cost and privacy

Account-level Workers AI on 2026-11-18 (all models, incl. the earlier pilot): **59 inferences, 2,821.7 Neurons** (Gemma 48 /
1,536.7; Qwen 6 / 927.5; Llama 5 / 357.5) — 28 % of the 10,000 free daily Neurons; staging's ledger 1,349 for its 32 calls
(measured ≈ 1,195; the ledger is conservative). No paid inference, no plan/billing change, no AI Gateway. Images are resized on
the phone (EXIF dropped), sent inline, never stored in D1/R2/logs or chat history; the Worker log has no content fields.

## 7. Remaining limitations

1. Dense single pages can hit the 4,000-token output cap (G3: 92.9 s + repair, 141.8 s total, close to the 150 s app ceiling) —
   needs per-page chunking or a higher cap before any release.
2. Gemma 4 drops the RTL "(" of Arabic repeat groups and is over-confident (always "clear"); the parser contains it, but the
   user must fix those lines in the editor.
3. Hallucinated lines (2 on the giraffe) are not detectable deterministically.
4. Multi-image beyond one 4-page set, duplicate/missing/out-of-order pages and image-borne injection: not measured live.
5. Vision/extraction gates in `benchmark-plan.md` are NOT passed; keep these tester-only.
