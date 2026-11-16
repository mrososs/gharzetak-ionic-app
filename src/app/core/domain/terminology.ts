/**
 * US ↔ UK crochet terminology conversion (explicit and boundary-safe).
 * Only sc / hdc / dc / tr / dtr (and their UK equivalents) change.
 * inc, dec, ch, sl st, MR … are identical in both systems.
 */
export type TermSystem = 'us' | 'uk';
export type ConvertDirection = 'us2uk' | 'uk2us';

export const US2UK: Readonly<Record<string, string>> = { sc: 'dc', hdc: 'htr', dc: 'tr', tr: 'dtr', dtr: 'trtr' };
export const UK2US: Readonly<Record<string, string>> = { dc: 'sc', htr: 'hdc', tr: 'dc', dtr: 'tr', trtr: 'dtr' };

export interface ConvertResult {
  readonly out: string;
  /** Number of abbreviations converted. */
  readonly n: number;
}

export function convertText(input: string, dir: ConvertDirection): ConvertResult {
  const map = dir === 'us2uk' ? US2UK : UK2US;
  let n = 0;
  const out = String(input).replace(
    /(^|[^A-Za-z])(\d*)(trtr|dtr|htr|hdc|sc|dc|tr)(?![A-Za-z])/gi,
    (m: string, pre: string, num: string, tok: string) => {
      const k = tok.toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(map, k)) return m;
      n++;
      let r = map[k];
      if (tok === tok.toUpperCase()) r = r.toUpperCase();
      else if (tok[0] === tok[0].toUpperCase()) r = r[0].toUpperCase() + r.slice(1);
      return pre + num + r;
    },
  );
  return { out, n };
}

/** Converts a single parsed stitch key between systems for display. */
export function convertToken(k: string, from: TermSystem, to: TermSystem): string {
  if (from === to || k === 'inc' || k === 'dec') return k;
  return from === 'us' ? (US2UK[k] ?? k) : (UK2US[k] ?? k);
}

/** Pattern text shown in the viewer's terminology. */
export function displayInTerms(raw: string, written: TermSystem, view: TermSystem): string {
  if (written === view) return raw;
  return convertText(raw, written === 'us' ? 'us2uk' : 'uk2us').out;
}
