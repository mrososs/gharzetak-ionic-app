/**
 * Smart crochet converter — deterministic, NO AI, NO network, NO OCR.
 *
 * Turns free-form Arabic / English crochet text into the strict notation understood by `pattern-parser.ts`
 * (and therefore by the tracker), reporting honestly how far each line could be trusted.
 *
 * Pipeline (every stage is a pure function):
 *   1. normalize   – digits, punctuation, Arabic letter variants, multiplication/range symbols
 *   2. classify    – per line: part heading · round line · assembly note · title
 *   3. header      – round number / ordinal word / range (R4 >> R7), declared total ([18] (18) = 18 غرزة)
 *   4. tokenize    – crochet vocabulary (US/UK, abbreviations, Arabic names, magic ring, repeat phrases)
 *   5. parse       – groups, repetitions, counts, shaping, joins → AST
 *   6. validate    – stitch arithmetic, declared totals, round-to-round continuity
 *   7. emit        – strict normalized text (cross-checked by re-parsing it with the strict parser)
 *
 * Guarantees:
 *   - Stitch counts are only ever CALCULATED from recognised tokens. Nothing is invented to make a total match.
 *   - Shaping keeps its stitch type: an HDC increase becomes `hdc-inc`, never a silent sc `inc`.
 *   - Stitches worked into another piece (`5sc in legs`) keep that reference and are flagged `needs-review`.
 *   - Anything not understood is `unsupported` and kept verbatim; the original text is always recoverable.
 */
import { STITCH_IO, StitchKind, parsePattern } from './pattern-parser';

/* ------------------------------------------------------------------ */
/* public model                                                        */
/* ------------------------------------------------------------------ */

export type ConvStatus = 'validated' | 'needs-review' | 'unsupported';

export interface ConvMessage {
  readonly level: 'info' | 'warn' | 'error';
  readonly code: string;
  readonly ar: string;
  readonly en: string;
}

export interface ConvRound {
  /** Round number as written (R7 → 7). */
  readonly n: number;
  /** The source line this round came from (a range line yields several rounds sharing it). */
  readonly original: string;
  /** Strict-notation line, e.g. `R3: (sc, inc) x 6 [18]`. For unsupported rounds: the original text, untouched. */
  readonly normalized: string;
  readonly status: ConvStatus;
  /** The total the pattern declared ([18]), or null. */
  readonly expected: number | null;
  /** The total we calculated from the recognised stitches, or null when the line is unsupported. */
  readonly calculated: number | null;
  /** Stitches taken from this piece's previous round. */
  readonly consumed: number | null;
  /** Other pieces this round is worked into (assembly), e.g. ['legs']. */
  readonly joins: readonly string[];
  readonly messages: readonly ConvMessage[];
}

export interface ConvPart {
  readonly name: string;
  /** Dictionary kind ('arm' | 'leg' | 'ear' | 'body' | …) or null for an unknown name. */
  readonly kind: string | null;
  readonly quantity: number;
  /** True when the quantity is only a suggestion (a paired piece such as arms) and the user must confirm it. */
  readonly quantityToConfirm: boolean;
  readonly rounds: readonly ConvRound[];
  /** Assembly / finishing instructions kept verbatim (sew, attach, stuff, fasten off …). */
  readonly notes: readonly string[];
  readonly status: ConvStatus;
  /** Sum of calculated output stitches over the rounds. */
  readonly calculatedTotal: number;
  /** Strict text of the part (one normalized line per round) — what the tracker will read. */
  readonly text: string;
  readonly messages: readonly ConvMessage[];
}

export interface ConversionResult {
  /** A title line found before the first part, or null. */
  readonly collectionName: string | null;
  readonly parts: readonly ConvPart[];
  /** Notes found before any part heading. */
  readonly looseNotes: readonly string[];
  /** The exact input (recoverable). */
  readonly original: string;
  /** Terminology of the INPUT; the normalized text is always written in US terms. */
  readonly detectedTerms: 'us' | 'uk';
  readonly counts: { readonly validated: number; readonly needsReview: number; readonly unsupported: number; readonly rounds: number };
  readonly status: ConvStatus;
  /** True when more than one part was found (suggest a collection). */
  readonly multiPart: boolean;
  readonly messages: readonly ConvMessage[];
}

export interface ConvertOptions {
  /** Terminology of the pasted text. 'auto' (default) = UK only when UK-only abbreviations (htr / trtr) are present. */
  readonly terms?: 'us' | 'uk' | 'auto';
}

/* ------------------------------------------------------------------ */
/* dictionaries                                                        */
/* ------------------------------------------------------------------ */

const L = '\\u0621-\\u064A';
/** "not followed by another letter" — JS \b does not understand Arabic. */
const END = `(?![a-z${L}])`;

const NUM_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  once: 1, twice: 2, thrice: 3,
  واحد: 1, واحده: 1, اثنين: 2, اثنان: 2, اثنتين: 2, اثنتان: 2, ثنتين: 2, ثلاث: 3, ثلاثه: 3, تلات: 3, تلاته: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6, سبع: 7, سبعه: 7,
  ثمان: 8, ثمانيه: 8, تمن: 8, تمانيه: 8, تسع: 9, تسعه: 9, عشر: 10, عشره: 10, عشرين: 20,
};

const ORDINALS: Readonly<Record<string, number>> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  الاول: 1, الاولي: 1, اول: 1, الثاني: 2, الثانيه: 2, الثالث: 3, الثالثه: 3, الرابع: 4, الرابعه: 4, الخامس: 5, الخامسه: 5, السادس: 6, السادسه: 6, السابع: 7, السابعه: 7, الثامن: 8, الثامنه: 8,
  التاسع: 9, التاسعه: 9, العاشر: 10, العاشره: 10, 'الحادي عشر': 11, 'الثاني عشر': 12,
};

const alt = (words: readonly string[]): string => [...words].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|');

