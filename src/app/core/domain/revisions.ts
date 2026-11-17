/**
 * Pattern change analysis — pure and deterministic.
 *
 * When a pattern (or one part of a collection) is edited, projects that are already working on it must not be
 * silently moved. These helpers answer three questions:
 *   1. What changed?                       → `diffPatterns`
 *   2. Can an existing tracker position be carried over to the new text?  → `mapCursor`
 *   3. Which undo steps are still meaningful afterwards?                  → (inside `mapCursor`)
 *
 * Nothing here ever resets progress: an unsafe mapping is REPORTED (level 'unsafe') and the caller must ask the user.
 */
import { ParsedPattern, ParsedRound, parsePattern } from './pattern-parser';
import { PatternCursor, PatternSnapshot, createPatternCursor } from './tracker-engine';

export type ChangeKind = 'same' | 'changed' | 'added' | 'removed';

export interface RoundChange {
  /** Index into the rounds list (old index for removed rounds). */
  readonly index: number;
  readonly kind: ChangeKind;
  readonly oldRaw: string | null;
  readonly newRaw: string | null;
  /** The sequence of stitch actions differs (not just the wording / total / spacing). */
  readonly structural: boolean;
}

export interface PatternDiff {
  readonly changes: readonly RoundChange[];
  readonly changedCount: number;
  readonly addedCount: number;
  readonly removedCount: number;
  /** True when any round's actions changed, or rounds were added/removed. */
  readonly structural: boolean;
  /** Index of the first round that is not `same`, or -1. */
  readonly firstChange: number;
  readonly identical: boolean;
}

const sig = (r: ParsedRound | undefined): string => (r && r.ok ? r.acts.map((a) => `${a.k}${a.mr ? 'm' : ''}${a.ref ? '@' + a.ref : ''}/${a.rep}`).join(',') : (r?.raw ?? ''));
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Compares two pattern texts round by round (by position, which is what a tracker cursor refers to). */
export function diffPatterns(oldText: string, newText: string): PatternDiff {
  return diffParsed(parsePattern(oldText), parsePattern(newText));
}

export function diffParsed(a: ParsedPattern, b: ParsedPattern): PatternDiff {
  const n = Math.max(a.rounds.length, b.rounds.length);
  const changes: RoundChange[] = [];
  for (let i = 0; i < n; i++) {
    const o = a.rounds[i];
    const w = b.rounds[i];
    if (o && !w) changes.push({ index: i, kind: 'removed', oldRaw: o.raw, newRaw: null, structural: true });
    else if (!o && w) changes.push({ index: i, kind: 'added', oldRaw: null, newRaw: w.raw, structural: true });
    else if (o && w) {
      const same = squash(o.raw) === squash(w.raw);
      changes.push({ index: i, kind: same ? 'same' : 'changed', oldRaw: o.raw, newRaw: w.raw, structural: !same && (sig(o) !== sig(w) || o.n !== w.n) });
    }
  }
  const diff = changes.filter((c) => c.kind !== 'same');
  return {
    changes,
    changedCount: diff.filter((c) => c.kind === 'changed').length,
    addedCount: diff.filter((c) => c.kind === 'added').length,
    removedCount: diff.filter((c) => c.kind === 'removed').length,
    structural: diff.some((c) => c.structural),
    firstChange: changes.findIndex((c) => c.kind !== 'same'),
    identical: diff.length === 0,
  };
}

/* ------------------------------------------------------------------ */
/* progress mapping                                                    */
/* ------------------------------------------------------------------ */

export type MapLevel = 'safe' | 'warn' | 'unsafe';

export type MapReason =
  | 'new-unreadable' // the new text cannot be followed by the pattern counter
  | 'rounds-shifted' // a round BEFORE the current one was inserted/removed/renumbered: positions no longer line up
  | 'completed-edited' // rounds already completed were edited (position is still valid)
  | 'current-edited' // the round being worked on was edited
  | 'stitch-clamped' // the stitch position is past the end of the edited round
  | 'beyond-end'; // the current round no longer exists

export interface CursorMapping {
  readonly cursor: PatternCursor;
  readonly level: MapLevel;
  readonly reasons: readonly MapReason[];
  /** Rounds (0-based, in the NEW pattern) the user should look at. */
  readonly affectedRounds: readonly number[];
  /** Undo steps that were kept / dropped because they no longer point at the same instruction. */
  readonly historyKept: number;
  readonly historyDropped: number;
}

