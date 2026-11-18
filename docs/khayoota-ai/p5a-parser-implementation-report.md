# P5a — Arabic Smart Pattern Parser Hardening: Implementation Report

| | |
|---|---|
| Branch | `fix/arabic-smart-pattern-parser-p5a` |
| Base | `origin/development` @ `e753481af29d1d0b4ceab09d5f70b985635c3454` |
| Plan | `origin/feat/khayoota-ai-agentic-planning` @ `48a4a8b` — `implementation-roadmap.md` (P5a), `pattern-extraction-pipeline.md` §7 |
| Scope | The deterministic Smart Pattern Parser only (`src/app/core/domain/smart-parser.ts`). No AI, no network, no inference, no Cloudflare change, no data migration. The strict parser (`pattern-parser.ts`) that the tracker and saved patterns use is **unchanged**. |

## 1. What changed

| File | Change |
|---|---|
| `src/app/core/domain/smart-parser.ts` | The four P5a fixes, set-up line handling, invalid-range handling, `each-basis` review rule |
| `src/app/core/domain/smart-parser-arabic.spec.ts` | **New** — 91 tests (positive and negative) |
| `src/app/core/domain/fixtures/bunny-dress-summary.fixture.ts` | **New** — the bunny-dress summary from the planning brief, labelled as a summary |
| `docs/pattern-collections/architecture.md` | Smart parser section: supported syntax added |
| `docs/khayoota-ai/p5a-parser-implementation-report.md` | This report |

The pipeline is unchanged — normalise → classify → header → tokenise → parse → arithmetic → validate → emit → strict re-parse — and so are the three statuses, the message format, the "never invent a total" rule and the preserved original text.

## 2. The four improvements — exact supported syntax

### 2.1 Magic ring

| Accepted | Meaning |
|---|---|
| `في حلقة سحرية`, `في الحلقة السحرية`, `بالحلقة السحرية`, `حلقة سحرية`, `في الدائرة السحرية`, `ماجيك رينج` | in the magic ring |
| `في MR`, `in MR`, `in magic ring`, `into ring`, `in a magic circle`, `adjustable ring` | in the magic ring |
| ring named **first**: `magic ring, 6 sc`, `MR, 6 sc into ring`, `حلقة سحرية، ٦ غرز قصيرة` | the following stitches are worked into the ring — **only** when no stitch in the line has its own target (join, "each", group); otherwise unsupported |

Root cause of the old `في MR` failure: the Arabic preposition was read as "in", and the ring token added a second "in" → a dangling "in" → unsupported. The ring token now never adds a second "in".

Not the ring: `الحلقة الأمامية / الخلفية` (front / back loop) → still unsupported (`loop`).

### 2.2 Arabic stitch names, plurals and duals

| Stitch | Accepted names (any form of «غرزة …» shown too) |
|---|---|
| sc | `غرزة قصيرة`, `غرز قصيرة`, `غرزات قصيرة`, `غرزة عادية`, `غرز عادية`, `سنجل`, `سنجل كروشيه` (`غرزة سنجل` US only) |
| sc — **always `needs-review` (`ambiguous`)** | `حشو`, `غرزة حشو`, `غرز حشو` |
| hdc | `نص عمود`, `نصف عمود`, `أنصاف أعمدة`, `أنصاف عمود`, `غرزة نص عمود`, `غرز نص عمود` |
| dc | `عمود`, `أعمدة`, `غرزة عمود`, `غرز عمود` |
| tr | `عمود مزدوج`, `عمود طويل`, `أعمدة مزدوجة`, `أعمدة طويلة` |
| duals (count 2 built in) | `غرزتين قصيرتين` / `غرزتين عاديتين` = 2 sc · `غرزتين حشو` = 2 sc (review) · `عمودين` = 2 dc · `زيادتين` = 2 inc · `نقصين` / `تنقيصين` = 2 dec |

