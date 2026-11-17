/**
 * Pattern collections → project part instances — pure domain logic.
 *
 *   Pattern Collection  (reusable design)            "Pink Teddy Bear"
 *     └ Pattern Part    (instructions, quantity)     "Arms" × 2
 *         └ Project Part Instance (a physical piece) "Arms 1/2", "Arms 2/2"  ← each has its OWN tracker
 *
 * A project never reads the live collection while working: it holds `PartSnapshot`s (a frozen copy of every part's
 * instructions). Editing the collection later changes nothing in a running project until the user explicitly updates
 * it (`planCollectionUpdate`), and that update never resets a tracker position.
 */
import type { PatternPart } from '../models/models';
import { mapCursor, MapLevel, MapReason } from './revisions';
import { ParsedPattern, parsePattern } from './pattern-parser';
import {
  PatternCursor,
  SimpleCounter,
  TrackerLike,
  createPatternCursor,
  createSimpleCounter,
  patternStats,
  simpleAllComplete,
  simpleProgress,
} from './tracker-engine';

export const MAX_PART_QUANTITY = 30;
export const MAX_PARTS = 30;

/** Frozen copy of one part's instructions, stored inside the project. */
export interface PartSnapshot {
  readonly partId: string;
  readonly name: string;
  readonly quantity: number;
  readonly text: string;
  readonly assemblyNotes: string;
  /** Terminology the text is written in (absent on snapshots made before this field existed = 'us'). */
  readonly terms?: 'us' | 'uk';
}

/** One physical piece with its own independent tracker, undo history and recorded time. */
export interface PartInstance {
  readonly id: string;
  readonly partId: string;
  /** 1-based piece number within its part (Arm 1, Arm 2). */
  readonly index: number;
  readonly mode: 'simple' | 'pattern';
  readonly simple: SimpleCounter;
  readonly cursor: PatternCursor;
  /** Seconds recorded while this piece was the active one. The project total stays the single authoritative sum. */
  readonly workedSeconds: number;
  readonly updatedAt: number;
  /** Kept although the new collection revision no longer has it (it had progress); still trackable. */
  readonly retired?: boolean;
}

export const clampQuantity = (n: number): number => Math.max(1, Math.min(MAX_PART_QUANTITY, Math.trunc(Number.isFinite(n) ? n : 1)));

export function snapshotPart(p: PatternPart, terms: 'us' | 'uk' = 'us'): PartSnapshot {
  return { partId: p.id, name: p.name, quantity: clampQuantity(p.quantity), text: p.text, assemblyNotes: p.assemblyNotes, terms };
}

/** New, untouched instance. A part the pattern counter cannot follow falls back to the simple stitch counter. */
export function newInstance(snapshot: PartSnapshot, index: number, id: string, now: number): PartInstance {
  const parsed = parsePattern(snapshot.text);
  return {
    id,
    partId: snapshot.partId,
    index,
    mode: parsed.ok ? 'pattern' : 'simple',
    simple: createSimpleCounter({ target: 30, perTap: 1, totalRounds: parsed.rounds.length }),
    cursor: createPatternCursor(),
    workedSeconds: 0,
    updatedAt: now,
  };
}

/** Every instance a project needs for the given parts (quantity 2 → two independent instances). */
export function createInstances(parts: readonly PatternPart[], newId: () => string, now: number, terms: 'us' | 'uk' = 'us'): { snapshots: PartSnapshot[]; instances: PartInstance[] } {
  const snapshots = parts.map((p) => snapshotPart(p, terms));
  const instances = snapshots.flatMap((s) => Array.from({ length: s.quantity }, (_, i) => newInstance(s, i + 1, newId(), now)));
  return { snapshots, instances };
}

/** "Arms 1/2" — or just the part name when there is a single piece. */
export function instanceLabel(inst: PartInstance, snap: PartSnapshot | undefined, siblings: number): string {
  const name = snap?.name ?? '—';
  return siblings > 1 ? `${name} ${inst.index}/${siblings}` : name;
}

export function siblingsOf(instances: readonly PartInstance[], inst: PartInstance): number {
  return instances.filter((i) => i.partId === inst.partId && !i.retired).length || 1;
}

/* ------------------------------------------------------------------ */
/* progress                                                            */
/* ------------------------------------------------------------------ */

/** A part instance viewed as a regular tracker, so the existing counter UI and engine work on it unchanged. */
export function instanceTracker(inst: PartInstance): TrackerLike {
  return { mode: inst.mode, simple: inst.simple, cursor: inst.cursor, patternId: null, updatedAt: inst.updatedAt };
}

export interface InstanceProgress {
  /** 0..1 */
  readonly fraction: number;
  readonly done: boolean;
  readonly started: boolean;
  /** Output stitches of the part (used to weight the overall completion); 1 when unknown. */
  readonly weight: number;
}

