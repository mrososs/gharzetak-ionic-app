/**
 * Smart crochet tracker — pure, deterministic domain engine.
 * No Angular, no I/O, no AI. Every function returns a NEW state object.
 *
 * Two counting modes (from the approved prototype):
 *  - Simple:  target stitches per round, N stitches per tap, never exceeds the target.
 *             Target 32, +5 → 5, 10, 15, 20, 25, 30, 32.
 *  - Pattern: follows a parsed pattern round by round; counts per action, per repeat
 *             group or per whole round, tracking consumed vs produced stitches separately.
 */
import { ParsedPattern, ParsedRound, groupEnd, sumTo } from './pattern-parser';

export const HISTORY_LIMIT = 300;

/* ------------------------------------------------------------------ */
/* Simple counter                                                      */
/* ------------------------------------------------------------------ */

export interface SimpleSnapshot {
  readonly round: number;
  readonly count: number;
}

export interface SimpleCounter {
  readonly round: number;
  readonly target: number;
  readonly perTap: number;
  readonly count: number;
  /** 0 = unknown / not set. */
  readonly totalRounds: number;
  readonly history: readonly SimpleSnapshot[];
}

export function createSimpleCounter(init: Partial<SimpleCounter> = {}): SimpleCounter {
  const target = clampInt(init.target ?? 30, 1, 999);
  return {
    round: clampInt(init.round ?? 1, 1, 9999),
    target,
    perTap: clampInt(init.perTap ?? 1, 1, 99),
    count: clampInt(init.count ?? 0, 0, target),
    totalRounds: clampInt(init.totalRounds ?? 0, 0, 999),
    history: init.history ?? [],
  };
}

export function simpleRoundComplete(s: SimpleCounter): boolean {
  return s.count >= s.target;
}

export function simpleAllComplete(s: SimpleCounter): boolean {
  return simpleRoundComplete(s) && s.totalRounds > 0 && s.round >= s.totalRounds;
}

/** How many stitches the next tap will add (0 when the round is complete). */
export function simpleNextAmount(s: SimpleCounter): number {
  return Math.max(0, Math.min(s.perTap, s.target - s.count));
}

function pushSimple(s: SimpleCounter): readonly SimpleSnapshot[] {
  return [...s.history, { round: s.round, count: s.count }].slice(-HISTORY_LIMIT);
}

export function simpleTap(s: SimpleCounter): SimpleCounter {
  const add = simpleNextAmount(s);
  if (add <= 0) return s;
  return { ...s, history: pushSimple(s), count: s.count + add };
}

export function simpleNextRound(s: SimpleCounter): SimpleCounter {
  if (!simpleRoundComplete(s) || simpleAllComplete(s)) return s;
  return { ...s, history: pushSimple(s), round: s.round + 1, count: 0 };
}

export function simpleUndo(s: SimpleCounter): SimpleCounter {
  if (!s.history.length) return s;
  const last = s.history[s.history.length - 1];
  return { ...s, history: s.history.slice(0, -1), round: last.round, count: last.count };
}

/** Resets the current round's count; the round number stays. */
export function simpleReset(s: SimpleCounter): SimpleCounter {
  return { ...s, count: 0, history: [] };
}

export function simpleSetTarget(s: SimpleCounter, target: number): SimpleCounter {
  const t = clampInt(target, 1, 999);
  return { ...s, target: t, count: Math.min(s.count, t) };
}

export function simpleSetPerTap(s: SimpleCounter, per: number): SimpleCounter {
  return { ...s, perTap: clampInt(per, 1, 99) };
}

export function simpleSetRound(s: SimpleCounter, round: number): SimpleCounter {
  return { ...s, round: clampInt(round, 1, 9999), count: 0, history: [] };
}

export function simpleSetTotalRounds(s: SimpleCounter, total: number): SimpleCounter {
  return { ...s, totalRounds: clampInt(total, 0, 999) };
}

/** 0..1 overall progress for the simple counter. */
export function simpleProgress(s: SimpleCounter): number {
  const roundFrac = s.target ? s.count / s.target : 0;
  const frac = s.totalRounds > 0 ? (s.round - 1 + roundFrac) / s.totalRounds : roundFrac;
  return Math.max(0, Math.min(1, frac));
}

/* ------------------------------------------------------------------ */
/* Pattern-aware counter                                               */
/* ------------------------------------------------------------------ */

export type CountMode = 'action' | 'group' | 'round';

export interface PatternSnapshot {
  readonly roundIndex: number;
  readonly ptr: number;
}

export interface PatternCursor {
  /** Index into parsed.rounds (not the written round number). */
  readonly roundIndex: number;
  /** Number of actions completed in the current round. */
  readonly ptr: number;
  readonly mode: CountMode;
  readonly history: readonly PatternSnapshot[];
}

export function createPatternCursor(init: Partial<PatternCursor> = {}): PatternCursor {
  return {
    roundIndex: Math.max(0, init.roundIndex ?? 0),
    ptr: Math.max(0, init.ptr ?? 0),
    mode: init.mode ?? 'action',
    history: init.history ?? [],
  };
}

export interface PatternContext {
  readonly round: ParsedRound;
  readonly roundIndex: number;
  readonly ptr: number;
  readonly isLastRound: boolean;
}