Terminology: descriptive Arabic names describe the stitch itself, so they now mean the **same** stitch in US and UK patterns (before, `عمود` was unknown in UK mode). Transliterations follow the system like their English originals (`دبل` = US dc, UK dc = US sc). Shaping keeps the stitch type (`زيادة نص عمود` = `hdc-inc`). Not guessed: a bare `غرزتين` (stitch kind not named), `غرز منزلقة` (slip stitch), `سلسلة` (chain).

### 2.3 Spaced round ranges

| Accepted | Notes |
|---|---|
| `R5 - 7:`, `R5 - R7:`, `Rounds 5 – 7:`, `Rnds 5 —7:`, `الدور ٥ - ٧:`, `الأدوار ٥ - ٧:`, `من الدور ٥ إلى ٧:` | Arabic-Indic, Persian and Western digits; `-` `–` `—`; also `الصفوف`, `الجولات` |
| `R5-7`, `R4 >> R7`, `R4 to R7`, `R5-R7` | unchanged |
| A **spaced** dash range is a range only if the header ends right after the second number (`:` `.` `)` `=`, end of line, or a bare total) | so `R5 - 12 sc [12]` stays **one** round of 12 sc |
| Reversed (`R7 - R5`, `الدور ٧ - ٥`, `R7-5`) | one `unsupported` round numbered as written, code `range-invalid`, nothing expanded; its normalised line is `R7: <the whole original line>`, so the tracker cannot count it as one round either |
| Longer than 100 rounds (`R2 - R500`) | same; `MAX_RANGE_SPAN = 99` (exported) |

Every expanded round keeps the same instruction and the same `original` line.

### 2.4 N stitches in each stitch

| Text | Result |
|---|---|
| `2 sc in each st` (after a round of 6) | `6inc` → 12 (stitch kind kept: `2 hdc in each st` → `6hdc-inc`) |
| `٢ غرزة قصيرة في كل غرزة`, `غرزتين قصيرتين في كل غرزة` | same |
| `2 sc in each of next 3 sts` | `3inc` (count written in the line) |
| `2 sc in next st`, `٢ غرزة قصيرة في نفس الغرزة / في الغرزة الجاية` | one increase (two stitches in ONE stitch) |
| `inc x 6`, `6 inc` | six increases (unchanged) |
| no previous round, or the previous round is unsupported | `unsupported`, code `each-unknown` — **no total is invented** |
| previous round is `needs-review` | result `needs-review`, code `each-basis` — unless the line's own written total equals the result |
| `3 sc in each st`, `2 inc in each st`, `3 sc in each of next 2 sts` | `unsupported` (no strict equivalent; not guessed) |

### 2.5 Also fixed (listed in the P5a plan)

Set-up lines — `Start: ch 43`, `Foundation chain: 43 ch`, `Ch 1, turn`, `Turn`, `سلسلة ٤٣`, `اقلبي الشغل` — are kept verbatim as notes of the piece. Before, `Start: ch 43` became the **piece name** and `Turn` started a **new piece**.

## 3. Real before / after examples

Produced by running the converter of `origin/development` (before) and of this branch (after) on the same 56 probe inputs, bundled read-only with esbuild. Status shown for the last (or only) round unless stated.

