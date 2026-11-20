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
 *   R4: 3hdc-inc, 2hdc [8]           stitch-specific shaping (hdc-inc, hdc-dec, dc-inc, ...)
 *   R7: 5sc, 5sc in legs, 14sc [24]  worked into ANOTHER piece (joining): consumes nothing from this piece's previous round,
 *                                    is kept as a reference and the round is flagged `joins` (never fully validated)
 *
 *   R1: 43 ch                        foundation chain (also `43ch`, `ch 43`, `43 chains`)
 *   R2: ch 1, 42 sc [42]             turning chain, then the row
 *
 * Stitch accounting (input stitches consumed from the previous round → output produced):
 *   sc / hdc / dc / tr : 1 → 1
 *   inc                : 1 → 2
 *   dec                : 2 → 1
 *   anything "in MR"   : 0 → n   (worked into the magic ring)
 *   ch                 : 0 → 0   a chain is a loop, not a stitch of the fabric: it is NEVER counted in a stitch total. Patterns differ on
 *                                whether the next row works into a chain, so each round reports its chains separately (`chains`) and
 *                                a position-based `chainRole`; see `classifyChains`.
 */

/**
 * Stitch kinds. The `*-inc` / `*-dec` kinds are stitch-specific shaping (an HDC increase is two hdc in one stitch, not an sc increase).
 * Plain `inc` / `dec` remain the single-crochet shaping used by every existing pattern.
 */
export type StitchKind = 'ch' | 'sc' | 'hdc' | 'dc' | 'tr' | 'inc' | 'dec' | 'hdc-inc' | 'hdc-dec' | 'dc-inc' | 'dc-dec' | 'tr-inc' | 'tr-dec';

/** [consumed, produced] for one action of each kind. */
export const STITCH_IO: Readonly<Record<StitchKind, readonly [number, number]>> = {
  ch: [0, 0],
  sc: [1, 1],
  hdc: [1, 1],
  dc: [1, 1],
  tr: [1, 1],
  inc: [1, 2],
  dec: [2, 1],
  'hdc-inc': [1, 2],
  'hdc-dec': [2, 1],
  'dc-inc': [1, 2],
  'dc-dec': [2, 1],
  'tr-inc': [1, 2],
  'tr-dec': [2, 1],
};

export interface UnitStep {
  readonly k: StitchKind;
  /** Worked into a magic ring: consumes nothing from a previous round. */
  readonly mr: boolean;
  /** Worked into another piece of the design (joining), e.g. `5sc in legs`. null for ordinary stitches. */
  readonly ref?: string | null;
}

/** One concrete action inside a round, after repeats are expanded. */
export interface RoundAction {
  readonly k: StitchKind;
  /** 0-based repeat (group) index. */
  readonly rep: number;
  /** Index inside the repeat unit. */
  readonly gi: number;
  readonly mr: boolean;
  /** Joined piece this stitch is worked into (consumes nothing from this piece's previous round). */
  readonly ref: string | null;
  readonly cons: number;
  readonly prod: number;
}

export type ChainStatus = 'na' | 'ok' | 'bad';

/**
 * What the chains of a round are, decided ONLY from where they sit (never from how many stitches the next row happens to use):
 *   none        no chains
 *   foundation  the FIRST round is nothing but chains (`R1: 43 ch`): the base the next row is worked into
 *   turning     1–4 chains at the very start of a round that goes on with stitches (`R2: ch 1, 42 sc`): lifts the yarn, not worked into
 *   standalone  a round of only chains that is NOT the first (a strap, a new base, a gap): its role cannot be told
 *   inline      any other chains (`R2: 6 sc, ch 6, 30 sc`, or a long chain before stitches): whether the next row works into them is unknown
 */
export type ChainRole = 'none' | 'foundation' | 'turning' | 'inline' | 'standalone';

/** The longest run of leading chains still read as a turning chain (1 for sc, 2 for hdc, 3 for dc, 4 for tr). */
export const MAX_TURNING_CHAIN = 4;
/** A single chain token may be longer than a stitch token: foundation chains of a blanket run to hundreds. */
export const MAX_CHAIN_COUNT = 500;

/**
 * Chains skipped at the start of the row worked into a foundation chain, by the stitch that row is made of (the standard rule: the first
 * chain from the hook is the turning chain for sc, the first two for hdc …). Any other first stitch (increase, decrease …) has no rule.
 */
export const FOUNDATION_SKIP: Readonly<Partial<Record<StitchKind, number>>> = { sc: 1, hdc: 2, dc: 3, tr: 4 };

/** How many stitches the standard rule expects in the row worked into a foundation chain of `chains`, or null when it cannot be told. */
export function foundationRowCount(chains: number, firstStitch: StitchKind | null): number | null {
  const skip = firstStitch ? FOUNDATION_SKIP[firstStitch] : undefined;
  return skip === undefined || chains - skip < 1 ? null : chains - skip;
}

