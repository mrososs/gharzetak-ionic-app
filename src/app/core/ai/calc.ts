/**
 * Deterministic "calculator facts" for Khayoota.
 *
 * The pilot benchmark showed the model getting stitch arithmetic wrong ("(2sc, inc) x 6" answered as 18 instead of 24).
 * So before a question is sent, the app finds round expressions in the user's own message, runs them through the REAL
 * Smart Pattern Parser and sends the results as facts. The model explains; the parser counts.
 *
 * Pure functions: no network, no store access.
 */
import { convertPatternText } from '../domain/smart-parser';

export interface CalcFact {
  /** The expression as found in the message (trimmed, ≤ 200 chars). */
  readonly expr: string;
  /** Strict notation the parser produced, e.g. `R1: (2sc, inc) x 6 [26]`. */
  readonly normalized: string;
  readonly consumed: number | null;
  readonly produced: number | null;
  readonly declared: number | null;
  readonly mismatch: boolean;
  readonly status: 'validated' | 'needs-review' | 'unsupported';
}

const MAX_FACTS = 5;
/** A repeat group with a count, optionally followed by a written total: (2sc, inc) x 6 [24]. */
const GROUP_RE = /\([^()\n]{1,120}\)\s*(?:[x×*]\s*[0-9٠-٩]{1,2}|[0-9٠-٩]{1,2}\s*(?:مرات|times))(?:\s*[[(]\s*[0-9٠-٩]{1,4}\s*[\])])?/g;
/** A whole round line: R4: …, Rnd 4: …, الدور ٤: … */
const LINE_RE = /^(?:\s*)(?:r|rnd|round|row|الدور|دور)\s*[0-9٠-٩]{1,3}\s*[:.)\-–][^\n]{1,200}$/gim;

/** Finds round expressions in free text and returns parser-computed facts (never more than five). */
export function calcFacts(message: string): CalcFact[] {
  const text = String(message ?? '').slice(0, 2000);
  const found: string[] = [];
  for (const m of text.matchAll(LINE_RE)) found.push(m[0].trim());
  if (!found.length) for (const m of text.matchAll(GROUP_RE)) found.push(m[0].trim());
  const facts: CalcFact[] = [];
  const seen = new Set<string>();
  const add = (expr: string, fallback: boolean): void => {
    if (facts.length >= MAX_FACTS || seen.has(expr)) return;
    seen.add(expr);
    const fact = factFor(expr);
    if (!fact) return;
    if (fact.status === 'unsupported' && fallback) {
      // A round line followed by a question ("R4: (2sc, inc) x 6 [24] اشرحلي…") is not a pattern line: count only the
      // repeat groups inside it. A line with nothing countable is not sent at all (no noise for the model).
      for (const m of expr.matchAll(GROUP_RE)) add(m[0].trim(), false);
      return;
    }
    facts.push(fact);
  };
  for (const expr of found) add(expr, true);
  return facts;
}

function factFor(expr: string): CalcFact | null {
  const line = /^(?:r|rnd|round|row|الدور|دور)\s*[0-9٠-٩]/i.test(expr) ? expr : `R1: ${expr}`;
  const round = convertPatternText(line).parts[0]?.rounds[0];
  if (!round) return null;
  return {
    expr: expr.slice(0, 200),
    normalized: round.normalized.slice(0, 200),
    consumed: round.consumed,
    produced: round.calculated,
    declared: round.expected,
    mismatch: round.expected !== null && round.calculated !== null && round.expected !== round.calculated,
    status: round.status,
  };
}

/** Crochet abbreviations and round markers: Latin letters that do not make a question "English". */
const STITCH_WORDS = /(?<![A-Za-z])(?:sc|hdc|dc|tr|dtr|inc|dec|ch|sl|st|sts|mr|blo|flo|sk|r|rnd|x|us|uk)(?![A-Za-z])/gi;

/**
 * The language to answer in = the language of the QUESTION, not the app's UI language: an English question asked in the
 * Arabic UI gets an English answer (found on the real device). Falls back to the UI language when there are no letters.
 */
export function messageLang(message: string, fallback: 'ar' | 'en'): 'ar' | 'en' {
  const text = String(message ?? '').replace(STITCH_WORDS, ' ');
  const arabic = (text.match(/[؀-ۿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (!arabic && !latin) return fallback;
  return arabic >= latin * 0.5 ? 'ar' : 'en';
}
