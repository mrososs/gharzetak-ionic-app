/**
 * P5a — Arabic Smart Pattern Parser hardening.
 * Magic ring in Arabic, Arabic stitch names (plural / dual / «غرزة …» forms), spaced round ranges, and
 * "N stitches in each stitch". Every case checks the status, the arithmetic and that nothing is invented.
 */
import { describe, expect, it } from 'vitest';
import { P1_TEXT, P2_TEXT } from '../data/catalog';
import { BUNNY_DRESS_TEXT } from './fixtures/bunny-dress.fixture';
import { BUNNY_DRESS_SUMMARY_TEXT } from './fixtures/bunny-dress-summary.fixture';
import { parsePattern } from './pattern-parser';
import { ConvRound, ConversionResult, MAX_RANGE_SPAN, convertPartText, convertPatternText } from './smart-parser';

/** All rounds of a single-part conversion. */
const rounds = (text: string, opts = {}): readonly ConvRound[] => {
  const r = convertPatternText(text, opts);
  expect(r.parts).toHaveLength(1);
  return r.parts[0].rounds;
};
/** The last round of a conversion (earlier lines give it a previous round to chain from). */
const last = (text: string, opts = {}): ConvRound => {
  const rs = rounds(text, opts);
  return rs[rs.length - 1];
};
const codes = (r: ConvRound) => r.messages.map((m) => m.code);
/** The strict parser (what the tracker runs) must agree with the converter's numbers. */
const strictAgrees = (r: ConvRound) => {
  const s = parsePattern(r.normalized).rounds[0];
  expect(s.ok, r.normalized).toBe(true);
  expect(s.prod, r.normalized).toBe(r.calculated);
  expect(s.cons, r.normalized).toBe(r.consumed);
};
const R1 = 'R1: 6sc in MR [6]\n';

describe('P5a · 1. magic ring in Arabic and English', () => {
  it('the reference example: «الدور ١: ٦ حشو في حلقة سحرية [6]» → R1: 6sc in MR [6], sent for review because of «حشو»', () => {
    const src = 'الدور ١: ٦ حشو في حلقة سحرية [6]';
    const r = last(src);
    expect(r).toMatchObject({ n: 1, normalized: 'R1: 6sc in MR [6]', calculated: 6, consumed: 0, expected: 6, status: 'needs-review', original: src });
    expect(codes(r)).toEqual(['ambiguous']);
    strictAgrees(r);
  });

  it.each([
    ['في حلقة سحرية', 'R1: 6sc في حلقة سحرية (6)'],
    ['في الحلقة السحرية, Arabic digits, plural stitch name', 'الدور ١: ٦ غرز قصيرة في الحلقة السحرية (٦)'],
    ['بالحلقة السحرية', 'الدور 1: 6 غرزة قصيرة بالحلقة السحرية (6)'],
    ['في الدائرة السحرية', 'الدور 1: 6 غرز قصيرة في الدائرة السحرية (6)'],
    ['في MR (Arabic preposition + abbreviation)', 'R1: 6sc في MR (6)'],
    ['plural + في MR + Arabic digits', 'الدور ١: ٦ غرز قصيرة في MR (٦)'],
    ['in magic ring', 'R1: 6 sc in magic ring (6)'],
    ['into ring', 'R1: 6 sc into ring [6]'],
    ['in MR', 'R1: 6sc in MR [6]'],
    ['ring named first, English', 'Rnd 1: magic ring, 6 sc (6)'],
    ['ring named first, then repeated', 'Rnd 1: MR, 6 sc into ring [6]'],
    ['ring named first, Arabic', 'الدور ١: حلقة سحرية، ٦ غرز قصيرة (٦)'],
    ['ماجيك رينج', 'الدور 1: 6 غرز قصيرة في ماجيك رينج (6)'],
  ])('%s → validated R1: 6sc in MR [6]', (_label, src) => {
    const r = last(src);
    expect(r).toMatchObject({ status: 'validated', normalized: 'R1: 6sc in MR [6]', calculated: 6, consumed: 0, expected: 6, original: src });
    strictAgrees(r);
  });

  it('the stitch type is kept inside the ring: «١٠ أعمدة في الحلقة السحرية» → 10dc in MR', () => {
    const r = last('الدور ١: ١٠ أعمدة في الحلقة السحرية (١٠)');
    expect(r).toMatchObject({ status: 'validated', normalized: 'R1: 10dc in MR [10]', calculated: 10 });
    strictAgrees(r);
  });

  it('a wrong written total inside the ring is flagged, not fixed', () => {
    const r = last('الدور ١: ٦ غرز قصيرة في الحلقة السحرية (٧)');
    expect(r).toMatchObject({ status: 'needs-review', normalized: 'R1: 6sc in MR [7]', calculated: 6, expected: 7 });
    expect(codes(r)).toContain('total-mismatch');
  });

  it('negative: the FRONT loop («الحلقة الأمامية») is not the magic ring', () => {
    const r = last(R1 + 'R2: 6 sc في الحلقة الأمامية (6)');
    expect(r.status).toBe('unsupported');
    expect(codes(r)).toContain('loop');
  });

  it('negative: a ring named first is not applied when another target is written (join into another piece)', () => {
    expect(last('R1: MR, 6 sc in legs (6)').status).toBe('unsupported');
  });

  it('negative: a ring with no stitches is unsupported', () => {
    expect(last('الدور ١: حلقة سحرية').status).toBe('unsupported');
  });
});

