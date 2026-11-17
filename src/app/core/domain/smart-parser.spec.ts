import { describe, expect, it } from 'vitest';
import { BUNNY_DRESS_TEXT } from './fixtures/bunny-dress.fixture';
import { parsePattern } from './pattern-parser';
import { ConvPart, ConvRound, ConversionResult, convertPartText, convertPatternText, normalizeLine, normalizedDocument, splitTotal } from './smart-parser';

const one = (text: string, opts = {}): ConvRound => {
  const r = convertPatternText(text, opts);
  expect(r.parts).toHaveLength(1);
  expect(r.parts[0].rounds).toHaveLength(1);
  return r.parts[0].rounds[0];
};
const codes = (r: ConvRound) => r.messages.map((m) => m.code);

describe('smart parser — normalization', () => {
  it('turns Arabic-Indic digits, Arabic punctuation and multiplication symbols into plain notation', () => {
    expect(normalizeLine('الدور ٣: (حشو، زيادة) × ٦')).toBe('الدور 3: (حشو, زياده) x 6');
    expect(normalizeLine('R3 : (sc + inc) * 6')).toBe('r3 : (sc + inc) x 6');
  });
  it('extracts declared totals in every common spelling', () => {
    for (const t of ['(sc, inc) x 6 [18]', '(sc, inc) x 6 (18)', '(sc, inc) x 6 = 18', '(sc, inc) x 6 = 18 غرزة', '(sc, inc) x 6 - 18 sts', '(sc, inc) x 6 [18 sts]']) {
      expect(splitTotal(normalizeLine(t))).toEqual({ body: '(sc, inc) x 6', declared: 18 });
    }
    expect(splitTotal('(sc, inc) x 6')).toEqual({ body: '(sc, inc) x 6', declared: null });
  });
});

describe('smart parser — the notations from the spec', () => {
  it('standard', () => {
    const r = one('R3: (sc, inc) x 6 [18]');
    expect(r).toMatchObject({ n: 3, status: 'validated', normalized: 'R3: (sc, inc) x 6 [18]', expected: 18, calculated: 18 });
  });
  it('alternative punctuation', () => {
    const r = one('R3 : (sc + inc) * 6 (18)');
    expect(r).toMatchObject({ n: 3, status: 'validated', normalized: 'R3: (sc, inc) x 6 [18]', calculated: 18 });
  });
  it('English prose with spelled-out repetition', () => {
    const r = one('Round 3: single crochet and increase, repeat six times');
    expect(r).toMatchObject({ n: 3, status: 'validated', normalized: 'R3: (sc, inc) x 6', calculated: 18, expected: null });
    expect(codes(r)).toContain('no-total');
  });
  it('Arabic prose: the ambiguous word "حشو" is understood but sent for review, never silently validated', () => {
    const r = one('الدور الثالث: حشو وبعدها زيادة كرري 6 مرات = 18 غرزة');
    expect(r).toMatchObject({ n: 3, normalized: 'R3: (sc, inc) x 6 [18]', calculated: 18, expected: 18, status: 'needs-review' });
    expect(codes(r)).toContain('ambiguous');
  });
  it('Arabic vocabulary of the app (غرزة قصيرة / زيادة / تنقيص) and Arabic numerals validate fully', () => {
    const r = one('الدور ٣: (غرزة قصيرة، زيادة) × ٦ [١٨]');
    expect(r).toMatchObject({ n: 3, status: 'validated', normalized: 'R3: (sc, inc) x 6 [18]', calculated: 18 });
  });
  it('round range without instructions is an explicit, flagged assumption (work even in sc)', () => {
    const res = convertPatternText('R3: (sc, inc) x 6 [18]\nR4 >> R7 (18)');
    const rounds = res.parts[0].rounds;
    expect(rounds.map((r) => r.n)).toEqual([3, 4, 5, 6, 7]);
    for (const r of rounds.slice(1)) {
      expect(r).toMatchObject({ status: 'needs-review', normalized: 'R' + r.n + ': 18sc [18]', calculated: 18, expected: 18 });
      expect(codes(r)).toContain('assumed-sc');
    }
  });
  it('range with an explicit instruction expands each round and validates continuity', () => {
    const res = convertPatternText('R3: (sc, inc) x 6 [18]\nR4-R6: sc around [18]');
    expect(res.parts[0].rounds.slice(1).map((r) => [r.n, r.status, r.normalized])).toEqual([
      [4, 'validated', 'R4: 18sc [18]'],
      [5, 'validated', 'R5: 18sc [18]'],
      [6, 'validated', 'R6: 18sc [18]'],
    ]);
  });
  it('multi-part headings in Arabic', () => {
    const res = convertPatternText('الايد:\nR1: 6 sc in magic ring\nالرجل:\nR1: 6 sc in magic ring\nالجسم:\nR1: 6 sc in magic ring');
    expect(res.parts.map((p) => [p.name, p.kind, p.rounds.length])).toEqual([
      ['الايد', 'arm', 1],
      ['الرجل', 'leg', 1],
      ['الجسم', 'body', 1],
    ]);
    expect(res.multiPart).toBe(true);
  });
  it('keeps magic ring, abbreviations and English headings', () => {
    const res = convertPatternText('Arms x2:\nRnd 1. 6sc in MR [6]\nRnd 2. inc × 6 [12]');
    expect(res.parts[0]).toMatchObject({ name: 'Arms', kind: 'arm', quantity: 2, quantityToConfirm: false, status: 'validated' });
    expect(res.parts[0].text).toBe('R1: 6sc in MR [6]\nR2: (inc) x 6 [12]');
  });
});

