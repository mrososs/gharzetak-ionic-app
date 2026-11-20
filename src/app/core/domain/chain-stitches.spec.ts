/**
 * Chain stitches (`ch`): `R1: 43 ch` used to be rejected by BOTH parsers because `ch` was not a stitch kind at all.
 * A chain is a first-class instruction now, but it is never counted as a stitch: patterns differ on whether the next row works into a
 * chain, so chains are reported separately (`chains`) with a role decided only from their position, and nothing is guessed.
 */
import { describe, expect, it } from 'vitest';
import { convertToken, convertText } from './terminology';
import { MAX_CHAIN_COUNT, MAX_TURNING_CHAIN, classifyChains, foundationRowCount, parsePattern, parseRound } from './pattern-parser';
import { ConvRound, convertPartText, convertPatternText } from './smart-parser';
import { createPatternCursor, patternStats, patternTap } from './tracker-engine';

const rounds = (text: string, opts = {}): readonly ConvRound[] => {
  const r = convertPatternText(text, opts);
  expect(r.parts).toHaveLength(1);
  return r.parts[0].rounds;
};
const last = (text: string): ConvRound => {
  const rs = rounds(text);
  return rs[rs.length - 1];
};
const codes = (r: ConvRound) => r.messages.map((m) => m.code);
const text = (r: ConvRound, code: string, lang: 'ar' | 'en' = 'en') => r.messages.find((m) => m.code === code)?.[lang] ?? '';
/** The strict parser (what the tracker runs) must agree with the converter's numbers, chains included. */
const strictAgrees = (r: ConvRound) => {
  const s = parsePattern(r.normalized).rounds[0];
  expect(s.ok, r.normalized).toBe(true);
  expect(s.prod, r.normalized).toBe(r.calculated);
  expect(s.cons, r.normalized).toBe(r.consumed);
  expect(s.chains, r.normalized).toBe(r.chains);
};

describe('root cause: the reported line', () => {
  it('R1: 43 ch is a valid foundation chain in the strict parser (it was { ok: false, err: "syntax" })', () => {
    const r = parseRound('R1: 43 ch', 0);
    expect(r).toMatchObject({ ok: true, n: 1, cons: 0, prod: 0, chains: 43, chainRole: 'foundation', mismatch: false });
    expect(r.acts).toHaveLength(43);
    expect(r.acts.every((a) => a.k === 'ch' && a.cons === 0 && a.prod === 0)).toBe(true);
  });

  it('and in the converter it is validated, with the rule explained rather than silent', () => {
    const r = last('R1: 43 ch');
    expect(r).toMatchObject({ status: 'validated', normalized: 'R1: 43ch', chains: 43, chainRole: 'foundation', calculated: 0, consumed: 0 });
    expect(codes(r)).toContain('foundation-chain');
    expect(text(r, 'foundation-chain')).toMatch(/not counted as stitches/);
    strictAgrees(r);
  });
});

describe('equivalent spellings', () => {
  it.each(['R1: 43 ch', 'R1: 43ch', 'R1: ch 43', 'R1: ch43', 'R1: CH 43', 'R1: 43 CH', 'R1: 43 chs', 'R1: 43 chain', 'R1: 43 chains', 'R1:   43   ch  ', 'Rnd 1. 43 ch', 'Round 1: 43 ch'])(
    'strict: «%s» = 43 chains',
    (line) => {
      expect(parseRound(line, 0), line).toMatchObject({ ok: true, cons: 0, prod: 0, chains: 43, chainRole: 'foundation' });
    },
  );

  it.each([
    'R1: 43 ch',
    'R1: 43ch',
    'R1: ch 43',
    'R1: ch43',
    'Row 1: 43 ch',
    'Rnd 1: 43 chains',
    'R1: Chain 43',
    'R1: 43 chain stitches',
    'R1: 43 ch sts',
    'R1: ch 43 sts',
    'R1: make 43 ch',
    'R1: chain of 43',
    'Row 1 - 43 ch.',
    'R1: 43 ch (43)',
    'R1: 43 ch [43]',
    'R1: 43 ch = 43',
  ])('converter: «%s» → R1: 43ch, validated, 43 chains', (line) => {
    const r = last(line);
    expect(r, line).toMatchObject({ status: 'validated', chains: 43, chainRole: 'foundation', calculated: 0 });
    expect(r.normalized.startsWith('R1: 43ch')).toBe(true);
    strictAgrees(r);
  });

  it('a bare «ch» is one chain, and ch is case-insensitive', () => {
    expect(parseRound('R1: ch', 0)).toMatchObject({ ok: true, chains: 1 });
    expect(last('R1: Ch 1')).toMatchObject({ chains: 1, status: 'validated' });
  });

  it('chains are the same in US and UK terminology', () => {
    expect(last('R1: 43 ch\nR2: 42 sc').normalized).toBe('R2: 42sc');
    const uk = convertPatternText('R1: 43 ch\nR2: 42 dc\nR3: 42 htr', { terms: 'uk' }).parts[0].rounds;
    expect(uk.map((r) => r.normalized)).toEqual(['R1: 43ch', 'R2: 42sc', 'R3: 42hdc']);
    expect(convertToken('ch', 'us', 'uk')).toBe('ch');
    expect(convertToken('ch', 'uk', 'us')).toBe('ch');
    expect(convertText('43ch, 12sc', 'us2uk').out).toBe('43ch, 12dc');
  });
});