describe('P5a · 2. Arabic stitch names, plurals and duals', () => {
  it.each([
    ['غرزة قصيرة', 'validated'],
    ['غرز قصيرة', 'validated'],
    ['غرز عادية', 'validated'],
    ['حشو', 'needs-review'],
    ['غرزة حشو', 'needs-review'],
    ['غرز حشو', 'needs-review'],
  ])('«٦ %s» is sc (%s)', (name, status) => {
    const r = last(`${R1}الدور ٢: ٦ ${name} (٦)`);
    expect(r).toMatchObject({ normalized: 'R2: 6sc [6]', calculated: 6, status });
    if (status === 'needs-review') expect(codes(r)).toEqual(['ambiguous']);
    strictAgrees(r);
  });

  it.each([
    ['عمود', '6dc'],
    ['أعمدة', '6dc'],
    ['غرز عمود', '6dc'],
    ['نص عمود', '6hdc'],
    ['نصف عمود', '6hdc'],
    ['أنصاف أعمدة', '6hdc'],
    ['عمود مزدوج', '6tr'],
    ['أعمدة طويلة', '6tr'],
  ])('«٦ %s» keeps its own stitch: %s (never turned into sc)', (name, body) => {
    const r = last(`${R1}الدور ٢: ٦ ${name} (٦)`);
    expect(r).toMatchObject({ normalized: `R2: ${body} [6]`, status: 'validated' });
    strictAgrees(r);
  });

  it('Arabic shaping keeps the stitch type: «زيادة نص عمود» = hdc-inc, «زيادة عمود» = dc-inc', () => {
    expect(last(`${R1}الدور ٢: (نص عمود، زيادة نص عمود) × ٣ (٩)`)).toMatchObject({ normalized: 'R2: (hdc, hdc-inc) x 3 [9]', status: 'validated' });
    expect(last(`${R1}الدور ٢: (عمود، زيادة عمود) × ٣ (٩)`)).toMatchObject({ normalized: 'R2: (dc, dc-inc) x 3 [9]', status: 'validated' });
  });

  it('duals carry their count: «غرزتين قصيرتين» = 2 sc, «زيادتين» = 2 inc, «عمودين» = 2 dc', () => {
    expect(last(`${R1}الدور ٢: (غرزة قصيرة، زيادتين) × ٢ (١٠)`)).toMatchObject({ normalized: 'R2: (sc, 2inc) x 2 [10]', calculated: 10, consumed: 6, status: 'validated' });
    expect(last(`${R1}الدور ٢: (غرزتين قصيرتين، زيادة) × ٢ (٨)`)).toMatchObject({ normalized: 'R2: (2sc, inc) x 2 [8]', calculated: 8, status: 'validated' });
    expect(last(`${R1}الدور ٢: عمودين، ٤ أعمدة (٦)`)).toMatchObject({ normalized: 'R2: 6dc [6]', status: 'validated' });
    expect(last(`${R1}الدور ٢: (غرزتين حشو، نقصين) × ٢ (٦)`)).toMatchObject({ normalized: 'R2: (2sc, 2dec) x 2 [6]', status: 'needs-review' });
  });

  it('negative: a bare dual «غرزتين» (stitch kind not named) is not guessed', () => {
    expect(last(`${R1}الدور ٢: غرزتين في كل غرزة (١٢)`).status).toBe('unsupported');
  });

  it('negative: slip stitches in Arabic stay unsupported (chains are supported now: see chain-stitches.spec.ts)', () => {
    expect(last(`${R1}الدور ٢: ٦ غرز منزلقة (٦)`).status).toBe('unsupported');
  });

  it('descriptive Arabic names mean the same stitch in UK patterns; transliterations still follow the system', () => {
    const res = convertPatternText('R1: 6 dc in MR [6]\nR2: 6 htr [6]\nالدور ٣: ٦ أعمدة (٦)\nالدور ٤: ٦ دبل (٦)', { terms: 'uk' });
    expect(res.parts[0].rounds.map((r) => r.normalized)).toEqual(['R1: 6sc in MR [6]', 'R2: 6hdc [6]', 'R3: 6dc [6]', 'R4: 6sc [6]']);
    // In US terms «دبل» is a double crochet.
    expect(last(`${R1}الدور ٢: ٦ دبل (٦)`).normalized).toBe('R2: 6dc [6]');
  });

  it('mixed Arabic and English in one line', () => {
    const r = last(`${R1}الدور ٢: (sc، زيادة) × 3 [9]`);
    expect(r).toMatchObject({ normalized: 'R2: (sc, inc) x 3 [9]', status: 'validated' });
  });
});