| Input | Before | After |
|---|---|---|
| `الدور ١: ٦ حشو في حلقة سحرية [6]` | unsupported | `R1: 6sc in MR [6]` · needs-review (`ambiguous`) |
| `R1: 6sc في MR (6)` | unsupported | `R1: 6sc in MR [6]` · validated |
| `الدور ١: ٦ غرز قصيرة في الحلقة السحرية (٦)` | unsupported | `R1: 6sc in MR [6]` · validated |
| `الدور ١: حلقة سحرية، ٦ غرز قصيرة (٦)` | unsupported | `R1: 6sc in MR [6]` · validated |
| `Rnd 1: magic ring, 6 sc (6)` | unsupported | `R1: 6sc in MR [6]` · validated |
| `الدور ٢: ٦ غرز حشو (٦)` | unsupported | `R2: 6sc [6]` · needs-review (`ambiguous`) |
| `الدور ٢: ٦ أنصاف أعمدة (٦)` | unsupported | `R2: 6hdc [6]` · validated |
| `الدور ٢: ٦ أعمدة طويلة (٦)` | unsupported | `R2: 6tr [6]` · validated |
| `الدور ٣: ٦ عمود (٦)` in a UK pattern | unsupported | `R3: 6dc [6]` · validated |
| `الدور ٥ - ٧: ٢٤ غرزة قصيرة (٢٤)` | **one** round R5, unsupported (R6, R7 missing) | R5, R6, R7 `24sc [24]` · validated |
| `Rounds 5 – 7: 12sc [12]` | one round R5, unsupported | R5, R6, R7 · validated |
| `من الدور ٥ إلى ٧: ١٢ غرزة قصيرة [12]` | became a **piece heading** | R5, R6, R7 · validated |
| `R5 - 12 sc [12]` | `R5: 12sc [12]` validated | unchanged |
| `R7 - R5: 12sc [12]` | unsupported, wrongly numbered **R5** | R7 unsupported (`range-invalid`) |
| `R2 - R500: 6sc [6]` | unsupported, generic message | R2 unsupported (`range-invalid`) |
| `R2: 2 sc in each st (12)` after R1 = 6 | unsupported | `R2: 6inc [12]` · validated |
| `R2: 2 hdc in each st around [12]` | unsupported | `R2: 6hdc-inc [12]` · validated |
| `R2: 2 sc in each st (14)` | unsupported | `R2: 6inc [14]` · needs-review (`total-mismatch`, 12 calculated) |
| `R2: 2 sc in each st (12)` with no previous round | unsupported | unsupported (`each-unknown`) |
| `R3: sc in each st` after a round with a wrong total | **validated** | needs-review (`each-basis`) |
| `R2: 2 sc in each of next 3 sts, 3 sc (9)` | unsupported | `R2: 3inc, 3sc [9]` · validated |
| `R2: 3 sc in each st (18)` | unsupported | unsupported |
| `Dress:` / `Row 1: 42 sc` / `Turn` / `Row 2: 42 sc` | 2 pieces: "Dress" and "**Turn**" | 1 piece, note "Turn" |
| UK ball (`2 dc in each st` in round 2) | 1 unsupported round | all 4 rounds validated |
| Benchmark text `ballAr` (natural Arabic, 10 rounds) | **8 rounds**: 6 validated, 2 unsupported | **10 rounds, 10 validated** |
| Bunny-dress summary | piece named "Start: ch 43" | piece "Bunny dress (reference summary)", note "Start: ch 43"; rounds identical (11 validated / 2 needs-review / 1 unsupported) |

Unchanged on purpose (identical before and after): `in magic ring`, `in MR`, `inc x 6`, `2 sc in next st`, `زيادة في كل غرزة`, tight ranges, `R5 - R7`, hdc/dc shaping, chains, `sl st to join`, armhole row, joins into other pieces, front loop.

## 4. Tests

| Run | Before (origin/development) | After (this branch) |
|---|---|---|
| Domain specs (`src/app/core/domain`) | 6 files · **135 passed** | 7 files · **226 passed** (135 existing + 91 new) |
| Full frontend unit suite (`ng test`) | 36 files · **547 passed** | 37 files · **638 passed**, 0 failed |
| Typecheck (`tsc -p tsconfig.app.json` and `tsconfig.spec.json`, `--noEmit`) | — | 0 errors / 0 errors |
| Production build (`ng build`) | — | success, 0 warnings (initial bundle 1.32 MB raw / 288 kB transfer) |

"Before" was measured in this worktree with `smart-parser.ts` restored from `origin/development` and the new spec removed; both files were then restored and checked by SHA-256. Node 24.22.3 (portable), Vitest 5.1, Angular CLI 22.2.

