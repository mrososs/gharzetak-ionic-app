import { describe, expect, it } from 'vitest';
import { createInstances } from './collections';
import { JoyContext, JoyOrigin, JoySnapshot, OPEN_ENDED_MILESTONE_EVERY, detectJoy, isValidJoyRow, joyKey, rowFromEvent } from './joy';
import { parsePattern } from './pattern-parser';
import {
  TrackerLike,
  createPatternCursor,
  createSimpleCounter,
  patternJump,
  patternReset,
  patternTap,
  patternUndo,
  simpleNextRound,
  simpleReset,
  simpleSetTarget,
  simpleTap,
  simpleUndo,
} from './tracker-engine';

const TEXT = 'R1: 6sc in MR [6]\nR2: inc x 6 [12]\nR3: (sc, inc) x 6 [18]\nR4: (2sc, inc) x 6 [24]\nR5: 24sc [24]';
const parsed = parsePattern(TEXT);

const tracker = (over: Partial<TrackerLike> = {}): TrackerLike => ({
  mode: 'simple',
  simple: createSimpleCounter({ target: 3, perTap: 1 }),
  cursor: createPatternCursor(),
  patternId: null,
  updatedAt: 1,
  ...over,
});
const snap = (t: TrackerLike, status: 'active' | 'paused' | 'done' = 'active'): JoySnapshot => ({ tracker: t, status });
const ctx = (over: Partial<JoyContext> = {}): JoyContext => ({ origin: 'tap', projectId: 'p1', instanceId: null, parsed: null, ...over });
const kinds = (events: { kind: string }[]) => events.map((e) => e.kind);

/** One tap in pattern mode, returning the before/after snapshots. */
function patternTapped(c: ReturnType<typeof createPatternCursor>) {
  const b = tracker({ mode: 'pattern', cursor: c });
  const a = tracker({ mode: 'pattern', cursor: patternTap(parsed, c) });
  return { b, a };
}

describe('detectJoy — simple counter', () => {
  it('fires `round` only on the tap that reaches the target, never mid-round', () => {
    let t = tracker();
    const seen: string[][] = [];
    for (let i = 0; i < 3; i++) {
      const next = { ...t, simple: simpleTap(t.simple) };
      seen.push(kinds(detectJoy(snap(t), snap(next), ctx())));
      t = next;
    }
    expect(seen).toEqual([[], [], ['round']]);
  });

  it('the tap AFTER completion (moving to the next round) is not an event', () => {
    const done = tracker({ simple: simpleTap(simpleTap(simpleTap(createSimpleCounter({ target: 3 })))) });
    const next = { ...done, simple: simpleNextRound(done.simple) };
    expect(detectJoy(snap(done), snap(next), ctx())).toEqual([]);
  });

  it('uses the round number as a stable id and as the display number', () => {
    const b = tracker({ simple: createSimpleCounter({ round: 6, target: 2, count: 1 }) });
    const a = { ...b, simple: simpleTap(b.simple) };
    const [e] = detectJoy(snap(b), snap(a), ctx());
    expect(e).toMatchObject({ kind: 'round', round: 6, display: 6, projectId: 'p1', instanceId: null });
  });

  it('a perTap larger than the remaining stitches still completes exactly once', () => {
    const b = tracker({ simple: createSimpleCounter({ target: 32, perTap: 5, count: 30 }) });
    const a = { ...b, simple: simpleTap(b.simple) };
    expect(b.simple.count).toBe(30);
    expect(a.simple.count).toBe(32);
    expect(kinds(detectJoy(snap(b), snap(a), ctx()))).toEqual(['round']);
  });

  it('lowering the target to the current count (a settings edit) is never an event', () => {
    const b = tracker({ simple: createSimpleCounter({ target: 10, count: 4 }) });
    const a = { ...b, simple: simpleSetTarget(b.simple, 4) };
    expect(detectJoy(snap(b), snap(a), ctx({ origin: 'settings' }))).toEqual([]);
    expect(detectJoy(snap(b), snap(a), ctx({ origin: 'edit' }))).toEqual([]);
  });

  it('percentage milestones need a known total; open-ended counting uses every 10th round instead', () => {
    const b = tracker({ simple: createSimpleCounter({ round: OPEN_ENDED_MILESTONE_EVERY, target: 2, count: 1, totalRounds: 0 }) });
    const a = { ...b, simple: simpleTap(b.simple) };
    const events = detectJoy(snap(b), snap(a), ctx());
    expect(kinds(events)).toEqual(['round', 'milestone']);
    expect(events[1]).toMatchObject({ roundCount: 10, pct: null });

    const b9 = tracker({ simple: createSimpleCounter({ round: 9, target: 2, count: 1, totalRounds: 0 }) });
    expect(kinds(detectJoy(snap(b9), snap({ ...b9, simple: simpleTap(b9.simple) }), ctx()))).toEqual(['round']);
  });

  it('fires 25/50/75 % for a simple counter with a known total, once each', () => {
    const fire = (round: number, total: number) => {
      const b = tracker({ simple: createSimpleCounter({ round, target: 1, count: 0, totalRounds: total }) });
      return detectJoy(snap(b), snap({ ...b, simple: simpleTap(b.simple) }), ctx()).filter((e) => e.kind === 'milestone');
    };
    expect(fire(2, 8)).toHaveLength(1); // 2/8 = 25 %
    expect(fire(2, 8)[0].pct).toBe(25);
    expect(fire(4, 8)[0].pct).toBe(50);
    expect(fire(6, 8)[0].pct).toBe(75);
    expect(fire(3, 8)).toHaveLength(0);
    expect(fire(8, 8)).toHaveLength(0); // 100 % is the piece / project completion, not a milestone
  });
});