describe('Arabic chain terminology', () => {
  it.each([
    ['الدور ١: ٤٣ سلسلة', 43],
    ['الدور ١: سلسلة ٤٣', 43],
    ['الدور ١: سلسلة من ٤٣', 43],
    ['الدور ١: سلسلة من ٤٣ غرزة', 43],
    ['الدور ١: ٤٣ غرزة سلسلة', 43],
    ['الدور ١: ٤٣ غرز سلسلة', 43],
    ['الدور ١: ٤٣ سلاسل', 43],
    ['الدور ١: ٤٣ تشين', 43],
    ['الصف ١: ٤٣ سلسلة', 43],
    ['الدور ١: سلسلتين', 2],
    ['الدور ١: ٤٣ سلسلة (٤٣)', 43],
    ['الدور ١: ٤٣ سلسلة [٤٣]', 43],
    ['الدور ١: اعملي ٤٣ سلسلة', 43],
  ])('«%s» → %i chains', (line, n) => {
    const r = last(line);
    expect(r, line).toMatchObject({ status: 'validated', chains: n, chainRole: 'foundation', normalized: `R1: ${n > 1 ? n : ''}ch${/\(|\[/.test(line) ? ` [${n}]` : ''}` });
    strictAgrees(r);
  });

  it('Arabic and English can be mixed in one line', () => {
    const rs = rounds('الدور ١: ٤٣ سلسلة\nالدور ٢: 42 sc\nالدور ٣: ٤٢ غرزة قصيرة');
    expect(rs.map((r) => [r.normalized, r.status])).toEqual([
      ['R1: 43ch', 'validated'],
      ['R2: 42sc', 'validated'],
      ['R3: 42sc', 'validated'],
    ]);
  });

  it('an Arabic turning chain and a trailing «اقلبي الشغل»', () => {
    const r = last('R1: 42 sc\nالدور ٢: سلسلة ١، اقلبي الشغل، ٤٢ غرزة قصيرة');
    expect(r).toMatchObject({ status: 'validated', normalized: 'R2: ch, 42sc', chains: 1, chainRole: 'turning', calculated: 42, consumed: 42 });
    expect(text(r, 'turn', 'ar')).toMatch(/اقلبي/);
  });

  it('the messages are available in Arabic', () => {
    const r = last('الدور ١: ٤٣ سلسلة');
    expect(text(r, 'foundation-chain', 'ar')).toMatch(/سلسلة/);
  });
});