const NUMWORD_RE = new RegExp(`^(?:${alt(Object.keys(NUM_WORDS))})${END}`);
const ORD_RE = new RegExp(`^(?:${alt(Object.keys(ORDINALS))})${END}`);

type BaseKind = 'sc' | 'hdc' | 'dc' | 'tr';

/** Names of the basic stitches. `ambiguous` = the word may mean something else (flagged for review). */
const BASE_US: ReadonlyArray<readonly [readonly string[], BaseKind, boolean?]> = [
  [['half double crochet', 'half double', 'half-double', 'hdc', 'هاف دبل', 'نص عمود', 'نصف عمود', 'نصف دبل'], 'hdc'],
  [['double crochet', 'dc', 'دبل كروشيه', 'دبل', 'عمود'], 'dc'],
  [['treble crochet', 'treble', 'tr', 'ترابل', 'عمود مزدوج', 'عمود طويل'], 'tr'],
  [['single crochet', 'single', 'sc', 'سنجل كروشيه', 'سنجل', 'غرزه قصيره', 'غرزه عاديه', 'غرزه سنجل'], 'sc'],
  // Appears in the product's reference examples as the plain stitch, but literally means "stuffing": needs a human look.
  [['حشو'], 'sc', true],
];
/** UK names: "dc" = US sc, "htr" = US hdc, "tr" = US dc, "dtr" = US tr. */
const BASE_UK: ReadonlyArray<readonly [readonly string[], BaseKind, boolean?]> = [
  [['half treble crochet', 'half treble', 'htr', 'هاف تريبل'], 'hdc'],
  [['double treble crochet', 'double treble', 'dtr'], 'tr'],
  [['treble crochet', 'treble', 'tr', 'ترابل'], 'dc'],
  [['double crochet', 'dc', 'دبل كروشيه', 'دبل'], 'sc'],
  [['single crochet', 'single', 'sc', 'سنجل كروشيه', 'سنجل', 'غرزه قصيره', 'غرزه عاديه'], 'sc'],
  [['حشو'], 'sc', true],
];

const INC_WORDS = ['increase', 'inc', 'incs', 'زياده', 'زيادة', 'زوّد', 'زود'];
const DEC_WORDS = ['decrease', 'dec', 'decs', 'نقص', 'انقاص', 'تنقيص', 'نقصان', 'تقليل'];
const MR_RE = new RegExp(`^(?:in\\s+(?:a\\s+|the\\s+)?)?(?:magic\\s*(?:ring|circle|loop)|adjustable\\s*ring|mr|ring)${END}`);

interface KindDef {
  readonly kind: string;
  readonly words: readonly string[];
  readonly pair?: boolean;
  readonly en: string;
}
const KINDS: readonly KindDef[] = [
  { kind: 'head', words: ['head', 'راس'], en: 'Head' },
  { kind: 'body', words: ['body', 'torso', 'جسم', 'جسد', 'بطن'], en: 'Body' },
  { kind: 'arm', words: ['arm', 'arms', 'hand', 'hands', 'ايد', 'يد', 'ايدي', 'ذراع', 'اذرع', 'ذراعين', 'ايدين'], pair: true, en: 'Arms' },
  { kind: 'leg', words: ['leg', 'legs', 'foot', 'feet', 'رجل', 'ارجل', 'رجلين', 'قدم', 'اقدام', 'رجول'], pair: true, en: 'Legs' },
  { kind: 'ear', words: ['ear', 'ears', 'ودن', 'ودان', 'ودنين', 'اذن', 'اذان', 'اذنين'], pair: true, en: 'Ears' },
  { kind: 'tail', words: ['tail', 'ذيل', 'ديل'], en: 'Tail' },
  { kind: 'dress', words: ['dress', 'skirt', 'فستان', 'تنوره'], en: 'Dress' },
  { kind: 'nose', words: ['nose', 'snout', 'muzzle', 'انف', 'خشم', 'منقار'], en: 'Nose' },
  { kind: 'wing', words: ['wing', 'wings', 'جناح', 'اجنحه'], pair: true, en: 'Wings' },
];

/** Strips the Arabic definite article so الجسم and جسم match the same dictionary entry. */
const stripAl = (w: string): string => (w.startsWith('ال') && w.length > 3 ? w.slice(2) : w);

export function kindOf(word: string): KindDef | null {
  const w = stripAl(normalizeLetters(word).trim().toLowerCase());
  return KINDS.find((k) => k.words.includes(w)) ?? null;
}

const NOTE_RE = new RegExp(
  `(?:^|[^a-z${L}])(?:sew|sewing|attach|assemble|assembly|stuff|stuffing|fasten\\s*off|cut\\s+(?:the\\s+)?yarn|leave\\s+(?:a\\s+)?(?:long\\s+)?tail|weave|embroider|glue|insert|invisible\\s+join|slip\\s+st(?:itch)?\\s+to\\s+join|خياطه|خيط[يه]?|ثبت[يه]?|تثبيت|جمع[يه]?|تجميع|الصق[يه]?|لصق|قص[يه]?\\s+الخيط|اقفل[يه]?|اغلق[يه]?|ابره|تطريز|طرز[يه]?|ركب[يه]?|تركيب|اربط[يه]?|ربط|احشي|يحشي)${END}`,
);

