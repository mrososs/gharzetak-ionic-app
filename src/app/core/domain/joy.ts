/**
 * Crochet Joy — completion event detection. Pure and deterministic: no Angular, no I/O, no clock.
 *
 * Completion is NOT stored anywhere in the app (rounds and parts are derived from the current counter position, and sync / merge /
 * restart / import replace that position wholesale). So an event is detected only by comparing the state BEFORE and AFTER one explicit
 * user command. Only `tap` (a counting action) and `finish` (an explicit "mark project finished") can ever produce events; every other
 * origin — undo, reset, edits, sync, load, import, settings — produces nothing, even if the resulting position looks "complete".
 *
 * Pattern "round" mode jumps straight to the next round without ever storing a "round complete" cursor, so the transition is recognised
 * from the before/after pair, never from a stored state.
 */
import type { PartInstance, PartSnapshot } from './collections';
import { projectCompletion } from './collections';
import type { ParsedPattern } from './pattern-parser';
import { TrackerLike, patternContext, simpleAllComplete, simpleRoundComplete } from './tracker-engine';

export type JoyOrigin = 'tap' | 'finish' | 'undo' | 'reset' | 'edit' | 'sync' | 'load' | 'import' | 'settings';

/** The only origins allowed to create events. */
export const CELEBRATING_ORIGINS: readonly JoyOrigin[] = ['tap', 'finish'];

export type JoyKind = 'round' | 'milestone' | 'part' | 'allParts' | 'project' | 'achievement';

/** Everything that identifies an event (and therefore its ledger key). */
export interface JoyKeyParts {
  readonly kind: JoyKind;
  readonly projectId?: string | null;
  readonly instanceId?: string | null;
  /** Stable round id: the simple round number, or the 1-based pattern round index. */
  readonly round?: number;
  /** 25 | 50 | 75 */
  readonly pct?: number | null;
  /** Open-ended simple counting: every 10th round. */
  readonly roundCount?: number | null;
  readonly achievementId?: string;
}

export interface JoyEvent extends JoyKeyParts {
  readonly projectId: string;
  readonly instanceId: string | null;
  /** The round number to show the user (the written round number for patterns). */
  readonly display?: number;
  /** Rounds in the pattern / piece (0 = unknown). */
  readonly total?: number;
}

/** One persisted ledger entry. `key` is unique per scope; inserting an existing key is a no-op. */
export interface JoyRow extends JoyKeyParts {
  readonly key: string;
  readonly at: number;
  /** `live` = created by a real action; `backfill` = derived silently from durable data (never celebrated). */
  readonly source: 'live' | 'backfill';
  readonly display?: number;
  readonly total?: number;
}

/** Stable ledger key. Scope is added by the storage layer. */
export function joyKey(p: JoyKeyParts): string {
  const proj = p.projectId ?? '-';
  const inst = p.instanceId ?? '-';
  switch (p.kind) {
    case 'round':
      return `r|${proj}|${inst}|${p.round ?? 0}`;
    case 'milestone':
      return p.roundCount != null ? `m|${proj}|${inst}|n${p.roundCount}` : `m|${proj}|${inst}|${p.pct ?? 0}`;
    case 'part':
      return `p|${proj}|${inst}`;
    case 'allParts':
      return `P|${proj}`;
    case 'project':
      return `j|${proj}`;
    case 'achievement':
      return `a|${p.achievementId ?? ''}`;
  }
}

export function rowFromEvent(e: JoyEvent, at: number, source: 'live' | 'backfill' = 'live'): JoyRow {
  const row: JoyRow = { ...e, key: joyKey(e), at, source };
  return row;
}

/** Cheap structural check used when migrating rows from another scope. */
export function isValidJoyRow(r: unknown): r is JoyRow {
  if (!r || typeof r !== 'object') return false;
  const x = r as Partial<JoyRow>;
  const kinds: JoyKind[] = ['round', 'milestone', 'part', 'allParts', 'project', 'achievement'];
  if (typeof x.key !== 'string' || !x.key || !x.kind || !kinds.includes(x.kind)) return false;
  if (typeof x.at !== 'number' || !Number.isFinite(x.at)) return false;
  if (x.kind === 'achievement') return typeof x.achievementId === 'string' && x.achievementId.length > 0;
  return typeof x.projectId === 'string' && x.projectId.length > 0;
}

export interface JoySnapshot {
  readonly tracker: TrackerLike;
  readonly status: 'active' | 'paused' | 'done';
}

export interface JoyContext {
  readonly origin: JoyOrigin;
  readonly projectId: string;
  /** The part instance being counted (multi-part projects), else null. */
  readonly instanceId: string | null;
  /**
   * The parsed pattern the tap actually used (the project's PINNED revision / the part snapshot — never the live text).
   * Required for pattern-mode detection; without it nothing is detected (safe).
   */
  readonly parsed: ParsedPattern | null;
  /** Multi-part only: the project's instances AFTER the tap + their frozen snapshots (used to detect "all pieces done"). */
  readonly partsAfter?: readonly PartInstance[] | null;
  readonly partSnapshots?: readonly PartSnapshot[] | null;
}