describe('detectJoy — pattern mode', () => {
  it('action mode: only the stitch that finishes the round fires; advancing from a complete round does not', () => {
    let c = createPatternCursor({ mode: 'action' });
    const fired: number[] = [];
    // R1 has 1 action ("6sc in MR"), R2 has 1 action group etc. — tap until we pass R2 and look at every transition.
    for (let i = 0; i < 12; i++) {
      const { b, a } = patternTapped(c);
      if (detectJoy(snap(b), snap(a), ctx({ parsed })).some((e) => e.kind === 'round')) fired.push(c.roundIndex + 1);
      c = patternTap(parsed, c);
    }
    expect(new Set(fired).size).toBe(fired.length); // no round id is reported twice
    expect(fired.length).toBeGreaterThan(0);
  });

  it('round mode jumps straight to the next round and is still recognised (no stored "complete" cursor exists)', () => {
    const c = createPatternCursor({ mode: 'round', roundIndex: 1, ptr: 0 });
    const { b, a } = patternTapped(c);
    expect(a.cursor.roundIndex).toBe(2);
    expect(a.cursor.ptr).toBe(0); // the engine stored NO "complete" state
    const events = detectJoy(snap(b), snap(a), ctx({ parsed }));
    expect(events[0]).toMatchObject({ kind: 'round', round: 2, display: 2, total: 5 });
  });

  it('group mode finishing the round on the last repeat group fires once', () => {
    let c = createPatternCursor({ mode: 'group', roundIndex: 2, ptr: 0 });
    let count = 0;
    for (let i = 0; i < 30 && c.roundIndex === 2; i++) {
      const { b, a } = patternTapped(c);
      if (detectJoy(snap(b), snap(a), ctx({ parsed })).some((e) => e.kind === 'round')) count++;
      c = a.cursor;
    }
    expect(count).toBe(1);
  });

  it('the last round of the pattern fires a round (and, for a single tracker, nothing about parts or the project)', () => {
    const c = createPatternCursor({ mode: 'round', roundIndex: 4, ptr: 0 });
    const { b, a } = patternTapped(c);
    expect(a.cursor.ptr).toBe(parsed.rounds[4].acts.length);
    expect(kinds(detectJoy(snap(b), snap(a), ctx({ parsed })))).toEqual(['round']);
  });

  it('a tap on an already-complete last round changes nothing and fires nothing', () => {
    const c = createPatternCursor({ mode: 'round', roundIndex: 4, ptr: parsed.rounds[4].acts.length });
    const { b, a } = patternTapped(c);
    expect(a.cursor).toEqual(b.cursor);
    expect(detectJoy(snap(b), snap(a), ctx({ parsed }))).toEqual([]);
  });

  it('without the parsed (pinned) pattern nothing is detected — never guesses from the live text', () => {
    const c = createPatternCursor({ mode: 'round', roundIndex: 1, ptr: 0 });
    const { b, a } = patternTapped(c);
    expect(detectJoy(snap(b), snap(a), ctx({ parsed: null }))).toEqual([]);
  });

  it('a pattern that cannot be parsed (empty rounds) never completes a round', () => {
    const bad = parsePattern('');
    const c = createPatternCursor({ mode: 'round' });
    const b = tracker({ mode: 'pattern', cursor: c });
    const a = tracker({ mode: 'pattern', cursor: patternTap(bad, c) });
    expect(detectJoy(snap(b), snap(a), ctx({ parsed: bad }))).toEqual([]);
  });

  it('fires pattern milestones when rounds done crosses 25/50/75 % (4+ rounds)', () => {
    const at = (roundIndex: number) => {
      const c = createPatternCursor({ mode: 'round', roundIndex, ptr: 0 });
      const { b, a } = patternTapped(c);
      return detectJoy(snap(b), snap(a), ctx({ parsed })).find((e) => e.kind === 'milestone');
    };
    // 5 rounds: 1/5=20 (none), 2/5=40 (25), 3/5=60 (50), 4/5=80 (75)
    expect(at(0)).toBeUndefined();
    expect(at(1)?.pct).toBe(25);
    expect(at(2)?.pct).toBe(50);
    expect(at(3)?.pct).toBe(75);
  });

  it('a mode change between before and after is never an event', () => {
    const b = tracker({ mode: 'pattern', cursor: createPatternCursor({ mode: 'round', roundIndex: 1 }) });
    const a = tracker({ mode: 'simple' });
    expect(detectJoy(snap(b), snap(a), ctx({ parsed }))).toEqual([]);
  });
});

