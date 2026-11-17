import { describe, expect, it } from 'vitest';
import type { PatternPart } from '../models/models';
import {
  PartInstance,
  createInstances,
  instanceLabel,
  instanceProgress,
  multiPosition,
  nextUnfinished,
  planCollectionUpdate,
  projectCompletion,
  siblingsOf,
} from './collections';
import { diffPatterns, mapCursor } from './revisions';
import { createPatternCursor, patternTap } from './tracker-engine';
import { parsePattern } from './pattern-parser';

let n = 0;
const id = () => `id-${++n}`;
const part = (name: string, quantity: number, text = 'R1: 6sc in MR [6]\nR2: inc x 6 [12]\nR3: (sc, inc) x 6 [18]'): PatternPart => ({ id: `part-${name}`, name, quantity, text, assemblyNotes: '' });

const tapN = (inst: PartInstance, text: string, times: number): PartInstance => {
  const parsed = parsePattern(text);
  let c = inst.cursor;
  for (let i = 0; i < times; i++) c = patternTap(parsed, c);
  return { ...inst, cursor: c, updatedAt: inst.updatedAt + 1 };
};

describe('collections → project part instances', () => {
  const parts = [part('Head', 1), part('Arms', 2), part('Legs', 2)];

  it('generates one independent instance per physical piece (Arms ×2 → Arm 1/2 and Arm 2/2)', () => {
    const { snapshots, instances } = createInstances(parts, id, 1000);
    expect(snapshots.map((s) => [s.name, s.quantity])).toEqual([['Head', 1], ['Arms', 2], ['Legs', 2]]);
    expect(instances).toHaveLength(5);
    expect(new Set(instances.map((i) => i.id)).size).toBe(5);
    const arms = instances.filter((i) => i.partId === 'part-Arms');
    expect(arms.map((a) => a.index)).toEqual([1, 2]);
    expect(instanceLabel(arms[0], snapshots[1], siblingsOf(instances, arms[0]))).toBe('Arms 1/2');
    expect(instanceLabel(instances[0], snapshots[0], siblingsOf(instances, instances[0]))).toBe('Head');
    expect(instances.every((i) => i.mode === 'pattern' && i.cursor.roundIndex === 0 && i.cursor.ptr === 0 && i.workedSeconds === 0)).toBe(true);
  });

  it('completing Arm 1 never completes Arm 2 (separate cursors and undo history)', () => {
    const { snapshots, instances } = createInstances([part('Arms', 2)], id, 0);
    const text = snapshots[0].text;
    const total = parsePattern(text).rounds.reduce((a, r) => a + r.acts.length, 0) + 3; // taps to finish (+ round advances)
    let [a1, a2] = instances;
    a1 = tapN(a1, text, total + 5);
    expect(instanceProgress(a1, snapshots[0]).done).toBe(true);
    expect(instanceProgress(a2, snapshots[0])).toMatchObject({ done: false, started: false, fraction: 0 });
    expect(a2.cursor.history).toHaveLength(0);
    expect(a1.cursor.history.length).toBeGreaterThan(0);
    expect(a2.cursor).toEqual(createPatternCursor());
  });

  it('two projects created from the same collection never share state', () => {
    const p1 = createInstances(parts, id, 0);
    const p2 = createInstances(parts, id, 0);
    const moved = tapN(p1.instances[0], p1.snapshots[0].text, 4);
    expect(multiPosition([moved])).toBeGreaterThan(0);
    expect(p2.instances[0].cursor).toEqual(createPatternCursor());
    expect(p1.instances.map((i) => i.id).some((x) => p2.instances.some((y) => y.id === x))).toBe(false);
  });

  it('overall completion is weighted by stitches and "continue last unfinished" picks a started, unfinished piece', () => {
    const { snapshots, instances } = createInstances([part('Head', 1), part('Arms', 2)], id, 0);
    const done = tapN(instances[0], snapshots[0].text, 60);
    const half = tapN(instances[1], snapshots[1].text, 8);
    const list = [done, half, instances[2]];
    const c = projectCompletion(list, snapshots);
    expect(c.doneCount).toBe(1);
    expect(c.total).toBe(3);
    expect(c.percent).toBeGreaterThan(40);
    expect(c.percent).toBeLessThan(100);
    expect(nextUnfinished(list, snapshots, done.id)?.id).toBe(half.id); // the started one wins over the untouched one
    expect(nextUnfinished([done], snapshots, null)).toBeNull();
  });

  it('a part the counter cannot follow falls back to the simple counter (never crashes)', () => {
    const { instances } = createInstances([part('Weird', 1, 'R1: ch 3, sl st in 2nd ch')], id, 0);
    expect(instances[0].mode).toBe('simple');
    expect(instanceProgress(instances[0], undefined).fraction).toBe(0);
  });
});