const roundSame = (a: ParsedRound | undefined, b: ParsedRound | undefined): boolean => !!a && !!b && squash(a.raw) === squash(b.raw);

/** The instructions of a round without its label (R4: ...), so a renumbered or moved round can still be recognised. */
const bodyOf = (r: ParsedRound): string => squash(r.raw.replace(/^(?:rnd|round|r)?\s*\d+\s*[:.\-–]\s*/i, ''));

/**
 * Carries a tracker position from the old pattern text to the new one — WITHOUT resetting anything.
 *  safe   : nothing the user did is affected
 *  warn   : position kept, but completed/current rounds were edited (tell the user)
 *  unsafe : positions no longer line up; the cursor is returned unchanged and the user must decide
 */
export function mapCursor(oldText: string, newText: string, cursor: PatternCursor): CursorMapping {
  const oldP = parsePattern(oldText);
  const newP = parsePattern(newText);
  const keep = (level: MapLevel, reasons: MapReason[], c: PatternCursor, affected: number[], kept = 0, dropped = 0): CursorMapping => ({ cursor: c, level, reasons, affectedRounds: affected, historyKept: kept, historyDropped: dropped });

  if (!newP.ok) return keep('unsafe', ['new-unreadable'], cursor, []);
  if (!oldP.ok) return keep('unsafe', ['new-unreadable'], cursor, []);

  const ri = Math.min(Math.max(0, cursor.roundIndex), oldP.rounds.length - 1);
  const reasons: MapReason[] = [];
  const affected: number[] = [];

  // The new pattern is shorter than the position: a pure truncation moves the cursor to the end, anything else is ambiguous.
  if (newP.rounds.length <= ri) {
    const prefixSame = newP.rounds.every((w, i) => roundSame(oldP.rounds[i], w));
    if (!prefixSame) return keep('unsafe', ['rounds-shifted'], cursor, []);
    const lastI = newP.rounds.length - 1;
    return keep('warn', ['beyond-end'], createPatternCursor({ roundIndex: lastI, ptr: newP.rounds[lastI].acts.length, mode: cursor.mode }), [lastI]);
  }

  // Rounds before the current one: a renumbering means the cursor index no longer points where it used to.
  for (let i = 0; i < ri; i++) {
    const o = oldP.rounds[i];
    const w = newP.rounds[i];
    if (!w || o.n !== w.n) {
      reasons.push('rounds-shifted');
      return keep('unsafe', reasons, cursor, [i]);
    }
    if (!roundSame(o, w)) affected.push(i);
  }
  // A completed (or the current) round whose instructions now appear at a DIFFERENT position means a round was inserted/removed/moved.
  const movedElsewhere = (i: number): boolean => {
    const o = oldP.rounds[i];
    return !!o && newP.rounds.some((w, j) => j !== i && bodyOf(w) === bodyOf(o)) && !roundSame(o, newP.rounds[i]);
  };
  if ([...affected, ri].some(movedElsewhere)) return keep('unsafe', ['rounds-shifted'], cursor, [...affected, ri].filter(movedElsewhere));
  if (affected.length) reasons.push('completed-edited');

  if (ri >= newP.rounds.length) {
    const lastI = newP.rounds.length - 1;
    reasons.push('beyond-end');
    return keep('warn', reasons, createPatternCursor({ roundIndex: lastI, ptr: newP.rounds[lastI].acts.length, mode: cursor.mode }), [...affected, lastI]);
  }

  const oldR = oldP.rounds[ri];
  const newR = newP.rounds[ri];
  let ptr = cursor.ptr;
  if (!roundSame(oldR, newR)) {
    affected.push(ri);
    reasons.push('current-edited');
    if (sig(oldR) !== sig(newR)) {
      // Different instructions: the stitch position only means something if the new round is at least that long.
      if (ptr > newR.acts.length) {
        ptr = newR.acts.length;
        reasons.push('stitch-clamped');
      }
    }
  }

  // Undo history: keep a step only if it still points at the same instruction in the same, unchanged round.
  const stillValid = (s: PatternSnapshot): boolean => {
    const o = oldP.rounds[s.roundIndex];
    const w = newP.rounds[s.roundIndex];
    return !!o && !!w && roundSame(o, w) && s.ptr <= w.acts.length;
  };
  const history = cursor.history.filter(stillValid);
  const level: MapLevel = reasons.length ? 'warn' : 'safe';
  return keep(level, reasons, { ...cursor, roundIndex: ri, ptr, history }, [...new Set(affected)].sort((a, b) => a - b), history.length, cursor.history.length - history.length);
}