export function instanceProgress(inst: PartInstance, snap: PartSnapshot | undefined): InstanceProgress {
  const parsed: ParsedPattern | null = snap ? parsePattern(snap.text) : null;
  if (inst.mode === 'pattern' && parsed?.ok) {
    const st = patternStats(parsed, inst.cursor);
    if (st) return { fraction: st.progress, done: st.patternComplete, started: st.overallProduced > 0 || inst.cursor.roundIndex > 0, weight: Math.max(1, parsed.total) };
  }
  const s = inst.simple;
  return { fraction: simpleProgress(s), done: simpleAllComplete(s), started: s.count > 0 || s.round > 1, weight: Math.max(1, parsed?.total ?? 1) };
}

export interface ProjectCompletion {
  /** 0..1, weighted by each part's stitch count. */
  readonly fraction: number;
  readonly percent: number;
  readonly doneCount: number;
  readonly total: number;
}

/** Overall completion of a multi-part project (retired extras count only once they have been started). */
export function projectCompletion(instances: readonly PartInstance[], snapshots: readonly PartSnapshot[]): ProjectCompletion {
  const rows = instances
    .map((i) => ({ i, p: instanceProgress(i, snapshots.find((s) => s.partId === i.partId)) }))
    .filter((r) => !r.i.retired || r.p.started);
  const weight = rows.reduce((a, r) => a + r.p.weight, 0);
  const fraction = weight ? rows.reduce((a, r) => a + r.p.fraction * r.p.weight, 0) / weight : 0;
  return { fraction, percent: Math.round(fraction * 100), doneCount: rows.filter((r) => r.p.done).length, total: rows.length };
}

/** The unfinished instance to continue with: the first one after `fromId` (wrapping), preferring started ones. */
export function nextUnfinished(instances: readonly PartInstance[], snapshots: readonly PartSnapshot[], fromId: string | null): PartInstance | null {
  const progress = (i: PartInstance) => instanceProgress(i, snapshots.find((s) => s.partId === i.partId));
  const open = instances.filter((i) => !progress(i).done);
  if (!open.length) return null;
  const start = Math.max(0, instances.findIndex((i) => i.id === fromId));
  const ordered = [...instances.slice(start), ...instances.slice(0, start)].filter((i) => open.includes(i));
  return ordered.find((i) => progress(i).started) ?? ordered[0] ?? null;
}

/** One comparable number for the whole multi-part state (mirrors the Worker's `multiPosition`). */
export function multiPosition(instances: readonly PartInstance[]): number {
  return instances.reduce((sum, i) => sum + (i.mode === 'pattern' ? i.cursor.roundIndex * 1_000_000 + i.cursor.ptr : i.simple.round * 1_000_000 + i.simple.count), 0);
}

/**
 * Merges two devices' states of the same multi-part project PIECE BY PIECE, so progress on Arm 1 (device A) and on Arm 2
 * (device B) both survive. Per piece: the more recently edited copy wins (so a deliberate undo is respected); when the edit
 * times tie, the further-along one wins. Recorded time never goes down. Pieces that exist on only one side are kept.
 */
export function mergeInstances(local: readonly PartInstance[], remote: readonly PartInstance[]): PartInstance[] {
  const pos = (i: PartInstance) => (i.mode === 'pattern' ? i.cursor.roundIndex * 1_000_000 + i.cursor.ptr : i.simple.round * 1_000_000 + i.simple.count);
  const byId = new Map<string, PartInstance>();
  for (const r of remote) byId.set(r.id, r);
  for (const l of local) {
    const r = byId.get(l.id);
    if (!r) {
      byId.set(l.id, l);
      continue;
    }
    const winner = l.updatedAt > r.updatedAt ? l : l.updatedAt < r.updatedAt ? r : pos(l) >= pos(r) ? l : r;
    byId.set(l.id, { ...winner, workedSeconds: Math.max(l.workedSeconds, r.workedSeconds) });
  }
  return [...byId.values()];
}

/** Union of the pinned part copies of two devices (the one with the higher collection revision wins a clash). */
export function mergeSnapshots(local: readonly PartSnapshot[], localRev: number, remote: readonly PartSnapshot[], remoteRev: number): PartSnapshot[] {
  const preferred = localRev >= remoteRev ? local : remote;
  const other = localRev >= remoteRev ? remote : local;
  return [...preferred, ...other.filter((s) => !preferred.some((p) => p.partId === s.partId))];
}

const untouched = (i: PartInstance): boolean => i.cursor.roundIndex === 0 && i.cursor.ptr === 0 && i.simple.round === 1 && i.simple.count === 0 && i.workedSeconds === 0 && !i.cursor.history.length && !i.simple.history.length;

/* ------------------------------------------------------------------ */
/* explicit update of a running project to a newer collection revision  */
/* ------------------------------------------------------------------ */

export interface PartUpdateReport {
  readonly partId: string;
  readonly name: string;
  readonly kind: 'unchanged' | 'edited' | 'added' | 'removed' | 'quantity';
  /** Worst mapping level over this part's instances. */
  readonly level: MapLevel;
  readonly reasons: readonly MapReason[];
  readonly affectedRounds: readonly number[];
}