describe('detectJoy — origins other than tap/finish never create events', () => {
  const others: JoyOrigin[] = ['undo', 'reset', 'edit', 'sync', 'load', 'import', 'settings'];

  it.each(others)('origin %s produces nothing even when the position now looks complete', (origin) => {
    const b = tracker({ simple: createSimpleCounter({ target: 3, count: 2 }) });
    const a = { ...b, simple: simpleTap(b.simple) };
    expect(detectJoy(snap(b), snap(a), ctx({ origin }))).toEqual([]);
    const pb = tracker({ mode: 'pattern', cursor: createPatternCursor({ mode: 'round', roundIndex: 1 }) });
    const pa = { ...pb, cursor: patternTap(parsed, pb.cursor) };
    expect(detectJoy(snap(pb), snap(pa), ctx({ origin, parsed }))).toEqual([]);
    expect(detectJoy(snap(b, 'active'), snap(a, 'done'), ctx({ origin }))).toEqual([]);
  });

  it('undo then re-completing is a normal tap again — dedupe is the ledger\'s job, and the detector reports the same key both times', () => {
    const b = tracker({ simple: createSimpleCounter({ target: 3, count: 2 }) });
    const done = { ...b, simple: simpleTap(b.simple) };
    const first = detectJoy(snap(b), snap(done), ctx());
    const undone = { ...done, simple: simpleUndo(done.simple) };
    expect(detectJoy(snap(done), snap(undone), ctx({ origin: 'undo' }))).toEqual([]);
    const again = detectJoy(snap(undone), snap({ ...undone, simple: simpleTap(undone.simple) }), ctx());
    expect(joyKey(first[0])).toBe(joyKey(again[0]));
  });

  it('reset / jump / pattern undo are silent', () => {
    const c = createPatternCursor({ mode: 'action', roundIndex: 2, ptr: 1 });
    const b = tracker({ mode: 'pattern', cursor: c });
    expect(detectJoy(snap(b), snap({ ...b, cursor: patternReset(c) }), ctx({ origin: 'reset', parsed }))).toEqual([]);
    expect(detectJoy(snap(b), snap({ ...b, cursor: patternJump(parsed, c, 4) }), ctx({ origin: 'edit', parsed }))).toEqual([]);
    expect(detectJoy(snap(b), snap({ ...b, cursor: patternUndo(c) }), ctx({ origin: 'undo', parsed }))).toEqual([]);
    const s = tracker({ simple: createSimpleCounter({ target: 3, count: 2 }) });
    expect(detectJoy(snap(s), snap({ ...s, simple: simpleReset(s.simple) }), ctx({ origin: 'reset' }))).toEqual([]);
  });
});