/* ------------------------------------------------------------------ */
/* 1. normalization                                                    */
/* ------------------------------------------------------------------ */

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Letter-level normalization used for MATCHING only (original text is always kept separately). */
export function normalizeLetters(s: string): string {
  return s
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // diacritics + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

/** Stage 1: one line of free text → a normalized, lower-cased matching string. */
export function normalizeLine(raw: string): string {
  let s = raw.normalize('NFKC');
  s = s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
  s = normalizeLetters(s).toLowerCase();
  s = s
    .replace(/[،؛]/g, ',')
    .replace(/[–—−‑]/g, '-')
    .replace(/[×✕✖⨯·]/g, ' x ')
    .replace(/[→⇒⟶➔➜]/g, ' >> ')
    .replace(/\s*[*]\s*(?=\d)/g, ' x ')
    .replace(/\)\s*\*/g, ') x ')
    .replace(/(?<![a-z])(sc|hdc|dc|tr|htr)\s*-\s*(inc|dec)(?![a-z])/g, '$1 $2')
    .replace(/[“”«»"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

/* ------------------------------------------------------------------ */
/* 3. header (round number / range / declared total)                  */
/* ------------------------------------------------------------------ */

const ROUND_PFX = `(?:rounds?|rnds?|rows?|r|الدور|دور|الجوله|جوله|الصف|صف)`;
const NUMTOK = `(\\d+|${alt(Object.keys(ORDINALS))})`;
const NUMTOK_NC = `(?:\\d+|${alt(Object.keys(ORDINALS))})`;

const HEADER_RE = new RegExp(
  `^(?:${ROUND_PFX})\\.?\\s*${NUMTOK}${END.replace('a-z', 'a-z0-9')}` +
    `(?:\\s*(?:>>|->|=>|to|through|thru|الي|حتي)\\s*(?:${ROUND_PFX}\\.?\\s*)?${NUMTOK}${END.replace('a-z', 'a-z0-9')}|\\s*-\\s*${ROUND_PFX}\\.?\\s*${NUMTOK}${END.replace('a-z', 'a-z0-9')}|-${NUMTOK}(?![a-z${L}0-9]))?` +
    `\\s*(?:[:.)=]|-(?=\\s)|(?=\\s|$|\\())?\\s*(.*)$`,
);

function numberOf(tok: string): number {
  if (/^\d+$/.test(tok)) return parseInt(tok, 10);
  return ORDINALS[tok] ?? NUM_WORDS[tok] ?? NaN;
}

const SHORT_TOTAL = `(?:sts?|stitch(?:es)?|st|غرز[هة]?|غرز)`;
const TOTAL_RES: readonly RegExp[] = [
  new RegExp(`\\[\\s*(\\d+)\\s*${SHORT_TOTAL}?\\s*\\]\\s*[.]?\\s*$`),
  new RegExp(`\\(\\s*(\\d+)\\s*${SHORT_TOTAL}?\\s*\\)\\s*[.]?\\s*$`),
  new RegExp(`(?:=|total\\s*:?|المجموع\\s*:?|اجمالي\\s*:?|الاجمالي\\s*:?|>>)\\s*(\\d+)\\s*${SHORT_TOTAL}?\\s*[.]?\\s*$`),
  new RegExp(`[-,]\\s*(\\d+)\\s*${SHORT_TOTAL}\\s*[.]?\\s*$`),
];

/** Stage 3b: pulls the declared total off the end of a body. */
export function splitTotal(body: string): { body: string; declared: number | null } {
  for (const re of TOTAL_RES) {
    const m = re.exec(body);
    if (m && m.index !== undefined) return { body: body.slice(0, m.index).replace(/[\s,:=-]+$/, '').trim(), declared: parseInt(m[1], 10) };
  }
  return { body: body.trim(), declared: null };
}

/* ------------------------------------------------------------------ */
/* 4. tokenizer                                                        */
/* ------------------------------------------------------------------ */

type Tok =
  | { t: 'num'; v: number }
  | { t: 'base'; k: BaseKind; ambiguous: boolean }
  | { t: 'shape'; s: 'inc' | 'dec' }
  | { t: 'spec'; k: StitchKind }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'sep' }
  | { t: 'x' }
  | { t: 'in' }
  | { t: 'mr' }
  | { t: 'same' }
  | { t: 'each' }
  | { t: 'loop' }
  | { t: 'word'; text: string }
  | { t: 'unk'; text: string };

interface Lexicon {
  readonly bases: ReadonlyArray<{ re: RegExp; k: BaseKind; ambiguous: boolean }>;
  readonly specs: ReadonlyArray<{ re: RegExp; k: StitchKind }>;
}

const lexCache = new Map<'us' | 'uk', Lexicon>();

function lexicon(terms: 'us' | 'uk'): Lexicon {
  const hit = lexCache.get(terms);
  if (hit) return hit;
  const table = terms === 'uk' ? BASE_UK : BASE_US;
  const bases: Array<{ re: RegExp; k: BaseKind; ambiguous: boolean; len: number }> = [];
  for (const [words, k, amb] of table) for (const w of words) bases.push({ re: new RegExp(`^${alt([w])}${END}`), k, ambiguous: !!amb, len: w.length });
  bases.sort((a, b) => b.len - a.len);
  // sc2tog / hdc2tog / dc2tog / invdec: stitch-specific decreases.
  const specs: Array<{ re: RegExp; k: StitchKind }> = [
    { re: new RegExp(`^(?:inv\\s*)?${terms === 'uk' ? 'dc' : 'sc'}\\s*2\\s*tog${END}`), k: 'dec' },
    { re: new RegExp(`^(?:inv\\s*)?${terms === 'uk' ? 'htr' : 'hdc'}\\s*2\\s*tog${END}`), k: 'hdc-dec' },
    { re: new RegExp(`^(?:inv\\s*)?${terms === 'uk' ? 'tr' : 'dc'}\\s*2\\s*tog${END}`), k: 'dc-dec' },
    { re: new RegExp(`^invdec${END}`), k: 'dec' },
  ];
  const lex = { bases: bases.map(({ re, k, ambiguous }) => ({ re, k, ambiguous })), specs };
  lexCache.set(terms, lex);
  return lex;
}

const SEP_RE = new RegExp(`^(?:,|\\+|&|;|and${END}|then${END}|after\\s+that${END}|وبعدها|بعدها|وبعدين|بعدين|ثم|و(?=\\s)|و(?=[${L}]))`);
const SHAPE_INC_RE = new RegExp(`^(?:${alt(INC_WORDS.map(normalizeLetters))})${END}`);
const SHAPE_DEC_RE = new RegExp(`^(?:${alt(DEC_WORDS.map(normalizeLetters))})${END}`);
const LOOP_RE = new RegExp(`^(?:(?:front|back)\\s+loops?(?:\\s+only)?|[fb]lo${END}|(?:الحلقه|حلقه)\\s+(?:الاماميه|الخلفيه)(?:\\s+فقط)?)`);
const SAME_RE = new RegExp(`^(?:the\\s+)?(?:next|same|one|1)(?:\\s+(?:st|stitch|sts|stitches|غرزه|الغرزه))?${END}`);
const EACH_RE = new RegExp(`^(?:each|every|كل)(?:\\s+(?:st|stitch|sts|stitches|غرزه|غرز))?${END}`);
const AROUND_RE = new RegExp(`^(?:around|round|حول|دايري|بالدور)${END}`);
const FILLER_RE = new RegExp(`^(?:work|make|crochet|the|a|an|of|your|اشتغلي|اشتغل|اعملي|شغلي)${END}`);
const WORD_RE = new RegExp(`^[a-z${L}][a-z${L}'-]*`);

/** Stage 4: normalized body → tokens. Unknown characters become `unk` tokens (the round is then unsupported). */
export function tokenize(body: string, terms: 'us' | 'uk'): Tok[] {
  const lex = lexicon(terms);
  const out: Tok[] = [];
  let s = body.trim();
  let m: RegExpExecArray | null;
  const eat = (n: number) => (s = s.slice(n).trimStart());
  outer: while (s) {
    if ((m = /^\d+/.exec(s))) {
      out.push({ t: 'num', v: parseInt(m[0], 10) });
      eat(m[0].length);
      continue;
    }
    if ((m = /^[([{]/.exec(s))) { out.push({ t: 'lp' }); eat(1); continue; }
    if ((m = /^[)\]}]/.exec(s))) { out.push({ t: 'rp' }); eat(1); continue; }
    if ((m = /^x(?=\s*\d)/.exec(s))) { out.push({ t: 'x' }); eat(1); continue; }
    if ((m = NUMWORD_RE.exec(s))) { out.push({ t: 'num', v: NUM_WORDS[m[0].replace(/\s+/g, ' ')] }); eat(m[0].length); continue; }
    if ((m = SEP_RE.exec(s))) { out.push({ t: 'sep' }); eat(m[0].length); continue; }
    if ((m = FILLER_RE.exec(s))) { eat(m[0].length); continue; }
    if ((m = MR_RE.exec(s))) { out.push({ t: 'in' }, { t: 'mr' }); eat(m[0].length); continue; }
    if ((m = /^(?:in|into|inside|في|داخل)(?![a-z0-9\u0621-\u064A])/.exec(s))) {
      out.push({ t: 'in' });
      eat(m[0].length);
      continue;
    }
    if ((m = LOOP_RE.exec(s))) { out.push({ t: 'loop' }); eat(m[0].length); continue; }
    if ((m = EACH_RE.exec(s))) { out.push({ t: 'each' }); eat(m[0].length); continue; }
    if ((m = AROUND_RE.exec(s))) { out.push({ t: 'each' }); eat(m[0].length); continue; }
    for (const sp of lex.specs) {
      if ((m = sp.re.exec(s))) { out.push({ t: 'spec', k: sp.k }); eat(m[0].length); continue outer; }
    }
    for (const b of lex.bases) {
      if ((m = b.re.exec(s))) { out.push({ t: 'base', k: b.k, ambiguous: b.ambiguous }); eat(m[0].length); continue outer; }
    }
    if ((m = SHAPE_INC_RE.exec(s))) { out.push({ t: 'shape', s: 'inc' }); eat(m[0].length); continue; }
    if ((m = SHAPE_DEC_RE.exec(s))) { out.push({ t: 'shape', s: 'dec' }); eat(m[0].length); continue; }
    if ((m = SAME_RE.exec(s))) { out.push({ t: 'same' }); eat(m[0].length); continue; }
    if ((m = WORD_RE.exec(s))) { out.push({ t: 'word', text: m[0] }); eat(m[0].length); continue; }
    out.push({ t: 'unk', text: s[0] });
    eat(1);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 5. parser → AST                                                     */
/* ------------------------------------------------------------------ */

interface StitchNode {
  readonly type: 'stitch';
  readonly k: StitchKind;
  readonly n: number;
  readonly mr: boolean;
  readonly ref: string | null;
  /** "in each stitch around": the count is whatever the previous round produced. */
  readonly each: boolean;
}
interface GroupNode {
  readonly type: 'group';
  readonly items: readonly Node[];
  readonly reps: number;
}
type Node = StitchNode | GroupNode;

interface ParseCtx {
  readonly partKind: string | null;
  readonly flags: { ambiguous: boolean; assumed: boolean };
}

class ParseError extends Error {}

const SHAPED: Readonly<Record<BaseKind, { inc: StitchKind; dec: StitchKind }>> = {
  sc: { inc: 'inc', dec: 'dec' },
  hdc: { inc: 'hdc-inc', dec: 'hdc-dec' },
  dc: { inc: 'dc-inc', dec: 'dc-dec' },
  tr: { inc: 'tr-inc', dec: 'tr-dec' },
};

function parseTokens(tokens: Tok[], ctx: ParseCtx): Node[] {
  let i = 0;
  const peek = (): Tok | undefined => tokens[i];

  const parseSeq = (closer: boolean): Node[] => {
    const items: Node[] = [];
    for (;;) {
      const t = peek();
      if (!t) break;
      if (t.t === 'rp') {
        if (!closer) throw new ParseError('unbalanced');
        break;
      }
      if (t.t === 'sep') { i++; continue; }
      if (t.t === 'x') {
        if (closer) throw new ParseError('repeat inside group');
        break; // whole-body repetition: handled by the caller
      }
      items.push(parseItem());
    }
    return items;
  };

  const readReps = (): number | null => {
    if (peek()?.t === 'x') {
      const n = tokens[i + 1];
      if (n?.t === 'num') {
        i += 2;
        if (n.v < 1 || n.v > 99) throw new ParseError('reps');
        return n.v;
      }
      throw new ParseError('reps');
    }
    return null;
  };

  const parseItem = (): Node => {
    const t = peek()!;
    if (t.t === 'lp') {
      i++;
      const inner = parseSeq(true);
      if (peek()?.t !== 'rp') throw new ParseError('unbalanced');
      i++;
      if (!inner.length) throw new ParseError('empty group');
      return { type: 'group', items: inner, reps: readReps() ?? 1 };
    }
    let count = 1;
    if (t.t === 'num') {
      count = t.v;
      i++;
      if (count < 1 || count > 200) throw new ParseError('count');
    }
    const a = peek();
    let kind: StitchKind;
    let base: BaseKind | null = null;
    if (a?.t === 'base') {
      i++;
      base = a.k;
      if (a.ambiguous) ctx.flags.ambiguous = true;
      const b = peek();
      if (b?.t === 'shape') {
        i++;
        kind = SHAPED[a.k][b.s];
      } else kind = a.k;
    } else if (a?.t === 'shape') {
      i++;
      const b = peek();
      if (b?.t === 'base') {
        i++;
        base = b.k;
        if (b.ambiguous) ctx.flags.ambiguous = true;
        kind = SHAPED[b.k][a.s];
      } else kind = SHAPED.sc[a.s]; // bare `inc` / `dec` always meant the single-crochet shaping
    } else if (a?.t === 'spec') {
      i++;
      kind = a.k;
    } else throw new ParseError(`unexpected ${a ? a.t : 'end'}`);

    let mr = false;
    let ref: string | null = null;
    let each = false;
    if (peek()?.t === 'each') {
      i++;
      each = true;
      if (count !== 1) throw new ParseError('count with each');
    }
    if (peek()?.t === 'in') {
      i++;
      const n = peek();
      if (n?.t === 'mr') { i++; mr = true; }
      else if (n?.t === 'same') {
        i++;
        // "2sc in next st" = one stitch worked twice = an increase; other multiples have no strict equivalent.
        if (base && count === 2 && (kind === 'sc' || kind === 'hdc' || kind === 'dc' || kind === 'tr')) {
          kind = SHAPED[base].inc;
          count = 1;
        } else throw new ParseError('multiple in one stitch');
      } else if (n?.t === 'each') {
        i++;
        each = true;
        if (count !== 1) throw new ParseError('count with each');
      } else if (n?.t === 'loop') throw new ParseError('loop');
      else if (n?.t === 'word') {
        i++;
        const def = kindOf(n.text);
        if (!def) throw new ParseError(`unknown reference ${n.text}`);
        // Working into this very piece is ordinary; into another piece is a join and keeps its reference.
        if (def.kind !== ctx.partKind) ref = stripAl(n.text);
      } else throw new ParseError('dangling in');
      if (peek()?.t === 'each') { i++; each = true; } // "in each st around"
    }
    if (peek()?.t === 'each') i++; // trailing "around"
    return { type: 'stitch', k: kind, n: count, mr, ref, each };
  };

  const items = parseSeq(false);
  if (peek()?.t === 'x') {
    const reps = readReps() ?? 1;
    if (i < tokens.length || !items.length) throw new ParseError('trailing tokens');
    return [{ type: 'group', items, reps }];
  }
  if (i < tokens.length) throw new ParseError('trailing tokens');
  return items;
}

/* ------------------------------------------------------------------ */
/* 6/7. arithmetic + emission                                          */
/* ------------------------------------------------------------------ */

interface Totals {
  cons: number;
  prod: number;
}

function totals(nodes: readonly Node[], prevProd: number | null): Totals {
  let cons = 0;
  let prod = 0;
  for (const n of nodes) {
    if (n.type === 'stitch') {
      const count = n.each ? (prevProd ?? 0) : n.n;
      const io = STITCH_IO[n.k];
      cons += n.mr || n.ref ? 0 : io[0] * count;
      prod += io[1] * count;
    } else {
      const t = totals(n.items, prevProd);
      cons += t.cons * n.reps;
      prod += t.prod * n.reps;
    }
  }
  return { cons, prod };
}

function emitStitch(k: StitchKind, n: number, mr: boolean, ref: string | null): string {
  return `${n > 1 ? n : ''}${k}${mr ? ' in MR' : ref ? ` in ${ref}` : ''}`;
}

/** Flattens groups (needed when a round mixes groups with loose stitches) into stitch nodes. */
function flatten(nodes: readonly Node[], prevProd: number | null): StitchNode[] {
  const out: StitchNode[] = [];
  for (const n of nodes) {
    if (n.type === 'stitch') out.push(n.each ? { ...n, n: prevProd ?? 0, each: false } : n);
    else for (let r = 0; r < n.reps; r++) out.push(...flatten(n.items, prevProd));
  }
  return out;
}

function emitSeq(stitches: readonly StitchNode[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < stitches.length) {
    const s = stitches[i];
    let n = s.n;
    let j = i + 1;
    while (j < stitches.length && stitches[j].k === s.k && stitches[j].mr === s.mr && stitches[j].ref === s.ref) n += stitches[j++].n;
    parts.push(emitStitch(s.k, n, s.mr, s.ref));
    i = j;
  }
  return parts.join(', ');
}

/** Stage 7: AST → strict body text. A single top-level repeat group keeps its `( … ) x N` shape (tracker group counting). */
function emitBody(nodes: readonly Node[], prevProd: number | null): string {
  if (nodes.length === 1 && nodes[0].type === 'group' && nodes[0].items.every((x) => x.type === 'stitch') && !nodes[0].items.some((x) => (x as StitchNode).each)) {
    const g = nodes[0];
    return `(${emitSeq(g.items as StitchNode[])}) x ${g.reps}`;
  }
  return emitSeq(flatten(nodes, prevProd));
}

/* ------------------------------------------------------------------ */
/* round conversion                                                    */
/* ------------------------------------------------------------------ */

const msg = (level: ConvMessage['level'], code: string, ar: string, en: string): ConvMessage => ({ level, code, ar, en });

/** Canonicalises repetition phrases to `x N` ("repeat six times", "كرري 6 مرات", "(…) 6 times"). */
function canonRepeat(body: string): string {
  const num = `(\\d+|${alt(Object.keys(NUM_WORDS))})`;
  const timesW = `(?:times?|x|مرات|مره)`;
  const toNum = (w: string) => (/^\d+$/.test(w) ? w : String(NUM_WORDS[w.replace(/\s+/g, ' ')] ?? w));
  return body
    .replace(new RegExp(`[,;]?\\s*(?:repeat(?:ing)?|rep|كرر[يه]?|تكرار)\\s*(?:it\\s+|this\\s+)?${num}\\s*${timesW}?${END}`, 'g'), (_m, w: string) => ` x ${toNum(w)} `)
    .replace(new RegExp(`\\)\\s*${num}\\s*(?:times?|مرات|مره)${END}`, 'g'), (_m, w: string) => `) x ${toNum(w)} `)
    .replace(new RegExp(`\\bx\\s*${num}\\s*(?:times?|مرات|مره)${END}`, 'g'), (_m, w: string) => `x ${toNum(w)} `)
    .replace(/\s+/g, ' ')
    .trim();
}

interface RoundCtx {
  readonly terms: 'us' | 'uk';
  readonly partKind: string | null;
  /** Stitches the previous round of THIS piece produced (null = unknown / first round). */
  readonly prevProd: number | null;
}

interface Converted {
  readonly round: ConvRound;
  readonly prod: number | null;
}

function convertOneRound(n: number, original: string, bodyNorm: string, declared: number | null, ctx: RoundCtx): Converted {
  const messages: ConvMessage[] = [];
  const mk = (status: ConvStatus, normalized: string, calculated: number | null, consumed: number | null, joins: string[]): Converted => ({
    round: { n, original, normalized, status, expected: declared, calculated, consumed, joins, messages },
    prod: calculated,
  });
  const header = `R${n}:`;
  let body = canonRepeat(bodyNorm);
  const flags = { ambiguous: false, assumed: false };

  // "R4 >> R7 (24)": no instruction at all, only a total → work even. The stitch is NOT written, so this is an explicit, flagged assumption.
  if (!body) {
    if (declared === null) return withMsg(mk('unsupported', `${header}`, null, null, []), messages, msg('error', 'empty', 'سطر بدون تعليمات', 'The line has no instructions'));
    flags.assumed = true;
    body = `${declared}sc`;
    messages.push(msg('warn', 'assumed-sc', `لم يُذكر نوع الغرزة: افترضنا ${declared} غرزة قصيرة (شغل مستوٍ). راجعي النوع.`, `No stitch type was written: assumed ${declared} single crochet (work even). Please confirm the stitch.`));
  }

  let nodes: Node[];
  try {
    nodes = parseTokens(tokenize(body, ctx.terms), { partKind: ctx.partKind, flags });
    if (!nodes.length) throw new ParseError('empty');
  } catch (e) {
    const reason = e instanceof ParseError ? e.message : 'error';
    const loop = reason === 'loop';
    return withMsg(
      mk('unsupported', `${header} ${original.replace(/^[^:]*:\s*/, '')}`.trim(), null, null, []),
      messages,
      msg(
        'error',
        loop ? 'loop' : 'unsupported',
        loop ? 'غرز الحلقة الأمامية/الخلفية غير مدعومة في العدّاد — اتحفظ السطر كما هو.' : 'تعذّر فهم هذا السطر — اتحفظ كما هو بدون عدّ تلقائي.',
        loop ? 'Front/back-loop stitches are not supported by the counter — the line is kept as written.' : 'This line could not be understood — it is kept as written, without automatic counting.',
      ),
    );
  }

  if (nodes.some((x) => hasEach(x)) && ctx.prevProd === null) {
    return withMsg(
      mk('unsupported', `${header} ${original.replace(/^[^:]*:\s*/, '')}`.trim(), null, null, []),
      messages,
      msg('error', 'each-unknown', '«في كل غرزة» يحتاج دورًا سابقًا معروف العدد.', '"In each stitch" needs a previous round with a known stitch count.'),
    );
  }

  const t = totals(nodes, ctx.prevProd);
  const joins = [...new Set(collectRefs(nodes))];
  const hasMr = collectMr(nodes);
  const normalizedBody = emitBody(nodes, ctx.prevProd);
  const normalized = `${header} ${normalizedBody}${declared !== null ? ` [${declared}]` : ''}`;

  let status: ConvStatus = 'validated';
  const review = (m: ConvMessage) => {
    messages.push(m);
    status = 'needs-review';
  };

  if (declared !== null && declared !== t.prod) {
    review(msg('warn', 'total-mismatch', `المجموع المكتوب [${declared}] لا يساوي المحسوب ${t.prod}. لم نعدّل أي غرزة — راجعي السطر.`, `The written total [${declared}] does not match the calculated ${t.prod}. No stitches were changed — please check the line.`));
  } else if (declared === null) {
    messages.push(msg('info', 'no-total', `لا يوجد مجموع مكتوب — المحسوب ${t.prod}.`, `No total was written — calculated ${t.prod}.`));
  }
  if (joins.length) {
    review(msg('warn', 'joins', `هذا الدور يعمل داخل قطع أخرى (${joins.join('، ')}). احتُفظ بالإشارة، ولا يمكن التحقق من تجميع القطع تلقائيًا.`, `This round is worked into other pieces (${joins.join(', ')}). The reference is kept; joining pieces cannot be fully validated automatically.`));
  } else if (ctx.prevProd !== null && !hasMr && t.cons !== ctx.prevProd) {
    review(msg('warn', 'chain', `يستهلك ${t.cons} غرزة لكن الدور السابق أنتج ${ctx.prevProd}.`, `It uses ${t.cons} stitches but the previous round produced ${ctx.prevProd}.`));
  }
  if (flags.ambiguous) review(msg('warn', 'ambiguous', 'كلمة «حشو» قد تعني الحشو لا الغرزة القصيرة — اعتُبرت غرزة قصيرة، راجعيها.', 'The word "حشو" may mean stuffing rather than a stitch — read as single crochet, please confirm.'));

  // Defence in depth: the strict parser (what the tracker uses) must agree with the numbers we calculated.
  const strict = parsePattern(normalized).rounds[0];
  if (!strict?.ok || strict.prod !== t.prod || strict.cons !== t.cons) {
    review(msg('warn', 'strict-mismatch', 'تعذّر تأكيد السطر بالمحلّل الصارم — راجعيه.', 'The strict parser could not confirm this line — please review it.'));
  }
  if (flags.assumed) {
    status = 'needs-review';
  }
  return { round: { n, original, normalized, status, expected: declared, calculated: t.prod, consumed: t.cons, joins, messages }, prod: t.prod };
}

function withMsg(c: Converted, messages: ConvMessage[], m: ConvMessage): Converted {
  messages.push(m);
  return c;
}
function hasEach(n: Node): boolean {
  return n.type === 'stitch' ? n.each : n.items.some(hasEach);
}
function collectRefs(nodes: readonly Node[]): string[] {
  return nodes.flatMap((n) => (n.type === 'stitch' ? (n.ref ? [n.ref] : []) : collectRefs(n.items)));
}
function collectMr(nodes: readonly Node[]): boolean {
  return nodes.some((n) => (n.type === 'stitch' ? n.mr : collectMr(n.items)));
}

/* ------------------------------------------------------------------ */
/* 2. line classification                                              */
/* ------------------------------------------------------------------ */

interface RoundHead {
  readonly from: number;
  readonly to: number;
  readonly rest: string;
}

function matchRoundHeader(norm: string): RoundHead | null {
  const m = HEADER_RE.exec(norm);
  if (!m) return null;
  const from = numberOf(m[1]);
  if (!Number.isFinite(from)) return null;
  const toTok = m[2] ?? m[3] ?? m[4];
  const to = toTok ? numberOf(toTok) : from;
  if (!Number.isFinite(to) || to < from || to - from > 99) return null;
  return { from, to, rest: (m[5] ?? '').trim() };
}

const hasStitchWord = (norm: string, terms: 'us' | 'uk'): boolean => {
  const lex = lexicon(terms);
  const words = norm.split(/[\s,+()[\]]+/).filter(Boolean);
  const joined = words.join(' ');
  return words.some((w) => lex.bases.some((b) => b.re.test(w)) || SHAPE_INC_RE.test(w) || SHAPE_DEC_RE.test(w) || /\d+(?:sc|hdc|dc|tr|htr|inc|dec)/.test(w)) || lex.bases.some((b) => b.re.test(joined)) || MR_RE.test(joined);
};

interface HeadingInfo {
  readonly name: string;
  readonly quantity: number | null;
}

/** "Arms x2", "الايد (2)", "Legs - make 2:" → { name:'Arms', quantity:2 } */
function parseHeading(original: string): HeadingInfo {
  let s = original.trim().replace(/^[\s\-•*#>·]+/, '').replace(/[\s:：.\-]+$/, '');
  s = s.replace(/^(?:part|piece|الجزء|جزء|قطعة|القطعة)\s*[:\-]?\s*/i, '');
  // Digit conversion keeps string length, so match offsets stay valid for the original letters.
  s = s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)));
  let quantity: number | null = null;
  const patterns = [
    /\s*[(\[]\s*(?:[x×]|make|عدد)?\s*(\d+)\s*(?:[x×]|pcs|pieces|قطع|قطعة)?\s*[)\]]\s*/i,
    /\s*(?:[-,:]\s*)?(?:make|اعمل[يه]?|عدد|qty|quantity)\s*:?\s*(\d+)\s*(?:pcs|pieces|times|مرات|قطع)?\s*/i,
    /\s*[x×]\s*(\d+)\s*$/i,
    /\s*(\d+)\s*[x×]\s*$/i,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) {
      quantity = parseInt(m[1], 10);
      s = s.replace(m[0], ' ');
      break;
    }
  }
  return { name: s.replace(/[\s:：\-,]+$/, '').replace(/\s+/g, ' ').trim(), quantity: quantity && quantity >= 1 && quantity <= 99 ? quantity : null };
}

/* ------------------------------------------------------------------ */
/* the converter                                                       */
/* ------------------------------------------------------------------ */

interface PartBuilder {
  name: string;
  quantity: number | null;
  rounds: ConvRound[];
  notes: string[];
  prevProd: number | null;
  lastN: number;
}

export function detectTerms(text: string): 'us' | 'uk' {
  return /(?:^|[^a-z])(?:htr|trtr|half\s+treble|double\s+treble)(?![a-z])/i.test(text) ? 'uk' : 'us';
}

const statusRank: Record<ConvStatus, number> = { validated: 0, 'needs-review': 1, unsupported: 2 };
const worst = (a: ConvStatus, b: ConvStatus): ConvStatus => (statusRank[b] > statusRank[a] ? b : a);

/** Converts a whole pasted document (one piece, or several pieces under part headings). */
export function convertPatternText(input: string, opts: ConvertOptions = {}): ConversionResult {
  const original = String(input ?? '');
  const terms: 'us' | 'uk' = opts.terms === 'us' || opts.terms === 'uk' ? opts.terms : detectTerms(original);
  const lines = original.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const messages: ConvMessage[] = [];
  if (terms === 'uk') messages.push(msg('info', 'uk-terms', 'اكتُشفت مصطلحات UK — تم تحويلها إلى US في النص المعياري.', 'UK terms detected — converted to US terms in the normalized text.'));

  const parts: PartBuilder[] = [];
  const looseNotes: string[] = [];
  let title: string | null = null;
  let current: PartBuilder | null = null;

  const classify = (line: string): 'round' | 'note' | 'label' => {
    const norm = normalizeLine(line);
    const head = matchRoundHeader(norm);
    if (head) return NOTE_RE.test(head.rest) && !hasStitchWord(head.rest, terms) ? 'note' : 'round';
    if (!NOTE_RE.test(norm) && hasStitchWord(norm, terms) && /[\d(]/.test(norm)) return 'round';
    if (NOTE_RE.test(norm)) return 'note';
    return 'label';
  };
  const kinds = lines.map((l) => classify(l));

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const norm = normalizeLine(line);
    const kind = kinds[li];

    if (kind === 'label') {
      const next = kinds[li + 1];
      const isLast = li === lines.length - 1;
      const startsDoc = !parts.length && !current;
      // A label followed by another label, before any part exists, is the collection title.
      if (startsDoc && title === null && (next === 'label') && !/:\s*$/.test(line)) {
        title = parseHeading(line).name;
        continue;
      }
      if (next === 'round' || next === 'label' || isLast || /[:：]\s*$/.test(line)) {
        const h = parseHeading(line);
        current = { name: h.name || line, quantity: h.quantity, rounds: [], notes: [], prevProd: null, lastN: 0 };
        parts.push(current);
        continue;
      }
      // a stray sentence between rounds: keep it as a note
      (current ? current.notes : looseNotes).push(line);
      continue;
    }

    if (kind === 'note') {
      (current ? current.notes : looseNotes).push(line);
      continue;
    }

    // ---- round line ----
    if (!current) {
      current = { name: '', quantity: null, rounds: [], notes: [], prevProd: null, lastN: 0 };
      parts.push(current);
    }
    const head = matchRoundHeader(norm);
    let from: number;
    let to: number;
    let rest: string;
    if (head) {
      from = head.from;
      to = head.to;
      rest = head.rest;
    } else {
      from = to = current.lastN + 1;
      rest = norm;
    }
    const sp = splitTotal(rest);
    const def = kindOf(current.name.replace(/\s*\(.*$/, '').split(/\s+/)[0] ?? '') ?? kindOf(current.name);
    for (let n = from; n <= to; n++) {
      const c = convertOneRound(n, line, sp.body, sp.declared, { terms, partKind: def?.kind ?? null, prevProd: current.prevProd });
      current.rounds.push(c.round);
      current.prevProd = c.prod;
      current.lastN = n;
    }
  }

  const built: ConvPart[] = parts
    .filter((p) => p.rounds.length || p.notes.length || p.name)
    .map((p, i) => {
      const def = kindOf(p.name) ?? kindOf(p.name.split(/\s+/)[0] ?? '');
      const name = p.name || (parts.length > 1 ? `${i + 1}` : '');
      const suggested = p.quantity === null && !!def?.pair;
      const status = p.rounds.reduce<ConvStatus>((acc, r) => worst(acc, r.status), 'validated');
      const pm: ConvMessage[] = [];
      if (!p.rounds.length) pm.push(msg('warn', 'no-rounds', 'لم نجد أدوارًا تحت هذا العنوان.', 'No rounds were found under this heading.'));
      return {
        name,
        kind: def?.kind ?? null,
        quantity: p.quantity ?? (suggested ? 2 : 1),
        quantityToConfirm: suggested,
        rounds: p.rounds,
        notes: p.notes,
        status: p.rounds.length ? status : 'needs-review',
        calculatedTotal: p.rounds.reduce((a, r) => a + (r.calculated ?? 0), 0),
        text: p.rounds.map((r) => r.normalized).join('\n'),
        messages: pm,
      } satisfies ConvPart;
    });

  const all = built.flatMap((p) => p.rounds);
  const counts = {
    validated: all.filter((r) => r.status === 'validated').length,
    needsReview: all.filter((r) => r.status === 'needs-review').length,
    unsupported: all.filter((r) => r.status === 'unsupported').length,
    rounds: all.length,
  };
  if (!all.length) messages.push(msg('error', 'nothing', 'لم نجد أي أدوار في النص.', 'No rounds were found in the text.'));
  return {
    collectionName: title,
    parts: built,
    looseNotes,
    original,
    detectedTerms: terms,
    counts,
    status: built.reduce<ConvStatus>((acc, p) => worst(acc, p.status), all.length ? 'validated' : 'unsupported'),
    multiPart: built.length > 1,
    messages,
  };
}

/** Re-converts the text of ONE part (used after the user corrected a line in the preview). */
export function convertPartText(text: string, partName = '', opts: ConvertOptions = {}): ConvPart {
  const r = convertPatternText(partName ? `${partName}:\n${text}` : text, opts);
  const first = r.parts[0];
  if (first) return { ...first, name: partName || first.name };
  return { name: partName, kind: null, quantity: 1, quantityToConfirm: false, rounds: [], notes: [], status: 'unsupported', calculatedTotal: 0, text: '', messages: [] };
}

/** The whole conversion as one strict text (parts separated by their headings) — for the "normalized text" view. */
export function normalizedDocument(r: ConversionResult): string {
  const single = r.parts.length === 1 && !r.parts[0].name;
  return r.parts.map((p) => (single ? p.text : `${p.name}:\n${p.text}`)).join('\n\n');
}