The 91 new tests cover: Arabic-Indic and Western digits; mixed Arabic/English; every magic-ring form above; singular, plural and dual stitch names; hdc/dc/tr never collapsing to sc; US/UK consistency; spaced, reversed, runaway and maximum-length ranges; `2 sc in each st` with a known, an unavailable and an unreliable previous count; wrong declared totals; the three "two stitches" meanings; armhole chains and `skip`/`sk`; turning chains; `sl st`; `*…*`; BLO; joins into other pieces; set-up lines; the bunny-dress summary; the amigurumi bunny fixture (counts identical to before: 26 validated / 11 needs-review / 0 unsupported / 37 rounds); the bundled sample patterns; idempotent round trip; original text preserved. Each converted round is re-parsed by the strict parser and its totals must agree.

Existing parser, collection, revision, tracker and joy specs are part of the domain run above and all pass unchanged. API tests were not run: no file under `apps/api` changed.

## 5. Compatibility

- **Saved patterns:** patterns are stored in strict notation and read by `pattern-parser.ts`, which this change does not touch. The tracker, revisions, pinning, `mapCursor` and the video counter therefore read every saved pattern exactly as before. No data migration.
- **Pattern Editor:** the converter is used only by Smart Import (`smart-import.page.ts`) and the per-part "Smart convert" in the collection editor (`collection-editor.page.ts`). The `ConversionResult` / `ConvPart` / `ConvRound` types are unchanged; new message codes (`range-invalid`, `each-basis`) use the existing `ConvMessage` shape with Arabic and English text, so the review screen shows them without UI changes.
- **Behaviour changes for inputs that were already accepted** (both deliberate, both stricter):
  1. `… in each st` after a round that needs review is now `needs-review` (was `validated`).
  2. Set-up lines no longer become piece names or new pieces. For a single pattern the piece name feeds the pattern name only when the name field is empty; the set-up line stays in the notes and in `sourceText`.
- Normalised text is still written with `R{n}:` for rows and rounds (the strict parser does not accept "Row"); the original wording is kept in `original` and in `sourceText`.

## 6. What is still unsupported (reported, not hidden)

| Construct | Example | Status |
|---|---|---|
| Chains inside a row/round, foundation chains as rounds | `Row 2: 6 sc, ch 6, skip 6 sts, …` | unsupported (kept verbatim) |
| Skips | `skip 6 sts`, `sk 6` | unsupported |
| Turning chains inside a row | `Row 2: ch 1, turn, 42 sc` | unsupported (a stand-alone `Ch 1, turn` line is a note) |
| Slip stitch / slip-stitch join | `inc x 6, sl st to join` | unsupported |
| Front / back loop only | `6 sc in BLO` | unsupported (`loop`) |
| Repeat from star | `*sc, inc* repeat from * 3 times` | unsupported |
| 3+ stitches into one stitch (shells, clusters, popcorn) | `3 sc in each st`, `5 dc in next st` | unsupported |
| Bare Arabic dual without a stitch name | `غرزتين في كل غرزة` | unsupported |
| Arabic "each of next N" | `في كل غرزة من الـ٣ غرز الجاية` | unsupported (English form works) |
| Increase totals stated without a method | `Round 9: 120 dc` after 60 | parsed, `needs-review` (`chain`) — the method is not invented |

The bunny-dress pattern is **not** supported end to end. With P5a its plain rows (1, 3, 4–8) and rounds (11–14) convert; the foundation chain is a note; row 2 (armhole chains and skips) is unsupported; rounds 9 and 10 need review. The actual Gemini extraction text was not available locally (only image files named `Gemini_Generated_Image_*` exist in Downloads; they were not opened), so the regression fixture is the summary from the brief and is labelled as such. Its `ch`, `skip`, `turn`, `sl st` and `dc inc` constructs are covered by targeted tests instead.

### Future P5b scope — garment and row patterns

Supporting these needs the **strict parser and the tracker** to change, not only the converter: `STITCH_IO`, cursor semantics, the revision mapper (`mapCursor`) and the tracker UI. It needs its own decision, design and regression plan.