describe('smart parser — stitch types are preserved', () => {
  it('an HDC increase never becomes an sc increase', () => {
    const r = one('R3: (hdc, hdc inc) x 6 [18]');
    expect(r.normalized).toBe('R3: (hdc, hdc-inc) x 6 [18]');
    expect(r.status).toBe('validated');
    const strict = parsePattern(r.normalized).rounds[0];
    expect(strict.acts.map((a) => a.k)).toEqual(['hdc', 'hdc-inc', 'hdc', 'hdc-inc', 'hdc', 'hdc-inc', 'hdc', 'hdc-inc', 'hdc', 'hdc-inc', 'hdc', 'hdc-inc']);
    expect(strict.prod).toBe(18);
  });
  it('hdc decrease, dc increase and sc2tog keep their own kinds', () => {
    expect(one('R4: (hdc, hdc dec) x 6 [12]').normalized).toBe('R4: (hdc, hdc-dec) x 6 [12]');
    expect(one('R4: (dc, dc inc) x 4 [12]').normalized).toBe('R4: (dc, dc-inc) x 4 [12]');
    expect(one('R4: (sc, sc2tog) x 6 [12]').normalized).toBe('R4: (sc, dec) x 6 [12]');
    expect(one('R4: (hdc, hdc2tog) x 6 [12]').normalized).toBe('R4: (hdc, hdc-dec) x 6 [12]');
    expect(one('R4: 2 hdc in next st, 2hdc [4]').normalized).toBe('R4: hdc-inc, 2hdc [4]');
  });
  it('Arabic specific shaping (زيادة نص عمود) is an hdc increase', () => {
    expect(one('الدور 2: نص عمود, زيادة نص عمود').normalized).toBe('R2: hdc, hdc-inc');
  });
  it('UK terms are detected and converted to US in the normalized text', () => {
    const res = convertPatternText('R1: 6dc in MR [6]\nR2: 2htr in next st, htr [3]', { terms: 'auto' });
    expect(res.detectedTerms).toBe('uk');
    expect(res.parts[0].rounds[0].normalized).toBe('R1: 6sc in MR [6]');
    expect(res.parts[0].rounds[1].normalized).toBe('R2: hdc-inc, hdc [3]');
  });
});

