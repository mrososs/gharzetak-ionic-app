# Khayoota AI — Image-to-Pattern Extraction Pipeline

> Design only. The pipeline reuses the existing deterministic Smart Pattern Parser; nothing was implemented and no model was run.

---

## 1. Principle: the model reads, the parser decides

The app already has a rule-based converter that turns messy Arabic/English crochet text into the strict notation the tracker executes, and labels every round **Validated / Needs Review / Unsupported** — the exact three states this feature must show (`src/app/core/domain/smart-parser.ts:28`). Its guarantees are the ones we want for AI too: totals are only ever *calculated*, never invented; unknown text is kept verbatim (:16-20).

So the model is used for the one thing code cannot do — **turning pixels into text** — and nothing else:

```
image(s) ──► VLM ──► faithful transcript (+ legibility flags)       ← model-authored, untrusted
                         │
                         ▼
              convertPatternText()  on the device                    ← deterministic, existing
                         │   normalise → classify → tokenise → parse → arithmetic → strict re-parse
                         ▼
              statuses, totals, warnings, strict text                ← authoritative
                         │
                         ▼
              final status = worst(parser status, legibility)        ← never upgraded by the model
```

The model **never** outputs stitch totals that the app trusts, never decides a round is valid, and never writes the strict notation that the tracker will run.

---

## 2. Four kinds of picture — handled differently

The first field the model returns is the source class. The app's behaviour then diverges:

| Class | What it is | What Khayoota does | Highest status possible |
|---|---|---|---|
| **A — written instructions** | A photo/screenshot of typed or handwritten rounds | Full pipeline below | Validated (per round, by the parser, if legible and checksummed) |
| **B — stitch chart** | Symbol diagram | Explain the symbols; optionally transcribe rounds, **each capped at Needs Review** ("read from a chart — check every round") | Needs Review |
| **C — finished object** | A photo of crocheted work | **No extraction.** Offer (1) a description of visible construction features, or (2) a *suggested reconstruction* that is permanently labelled "Khayoota's guess — not the original pattern" and capped at Needs Review. Never the word "extracted". | Needs Review, labelled as a guess |
| **D — tutorial / demonstration frame** | A step photo or video frame | Explain what the step shows; no pattern draft | — |
| other | Not crochet | Polite redirect | — |

Why C is special: a finished object does not reveal its round structure, starting method, hidden increases/decreases or stitch counts with any reliability. Presenting a guess as an extraction would be a false claim — and for someone else's design it would also be a copy of that design made without the pattern (see `security-privacy-cost.md` §5).

---

## 3. Pipeline, step by step

| # | Step | Where | Detail |
|---|---|---|---|
| 1 | Input validation | device | 1–4 images; source ≤ 8 MB each; jpeg/png/webp/heic/heif (`utils/image.ts`). Or pasted text ≤ 20,000 chars. |
| 2 | Resize / compress | device | `readImageFile(file, 1568, 0.85)`; if > 700 KB → q 0.7 → 1280 px. Dense multi-column pages: advise "one column per photo". |
| 3 | EXIF / metadata | device | Canvas re-encode yields a clean JPEG (no GPS/device data). |
| 4 | Private handling | device ↔ Worker | Inline in an authenticated HTTPS POST; in memory only; not stored, not logged (`multimodal-architecture.md` §4). Thumbnails for the review screen stay on the device, in memory. |
| 5 | Vision reading | Worker → model | Prompt: classify the source, then transcribe **line by line, exactly as written** — same digits, same abbreviations, same language, no translation, no correction, no completion. Mark each line `clear / uncertain / unreadable`. |
| 6 | Source preservation | Worker → device | The full transcript is returned and later stored as the pattern's `sourceText` (the field already exists: `Pattern.sourceText`, `PatternCollection.sourceText`; D1 `patterns.source_text`) so the original wording is always recoverable. |
| 7 | Notation normalisation | device | Existing `normalizeLine` / tokenizer: Arabic-Indic digits, letter variants, `× * ✕`, UK→US, Arabic stitch names, spelled-out repeats. |
| 8 | Structural parsing | device | Existing classifier: part headings + quantities, round lines, ranges, assembly notes kept verbatim. |
| 9 | Arithmetic validation | device | Existing: calculated vs. written total (`total-mismatch`), round-to-round continuity (`chain`), joins, strict re-parse (`strict-mismatch`). |
| 10 | Confidence classification | device | §5 below. |
| 11 | Review preview | device | The existing Smart Import preview, seeded with the transcript, plus the source photo and AI line flags (§6). |
| 12 | Final confirmation | device | The existing Smart Import "Confirm" (which already asks again if any line is unsupported). |
| 13 | Add / Edit Pattern | device | Existing `ImportDraftService.offer` → Add Pattern or Collection editor opens **populated, dirty and unsaved**. The user presses the editor's Save. |