describe('P5a · 3. spaced round ranges', () => {
  const R4 = 'R4: 12sc [12]\n';
  it.each([
    ['Arabic digits, spaces', 'الدور ٥ - ٧: ١٢ غرزة قصيرة [12]'],
    ['Western digits, spaces', 'الدور 5 - 7: 12 غرز قصيرة [12]'],
    ['R5 - R7', 'R5 - R7: 12sc [12]'],
    ['Rounds 5 – 7 (en dash)', 'Rounds 5 – 7: 12sc [12]'],
    ['Rnds 5 —7', 'Rnds 5 —7: 12 sc [12]'],
    ['الأدوار ٥ - ٧', 'الأدوار ٥ - ٧: ١٢ غرزة قصيرة [12]'],
    ['من الدور ٥ إلى ٧', 'من الدور ٥ إلى ٧: ١٢ غرزة قصيرة [12]'],
    ['tight R5-7 (unchanged)', 'R5-7: 12sc [12]'],
  ])('%s expands into R5, R6, R7 with the same instruction', (_label, line) => {
    const rs = rounds(R4 + line);
    expect(rs.map((r) => [r.n, r.normalized, r.status])).toEqual([
      [4, 'R4: 12sc [12]', 'validated'],
      [5, 'R5: 12sc [12]', 'validated'],
      [6, 'R6: 12sc [12]', 'validated'],
      [7, 'R7: 12sc [12]', 'validated'],
    ]);
    for (const r of rs.slice(1)) expect(r.original).toBe(line);
  });

  it('a range with «حشو» expands and every round stays reviewable', () => {
    const rs = rounds(R4 + 'الدور ٥ - ٧: ١٢ حشو [12]');
    expect(rs.slice(1).map((r) => [r.n, r.status, codes(r)])).toEqual([
      [5, 'needs-review', ['ambiguous']],
      [6, 'needs-review', ['ambiguous']],
      [7, 'needs-review', ['ambiguous']],
    ]);
  });

  it('a range with only a total, spaced, is the existing flagged "work even" assumption', () => {
    const rs = rounds(R4 + 'الدور ٥ - ٧ (١٢)');
    expect(rs.slice(1).map((r) => [r.n, r.normalized, r.status])).toEqual([
      [5, 'R5: 12sc [12]', 'needs-review'],
      [6, 'R6: 12sc [12]', 'needs-review'],
      [7, 'R7: 12sc [12]', 'needs-review'],
    ]);
    expect(codes(rs[1])).toContain('assumed-sc');
  });

  it('negative: «R5 - 12 sc» is ONE round of 12 sc, not rounds 5…12', () => {
    const rs = rounds(R4 + 'R5 - 12 sc [12]');
    expect(rs.map((r) => r.n)).toEqual([4, 5]);
    expect(rs[1]).toMatchObject({ normalized: 'R5: 12sc [12]', status: 'validated' });
  });

  it.each([
    ['reversed, English', 'R7 - R5: 12sc [12]', 7],
    ['reversed, Arabic', 'الدور ٧ - ٥: ١٢ غرزة قصيرة [12]', 7],
    ['reversed, tight', 'R7-5: 12sc [12]', 7],
  ])('negative: %s → one unsupported round numbered as written, nothing expanded', (_label, line, n) => {
    const rs = rounds(R4 + line);
    expect(rs).toHaveLength(2);
    expect(rs[1]).toMatchObject({ n, status: 'unsupported', calculated: null, original: line });
    expect(codes(rs[1])).toEqual(['range-invalid']);
    // The tracker must not count it as a single round either.
    const strict = parsePattern(rs[1].normalized).rounds[0];
    expect(strict).toMatchObject({ n, ok: false });
  });

  it(`negative: a runaway range (more than ${MAX_RANGE_SPAN + 1} rounds) is not expanded`, () => {
    const rs = rounds(R1 + 'R2 - R500: 6sc [6]');
    expect(rs).toHaveLength(2);
    expect(rs[1]).toMatchObject({ n: 2, status: 'unsupported' });
    expect(codes(rs[1])).toEqual(['range-invalid']);
    expect(parsePattern(rs[1].normalized).rounds[0].ok).toBe(false);
  });

  it('a spaced range with only a bare total is read as a range (the existing "work even" assumption), never validated', () => {
    const rs = rounds(R1.replace('6sc', '12sc').replace('[6]', '[12]') + 'R2 - 4 [12]');
    expect(rs.slice(1).map((r) => [r.n, r.status])).toEqual([
      [2, 'needs-review'],
      [3, 'needs-review'],
      [4, 'needs-review'],
    ]);
    expect(codes(rs[1])).toContain('assumed-sc');
  });

  it(`the longest allowed range (${MAX_RANGE_SPAN + 1} rounds) still expands`, () => {
    const rs = rounds(`R1 - R${MAX_RANGE_SPAN + 1}: 6sc [6]`);
    expect(rs).toHaveLength(MAX_RANGE_SPAN + 1);
  });

  it('after an invalid range the next round has no previous count to chain from', () => {
    const rs = rounds(R4 + 'R7 - R5: 12sc [12]\nR8: sc in each st');
    expect(rs[2]).toMatchObject({ n: 8, status: 'unsupported' });
    expect(codes(rs[2])).toContain('each-unknown');
  });
});