/** Counts the chains of a round and says what they are. `seq` is the round in order, one entry per run of the same stitch. */
export function classifyChains(seq: readonly { readonly k: StitchKind; readonly n: number }[], first: boolean): { chains: number; role: ChainRole } {
  const chains = seq.reduce((a, s) => a + (s.k === 'ch' ? s.n : 0), 0);
  if (!chains) return { chains: 0, role: 'none' };
  if (seq.every((s) => s.k === 'ch')) return { chains, role: first ? 'foundation' : 'standalone' };
  let lead = 0;
  for (const s of seq) {
    if (s.k !== 'ch') break;
    lead += s.n;
  }
  return { chains, role: lead === chains && lead <= MAX_TURNING_CHAIN ? 'turning' : 'inline' };
}

/** The number a round's written total [N] is compared with: its stitches, or — for a round of ONLY chains — its chains. */
export const countedTotal = (r: { readonly chainRole: ChainRole; readonly chains: number; readonly prod: number }): number => (r.chainRole === 'foundation' || r.chainRole === 'standalone' ? r.chains : r.prod);

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
  /** declared !== null && declared !== the counted total (stitches produced; for a round of ONLY chains, the chains). */
  readonly mismatch: boolean;
  /** Chains worked in this round. They are never part of `cons` / `prod`. */
  readonly chains: number;
  readonly chainRole: ChainRole;
  /** Whether this round consumes what the previous round produced. */
  readonly chain: ChainStatus;
  /** Distinct other pieces this round is joined to (assembly). Empty for ordinary rounds. */
  readonly joins: readonly string[];
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

const TOK_RE = /^(\d+)?\s*(hdc-inc|hdc-dec|dc-inc|dc-dec|tr-inc|tr-dec|sc|hdc|dc|tr|inc|dec|ch(?:ain)?s?)(?:\s+in\s+(?:(mr|magic\s*ring|magic\s*circle)|([A-Za-z؀-ۿ][A-Za-z؀-ۿ-]*)))?$/i;
/** `ch 43`: the only token whose count may follow its name (it is how chains are written everywhere: "ch 3", "chain 43"). */
const CH_COUNT_AFTER_RE = /^ch(?:ain)?s?\s*(\d+)$/i;
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
    const after = p.match(CH_COUNT_AFTER_RE);
    const m = after ? null : p.match(TOK_RE);
    if (!after && !m) return null;
    const n = after ? parseInt(after[1], 10) : m![1] ? parseInt(m![1], 10) : 1;
    const k: StitchKind = after || m![2].toLowerCase().startsWith('ch') ? 'ch' : (m![2].toLowerCase() as StitchKind);
    if (n < 1 || n > (k === 'ch' ? MAX_CHAIN_COUNT : MAX_TOKEN_COUNT)) return null;
    // A chain is not worked into a ring or another piece: that is not a notation this parser can count, so it is not guessed.
    if (k === 'ch' && m && (m[3] || m[4])) return null;
    const ref = m && m[4] ? m[4].toLowerCase() : null;
    for (let i = 0; i < n; i++) out.push({ k, mr: !!(m && m[3]), ref });
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
    return { raw, n, ok: false, err: 'syntax', acts: [], unit: [], reps: 1, cons: 0, prod: 0, declared, mismatch: false, chains: 0, chainRole: 'none', joins: [] };
  }

  const acts: RoundAction[] = [];
  for (let rep = 0; rep < reps; rep++) {
    unit.forEach((u, gi) => {
      const io = STITCH_IO[u.k];
      const ref = u.ref ?? null;
      acts.push({ k: u.k, rep, gi, mr: u.mr, ref, cons: u.mr || ref ? 0 : io[0], prod: io[1] });
    });
  }
  const cons = acts.reduce((a, x) => a + x.cons, 0);
  const prod = acts.reduce((a, x) => a + x.prod, 0);
  const joins = [...new Set(acts.map((a) => a.ref).filter((r): r is string => !!r))];
  const { chains, role } = classifyChains(
    acts.map((a) => ({ k: a.k, n: 1 })),
    idx === 0,
  );
  // A round of ONLY chains has no stitches to total, so its written total ([43]) is checked against the chains.
  const counted = countedTotal({ chainRole: role, chains, prod });
  return { raw, n, ok: true, err: '', acts, unit, reps, cons, prod, declared, mismatch: declared !== null && declared !== counted, chains, chainRole: role, joins };
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
      const chainOnly = r.chainRole === 'foundation' || r.chainRole === 'standalone';
      if (r.joins.length) chain = 'na'; // worked into another piece: cannot be checked against this piece's previous round
      else if (anyMr) chain = 'ok';
      else if (chainOnly) chain = 'na'; // chains consume nothing from the previous round
      else if (prev.chainRole === 'foundation') {
        // Worked into a foundation chain: checked against the standard rule only (N−1 for sc, N−2 hdc …); no rule → not checked.
        const expected = foundationRowCount(prev.chains, r.acts.find((a) => a.k !== 'ch')?.k ?? null);
        chain = expected === null ? 'na' : r.cons === expected ? 'ok' : 'bad';
      } else if (prev.chainRole === 'standalone') chain = 'na'; // what the previous chains were is unknown: nothing to compare with
      else chain = r.cons === prev.prod ? 'ok' : 'bad';
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