describe('foundation chain → the first row (validated by the standard rule, and the rule is reported)', () => {
  it.each([
    ['sc', 42],
    ['hdc', 41],
    ['dc', 40],
    ['tr', 39],
  ])('43 ch then %s: %i stitches is the standard count', (st, n) => {
    const [, r2] = rounds(`R1: 43 ch\nR2: ${n}${st}`);
    expect(r2, st).toMatchObject({ status: 'validated', consumed: n, calculated: n });
    expect(codes(r2)).toContain('foundation-rule');
    expect(text(r2, 'foundation-rule')).toMatch(/43-chain foundation/);
    strictAgrees(r2);
  });

  it('a different count is NOT silently accepted: needs review, naming the expected number', () => {
    const [, r2] = rounds('R1: 43 ch\nR2: 43 sc');
    expect(r2.status).toBe('needs-review');
    expect(codes(r2)).toContain('foundation-count');
    expect(text(r2, 'foundation-count')).toMatch(/normally uses 42/);
    expect(codes(r2)).not.toContain('foundation-rule');
  });

  it('a first stitch with no standard rule (an increase) is not guessed either', () => {
    const [, r2] = rounds('R1: 43 ch\nR2: 6 inc');
    expect(r2.status).toBe('needs-review');
    expect(text(r2, 'foundation-count')).toMatch(/no standard rule/);
  });

  it('only the NEXT row is checked against the foundation: later rows chain from stitches as usual', () => {
    const rs = rounds('R1: 43 ch\nR2: 42 sc\nR3: 42 sc\nR4: 41 sc');
    expect(rs.map((r) => r.status)).toEqual(['validated', 'validated', 'validated', 'needs-review']);
    expect(codes(rs[3])).toContain('chain');
    expect(codes(rs[2])).not.toContain('foundation-rule');
  });

  it('the row after a foundation chain cannot say "in each stitch": there is no stitch count to take it from', () => {
    const r = last('R1: 43 ch\nR2: 2 sc in each st');
    expect(r).toMatchObject({ status: 'unsupported', calculated: null });
    expect(codes(r)).toContain('each-unknown');
  });

  it('strict parser: the same rule drives the continuity flag (ok / bad / na)', () => {
    const flags = (t: string) => parsePattern(t).rounds.map((r) => r.chain);
    expect(flags('R1: 43 ch\nR2: 42 sc')).toEqual(['na', 'ok']);
    expect(flags('R1: 43 ch\nR2: 43 sc')).toEqual(['na', 'bad']);
    expect(flags('R1: 43 ch\nR2: 41 hdc')).toEqual(['na', 'ok']);
    expect(flags('R1: 43 ch\nR2: 40 dc')).toEqual(['na', 'ok']);
    expect(flags('R1: 43 ch\nR2: 39 tr')).toEqual(['na', 'ok']);
    expect(flags('R1: 43 ch\nR2: 6 inc')).toEqual(['na', 'na']); // no rule for the first stitch: not checked
    expect(flags('R1: 43 ch\nR2: ch 1, 42 sc\nR3: 42 sc')).toEqual(['na', 'ok', 'ok']);
  });

  it('foundationRowCount is the single source of the rule', () => {
    expect(foundationRowCount(43, 'sc')).toBe(42);
    expect(foundationRowCount(43, 'hdc')).toBe(41);
    expect(foundationRowCount(43, 'dc')).toBe(40);
    expect(foundationRowCount(43, 'tr')).toBe(39);
    expect(foundationRowCount(43, 'inc')).toBeNull();
    expect(foundationRowCount(43, null)).toBeNull();
    expect(foundationRowCount(1, 'sc')).toBeNull(); // nothing would be left to work into
  });
});