describe('P5a · 4. N stitches in each stitch', () => {
  it('«2 sc in each st» after a known round = one increase in every stitch', () => {
    const r = last(R1 + 'R2: 2 sc in each st (12)');
    expect(r).toMatchObject({ normalized: 'R2: 6inc [12]', calculated: 12, consumed: 6, status: 'validated' });
    strictAgrees(r);
  });

  it('the stitch type is kept: «2 hdc in each st around» = hdc increases', () => {
    const r = last(R1 + 'R2: 2 hdc in each st around [12]');
    expect(r).toMatchObject({ normalized: 'R2: 6hdc-inc [12]', calculated: 12, status: 'validated' });
    strictAgrees(r);
  });

  it('Arabic: «٢ غرزة قصيرة في كل غرزة» and «غرزتين قصيرتين في كل غرزة»', () => {
    for (const line of ['الدور ٢: ٢ غرزة قصيرة في كل غرزة (١٢)', 'الدور ٢: غرزتين قصيرتين في كل غرزة (١٢)']) {
      expect(last(R1 + line)).toMatchObject({ normalized: 'R2: 6inc [12]', calculated: 12, status: 'validated' });
    }
  });

  it('distinguishes the three meanings', () => {
    // two stitches in ONE target stitch
    expect(last(R1 + 'R2: (sc, 2 sc in next st) x 3 [9]')).toMatchObject({ normalized: 'R2: (sc, inc) x 3 [9]', calculated: 9 });
    expect(last(R1 + 'الدور ٢: (غرزة قصيرة، ٢ غرزة قصيرة في نفس الغرزة) × ٣ (٩)')).toMatchObject({ normalized: 'R2: (sc, inc) x 3 [9]', status: 'validated' });
    // two stitches in each of a STATED number of stitches
    expect(last(R1 + 'R2: 2 sc in each of next 3 sts, 3 sc (9)')).toMatchObject({ normalized: 'R2: 3inc, 3sc [9]', calculated: 9, consumed: 6, status: 'validated' });
    // an increase repeated a stated number of times
    expect(last(R1 + 'R2: inc x 6 [12]')).toMatchObject({ normalized: 'R2: (inc) x 6 [12]', calculated: 12 });
    expect(last(R1 + 'R2: 6 inc [12]')).toMatchObject({ normalized: 'R2: 6inc [12]', calculated: 12 });
  });

  it('negative: with no previous round the count is unknown — never invented', () => {
    const r = last('R2: 2 sc in each st (12)');
    expect(r).toMatchObject({ status: 'unsupported', calculated: null });
    expect(codes(r)).toContain('each-unknown');
  });

  it('negative: after an unsupported round the count is unknown too', () => {
    const r = last('R1: ch 3, sl st\nR2: 2 sc in each st (12)');
    expect(r).toMatchObject({ status: 'unsupported', calculated: null });
  });

  it('a previous round that itself needs review makes "each" need review — unless the written total confirms it', () => {
    const unsure = last(R1 + 'R2: (sc, inc) x 6 [20]\nR3: sc in each st');
    expect(unsure).toMatchObject({ status: 'needs-review', calculated: 18 });
    expect(codes(unsure)).toContain('each-basis');
    const confirmed = last(R1 + 'R2: (sc, inc) x 6 [20]\nR3: sc in each st [18]');
    expect(codes(confirmed)).not.toContain('each-basis');
  });

  it('an incorrect declared total is flagged and kept', () => {
    const r = last(R1 + 'R2: 2 sc in each st (14)');
    expect(r).toMatchObject({ status: 'needs-review', normalized: 'R2: 6inc [14]', calculated: 12, expected: 14 });
    expect(codes(r)).toContain('total-mismatch');
  });

  it.each([
    ['3 sc in each st (no strict equivalent)', 'R2: 3 sc in each st (18)'],
    ['2 inc in each st (meaningless)', 'R2: 2 inc in each st (24)'],
    ['3 sc in each of next 2 sts', 'R2: 3 sc in each of next 2 sts, 4 sc'],
  ])('negative: %s stays unsupported', (_label, line) => {
    expect(last(R1 + line).status).toBe('unsupported');
  });

  it('UK terms: «2 dc in each st» is two UK double crochets = US sc increases', () => {
    const res = convertPatternText('Rnd 1: 6 dc in magic ring (6)\nRnd 2: 2 dc in each st (12)\nRnd 3: (1 dc, 2 dc in next st) x 6 (18)\nRnd 4: 18 htr (18)');
    expect(res.detectedTerms).toBe('uk');
    expect(res.parts[0].rounds.map((r) => [r.normalized, r.status])).toEqual([
      ['R1: 6sc in MR [6]', 'validated'],
      ['R2: 6inc [12]', 'validated'],
      ['R3: (sc, inc) x 6 [18]', 'validated'],
      ['R4: 18hdc [18]', 'validated'],
    ]);
  });
});