/** Normalises a cursor against a pattern. Returns null when the pattern is unusable. */
export function patternContext(p: ParsedPattern, c: PatternCursor): PatternContext | null {
  if (!p.ok || !p.rounds.length) return null;
  const roundIndex = clampInt(c.roundIndex, 0, p.rounds.length - 1);
  const round = p.rounds[roundIndex];
  return { round, roundIndex, ptr: clampInt(c.ptr, 0, round.acts.length), isLastRound: roundIndex >= p.rounds.length - 1 };
}

function pushPattern(c: PatternCursor, ctx: PatternContext): readonly PatternSnapshot[] {
  return [...c.history, { roundIndex: ctx.roundIndex, ptr: ctx.ptr }].slice(-HISTORY_LIMIT);
}

/**
 * One confirmed tap.
 *  - round finished → moves to the next round (no-op on the last round)
 *  - mode 'action'  → +1 action
 *  - mode 'group'   → to the end of the current repeat group
 *  - mode 'round'   → completes the round (advances to the next one, or stays complete on the last)
 */
export function patternTap(p: ParsedPattern, c: PatternCursor): PatternCursor {
  const ctx = patternContext(p, c);
  if (!ctx) return c;
  const len = ctx.round.acts.length;
  const history = pushPattern(c, ctx);

  if (ctx.ptr >= len) {
    if (ctx.isLastRound) return c;
    return { ...c, history, roundIndex: ctx.roundIndex + 1, ptr: 0 };
  }
  switch (c.mode) {
    case 'round':
      return ctx.isLastRound
        ? { ...c, history, roundIndex: ctx.roundIndex, ptr: len }
        : { ...c, history, roundIndex: ctx.roundIndex + 1, ptr: 0 };
    case 'group':
      return { ...c, history, roundIndex: ctx.roundIndex, ptr: groupEnd(ctx.round.acts, ctx.ptr) };
    default:
      return { ...c, history, roundIndex: ctx.roundIndex, ptr: ctx.ptr + 1 };
  }
}

export function patternUndo(c: PatternCursor): PatternCursor {
  if (!c.history.length) return c;
  const last = c.history[c.history.length - 1];
  return { ...c, history: c.history.slice(0, -1), roundIndex: last.roundIndex, ptr: last.ptr };
}

/** Restarts the current round (ptr → 0). */
export function patternReset(c: PatternCursor): PatternCursor {
  return { ...c, ptr: 0, history: [] };
}

export function patternJump(p: ParsedPattern, c: PatternCursor, roundIndex: number): PatternCursor {
  const ctx = patternContext(p, c);
  if (!ctx) return c;
  return { ...c, history: pushPattern(c, ctx), roundIndex: clampInt(roundIndex, 0, p.rounds.length - 1), ptr: 0 };
}

export function patternSetMode(c: PatternCursor, mode: CountMode): PatternCursor {
  return { ...c, mode };
}

export interface PatternStats {
  readonly roundNumber: number;
  readonly actionsDone: number;
  readonly actionsTotal: number;
  /** Input stitches consumed so far in this round. */
  readonly consumed: number;
  /** Output stitches produced so far in this round. */
  readonly produced: number;
  readonly roundConsumed: number;
  readonly roundProduced: number;
  readonly completedGroups: number;
  readonly totalGroups: number;
  /** 1-based repeat the user is on (== totalGroups when complete). */
  readonly currentGroup: number;
  readonly roundComplete: boolean;
  readonly patternComplete: boolean;
  /** Output stitches produced across the whole pattern. */
  readonly overallProduced: number;
  readonly overallTotal: number;
  /** 0..1 */
  readonly progress: number;
}

export function patternStats(p: ParsedPattern, c: PatternCursor): PatternStats | null {
  const ctx = patternContext(p, c);
  if (!ctx) return null;
  const { round, ptr } = ctx;
  const len = round.acts.length;
  const roundComplete = ptr >= len;
  let overall = 0;
  for (let i = 0; i < ctx.roundIndex; i++) overall += p.rounds[i].prod;
  const produced = sumTo(round.acts, ptr, 'prod');
  overall += produced;
  const completedGroups = roundComplete ? round.reps : round.acts[ptr].rep;
  return {
    roundNumber: round.n,
    actionsDone: ptr,
    actionsTotal: len,
    consumed: sumTo(round.acts, ptr, 'cons'),
    produced,
    roundConsumed: round.cons,
    roundProduced: round.prod,
    completedGroups,
    totalGroups: round.reps,
    currentGroup: roundComplete ? round.reps : completedGroups + 1,
    roundComplete,
    patternComplete: roundComplete && ctx.isLastRound,
    overallProduced: overall,
    overallTotal: p.total,
    progress: p.total ? Math.max(0, Math.min(1, overall / p.total)) : 0,
  };
}

/* ------------------------------------------------------------------ */

function clampInt(n: number, min: number, max: number): number {
  const v = Number.isFinite(n) ? Math.round(n) : min;
  return Math.max(min, Math.min(max, v));
}

/** Structural shape shared by a project's tracker and a part instance's tracker (both feed the same counter UI). */
export interface TrackerLike {
  readonly mode: 'simple' | 'pattern';
  readonly simple: SimpleCounter;
  readonly cursor: PatternCursor;
  readonly patternId: string | null;
  readonly updatedAt: number;
}