describe('turning chains', () => {
  const R1 = 'R1: 42 sc\n';

  it('a leading chain before the row is a turning chain: not counted, the row still chains from the previous one', () => {
    const r = last(`${R1}R2: ch 1, 42 sc`);
    expect(r).toMatchObject({ status: 'validated', normalized: 'R2: ch, 42sc', chains: 1, chainRole: 'turning', calculated: 42, consumed: 42 });
    expect(codes(r)).toContain('turning-chain');
    strictAgrees(r);
  });

  it.each([
    ['sc', 'ch 1', 1],
    ['hdc', 'ch 2', 2],
    ['dc', 'ch 3', 3],
    ['tr', 'ch 4', 4],
  ])('%s row with «%s»', (st, lead, n) => {
    const r = last(`${R1}R2: ${lead}, turn, 42 ${st}`);
    expect(r).toMatchObject({ status: 'validated', chains: n, chainRole: 'turning', consumed: 42, calculated: 42 });
  });

  it('«turn» is dropped from the strict text but reported, and the original line is kept', () => {
    const r = last(`${R1}Row 2: ch 1, turn, 42 sc`);
    expect(r.original).toBe('Row 2: ch 1, turn, 42 sc');
    expect(r.normalized).toBe('R2: ch, 42sc');
    expect(codes(r)).toContain('turn');
  });

  it.each(['R2: ch 1 and turn, 42 sc', 'R2: ch 1 turn 42 sc', 'R2: 42 sc, ch 1, turn', 'R2: ch 1, turn your work, 42 sc', 'R2: chain 1, turning, 42 sc'])('equivalent forms: «%s»', (line) => {
    const r = last(R1 + line);
    expect(r.status, line).not.toBe('unsupported');
    expect(r.calculated, line).toBe(42);
  });

  it('a round-start chain on the first round (a chain-started amigurumi round) is a turning chain too', () => {
    const r = last('R1: ch 3, 11 dc in MR');
    expect(r).toMatchObject({ chainRole: 'turning', chains: 3, calculated: 11, consumed: 0, status: 'validated' });
  });

  it('the old negative for a turning chain in Arabic now reads the row', () => {
    const r = last('R1: 6 sc in MR [6]\nالدور ٢: ٣ سلسلة، ٦ غرز قصيرة');
    expect(r).toMatchObject({ status: 'validated', chains: 3, chainRole: 'turning', calculated: 6, consumed: 6 });
  });

  it('more than four leading chains is NOT assumed to be a turning chain', () => {
    expect(MAX_TURNING_CHAIN).toBe(4);
    const r = last(`${R1}R2: ch 5, 37 sc`);
    expect(r).toMatchObject({ chainRole: 'inline', chains: 5, status: 'needs-review' });
  });

  it('the round-trip of the normalized text is stable', () => {
    const once = last(`${R1}R2: ch 1, turn, 42 sc`).normalized;
    expect(last(`${R1}${once}`).normalized).toBe(once);
  });
});

describe('chains that are not foundation or turning: never counted, never guessed', () => {
  it('chains inside a row are not counted as stitches, and the round asks for a look', () => {
    const r = last('R1: 36 sc\nR2: 6 sc, ch 6, 30 sc');
    expect(r).toMatchObject({ status: 'needs-review', chains: 6, chainRole: 'inline', calculated: 36, consumed: 36 });
    expect(codes(r)).toContain('chain-inline');
    expect(text(r, 'chain-inline')).toMatch(/not counted as stitches/);
    strictAgrees(r);
  });

  it('the next row mentions the uncounted chains when its count only works if they were stitches', () => {
    const [, , r3] = rounds('R1: 36 sc\nR2: 6 sc, ch 6, 30 sc\nR3: 42 sc');
    expect(r3.status).toBe('needs-review');
    expect(text(r3, 'chain')).toMatch(/also has 6 chains/);
  });

  it('a written total that equals stitches + chains is flagged and explained, not accepted', () => {
    const r = last('R1: 36 sc\nR2: 6 sc, ch 6, 30 sc [42]');
    expect(r.status).toBe('needs-review');
    expect(codes(r)).toContain('total-mismatch');
    expect(text(r, 'total-mismatch')).toMatch(/stitches plus the 6 chains/);
  });

  it('a chain-only row that is not the first row cannot be classified, and the next row has no count to be compared with', () => {
    const rs = rounds('R1: 42 sc\nR2: ch 20\nR3: 19 sc');
    expect(rs[1]).toMatchObject({ status: 'needs-review', chains: 20, chainRole: 'standalone', calculated: 0 });
    expect(codes(rs[1])).toContain('chain-role');
    expect(rs[2].status).toBe('validated');
    expect(codes(rs[2])).not.toContain('chain');
    expect(parsePattern('R1: 42 sc\nR2: ch 20\nR3: 19 sc').rounds.map((r) => r.chain)).toEqual(['na', 'na', 'na']);
  });

  it('chains consume nothing: a chain-only row never raises a continuity warning of its own', () => {
    const r = last('R1: 42 sc\nR2: ch 20');
    expect(codes(r)).not.toContain('chain');
  });

  it('chains repeated in a group stay inline', () => {
    const r = last('R1: 40 sc\nR2: (sc, ch 1, sc) x 10');
    expect(r).toMatchObject({ chainRole: 'inline', chains: 10, calculated: 20, consumed: 20 });
  });
});