export interface CollectionUpdatePlan {
  readonly snapshots: readonly PartSnapshot[];
  readonly instances: readonly PartInstance[];
  readonly reports: readonly PartUpdateReport[];
  /** Highest risk across every part. 'unsafe' means some progress cannot be mapped and the user must confirm. */
  readonly level: MapLevel;
  /** Instances kept even though the new revision dropped them (they had progress). */
  readonly retired: readonly string[];
  readonly addedInstances: readonly string[];
  readonly removedInstances: readonly string[];
}

const rank: Record<MapLevel, number> = { safe: 0, warn: 1, unsafe: 2 };
const worse = (a: MapLevel, b: MapLevel): MapLevel => (rank[b] > rank[a] ? b : a);

/**
 * Computes what updating a project to `newParts` would do — without changing anything. Progress is never reset:
 *  - edited parts: every instance's cursor is mapped (`mapCursor`); an unmappable one keeps its position and is flagged 'unsafe';
 *  - added parts / extra quantity: fresh instances are appended;
 *  - removed parts / reduced quantity: untouched instances disappear, instances with progress are KEPT (retired) with their old text.
 * Applying the plan is the caller's explicit action.
 */
export function planCollectionUpdate(
  current: { snapshots: readonly PartSnapshot[]; instances: readonly PartInstance[] },
  newParts: readonly PatternPart[],
  newId: () => string,
  now: number,
  terms: 'us' | 'uk' = 'us',
): CollectionUpdatePlan {
  const nextSnaps = newParts.map((p) => snapshotPart(p, terms));
  const reports: PartUpdateReport[] = [];
  const out: PartInstance[] = [];
  const retired: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const snapshots: PartSnapshot[] = [...nextSnaps];

  for (const snap of nextSnaps) {
    const old = current.snapshots.find((s) => s.partId === snap.partId);
    const existing = current.instances.filter((i) => i.partId === snap.partId).sort((a, b) => a.index - b.index);
    let level: MapLevel = 'safe';
    const reasons = new Set<MapReason>();
    const affected = new Set<number>();
    const kept: PartInstance[] = [];

    for (const inst of existing) {
      let next = inst;
      if (old && old.text !== snap.text && inst.mode === 'pattern') {
        const m = mapCursor(old.text, snap.text, inst.cursor);
        level = worse(level, m.level);
        m.reasons.forEach((r) => reasons.add(r));
        m.affectedRounds.forEach((r) => affected.add(r));
        next = { ...inst, cursor: m.cursor, updatedAt: now };
      }
      // The part may have become (un)readable by the counter: only switch mode for an untouched instance.
      const parsed = parsePattern(snap.text);
      if (untouched(next)) next = { ...next, mode: parsed.ok ? 'pattern' : 'simple', simple: { ...next.simple, totalRounds: parsed.rounds.length } };
      kept.push(next);
    }

    const wanted = snap.quantity;
    const live = kept.filter((i) => !i.retired);
    // Reduced quantity: drop untouched pieces from the end; keep (retire) the ones with progress.
    for (let n = live.length; n > wanted; n--) {
      const victim = [...live].reverse().find((i) => !kept.find((k) => k.id === i.id && k.retired));
      if (!victim) break;
      const idx = kept.findIndex((k) => k.id === victim.id);
      if (untouched(victim)) {
        kept.splice(idx, 1);
        removed.push(victim.id);
      } else {
        kept[idx] = { ...victim, retired: true };
        retired.push(victim.id);
      }
      live.splice(live.indexOf(victim), 1);
    }
    // Increased quantity (or a brand-new part): append fresh instances.
    for (let n = live.length; n < wanted; n++) {
      const used = new Set(kept.map((i) => i.index));
      let index = 1;
      while (used.has(index)) index++;
      const fresh = newInstance(snap, index, newId(), now);
      kept.push(fresh);
      added.push(fresh.id);
    }
    out.push(...kept.sort((a, b) => a.index - b.index));

    const kind: PartUpdateReport['kind'] = !old ? 'added' : old.text !== snap.text || old.name !== snap.name ? 'edited' : old.quantity !== snap.quantity ? 'quantity' : 'unchanged';
    reports.push({ partId: snap.partId, name: snap.name, kind, level, reasons: [...reasons], affectedRounds: [...affected].sort((a, b) => a - b) });
  }

  // Parts the new revision no longer has.
  for (const oldSnap of current.snapshots.filter((s) => !nextSnaps.some((n) => n.partId === s.partId))) {
    const insts = current.instances.filter((i) => i.partId === oldSnap.partId);
    let keptAny = false;
    for (const inst of insts) {
      if (untouched(inst)) removed.push(inst.id);
      else {
        out.push({ ...inst, retired: true });
        retired.push(inst.id);
        keptAny = true;
      }
    }
    if (keptAny) snapshots.push(oldSnap); // its instructions stay available to the retired instances
    reports.push({ partId: oldSnap.partId, name: oldSnap.name, kind: 'removed', level: keptAny ? 'warn' : 'safe', reasons: [], affectedRounds: [] });
  }

  return { snapshots, instances: out, reports, level: reports.reduce<MapLevel>((l, r) => worse(l, r.level), 'safe'), retired, addedInstances: added, removedInstances: removed };
}