Steps 7–13 are existing code paths; steps 1–3 are the existing image utility with different parameters. The new parts are step 5 (one endpoint + prompt), step 10's merge rule, and a seed entry for step 11.

---

## 4. Output structure — versioned draft schema

Two layers, deliberately separate.

### 4.1 `PatternTranscriptV1` — what the model returns (validated with Zod on the server)

```ts
interface PatternTranscriptV1 {
  schema: 'gz.pattern-transcript';
  v: 1;
  sourceClass: 'written' | 'chart' | 'finished-object' | 'tutorial' | 'other';
  title: string | null;                        // only if written in the source
  language: 'ar' | 'en' | 'mixed';
  terms: 'us' | 'uk' | 'unknown';              // as indicated by the source, not assumed
  lines: TranscriptLine[];                     // reading order, ≤ 400
  warnings: { code: TranscriptWarning; lineIndex?: number; note: string }[];
}
interface TranscriptLine {
  page: number;                                // 1-based index of the input image
  text: string;                                // verbatim; ≤ 300 chars
  kind: 'title' | 'part-heading' | 'round' | 'assembly' | 'note' | 'other';   // a hint only; the parser re-classifies
  legibility: 'clear' | 'uncertain' | 'unreadable';
  uncertain?: string[];                        // the exact fragments it was unsure about, e.g. ["24", "inc"]
}
type TranscriptWarning =
  | 'cropped' | 'blurred' | 'rotated' | 'handwriting' | 'crossed-out' | 'multi-column'
  | 'chart-no-legend' | 'missing-rounds' | 'non-pattern-text' | 'possible-instruction-in-source';
```

What is **absent on purpose**: stitch tokens, repeat structures, calculated totals, any "valid" flag. If the model returns extra fields, Zod strips them.

`possible-instruction-in-source` is raised when the image/text contains something that reads like an instruction to an AI; that line is kept as `kind: 'other'` and shown to the user as non-pattern text (it will be `unsupported` in the parser anyway).

### 4.2 `PatternDraftV1` — what the app builds from it (device, deterministic)

Everything the brief asks the draft to contain, and where each field comes from:

| Field | Source |
|---|---|
| `schema: 'gz.pattern-draft'`, `v: 1` | app |
| Pattern title | transcript `title` → `ConversionResult.collectionName`; editable |
| Language | transcript |
| US/UK terminology | `detectTerms` (parser) cross-checked with the transcript's `terms`; a disagreement becomes a warning and the user picks (the Smart Import screen already has an auto/US/UK control) |
| Source type | `'image'` (already a `PatternSource` value) + `sourceClass` |
| Original extracted text | transcript lines joined → `sourceText` |
| Sections / parts and quantities | `ConversionResult.parts[]` (`name`, `kind`, `quantity`, `quantityToConfirm`) |
| Row / round labels | `ConvRound.n` (+ the original line) |
| Stitch tokens | the parser's AST, surfaced as the strict line `ConvRound.normalized` |
| Repeat expressions | same — `( … ) x N` preserved by `emitBody` |
| Expected stitch totals | `ConvRound.expected` (written) and `ConvRound.calculated` (computed) — both shown |
| Assembly notes | `ConvPart.notes[]`, verbatim |
| Warnings | `ConvRound.messages[]` + transcript `warnings[]` |
| Evidence references | per round: `{ page, lineIndex }` back to the transcript line and its source photo |
| Confidence classification | §5 |
| Editable fields | name, quantity, each normalised line, assembly notes — already editable in Smart Import, re-checked through `convertPartText` on every change |

`PatternDraftV1` is a view over `ConversionResult` + evidence; it then maps 1:1 onto the existing `ImportDraft { target, collectionName, sourceText, parts: DraftPart[] }` consumed by the editors. **No new persisted format** is introduced, and AI output cannot be incompatible with the editor because it never reaches the editor except through the converter.

---

## 5. Confidence rules

```
status(round) = worst( parserStatus(round), legibilityCap(line), sourceCap(sourceClass) )
```