describe('what stays unsupported (honest, not guessed)', () => {
  it.each([
    ['a chain worked into the magic ring', 'R1: 3 ch in MR'],
    ['a chain with a target', 'R2: ch 3 in each st'],
    ['"in each stitch" on a chain', 'R2: ch in each st'],
    ['a count on both sides', 'R2: 2 ch 3'],
    ['zero chains', 'R1: 0 ch'],
    ['more chains than a token may hold', `R1: ${MAX_CHAIN_COUNT + 1} ch`],
    ['a slip stitch into a chain', 'R2: ch 3, sl st in 2nd ch from hook'],
    ['skipped stitches', 'R2: 6 sc, ch 6, skip 6 sts, 18 sc'],
    ['a turn in the middle of a row (a short row)', 'R2: 20 sc, turn, 22 sc'],
    ['a turn on its own', 'R2: turn'],
    ['a chain count that is a word we do not know', 'R2: ch many'],
  ])('%s', (_label, line) => {
    const r = last('R1: 42 sc\n' + line);
    expect(r.status, line).toBe('unsupported');
    expect(r.calculated).toBeNull();
    expect(r.original).toBe(line);
  });

  it('the strict parser rejects the same notations', () => {
    for (const line of ['R1: 3 ch in MR', 'R1: 0 ch', `R1: ${MAX_CHAIN_COUNT + 1} ch`, 'R1: 2 ch 3', 'R1: ch 5 in legs']) expect(parseRound(line, 0).ok, line).toBe(false);
    expect(parseRound(`R1: ${MAX_CHAIN_COUNT} ch`, 0)).toMatchObject({ ok: true, chains: MAX_CHAIN_COUNT });
  });

  it('popcorn stays unsupported even though ch is understood', () => {
    expect(parseRound('R6: 5 popcorn, ch 2', 0)).toMatchObject({ ok: false, err: 'syntax' });
  });
});

describe('written totals', () => {
  it('a foundation chain [43] matches its chains; [42] does not', () => {
    expect(parseRound('R1: 43 ch [43]', 0)).toMatchObject({ mismatch: false, declared: 43 });
    expect(parseRound('R1: 43 ch [42]', 0)).toMatchObject({ mismatch: true });
    expect(last('R1: 43 ch [43]').status).toBe('validated');
    const bad = last('R1: 43 ch [42]');
    expect(bad.status).toBe('needs-review');
    expect(codes(bad)).toContain('total-mismatch');
  });

  it('a mixed round is compared with its stitches only', () => {
    expect(parseRound('R2: ch 1, 42 sc [42]', 1)).toMatchObject({ mismatch: false, chains: 1, prod: 42 });
    expect(parseRound('R2: ch 1, 42 sc [43]', 1)).toMatchObject({ mismatch: true });
  });

  it('the pattern total never includes chains', () => {
    expect(parsePattern('R1: 43 ch\nR2: 42 sc\nR3: 42 sc').total).toBe(84);
  });
});

describe('classification is by position, never by the next row', () => {
  it('classifyChains', () => {
    const c = (seq: [string, number][], first = false) => classifyChains(seq.map(([k, n]) => ({ k: k as never, n })), first);
    expect(c([['sc', 6]])).toEqual({ chains: 0, role: 'none' });
    expect(c([['ch', 43]], true)).toEqual({ chains: 43, role: 'foundation' });
    expect(c([['ch', 43]], false)).toEqual({ chains: 43, role: 'standalone' });
    expect(c([['ch', 1], ['sc', 42]])).toEqual({ chains: 1, role: 'turning' });
    expect(c([['ch', 4], ['dc', 9]])).toEqual({ chains: 4, role: 'turning' });
    expect(c([['ch', 5], ['dc', 9]])).toEqual({ chains: 5, role: 'inline' });
    expect(c([['sc', 6], ['ch', 6], ['sc', 30]])).toEqual({ chains: 6, role: 'inline' });
    expect(c([['ch', 1], ['sc', 5], ['ch', 1]])).toEqual({ chains: 2, role: 'inline' });
    expect(c([['sc', 5], ['ch', 2]])).toEqual({ chains: 2, role: 'inline' });
  });

  it('the same count is a different role in a different place', () => {
    expect(parseRound('R1: 3 ch', 0).chainRole).toBe('foundation');
    expect(parseRound('R4: 3 ch', 3).chainRole).toBe('standalone');
    expect(parseRound('R4: 3 ch, 9 dc', 3).chainRole).toBe('turning');
    expect(parseRound('R4: 9 dc, 3 ch', 3).chainRole).toBe('inline');
  });
});

