/**
 * Deterministic crochet pattern parser.
 *
 * Ported from the approved Gharzetak prototype (Main.dc.html → parsePattern).
 * Supported syntax (anything else is flagged `ok: false`, never guessed):
 *
 *   R1: 6sc in MR [6]
 *   R2: inc × 6 [12]
 *   R3: (sc, inc) × 6 [18]
 *   R5: (3sc, inc) × 6 [30]
 *   R6: 30sc [30]
 *   Rnd 8. (3sc, dec) x 6 [24]
 *
 * Stitch accounting (input stitches consumed from the previous round → output produced):
 *   sc / hdc / dc / tr : 1 → 1
 *   inc                : 1 → 2
 *   dec                : 2 → 1
 *   anything "in MR"   : 0 → n   (worked into the magic ring)
 */

export type StitchKind = 'sc' | 'hdc' | 'dc' | 'tr' | 'inc' | 'dec';

/** [consumed, produced] for one action of each kind. */
export const STITCH_IO: Readonly<Record<StitchKind, readonly [number, number]>> = {
  sc: [1, 1],
  hdc: [1, 1],
  dc: [1, 1],
  tr: [1, 1],
  inc: [1, 2],
  dec: [2, 1],
};

export interface UnitStep {
  readonly k: StitchKind;
  /** Worked into a magic ring: consumes nothing from a previous round. */
  readonly mr: boolean;
}

/** One concrete action inside a round, after repeats are expanded. */
export interface RoundAction {
  readonly k: StitchKind;
  /** 0-based repeat (group) index. */
  readonly rep: number;
  /** Index inside the repeat unit. */
  readonly gi: number;
  readonly mr: boolean;
  readonly cons: number;
  readonly prod: number;
}

export type ChainStatus = 'na' | 'ok' | 'bad';

export interface ParsedRound {
  readonly raw: string;
  /** Round number as written (R5 → 5), or line index + 1. */
  readonly n: number;
  readonly ok: boolean;
  readonly err: '' | 'syntax';
  readonly acts: readonly RoundAction[];
  readonly unit: readonly UnitStep[];
  readonly reps: number;
  readonly cons: number;
  readonly prod: number;
  /** The total written in [N], if any. */
  readonly declared: number | null;
  /** declared !== null && declared !== prod */
  readonly mismatch: boolean;
  /** Whether this round consumes what the previous round produced. */
  readonly chain: ChainStatus;
}

export interface ParsedPattern {
  readonly rounds: readonly ParsedRound[];
  /** True when there is at least one round and every round parsed. */
  readonly ok: boolean;
  /** Number of unsupported lines. */
  readonly bad: number;
  /** Sum of output stitches over all parsed rounds. */
  readonly total: number;
}

const TOK_RE = /^(\d+)?\s*(sc|hdc|dc|tr|inc|dec)(\s+in\s+(?:mr|magic\s*ring|magic\s*circle))?$/i;
const MAX_TOKEN_COUNT = 200;
const MAX_REPEATS = 99;

/** Parses a comma separated sequence such as `3sc, inc`. Returns null when unsupported. */
export function parseSequence(str: string): UnitStep[] | null {
  const parts = str
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const out: UnitStep[] = [];
  for (const p of parts) {
    const m = p.match(TOK_RE);
    if (!m) return null;
    const n = m[1] ? parseInt(m[1], 10) : 1;
    if (n < 1 || n > MAX_TOKEN_COUNT) return null;
    const k = m[2].toLowerCase() as StitchKind;
    for (let i = 0; i < n; i++) out.push({ k, mr: !!m[3] });
  }
  return out;
}

export function parseRound(line: string, idx: number): Omit<ParsedRound, 'chain'> {
  const raw = String(line).trim();
  let n = idx + 1;
  let body = raw;
  let declared: number | null = null;

  const lm = body.match(/^(?:R|Rnd|Round)?\s*(\d+)\s*[:.\-–]\s*(.*)$/i);
  if (lm) {
    n = parseInt(lm[1], 10);
    body = lm[2];
  }
  const dm = body.match(/\[\s*(\d+)\s*\]\s*$/);
  if (dm && dm.index !== undefined) {
    declared = parseInt(dm[1], 10);
    body = body.slice(0, dm.index).trim();
  }
  body = body.replace(/[×✕*]/g, 'x').trim();

  let unit: UnitStep[] | null = null;
  let reps = 1;
  let m: RegExpMatchArray | null;
  if ((m = body.match(/^\((.+)\)\s*x\s*(\d+)$/i))) {
    unit = parseSequence(m[1]);
    reps = parseInt(m[2], 10);
  } else if ((m = body.match(/^(.+?)\s*x\s*(\d+)$/i))) {
    unit = parseSequence(m[1]);
    reps = parseInt(m[2], 10);
  } else {
    unit = parseSequence(body);
  }

  if (!unit || reps < 1 || reps > MAX_REPEATS) {
    return { raw, n, ok: false, err: 'syntax', acts: [], unit: [], reps: 1, cons: 0, prod: 0, declared, mismatch: false };
  }

  const acts: RoundAction[] = [];
  for (let rep = 0; rep < reps; rep++) {
    unit.forEach((u, gi) => {
      const io = STITCH_IO[u.k];
      acts.push({ k: u.k, rep, gi, mr: u.mr, cons: u.mr ? 0 : io[0], prod: io[1] });
    });
  }
  const cons = acts.reduce((a, x) => a + x.cons, 0);
  const prod = acts.reduce((a, x) => a + x.prod, 0);
  return { raw, n, ok: true, err: '', acts, unit, reps, cons, prod, declared, mismatch: declared !== null && declared !== prod };
}

const cache = new Map<string, ParsedPattern>();

export function parsePattern(text: string | null | undefined): ParsedPattern {
  const key = String(text ?? '');
  const hit = cache.get(key);
  if (hit) return hit;

  const lines = key
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const base = lines.map((l, i) => parseRound(l, i));
  const rounds: ParsedRound[] = base.map((r, i) => {
    let chain: ChainStatus = 'na';
    const prev = base[i - 1];
    if (i > 0 && r.ok && prev.ok) {
      const anyMr = r.acts.some((a) => a.mr);
      chain = anyMr || r.cons === prev.prod ? 'ok' : 'bad';
    }
    return { ...r, chain };
  });

  const res: ParsedPattern = {
    rounds,
    ok: rounds.length > 0 && rounds.every((r) => r.ok),
    bad: rounds.filter((r) => !r.ok).length,
    total: rounds.reduce((a, r) => a + (r.ok ? r.prod : 0), 0),
  };
  if (cache.size > 200) cache.clear();
  cache.set(key, res);
  return res;
}

/** Index just past the repeat group that contains `ptr`. */
export function groupEnd(acts: readonly RoundAction[], ptr: number): number {
  if (ptr >= acts.length) return acts.length;
  const rep = acts[ptr].rep;
  let i = ptr;
  while (i < acts.length && acts[i].rep === rep) i++;
  return i;
}

export function sumTo(acts: readonly RoundAction[], ptr: number, field: 'cons' | 'prod'): number {
  let s = 0;
  for (let i = 0; i < ptr && i < acts.length; i++) s += acts[i][field];
  return s;
}
