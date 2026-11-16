import { describe, expect, it } from 'vitest';
import { groupEnd, parsePattern, parseRound } from './pattern-parser';
import { convertText, convertToken, displayInTerms } from './terminology';

describe('pattern parser', () => {
  it('parses a repeat group with a declared total', () => {
    const r = parseRound('R5: (3sc, inc) × 6 [30]', 0);
    expect(r).toMatchObject({ ok: true, n: 5, reps: 6, cons: 24, prod: 30, declared: 30, mismatch: false });
    expect(r.acts.length).toBe(24);
    expect(r.unit.map((u) => u.k)).toEqual(['sc', 'sc', 'sc', 'inc']);
  });

  it('accepts x, ×, ✕ and * as the repeat sign', () => {
    for (const sign of ['x', '×', '✕', '*']) {
      expect(parseRound(`R3: (sc, inc) ${sign} 6 [18]`, 0)).toMatchObject({ ok: true, prod: 18 });
    }
  });

  it('accepts Rnd / Round prefixes and "." separator', () => {
    expect(parseRound('Rnd 8. (3sc, dec) x 6 [24]', 0)).toMatchObject({ ok: true, n: 8, cons: 30, prod: 24 });
    expect(parseRound('Round 2: inc x 6', 0)).toMatchObject({ ok: true, n: 2, prod: 12, declared: null });
  });

  it('handles the magic ring', () => {
    expect(parseRound('R1: 6sc in MR [6]', 0)).toMatchObject({ ok: true, cons: 0, prod: 6 });
    expect(parseRound('R1: 6 sc in magic ring', 0)).toMatchObject({ ok: true, cons: 0, prod: 6 });
  });

  it('flags a declared total that differs from the maths', () => {
    expect(parseRound('R4: (2sc, inc) × 6 [25]', 0)).toMatchObject({ ok: true, prod: 24, mismatch: true });
  });

  it('marks unsupported syntax instead of guessing', () => {
    expect(parseRound('R6: 5 popcorn, ch 2', 0)).toMatchObject({ ok: false, err: 'syntax' });
    expect(parseRound('R6: (sc, inc) × 0', 0).ok).toBe(false);
  });

  it('checks that each round consumes what the previous produced', () => {
    const p = parsePattern('R1: 6sc in MR [6]\nR2: inc × 6 [12]\nR3: (2sc, inc) × 6 [24]');
    expect(p.rounds.map((r) => r.chain)).toEqual(['na', 'ok', 'bad']);
    expect(p.ok).toBe(true);
    expect(p.total).toBe(42);
  });

  it('reports bad lines and an overall not-ok pattern', () => {
    const p = parsePattern('R1: 6sc in MR [6]\nR2: magic happens');
    expect(p.ok).toBe(false);
    expect(p.bad).toBe(1);
  });

  it('ignores blank lines', () => {
    expect(parsePattern('\n\nR1: 6sc in MR [6]\n\n').rounds.length).toBe(1);
  });

  it('groupEnd finds the end of the current repeat', () => {
    const r = parseRound('R3: (sc, inc) × 6 [18]', 0);
    expect(groupEnd(r.acts, 0)).toBe(2);
    expect(groupEnd(r.acts, 3)).toBe(4);
    expect(groupEnd(r.acts, 12)).toBe(12);
  });
});

describe('terminology converter', () => {
  it('converts US → UK on word boundaries and after numbers', () => {
    const r = convertText('R3: (sc, inc) × 6 [18]', 'us2uk');
    expect(r.out).toBe('R3: (dc, inc) × 6 [18]');
    expect(r.n).toBe(1);
    expect(convertText('12hdc, 6dc, ch 3', 'us2uk').out).toBe('12htr, 6tr, ch 3');
  });

  it('does not double convert (dc → tr, not tr → dtr)', () => {
    expect(convertText('sc, dc, tr', 'us2uk').out).toBe('dc, tr, dtr');
  });

  it('converts UK → US', () => {
    expect(convertText('sl st, 4tr, dtr', 'uk2us')).toEqual({ out: 'sl st, 4dc, tr', n: 2 });
  });

  it('keeps case and leaves other words alone', () => {
    expect(convertText('SC into the scallop', 'us2uk').out).toBe('DC into the scallop');
  });

  it('converts single tokens and display text', () => {
    expect(convertToken('sc', 'us', 'uk')).toBe('dc');
    expect(convertToken('inc', 'us', 'uk')).toBe('inc');
    expect(displayInTerms('6sc in MR', 'us', 'us')).toBe('6sc in MR');
    expect(displayInTerms('6sc in MR', 'us', 'uk')).toBe('6dc in MR');
  });
});