describe('the tracker walks chains one by one and counts stitches, not chains', () => {
  it('every chain is a step; the round finishes after the last one; progress counts stitches only', () => {
    const p = parsePattern('R1: 5 ch\nR2: 4 sc');
    expect(p.ok).toBe(true);
    let c = createPatternCursor({ mode: 'action' });
    for (let i = 0; i < 5; i++) {
      const st = patternStats(p, c)!;
      expect(st.roundNumber).toBe(1);
      expect(st.actionsDone).toBe(i);
      expect(st.actionsTotal).toBe(5);
      expect(st.produced).toBe(0);
      expect(Number.isFinite(st.progress)).toBe(true);
      c = patternTap(p, c);
    }
    expect(patternStats(p, c)).toMatchObject({ roundNumber: 1, roundComplete: true, actionsDone: 5, overallProduced: 0 });
    c = patternTap(p, c); // "start round 2"
    expect(patternStats(p, c)).toMatchObject({ roundNumber: 2, actionsDone: 0, overallTotal: 4 });
    for (let i = 0; i < 4; i++) c = patternTap(p, c);
    expect(patternStats(p, c)).toMatchObject({ roundNumber: 2, roundComplete: true, patternComplete: true, overallProduced: 4, progress: 1 });
  });

  it('"whole round" mode skips all chains of a chain row at once', () => {
    const p = parsePattern('R1: 43 ch\nR2: 42 sc');
    const c = patternTap(p, createPatternCursor({ mode: 'round' }));
    expect(patternStats(p, c)).toMatchObject({ roundNumber: 2, actionsDone: 0 });
  });

  it('a turning chain is its own step before the stitches, and stitches still total correctly', () => {
    const p = parsePattern('R1: 6 sc in MR [6]\nR2: ch 3, 6 dc');
    let c = patternTap(p, createPatternCursor({ mode: 'round' }));
    expect(patternStats(p, c)).toMatchObject({ roundNumber: 2, actionsTotal: 9, roundProduced: 6, roundConsumed: 6 });
    c = createPatternCursor({ mode: 'action', roundIndex: 1, ptr: 3 });
    expect(patternStats(p, c)).toMatchObject({ produced: 0, consumed: 0 }); // 3 chains done: no stitch yet
    c = patternTap(p, c);
    expect(patternStats(p, c)).toMatchObject({ produced: 1, consumed: 1 });
  });
});