describe('pattern change analysis (editing never silently corrupts progress)', () => {
  const v1 = 'R1: 6sc in MR [6]\nR2: inc x 6 [12]\nR3: (sc, inc) x 6 [18]\nR4: (2sc, inc) x 6 [24]\nR5: (3sc, inc) x 6 [30]';

  it('detects identical, edited and structural changes', () => {
    expect(diffPatterns(v1, v1).identical).toBe(true);
    const wording = diffPatterns(v1, v1.replace('R2: inc x 6 [12]', 'R2:   inc   x 6   [12]'));
    expect(wording.identical).toBe(true); // whitespace only
    const edited = diffPatterns(v1, v1.replace('R5: (3sc, inc) x 6 [30]', 'R5: (3sc, dec) x 6 [24]'));
    expect(edited).toMatchObject({ changedCount: 1, structural: true, firstChange: 4 });
    const totalOnly = diffPatterns(v1, v1.replace('[30]', '[31]'));
    expect(totalOnly).toMatchObject({ changedCount: 1, structural: false });
    const added = diffPatterns(v1, v1 + '\nR6: 36sc [36]');
    expect(added).toMatchObject({ addedCount: 1, structural: true });
  });

  it('safe: editing a LATER round leaves a mid-pattern position and its undo history untouched', () => {
    const parsed = parsePattern(v1);
    let c = createPatternCursor();
    for (let i = 0; i < 20; i++) c = patternTap(parsed, c); // somewhere in round 3
    expect(c.roundIndex).toBeGreaterThanOrEqual(2);
    const edited = v1.replace('R5: (3sc, inc) x 6 [30]', 'R5: 30sc [30]');
    const m = mapCursor(v1, edited, c);
    expect(m.level).toBe('safe');
    expect(m.cursor).toEqual(c);
    expect(m.historyDropped).toBe(0);
  });

  it('warn: editing a COMPLETED round keeps the position (never resets) and names the edited round', () => {
    const parsed = parsePattern(v1);
    let c = createPatternCursor();
    for (let i = 0; i < 40; i++) c = patternTap(parsed, c);
    const ri = c.roundIndex;
    expect(ri).toBeGreaterThanOrEqual(3);
    const edited = v1.replace('R2: inc x 6 [12]', 'R2: (inc) x 6 [12]'.replace('(inc)', 'inc')).replace('R2: inc x 6', 'R2: 6inc');
    const m = mapCursor(v1, edited, c);
    expect(m.level).toBe('warn');
    expect(m.reasons).toContain('completed-edited');
    expect(m.cursor.roundIndex).toBe(ri);
    expect(m.cursor.ptr).toBe(c.ptr);
    expect(m.affectedRounds).toContain(1);
    // undo steps that point at the unchanged rounds survive; steps inside the edited round are dropped
    expect(m.historyKept).toBeGreaterThan(0);
    expect(m.historyDropped).toBeGreaterThan(0);
    expect(m.historyKept + m.historyDropped).toBe(c.history.length);
  });

  it('warn: editing the CURRENT round clamps an impossible stitch position instead of crashing', () => {
    const parsed = parsePattern(v1);
    let c = createPatternCursor({ roundIndex: 4, ptr: 10 });
    c = { ...c, history: [] };
    expect(parsed.rounds[4].acts.length).toBeGreaterThanOrEqual(10);
    const edited = v1.replace('R5: (3sc, inc) x 6 [30]', 'R5: (sc, inc) x 2 [6]'.replace('[6]', '[6]'));
    const m = mapCursor(v1, edited, c);
    expect(m.level).toBe('warn');
    expect(m.reasons).toEqual(expect.arrayContaining(['current-edited', 'stitch-clamped']));
    expect(m.cursor.ptr).toBe(parsePattern(edited).rounds[4].acts.length);
  });

  it('unsafe: inserting a round before the current one cannot be mapped — the cursor is returned UNCHANGED for the user to decide', () => {
    const c = createPatternCursor({ roundIndex: 3, ptr: 2 });
    const inserted = v1.replace('R3:', 'R2b: 12sc [12]\nR3:');
    const m = mapCursor(v1, inserted.replace('R2b', 'R3').replace('\nR3: (sc, inc)', '\nR4: (sc, inc)'), c);
    expect(m.level).toBe('unsafe');
    expect(m.reasons).toContain('rounds-shifted');
    expect(m.cursor).toEqual(c);
  });

  it('unsafe: an unreadable new text is flagged, never applied silently', () => {
    const m = mapCursor(v1, 'R1: ch 3, sl st', createPatternCursor({ roundIndex: 2, ptr: 1 }));
    expect(m.level).toBe('unsafe');
    expect(m.reasons).toContain('new-unreadable');
  });

  it('beyond-end: if the current round was deleted the cursor moves to the end of the shorter pattern', () => {
    const m = mapCursor(v1, 'R1: 6sc in MR [6]\nR2: inc x 6 [12]', createPatternCursor({ roundIndex: 4, ptr: 3 }));
    expect(m.level).toBe('warn');
    expect(m.reasons).toContain('beyond-end');
    expect(m.cursor.roundIndex).toBe(1);
  });
});