describe('detectJoy — multi-part instances', () => {
  const parts = [
    { id: 'h', name: 'Head', quantity: 1, text: 'R1: 6sc in MR [6]\nR2: inc x 6 [12]', assemblyNotes: '' },
    { id: 'a', name: 'Arm', quantity: 2, text: 'R1: 6sc in MR [6]\nR2: inc x 6 [12]', assemblyNotes: '' },
  ];
  let n = 0;
  const { snapshots, instances } = createInstances(parts, () => `i${++n}`, 1);
  const head = instances[0];
  const headParsed = parsePattern(snapshots[0].text);

  it('finishing the last round of a piece fires round + part, but NOT allParts while other pieces are open', () => {
    const b = tracker({ mode: 'pattern', cursor: createPatternCursor({ mode: 'round', roundIndex: 1, ptr: 0 }) });
    const a = { ...b, cursor: patternTap(headParsed, b.cursor) };
    const partsAfter = instances.map((i) => (i.id === head.id ? { ...i, mode: 'pattern' as const, cursor: a.cursor } : i));
    const events = detectJoy(snap(b), snap(a), ctx({ instanceId: head.id, parsed: headParsed, partsAfter, partSnapshots: snapshots }));
    expect(kinds(events)).toEqual(['round', 'part']);
    expect(events[1]).toMatchObject({ kind: 'part', instanceId: head.id });
  });

  it('finishing the final open piece also fires allParts (and never project — that needs an explicit finish)', () => {
    const doneCursor = (len: number) => createPatternCursor({ mode: 'round', roundIndex: 1, ptr: len });
    const len = headParsed.rounds[1].acts.length;
    const others = instances.map((i) => (i.id === head.id ? i : { ...i, mode: 'pattern' as const, cursor: doneCursor(len) }));
    const b = tracker({ mode: 'pattern', cursor: createPatternCursor({ mode: 'round', roundIndex: 1, ptr: 0 }) });
    const a = { ...b, cursor: patternTap(headParsed, b.cursor) };
    const partsAfter = others.map((i) => (i.id === head.id ? { ...i, mode: 'pattern' as const, cursor: a.cursor } : i));
    const events = detectJoy(snap(b), snap(a), ctx({ instanceId: head.id, parsed: headParsed, partsAfter, partSnapshots: snapshots }));
    expect(kinds(events)).toEqual(['round', 'part', 'allParts']);
    expect(events[2]).toMatchObject({ kind: 'allParts', projectId: 'p1', instanceId: null });
  });

  it('keys are per instance, so Arm 1 and Arm 2 never share a ledger row', () => {
    const e1 = { kind: 'round' as const, projectId: 'p1', instanceId: 'i2', round: 1 };
    const e2 = { ...e1, instanceId: 'i3' };
    expect(joyKey(e1)).not.toBe(joyKey(e2));
  });
});

describe('detectJoy — explicit project completion', () => {
  const t = tracker();
  it('finish fires `project` only on the transition into done', () => {
    expect(kinds(detectJoy(snap(t, 'active'), snap(t, 'done'), ctx({ origin: 'finish' })))).toEqual(['project']);
    expect(detectJoy(snap(t, 'done'), snap(t, 'done'), ctx({ origin: 'finish' }))).toEqual([]);
    expect(detectJoy(snap(t, 'active'), snap(t, 'paused'), ctx({ origin: 'finish' }))).toEqual([]);
  });

  it('a counting tap never completes the project by itself', () => {
    const b = tracker({ simple: createSimpleCounter({ round: 3, target: 1, count: 0, totalRounds: 3 }) });
    const a = { ...b, simple: simpleTap(b.simple) };
    expect(kinds(detectJoy(snap(b), snap(a), ctx()))).toEqual(['round']);
    expect(detectJoy(snap(b), snap(a), ctx()).some((e) => e.kind === 'project')).toBe(false);
  });
});

describe('ledger keys and rows', () => {
  it('keys are stable and distinguish every kind', () => {
    const keys = [
      joyKey({ kind: 'round', projectId: 'p', instanceId: null, round: 3 }),
      joyKey({ kind: 'round', projectId: 'p', instanceId: 'i', round: 3 }),
      joyKey({ kind: 'milestone', projectId: 'p', instanceId: 'i', pct: 50 }),
      joyKey({ kind: 'milestone', projectId: 'p', instanceId: 'i', roundCount: 10 }),
      joyKey({ kind: 'part', projectId: 'p', instanceId: 'i' }),
      joyKey({ kind: 'allParts', projectId: 'p' }),
      joyKey({ kind: 'project', projectId: 'p' }),
      joyKey({ kind: 'achievement', achievementId: 'first_round' }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(joyKey({ kind: 'round', projectId: 'p', instanceId: null, round: 3 })).toBe('r|p|-|3');
  });

  it('rowFromEvent keeps the key and validates', () => {
    const row = rowFromEvent({ kind: 'round', projectId: 'p', instanceId: null, round: 2, display: 2 }, 123);
    expect(row).toMatchObject({ key: 'r|p|-|2', at: 123, source: 'live' });
    expect(isValidJoyRow(row)).toBe(true);
    expect(isValidJoyRow({ ...row, at: Number.NaN })).toBe(false);
    expect(isValidJoyRow({ ...row, kind: 'nope' })).toBe(false);
    expect(isValidJoyRow({ key: 'a|x', kind: 'achievement', at: 1 })).toBe(false);
    expect(isValidJoyRow(null)).toBe(false);
  });
});