describe('P5a · set-up lines, rows and unsupported syntax', () => {
  it('a foundation chain line is kept as a note, never as a piece name or a counted round', () => {
    const res = convertPatternText('Bunny dress\nStart: ch 43\nRow 1: 42 sc\nRow 2: 42 sc');
    expect(res.parts).toHaveLength(1);
    expect(res.parts[0]).toMatchObject({ name: 'Bunny dress', notes: ['Start: ch 43'] });
    expect(res.parts[0].rounds.map((r) => r.n)).toEqual([1, 2]);
  });

  it.each(['Turn', 'Ch 1, turn', 'ch 1 and turn.', 'اقلبي الشغل', 'سلسلة ٤٣', 'ابدئي بسلسلة ٤٣', 'اعملي سلسلة من ٤٣ غرزة', 'Foundation chain: 43 ch'])(
    '«%s» between rows is a note, not a new piece',
    (setup) => {
      const res = convertPatternText(`Dress:\nRow 1: 42 sc\n${setup}\nRow 2: 42 sc`);
      expect(res.parts).toHaveLength(1);
      expect(res.parts[0].notes).toEqual([setup]);
      expect(res.parts[0].rounds.map((r) => [r.n, r.status])).toEqual([
        [1, 'validated'],
        [2, 'validated'],
      ]);
    },
  );

  it.each([
    ['armhole chains and skips', 'Row 2: 6 sc, ch 6, skip 6 sts, 18 sc, ch 6, skip 6 sts, 6 sc (54)'],
    ['sk abbreviation', 'Row 2: 6 sc, ch 6, sk 6, 30 sc (54)'],
    ['slip stitch to join', 'R2: inc x 6, sl st to join (12)'],
    ['a chain space with a slip stitch', 'R2: ch 3, sl st in 2nd ch from hook'],
    ['repeat from *', 'R2: *sc, inc* repeat from * 3 times (9)'],
    ['back loop only', 'R2: 6 sc in BLO (6)'],
  ])('unsupported and kept verbatim: %s', (_label, line) => {
    const r = last('Row 1: 42 sc\n' + line);
    expect(r.status).toBe('unsupported');
    expect(r.calculated).toBeNull();
    expect(r.original).toBe(line);
    expect(r.normalized).toContain(line.replace(/^[^:]*:\s*/, ''));
  });

  it('dc increases in a row are preserved', () => {
    expect(last('R1: 30sc [30]\nR2: (dc, dc inc) x 15 [45]')).toMatchObject({ normalized: 'R2: (dc, dc-inc) x 15 [45]', status: 'validated' });
  });

  it('joining instructions keep their reference and are never validated', () => {
    const r = last('الجسم:\nR6: 4dec, 22sc [26]\nR7: 5sc in body + 5sc in legs + 14sc in body + 5sc in legs + 7sc in body (36)');
    expect(r).toMatchObject({ joins: ['legs'], status: 'needs-review', calculated: 36, consumed: 26 });
  });
});

