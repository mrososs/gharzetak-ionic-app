import { describe, expect, it } from 'vitest';
import { parsePattern } from './pattern-parser';
import {
  createPatternCursor,
  createSimpleCounter,
  patternJump,
  patternReset,
  patternStats,
  patternTap,
  patternUndo,
  simpleAllComplete,
  simpleNextRound,
  simpleProgress,
  simpleReset,
  simpleRoundComplete,
  simpleSetTarget,
  simpleTap,
  simpleUndo,
  SimpleCounter,
  PatternCursor,
} from './tracker-engine';

const tapN = (s: SimpleCounter, n: number): SimpleCounter[] => {
  const out: SimpleCounter[] = [];
  let cur = s;
  for (let i = 0; i < n; i++) {
    cur = simpleTap(cur);
    out.push(cur);
  }
  return out;
};

describe('simple counter', () => {
  it('increments by 1', () => {
    const s = simpleTap(createSimpleCounter({ target: 6, perTap: 1 }));
    expect(s.count).toBe(1);
  });

  it('target 30, +5 → 5,10,15,20,25,30 and stops', () => {
    const seq = tapN(createSimpleCounter({ target: 30, perTap: 5 }), 8).map((s) => s.count);
    expect(seq).toEqual([5, 10, 15, 20, 25, 30, 30, 30]);
  });

  it('target 32, +5 → 5,10,15,20,25,30,32 (never exceeds the target)', () => {
    const seq = tapN(createSimpleCounter({ target: 32, perTap: 5 }), 9).map((s) => s.count);
    expect(seq).toEqual([5, 10, 15, 20, 25, 30, 32, 32, 32]);
  });

  it('undo restores the exact previous count, including the remainder tap', () => {
    let s = createSimpleCounter({ target: 32, perTap: 5 });
    for (let i = 0; i < 7; i++) s = simpleTap(s);
    expect(s.count).toBe(32);
    s = simpleUndo(s);
    expect(s.count).toBe(30);
    s = simpleUndo(s);
    expect(s.count).toBe(25);
  });

  it('undo with no history is a no-op', () => {
    const s = createSimpleCounter({ target: 10 });
    expect(simpleUndo(s)).toBe(s);
  });

  it('reset clears the round count but keeps the round number', () => {
    let s = createSimpleCounter({ target: 10, perTap: 2, round: 4 });
    s = simpleTap(simpleTap(s));
    s = simpleReset(s);
    expect(s.count).toBe(0);
    expect(s.round).toBe(4);
    expect(s.history.length).toBe(0);
  });

  it('round completion then next round, and undo across the boundary', () => {
    let s = createSimpleCounter({ target: 4, perTap: 2 });
    s = simpleTap(simpleTap(s));
    expect(simpleRoundComplete(s)).toBe(true);
    s = simpleNextRound(s);
    expect(s.round).toBe(2);
    expect(s.count).toBe(0);
    s = simpleUndo(s);
    expect(s.round).toBe(1);
    expect(s.count).toBe(4);
  });

  it('cannot advance before the round is complete', () => {
    const s = simpleTap(createSimpleCounter({ target: 10, perTap: 3 }));
    expect(simpleNextRound(s)).toBe(s);
  });

  it('all rounds complete when the last round reaches the target', () => {
    let s = createSimpleCounter({ target: 2, perTap: 2, totalRounds: 2, round: 2 });
    s = simpleTap(s);
    expect(simpleAllComplete(s)).toBe(true);
    expect(simpleNextRound(s)).toBe(s);
  });

  it('lowering the target clamps the current count', () => {
    let s = createSimpleCounter({ target: 30, perTap: 5 });
    s = simpleTap(simpleTap(simpleTap(s)));
    s = simpleSetTarget(s, 12);
    expect(s.count).toBe(12);
  });

  it('progress uses rounds when total is known', () => {
    const s = createSimpleCounter({ target: 10, count: 5, round: 2, totalRounds: 4 });
    expect(simpleProgress(s)).toBeCloseTo(0.375);
  });
});