interface RoundTransition {
  readonly id: number;
  readonly display: number;
  /** Rounds in the pattern / piece; 0 = unknown (open-ended simple counting). */
  readonly total: number;
  readonly doneBefore: number;
  readonly doneAfter: number;
  /** This round was the last one: the piece / pattern is now complete. */
  readonly finishedAll: boolean;
}

/** Did one tap complete a round? Compares positions only — never trusts a stored "complete" flag. */
function roundTransition(before: TrackerLike, after: TrackerLike, parsed: ParsedPattern | null): RoundTransition | null {
  if (before.mode !== after.mode) return null;

  if (before.mode === 'simple') {
    const b = before.simple;
    const a = after.simple;
    // Completing a round = the count reached the target within the same round. The NEXT tap (simpleNextRound) is not an event.
    if (simpleRoundComplete(b) || a.round !== b.round || !simpleRoundComplete(a)) return null;
    return { id: b.round, display: b.round, total: b.totalRounds, doneBefore: b.round - 1, doneAfter: b.round, finishedAll: simpleAllComplete(a) };
  }

  if (!parsed) return null;
  const cb = patternContext(parsed, before.cursor);
  const ca = patternContext(parsed, after.cursor);
  if (!cb || !ca) return null;
  const lenB = cb.round.acts.length;
  if (lenB === 0) return null; // an empty / invalid round can never be "completed"
  if (cb.ptr >= lenB) return null; // this tap only advanced from an already-complete round
  const advanced = ca.roundIndex > cb.roundIndex; // 'round' mode jumps straight to the next round
  const stayedComplete = ca.roundIndex === cb.roundIndex && ca.ptr >= lenB;
  if (!advanced && !stayedComplete) return null;
  return {
    id: cb.roundIndex + 1,
    display: cb.round.n,
    total: parsed.rounds.length,
    doneBefore: cb.roundIndex,
    doneAfter: cb.roundIndex + 1,
    finishedAll: stayedComplete && cb.isLastRound,
  };
}

const THRESHOLDS = [25, 50, 75] as const;
/** Patterns with fewer rounds than this get no percentage milestones (they would just repeat the round banner). */
const MIN_ROUNDS_FOR_PERCENT = 4;
/** Open-ended simple counting celebrates every Nth round instead of inventing a percentage. */
export const OPEN_ENDED_MILESTONE_EVERY = 10;

function milestoneOf(t: RoundTransition): { pct: number | null; roundCount: number | null } | null {
  if (t.finishedAll) return null; // the piece / project completion has its own celebration
  if (t.total >= MIN_ROUNDS_FOR_PERCENT) {
    let hit: number | null = null;
    for (const p of THRESHOLDS) if (t.doneBefore * 100 < p * t.total && t.doneAfter * 100 >= p * t.total) hit = p;
    return hit ? { pct: hit, roundCount: null } : null;
  }
  if (t.total === 0 && t.doneAfter % OPEN_ENDED_MILESTONE_EVERY === 0) return { pct: null, roundCount: t.doneAfter };
  return null;
}

/**
 * The events created by ONE user command. Returns [] for every non-celebrating origin.
 * Order: round → milestone → part → allParts. (`project` is returned alone for `finish`.)
 */
export function detectJoy(before: JoySnapshot, after: JoySnapshot, ctx: JoyContext): JoyEvent[] {
  if (ctx.origin === 'finish') {
    return before.status !== 'done' && after.status === 'done' ? [{ kind: 'project', projectId: ctx.projectId, instanceId: null }] : [];
  }
  if (ctx.origin !== 'tap') return [];

  const t = roundTransition(before.tracker, after.tracker, ctx.parsed);
  if (!t) return [];
  const base = { projectId: ctx.projectId, instanceId: ctx.instanceId };
  const events: JoyEvent[] = [{ ...base, kind: 'round', round: t.id, display: t.display, total: t.total }];

  const m = milestoneOf(t);
  if (m) events.push({ ...base, kind: 'milestone', pct: m.pct, roundCount: m.roundCount, display: t.display, total: t.total });

  if (ctx.instanceId && t.finishedAll) {
    events.push({ ...base, kind: 'part', display: t.display, total: t.total });
    if (ctx.partsAfter && ctx.partSnapshots) {
      const c = projectCompletion(ctx.partsAfter, ctx.partSnapshots);
      if (c.total > 0 && c.doneCount >= c.total) events.push({ ...base, instanceId: null, kind: 'allParts' });
    }
  }
  return events;
}