describe('P5a · regression fixtures', () => {
  it('bunny-dress SUMMARY: every gap stays visible (P5a does not make this pattern "supported")', () => {
    const res: ConversionResult = convertPatternText(BUNNY_DRESS_SUMMARY_TEXT);
    expect(res.original).toBe(BUNNY_DRESS_SUMMARY_TEXT);
    expect(res.parts).toHaveLength(1);
    const p = res.parts[0];
    expect(p.name).toBe('Bunny dress (reference summary)');
    expect(p.notes).toEqual(['Start: ch 43']); // the foundation chain is kept, not counted
    const by = (n: number) => p.rounds.find((r) => r.n === n)!;
    expect(p.rounds.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]); // rows 4–8 and rounds 11–14 expanded
    expect(by(2)).toMatchObject({ status: 'unsupported', calculated: null }); // armhole row: no stitch sequence, none invented
    expect(by(9)).toMatchObject({ status: 'needs-review', calculated: 120 });
    expect(codes(by(9))).toContain('chain'); // 60 → 120 with no stated method
    expect(by(10)).toMatchObject({ status: 'needs-review', calculated: 180 });
    expect(res.status).toBe('unsupported');
  });

  it('the bunny-with-dress amigurumi fixture converts exactly as before', () => {
    const res = convertPatternText(BUNNY_DRESS_TEXT);
    // Same counts as before P5a (measured on the unmodified converter).
    expect(res.counts).toEqual({ validated: 26, needsReview: 11, unsupported: 0, rounds: 37 });
  });

  it('the bundled sample patterns (already in strict notation) convert to the same stitches, round by round', () => {
    const shape = (text: string) => parsePattern(text).rounds.map((r) => [r.n, r.cons, r.prod, r.declared, r.acts.map((a) => a.k).join()]);
    for (const text of [P1_TEXT, P2_TEXT]) {
      const part = convertPartText(text);
      expect(part.status).toBe('validated');
      expect(shape(part.text)).toEqual(shape(text));
    }
  });

  it('round trip: re-converting the normalized text is idempotent for every new construct', () => {
    const src = [
      'الدور ١: ٦ غرز قصيرة في الحلقة السحرية (٦)',
      'الدور ٢: ٢ غرزة قصيرة في كل غرزة (١٢)',
      'الدور ٣: (غرزة قصيرة، زيادة) × ٦ (١٨)',
      'الدور ٤ - ٦: ١٨ غرز قصيرة (١٨)',
      'الدور ٧: (نص عمود، زيادة نص عمود) × ٩ (٢٧)',
    ].join('\n');
    const first = convertPatternText(src);
    expect(first.status).toBe('validated');
    const again = convertPartText(first.parts[0].text);
    expect(again.text).toBe(first.parts[0].text);
    expect(again.rounds.map((r) => r.status)).toEqual(first.parts[0].rounds.map((r) => r.status));
    expect(first.original).toBe(src);
  });
});