describe('pattern-aware counter', () => {
  const head = parsePattern(
    [
      'R1: 6sc in MR [6]',
      'R2: inc × 6 [12]',
      'R3: (sc, inc) × 6 [18]',
      'R4: (2sc, inc) × 6 [24]',
      'R5: (3sc, inc) × 6 [30]',
      'R6: 30sc [30]',
      'R7: 30sc [30]',
      'R8: (3sc, dec) × 6 [24]',
      'R9: (2sc, dec) × 6 [18]',
      'R10: (sc, dec) × 6 [12]',
      'R11: dec × 6 [6]',
    ].join('\n'),
  );

  const at = (roundIndex: number, mode: PatternCursor['mode'] = 'action') => createPatternCursor({ roundIndex, mode });

  it('R5: (3sc, inc) × 6 [30] → 24 actions, 24 consumed, 30 produced, 6 groups', () => {
    let c = at(4);
    for (let i = 0; i < 24; i++) c = patternTap(head, c);
    const st = patternStats(head, c)!;
    expect(st.actionsDone).toBe(24);
    expect(st.actionsTotal).toBe(24);
    expect(st.consumed).toBe(24);
    expect(st.produced).toBe(30);
    expect(st.completedGroups).toBe(6);
    expect(st.totalGroups).toBe(6);
    expect(st.roundComplete).toBe(true);
  });

  it('does not confuse actions with output stitches mid-round', () => {
    let c = at(4);
    for (let i = 0; i < 4; i++) c = patternTap(head, c); // 3sc + inc
    const st = patternStats(head, c)!;
    expect(st.actionsDone).toBe(4);
    expect(st.consumed).toBe(4);
    expect(st.produced).toBe(5);
    expect(st.completedGroups).toBe(1);
    expect(st.currentGroup).toBe(2);
  });

  it('INC consumes 1 produces 2; DEC consumes 2 produces 1', () => {
    let inc = patternTap(head, at(1));
    expect(patternStats(head, inc)).toMatchObject({ consumed: 1, produced: 2 });
    let dec = patternTap(head, at(10));
    expect(patternStats(head, dec)).toMatchObject({ consumed: 2, produced: 1 });
    for (let i = 0; i < 5; i++) dec = patternTap(head, dec);
    expect(patternStats(head, dec)).toMatchObject({ consumed: 12, produced: 6, patternComplete: true });
    inc = patternUndo(inc);
    expect(patternStats(head, inc)).toMatchObject({ consumed: 0, produced: 0 });
  });

  it('magic ring round consumes nothing', () => {
    expect(head.rounds[0]).toMatchObject({ cons: 0, prod: 6 });
  });

  it('group mode jumps to the end of each repeat group', () => {
    let c = at(4, 'group');
    c = patternTap(head, c);
    expect(patternStats(head, c)).toMatchObject({ actionsDone: 4, consumed: 4, produced: 5, completedGroups: 1 });
    for (let i = 0; i < 5; i++) c = patternTap(head, c);
    expect(patternStats(head, c)).toMatchObject({ actionsDone: 24, produced: 30, completedGroups: 6, roundComplete: true });
  });

  it('round mode advances a whole round; on the last round it completes', () => {
    let c = patternTap(head, at(4, 'round'));
    expect(c.roundIndex).toBe(5);
    expect(c.ptr).toBe(0);
    c = patternTap(head, at(10, 'round'));
    expect(patternStats(head, c)!.patternComplete).toBe(true);
    expect(patternTap(head, c)).toBe(c); // nothing past the end
  });

  it('a tap on a finished round moves to the next round', () => {
    let c = createPatternCursor({ roundIndex: 0, ptr: 6 });
    c = patternTap(head, c);
    expect(c.roundIndex).toBe(1);
    expect(c.ptr).toBe(0);
  });

  it('undo walks back across round boundaries', () => {
    let c = at(0, 'round');
    c = patternTap(head, c);
    c = patternTap(head, c);
    expect(c.roundIndex).toBe(2);
    c = patternUndo(patternUndo(c));
    expect(c.roundIndex).toBe(0);
    expect(c.ptr).toBe(0);
  });

  it('reset restarts the current round only', () => {
    let c = at(3);
    c = patternTap(head, patternTap(head, c));
    c = patternReset(c);
    expect(c).toMatchObject({ roundIndex: 3, ptr: 0, history: [] });
  });

  it('jump records history so it can be undone', () => {
    let c = patternTap(head, at(2));
    c = patternJump(head, c, 7);
    expect(c.roundIndex).toBe(7);
    c = patternUndo(c);
    expect(c).toMatchObject({ roundIndex: 2, ptr: 1 });
  });

  it('overall progress sums produced stitches of finished rounds', () => {
    const c = createPatternCursor({ roundIndex: 2, ptr: 0 });
    const st = patternStats(head, c)!;
    expect(st.overallProduced).toBe(18); // 6 + 12
    expect(st.overallTotal).toBe(head.total);
  });

  it('an unparseable pattern leaves the cursor untouched', () => {
    const bad = parsePattern('R1: 6 popcorn in MR');
    const c = at(0);
    expect(patternTap(bad, c)).toBe(c);
    expect(patternStats(bad, c)).toBeNull();
  });
});