describe('explicit update of a running project to a newer collection revision', () => {
  const base = [part('Head', 1), part('Arms', 2)];

  it('keeps every position, maps edited parts, adds new parts, and reports per part', () => {
    const { snapshots, instances } = createInstances(base, id, 0);
    const head = tapN(instances[0], snapshots[0].text, 9);
    const arm1 = tapN(instances[1], snapshots[1].text, 5);
    const current = { snapshots, instances: [head, arm1, instances[2]] };
    const edited = [
      { ...base[0], text: base[0].text.replace('R3: (sc, inc) x 6 [18]', 'R3: 18sc [18]') }, // later round of Head edited
      base[1],
      part('Tail', 1),
    ];
    const plan = planCollectionUpdate(current, edited, id, 5000);
    expect(plan.reports.map((r) => [r.name, r.kind])).toEqual([['Head', 'edited'], ['Arms', 'unchanged'], ['Tail', 'added']]);
    const newHead = plan.instances.find((i) => i.partId === 'part-Head')!;
    expect(newHead.cursor.roundIndex).toBe(head.cursor.roundIndex);
    expect(newHead.cursor.ptr).toBe(head.cursor.ptr);
    expect(plan.instances.find((i) => i.id === arm1.id)!.cursor).toEqual(arm1.cursor);
    expect(plan.addedInstances).toHaveLength(1);
    expect(plan.instances.filter((i) => i.partId === 'part-Tail')).toHaveLength(1);
    expect(plan.level).not.toBe('unsafe');
  });

  it('unsafe edits keep the old position and raise the level so the UI must ask first', () => {
    const { snapshots, instances } = createInstances([part('Body', 1)], id, 0);
    const moved = tapN(instances[0], snapshots[0].text, 20);
    const shifted = { ...part('Body', 1), text: 'R1: 6sc in MR [6]\nR2: 6sc [6]\nR3: inc x 6 [12]\nR4: (sc, inc) x 6 [18]' };
    const plan = planCollectionUpdate({ snapshots, instances: [moved] }, [shifted], id, 1);
    expect(plan.level).toBe('unsafe');
    expect(plan.instances[0].cursor).toEqual(moved.cursor); // never reset
  });

  it('reducing a quantity drops only untouched pieces and RETIRES pieces that have progress (nothing is lost)', () => {
    const { snapshots, instances } = createInstances([part('Arms', 3)], id, 0);
    const worked = tapN(instances[2], snapshots[0].text, 6); // Arm 3 has progress
    const current = { snapshots, instances: [instances[0], instances[1], worked] };
    const plan = planCollectionUpdate(current, [part('Arms', 1)], id, 1);
    expect(plan.removedInstances).toEqual([instances[1].id]);
    expect(plan.retired).toEqual([worked.id]);
    const kept = plan.instances.map((i) => [i.index, !!i.retired]);
    expect(kept).toEqual([[1, false], [3, true]]);
    expect(plan.instances.find((i) => i.id === worked.id)!.cursor).toEqual(worked.cursor);
  });

  it('removing a part keeps worked instances (and their instructions) and drops untouched ones', () => {
    const { snapshots, instances } = createInstances([part('Head', 1), part('Ears', 2)], id, 0);
    const earWorked = tapN(instances[1], snapshots[1].text, 3);
    const plan = planCollectionUpdate({ snapshots, instances: [instances[0], earWorked, instances[2]] }, [part('Head', 1)], id, 1);
    expect(plan.reports.find((r) => r.name === 'Ears')).toMatchObject({ kind: 'removed', level: 'warn' });
    expect(plan.instances.map((i) => i.id)).toEqual([instances[0].id, earWorked.id]);
    expect(plan.instances[1].retired).toBe(true);
    expect(plan.snapshots.some((s) => s.partId === 'part-Ears')).toBe(true); // retired instances can still be read
    expect(plan.removedInstances).toEqual([instances[2].id]);
  });
});