describe('realistic patterns', () => {
  it('a flat scarf: foundation chain, turning chains, steady stitch count', () => {
    const scarf = ['Scarf', 'R1: 31 ch', 'R2: 30 sc', 'R3: ch 1, turn, 30 sc', 'R4: ch 1, turn, 30 sc', 'R5-8: ch 1, turn, 30 sc'].join('\n');
    const res = convertPatternText(scarf);
    expect(res.parts).toHaveLength(1);
    const rs = res.parts[0].rounds;
    expect(rs.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rs.map((r) => r.status)).toEqual(Array(8).fill('validated'));
    expect(rs.map((r) => r.chains)).toEqual([31, 0, 1, 1, 1, 1, 1, 1]);
    expect(res.parts[0].calculatedTotal).toBe(30 * 7);
    expect(res.status).toBe('validated');
    const strict = parsePattern(res.parts[0].text);
    expect(strict.ok).toBe(true);
    expect(strict.total).toBe(210);
  });

  it('a dc blanket: ch 3 + dc, with a long foundation chain', () => {
    const rs = rounds('R1: 123 ch\nR2: 120 dc\nR3: ch 3, 120 dc\nR4: ch 3, 120 dc');
    expect(rs.map((r) => [r.chains, r.status])).toEqual([[123, 'validated'], [0, 'validated'], [3, 'validated'], [3, 'validated']]);
  });

  it('the bunny-dress summary still keeps every gap visible (its "Start: ch 43" line is a note, as before)', () => {
    const res = convertPatternText('Bunny dress\nStart: ch 43\nRow 1: 42 sc\nRow 2: 42 sc');
    expect(res.parts[0].notes).toEqual(['Start: ch 43']);
    expect(res.parts[0].rounds.map((r) => r.status)).toEqual(['validated', 'validated']);
  });

  it('each piece of a multi-part pattern has its own first round: a strap with a foundation chain next to an amigurumi head', () => {
    const doc = ['Head:', 'R1: 6 sc in MR [6]', 'R2: inc x 6 [12]', 'R3: (sc, inc) x 6 [18]', 'Strap x2:', 'R1: 21 ch', 'R2: 20 sc', 'R3: ch 1, turn, 20 sc'].join('\n');
    const res = convertPatternText(doc);
    expect(res.parts.map((p) => p.name)).toEqual(['Head', 'Strap']);
    expect(res.parts[0].rounds.map((r) => [r.calculated, r.status])).toEqual([[6, 'validated'], [12, 'validated'], [18, 'validated']]);
    expect(res.parts[1].rounds.map((r) => [r.chains, r.chainRole, r.status])).toEqual([[21, 'foundation', 'validated'], [0, 'none', 'validated'], [1, 'turning', 'validated']]);
    expect(res.parts[1].quantity).toBe(2);
  });

  it('convertPartText (re-conversion after the user fixed a line) understands chains', () => {
    const part = convertPartText('R1: 43 ch\nR2: 42 sc', 'Dress');
    expect(part).toMatchObject({ name: 'Dress', status: 'validated', text: 'R1: 43ch\nR2: 42sc' });
  });

  it('converted text is stable when converted again (idempotent)', () => {
    const src = 'R1: 43 ch\nR2: 42 sc\nR3: ch 1, turn, 42 sc\nR4: 42 sc';
    const once = convertPatternText(src).parts[0].text;
    expect(convertPatternText(once).parts[0].text).toBe(once);
  });
});

describe('regressions: sc / inc / dec / MR / multi-part keep their exact numbers', () => {
  it('the classic amigurumi ball', () => {
    const rs = rounds('R1: 6 sc in MR [6]\nR2: inc x 6 [12]\nR3: (sc, inc) x 6 [18]\nR4: (2sc, inc) x 6 [24]\nR5-7: 24 sc [24]\nR8: (2sc, dec) x 6 [18]\nR9: (sc, dec) x 6 [12]\nR10: dec x 6 [6]');
    expect(rs.map((r) => r.calculated)).toEqual([6, 12, 18, 24, 24, 24, 24, 18, 12, 6]);
    expect(rs.every((r) => r.status === 'validated' && r.chains === 0 && r.chainRole === 'none')).toBe(true);
  });

  it('the strict parser still sees no chains in a chain-free pattern, with the same flags as before', () => {
    const p = parsePattern('R1: 6sc in MR [6]\nR2: inc × 6 [12]\nR3: (2sc, inc) × 6 [24]');
    expect(p.rounds.map((r) => r.chain)).toEqual(['na', 'ok', 'bad']);
    expect(p.rounds.every((r) => r.chains === 0 && r.chainRole === 'none')).toBe(true);
    expect(p.total).toBe(42);
  });

  it('a row of stitches after a row of stitches still chains by count, including a mismatch', () => {
    expect(parsePattern('R1: 42 sc\nR2: 41 sc').rounds.map((r) => r.chain)).toEqual(['na', 'bad']);
    expect(last('R1: 42 sc\nR2: 41 sc').status).toBe('needs-review');
  });

  it('a pattern whose unit is "ch" never makes the strict and converted totals disagree', () => {
    for (const src of ['R1: 43 ch\nR2: 42 sc', 'R1: 36 sc\nR2: 6 sc, ch 6, 30 sc', 'R1: 42 sc\nR2: ch 1, 42 sc\nR3: ch 20']) {
      const part = convertPatternText(src).parts[0];
      const strict = parsePattern(part.text);
      expect(strict.ok, src).toBe(true);
      part.rounds.forEach((r, i) => {
        expect(strict.rounds[i].prod, src).toBe(r.calculated);
        expect(strict.rounds[i].cons, src).toBe(r.consumed);
        expect(strict.rounds[i].chains, src).toBe(r.chains);
      });
    }
  });
});