describe('smart parser — validation never invents stitches', () => {
  it('a wrong declared total is flagged and the calculated number is kept', () => {
    const r = one('R3: (sc, inc) x 6 [20]');
    expect(r).toMatchObject({ status: 'needs-review', expected: 20, calculated: 18 });
    expect(codes(r)).toContain('total-mismatch');
    expect(r.normalized).toBe('R3: (sc, inc) x 6 [20]'); // the user's declared total is preserved, never "fixed"
  });
  it('a missing total is reported as information, not guessed', () => {
    const r = one('R3: (sc, inc) x 6');
    expect(r).toMatchObject({ status: 'validated', expected: null, calculated: 18 });
  });
  it('continuity: a round using more stitches than the previous round produced needs review', () => {
    const res = convertPatternText('R1: 6sc in MR [6]\nR2: (sc, inc) x 6 [18]');
    expect(res.parts[0].rounds[1]).toMatchObject({ status: 'needs-review', consumed: 12 });
    expect(codes(res.parts[0].rounds[1])).toContain('chain');
  });
  it('unsupported lines are kept verbatim and clearly marked', () => {
    const res = convertPatternText('R1: 6sc in MR [6]\nR2: ch 3, sl st in 2nd ch from hook');
    const bad = res.parts[0].rounds[1];
    expect(bad.status).toBe('unsupported');
    expect(bad.calculated).toBeNull();
    expect(bad.normalized).toContain('ch 3');
    expect(res.status).toBe('unsupported');
    expect(res.counts).toMatchObject({ validated: 1, unsupported: 1 });
  });
  it('front / back loop stitches are unsupported, not silently treated as plain stitches', () => {
    const r = one('R2: 6sc in front loop only [6]');
    expect(r.status).toBe('unsupported');
    expect(codes(r)).toContain('loop');
  });
  it('"in each stitch around" uses the previous round and fails safely without one', () => {
    expect(one('R2: sc in each st around')).toMatchObject({ status: 'unsupported' });
    const res = convertPatternText('R1: 6sc in MR [6]\nR2: inc in each st around [12]');
    expect(res.parts[0].rounds[1]).toMatchObject({ status: 'validated', calculated: 12, normalized: 'R2: 6inc [12]' });
  });
});

describe('smart parser — assembly instructions keep their meaning', () => {
  const text = 'الجسم:\nR6: 4dec, 22sc [26]\nR7: 5sc in body + 5sc in legs + 14sc in body + 5sc in legs + 7sc in body (36)';
  it('keeps the references to the legs and does not mark the round fully validated', () => {
    const r = convertPatternText(text).parts[0].rounds[1];
    expect(r.joins).toEqual(['legs']);
    expect(r.normalized).toBe('R7: 5sc, 5sc in legs, 14sc, 5sc in legs, 7sc [36]');
    expect(r.calculated).toBe(36);
    expect(r.expected).toBe(36);
    expect(r.consumed).toBe(26);
    expect(r.status).toBe('needs-review');
    expect(codes(r)).toContain('joins');
  });
  it('the strict parser (tracker) sees the same joins and counts', () => {
    const strict = parsePattern(convertPatternText(text).parts[0].text);
    expect(strict.ok).toBe(true);
    expect(strict.rounds[1].joins).toEqual(['legs']);
    expect(strict.rounds[1].prod).toBe(36);
    expect(strict.rounds[1].cons).toBe(26);
    expect(strict.rounds[1].chain).toBe('na');
  });
  it('assembly sentences are kept as notes of the part, not as rounds', () => {
    const res = convertPatternText('الودان:\nR1: 6 sc in magic ring\nخيطي الودان في أعلى الراس\nFasten off and leave a long tail for sewing.');
    expect(res.parts[0].notes).toEqual(['خيطي الودان في أعلى الراس', 'Fasten off and leave a long tail for sewing.']);
    expect(res.parts[0].rounds).toHaveLength(1);
  });
});

describe('smart parser — quantities', () => {
  it('suggests (but asks to confirm) 2 for paired pieces and 1 otherwise; explicit quantities are trusted', () => {
    const res = convertPatternText('الايد:\nR1: 6sc in MR\nالجسم:\nR1: 6sc in MR\nTail (x3):\nR1: 6sc in MR');
    expect(res.parts.map((p) => [p.kind, p.quantity, p.quantityToConfirm])).toEqual([
      ['arm', 2, true],
      ['body', 1, false],
      ['tail', 3, false],
    ]);
  });
});