| Input | Effect |
|---|---|
| Parser says `unsupported` | **Unsupported** — original text kept, no automatic counting. |
| Parser says `needs-review` (total mismatch, chain break, join, ambiguous word, assumed stitch) | **Needs Review**, with the parser's own bilingual message. |
| Line `legibility: uncertain` or any `uncertain` fragment | cap at **Needs Review** ("Khayoota wasn't sure about: 24"). |
| Line `unreadable` | **Unsupported**, text shown as "…unreadable…", never guessed. |
| Source class B (chart) or C (guess) | cap at **Needs Review** for every round. |
| AI-read round with **no written total** | cap at **Needs Review**. Reason: with no checksum on the page, a misread digit (`2sc` ↔ `3sc`) is undetectable. The cap is lifted when continuity holds with the previous round **and**, where one exists, the next round. (Today's converter treats a missing total as `validated` with an info message — fine for text the user typed herself, too generous for text a model read.) |
| Parser `validated` **and** line `clear` **and** (written total = calculated, or continuity holds as above) | **Validated** |

Consequences:

- **"Validated" never rests on model confidence.** It needs a deterministic check that would have failed had the model misread the line.
- The model can only make a status *worse*, never better.
- Rounds are never invented: a range or count that is missing in the transcript stays missing. Gaps in round numbering raise `missing-rounds`.
- Written totals are never "fixed". `(sc, inc) x 6 (20)` stays `[20]` with the mismatch warning (parser code `total-mismatch`).

---

## 6. Review experience (reusing Smart Import)

The existing `SmartImportPage` already provides: per-part cards with editable name / quantity / normalised text / assembly notes, a per-round status with messages, three views (preview / original / normalised), status-count badges, and a confirm that double-checks unsupported lines.

Additions needed (small, specified in `product-ux-and-branding.md` §6):

1. A **seed entry**: open Smart Import with text already filled in and converted. Today the page's text signal starts empty and there is no input for it [Verified]. Mechanism: extend `ImportDraftService` with a one-shot `offerSeed({ text, terms, origin: 'ai', lineFlags, pages })` / `takeSeed()` — same in-memory, one-shot pattern as `offer` / `take`.
2. An **origin banner**: "Read from your photo by Khayoota — check it against the original."
3. **Line flags**: an "unsure" marker on AI-uncertain lines, listing the fragments.
4. **Source viewer**: tap a round to see the photo it came from (thumbnail held in memory; pinch-zoom).
5. Buttons: **Edit** (already inline), **Add to Patterns** (the existing Confirm), **Cancel**.

Conversation side (matching the brief's example):

> «لقيت باترون فيه 12 دور، وفيه دورين محتاجين مراجعة. تحبي أجهزهولك في غرزتك؟»

The numbers in that sentence are **filled in by the app from the converter's `counts`**, not written by the model — the chat line is a template around deterministic values. Below it: a `card.patternPreview` and the `pattern.createDraft` button. Tapping opens the review screen; confirming opens the real Add Pattern editor with the draft populated. **Nothing is saved until the user presses Save in the editor.**

Targets: one part → Add Pattern (`target: 'pattern'`; the editor takes `parts[0]`); several parts → Collection editor (`target: 'collection'`). Smart Import already redirects when the user switches target [Verified `smart-import.page.ts:253-279`].

---

## 7. What the existing parser cannot represent (and what that means)

[Verified two ways on 2026-11-18: by reading `pattern-parser.ts` / `smart-parser.ts`, and by **running the real `convertPatternText`** (bundled read-only into a temp folder) on probe lines. "Result" is the actual status returned.]

| Construct | Probe | Result today | Effect on extraction |
|---|---|---|---|
| Chains, slip stitch | `R1: ch 3, sl st to join` | `unsupported` | Kept verbatim. Flat/row garments (like the Bunny Dress yoke) will be mostly "kept as text". |
| Front/back loop only | `R2: 6 sc in BLO (6)` | `unsupported` (code `loop`) | same |
| `*…* repeat from *` | `R2: *sc, inc* repeat from * 3 times (9)` | `unsupported` | same |
| "2 stitches in each stitch" | `R2: 2 sc in each st (12)` | `unsupported` (but `inc in each st` → validated, 12) | A very common phrasing is lost. |
| **Arabic magic ring** | `R1: 6sc في حلقة سحرية (6)` | `unsupported` | `MR_RE` is English-only (`smart-parser.ts:145`). |
| **Arabic "in" before MR** | `R1: 6sc في MR (6)` | `unsupported` (`6sc in MR` → validated) | The Arabic preposition followed by `MR` yields a dangling "in". |
| **Arabic plural stitch name** | `R1: 6 غرز قصيرة in MR (6)` | `unsupported` (singular `غرزة قصيرة` → validated) | Counts above 2 are naturally written with the plural. |
| **Spaced round range** | `الدور ٥ - ٧: ٢٤ غرزة قصيرة (٢٤)` | only R5 emitted, `unsupported` (`٥-٧` without spaces → R5, R6, R7 validated) | Two rounds silently missing from the round list. |
| "حشو" as a stitch | `الدور 2: 6 حشو (6)` | `needs-review` (code `ambiguous`) | Correct, by design. |
| More than two stitches into one stitch (shells, clusters, popcorn) | — | not supported (by code reading) | same |

**The four Arabic rows are the most important finding of this audit for extraction**: with today's converter, round 1 of nearly any Arabic amigurumi pattern ("… في الحلقة السحرية") comes out Unsupported no matter how perfectly a model reads the photo. These are small, deterministic fixes with obvious spec cases — and they improve the existing Smart Paste for every user, AI or not.

This is acceptable for the first release **because the app says so honestly** — Unsupported lines are kept, shown and never counted — but it limits how much of a pattern becomes trackable. Two follow-ups, sized in `implementation-roadmap.md`:

- **P5a (small, do before or with P5):** Arabic magic-ring synonyms and `في MR`; plural `غرز قصيرة` (and plural forms of the other Arabic stitch names); spaced ranges `5 - 7`; `N <stitch> in each st` → the matching `*-inc` for N = 2. Pure functions, one spec case each.
- **P5b (separate decision):** teach the strict parser and tracker `ch` (0 → 1), `sk` (1 → 0), `sl st` and turning chains. This changes `STITCH_IO`, cursor semantics and the revision mapper — a parser/tracker project in its own right, not an AI task.

**The AI must not paper over these gaps** by rewriting a chain row as something the parser accepts.

---

## 8. Worked example — the Bunny Dress summary through this pipeline

Input: the summary from the brief as text (`benchmark/cases.json` → `sharedTexts.bunnyDress`). No source video is available — see `benchmark-plan.md` §7. The "parser today" column is the **actual output of `convertPatternText`** on that text (run on 2026-11-18: 14 rounds — 11 validated, 2 needs-review, 1 unsupported). The "final status" column applies the stricter AI-origin caps of §5 (design, not yet code).

| Line | Parser today (executed) | Final status with §5 caps | Why |
|---|---|---|---|
| Start: ch 43 | **taken as the part heading** — it is not a round line, so it becomes the piece's name | shown as heading text | A quirk worth fixing in P5a (treat "Start / Foundation" lines as notes). Either way the chain is not counted. |
| Row 1: 42 sc | `validated`, calculated 42, `no-total` | **Needs Review** | AI-read, no written total, no previous round, next row unsupported → nothing would catch a misread digit |
| Row 2: armhole chains, skips and increases — 54 | `unsupported` | **Unsupported** | no stitch sequence exists to parse; none may be invented |
| Row 3: 60 sc | `validated` 60 (previous unknown → no continuity check) | **Needs Review** | no checksum, no previous round to agree with |
| Rows 4–7: 60 sc | `validated` 60 each | **Validated** | continuity 60 → 60 holds on both sides |
| Row 8: 60 sc | `validated` 60 | **Needs Review** | the next round does not continue from it |
| Round 9: 120 dc | `needs-review`, code **`chain`** (consumes 120, previous produced 60) | **Needs Review** | the summary gives a total, not the instruction (probably 2 dc in each stitch — not stated) |
| Round 10: 180 dc | `needs-review`, code `chain` (120 → 180) | **Needs Review** | same |
| Rounds 11–14: 180 dc | `validated` 180 each | **Validated** | continuity holds |

Plus three free-text warnings carried from the source notes (turning chain near 01:45; video edit 06:21–07:03; ~3 sc before the waist join at 07:51–08:06). Result: an honest draft where the tracker can count the plain rows and the user sees exactly which rows need their judgement. A "fully validated" Bunny Dress would be a sign that something had been made up.

Note what the deterministic layer already does unaided: it flags rounds 9 and 10 because the arithmetic does not chain — without any model involved.

---

## 9. Edit Pattern integration (corrections to an existing pattern)

When Khayoota or the deterministic validator notices an inconsistent round in a pattern the user already owns:

1. Khayoota proposes `pattern.proposeCorrection { target, roundN, proposedLine, reason, rev }`.
2. The app re-parses `proposedLine` with the strict parser; if it does not parse, the proposal is shown as text only.
3. The edit screen opens with a proposal card: current line, proposed line, and the deterministic consequences (new total, continuity with neighbours).
4. "Apply to editor" puts the line into the form (dirty). The user saves.
5. Saving goes through `AppStore.savePatternEdit` / `saveCollectionEdit` [Verified]: a revision is recorded, every project following the pattern is **pinned to the old text**, and each project owner (the same user) later chooses "Review the update", where `mapCursor` carries the position over or refuses — **progress is never reset**.

The AI path adds no new write path and cannot bypass revisioning.

---

## 10. Limits and abuse controls specific to extraction

- ≤ 4 images per request; ≤ 400 transcript lines; output cap ~4,000 tokens.
- Daily per-user extraction cap (default 3 — `security-privacy-cost.md` §7): extraction is the most expensive request.
- Copyright notice at first use and in the review banner: "Only add patterns you have the right to use. Gharzetak keeps this pattern private to your account."
- Extraction results live in memory on the device until the user saves; abandoning the review discards them (`ImportDraftService.discard`).