describe('vocabulary found on a real Arabic pattern sheet read by Khayoota (P5a follow-up)', () => {
  const rounds = (text: string) => convertPatternText(text).parts.flatMap((p) => p.rounds);

  it('«السطر» is a round marker, including ranges', () => {
    const r = rounds('السطر 1: 6 غرز قصيرة في دائرة سحرية (6)\nالسطر 2: تزايد في كل غرزة (12)\nالسطر 3–4: 12 غرزة قصيرة (12)');
    expect(r.map((x) => [x.n, x.normalized, x.status])).toEqual([
      [1, 'R1: 6sc in MR [6]', 'validated'],
      [2, 'R2: 6inc [12]', 'validated'],
      [3, 'R3: 12sc [12]', 'validated'],
      [4, 'R4: 12sc [12]', 'validated'],
    ]);
  });

  it('«تزايد» = inc and «تناقص» = dec', () => {
    const r = rounds('الدور 1: 6 غرز قصيرة في الحلقة السحرية (6)\nالدور 2: تزايد في كل غرزة (12)\nالدور 3: (2 غرز قصيرة، تناقص) ×3 (9)');
    expect(r.map((x) => x.normalized)).toEqual(['R1: 6sc in MR [6]', 'R2: 6inc [12]', 'R3: (2sc, dec) x 3 [9]']);
    expect(r.every((x) => x.status === 'validated')).toBe(true);
  });

  it('a full stop before the written total (or at the end) is punctuation', () => {
    expect(rounds('الدور 1: 6 غرز قصيرة في الحلقة السحرية. (6)')[0]).toMatchObject({ normalized: 'R1: 6sc in MR [6]', status: 'validated', expected: 6 });
    expect(rounds('الدور 1: 6 غرز قصيرة في الحلقة السحرية (6)\nالدور 2: تزايد في كل غرزة.')[1]).toMatchObject({ normalized: 'R2: 6inc', calculated: 12 });
  });

  it('«حشو» still needs review (P5a rule unchanged), and an unbalanced group is never validated', () => {
    expect(rounds('السطر 1: 6 حشو في دائرة سحرية. (6)')[0]).toMatchObject({ status: 'needs-review' });
    const bad = rounds('الدور 1: 6 غرز قصيرة في الحلقة السحرية (6)\nالدور 2: 1 غرزة قصيرة، زيادة) ×6 (12)');
    expect(bad[1]!.status).not.toBe('validated');
  });

  it('Arabic dual quantity in a heading: (قطعتان) / (قطعتين) = 2 pieces', () => {
    const c = convertPatternText('الأذنان (قطعتان)\nالدور 1: 6 غرز قصيرة في الحلقة السحرية (6)\nالقرون (قطعتين)\nالدور 1: 5 غرز قصيرة في الحلقة السحرية (5)\nالأرجل (4 قطع)\nالدور 1: 7 غرز قصيرة في الحلقة السحرية (7)');
    expect(c.parts.map((p) => [p.name, p.quantity])).toEqual([['الأذنان', 2], ['القرون', 2], ['الأرجل', 4]]);
  });
});