describe('smart parser — bunny-with-dress regression fixture', () => {
  const res = convertPatternText(BUNNY_DRESS_TEXT);
  const part = (kind: string): ConvPart => res.parts.find((p) => p.kind === kind)!;
  const rnd = (kind: string, n: number): ConvRound => part(kind).rounds.find((r) => r.n === n)!;

  it('finds the title and the four pieces, in order', () => {
    expect(res.collectionName).toBe('الأرنوبة بالفستان');
    expect(res.parts.map((p) => p.kind)).toEqual(['arm', 'leg', 'ear', 'body']);
    expect(res.original).toBe(BUNNY_DRESS_TEXT);
  });
  it('arms: round range R4>>R7 expands to four assumed work-even rounds', () => {
    expect(part('arm').rounds.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rnd('arm', 5).status).toBe('needs-review');
    expect(rnd('arm', 8)).toMatchObject({ status: 'validated', calculated: 12 });
  });
  it('legs: hdc shaping is preserved and validated', () => {
    expect(rnd('leg', 3)).toMatchObject({ status: 'validated', normalized: 'R3: (hdc, hdc-inc) x 6 [18]' });
    expect(rnd('leg', 7)).toMatchObject({ status: 'validated', normalized: 'R7: (hdc, hdc-dec) x 6 [12]' });
    expect(part('leg').rounds.filter((r) => r.n >= 4 && r.n <= 6).every((r) => r.status === 'validated' && r.calculated === 18)).toBe(true);
  });
  it('ears: a missing total stays validated (continuity verified) and the sewing note is kept', () => {
    expect(rnd('ear', 3)).toMatchObject({ status: 'validated', expected: null, calculated: 9 });
    expect(part('ear').notes).toEqual(['خيطي الودان في أعلى الراس']);
    expect(part('ear').status).toBe('validated');
  });
  it('body: R7 joins the legs and R17 joins the arms — both flagged, both with correct arithmetic', () => {
    expect(rnd('body', 7)).toMatchObject({ status: 'needs-review', joins: ['legs'], calculated: 36, expected: 36, consumed: 26 });
    expect(rnd('body', 17)).toMatchObject({ status: 'needs-review', joins: ['arms'], calculated: 36, expected: 36, consumed: 24 });
    expect(rnd('body', 17).normalized).toBe('R17: 8sc, 6sc in arms, 8sc, 6sc in arms, 8sc [36]');
  });
  it('body: every non-assembly round validates against the previous round', () => {
    const plain = part('body').rounds.filter((r) => !r.joins.length && !(r.n >= 8 && r.n <= 12));
    expect(plain.every((r) => r.status === 'validated')).toBe(true);
  });
  it('summary counts add up and nothing is unsupported', () => {
    expect(res.counts.unsupported).toBe(0);
    expect(res.counts.validated + res.counts.needsReview).toBe(res.counts.rounds);
    expect(res.counts.needsReview).toBeGreaterThanOrEqual(2 + 4 + 5); // R7, R17 + arm R4-7 + body R8-12
    expect(res.status).toBe('needs-review');
  });
  it('every normalized part re-parses with the strict parser, with matching totals', () => {
    for (const p of res.parts) {
      const strict = parsePattern(p.text);
      expect(strict.ok, p.name).toBe(true);
      expect(strict.total, p.name).toBe(p.calculatedTotal);
    }
  });
  it('re-converting the normalized text is idempotent', () => {
    for (const p of res.parts) {
      const again = convertPartText(p.text, p.name);
      expect(again.text, p.name).toBe(p.text);
    }
  });
  it('the normalized document is recoverable and keeps the original untouched', () => {
    expect(normalizedDocument(res)).toContain('الجسم:\nR1: 6sc in MR [6]');
    const r2: ConversionResult = convertPatternText(res.original);
    expect(r2.parts.length).toBe(res.parts.length);
  });
});