| P5b item | Why it is not a converter-only fix |
|---|---|
| Chains as stitches (`ch` 0 → 1), foundation chains as row 0, chain spaces (`ch 6` armholes) | a chain produces positions that the next row works into but consumes nothing; the tracker has no "0-consume" stitch other than MR |
| Skips (`sk`, `skip N sts`) | consume without producing — a new stitch kind with `[1, 0]` I/O |
| Turning chains and "does / does not count as a stitch" | changes the total of a row depending on a convention stated elsewhere in the pattern |
| Slip stitches and slip-stitch joins (`sl st to join`) | joining a round changes whether the next round starts in the join; count-neutral but position-changing |
| Working into chain spaces / armholes (`5 dc in ch-6 sp`) | needs a target that is a chain space, not a stitch |
| Joins between garment pieces (bodice ↔ skirt, sleeve into armhole) | like the existing `in <piece>` joins, but on rows and chain spaces |
| Rows vs rounds in normalised text | the strict notation writes every line as `R{n}:`; rows keep their wording only in `original` / `sourceText` |
| `*…*` repeats, front/back-loop stitches, 3+ stitches into one stitch (shells, clusters, popcorns) | need new strict syntax and new stitch kinds |

## 6a. Review of the change (before opening the PR)

| Check | Result |
|---|---|
| Regression sweep — 24,948 generated two-round patterns (11 header styles × 7 total styles × 27 bodies × 6 first rounds × with/without a previous round), old vs new converter | **462 changed, all improvements** (`2 sc in each st` now validates); **0** rounds became stricter or lost |
| Range / heading / set-up sweep — 12,189 inputs (5 range shapes × 9 separators × 9 prefixes × 3 second-number forms × 10 tails, plus 13 set-up lines in 3 positions) | 0 lost rounds. Changes: lines that used to become **bogus piece headings** (`الأدوار ٥-٧ (١٢)`, `من الدور ٥ إلى ٧ …`) are now rounds; set-up lines are now notes. The only "stricter" hits were a counting artefact of duplicated round numbers in `ch 3 (counts as dc)` inputs — the old and new outputs are identical there. |
| Ambiguity | Every «حشو» form stays `needs-review`; a bare dual without a stitch name and `3 sc in each st` are not guessed; `each` never invents a count (`each-unknown`) and now flags an unreliable basis (`each-basis`). |
| Range expansion | Spaced dash ranges only when the header ends after the second number; reversed and > 100-round ranges are never expanded; a spaced range with only a bare total (`R2 - 4 [12]`) is read as a range under the existing flagged "work even" assumption (`assumed-sc`, never validated). |
| Saved patterns | `pattern-parser.ts` untouched; `git diff` contains no file outside the parser, its spec/fixture and two docs. |
| Found and fixed during review | (1) Arabic set-up verbs were written in un-normalised form (`ابدئي`) and `بسلسلة` was not matched — fixed, 2 tests added. (2) A reversed/runaway range's normalised line could still be read by the strict parser as one countable round — it now carries the whole original line, so the tracker does not count it; 2 assertions added. |
| Pre-existing, not changed | `ch 3 (counts as dc)` (a chain line with extra words) becomes an unsupported round with a duplicated number; part of P5b. |

## 7. Readiness for Khayoota image-extraction integration

The deterministic layer that every AI-read transcript must pass through now handles the natural way Arabic amigurumi patterns are written: the first round (`… في الحلقة السحرية`), plural stitch names, spaced ranges and "two stitches in each stitch". On the benchmark's natural-Arabic text it moved from 8 rounds (6 validated) to 10 of 10 validated, without relaxing any rule: totals are still calculated, ambiguity is still flagged, and the new "each" rule is stricter than before.

Recommendation: the parser is **ready to be the judge for printed and handwritten Arabic/English amigurumi rounds** in P0 (benchmark scoring) and P5 (extraction). It is **not** ready for row-based garments with chains and skips; those will appear as clearly marked unsupported lines until P5b is decided. Re-run the parser baseline in `benchmark-plan.md` §7a with this branch before scoring any model.
