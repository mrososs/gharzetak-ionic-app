/**
 * Image-to-pattern, the deterministic half (pattern-extraction-pipeline.md §3–§5).
 *
 * The model only TRANSCRIBES. This module runs the transcript through the real Smart Pattern Parser and then applies the
 * AI-origin caps — the model can only make a round's status WORSE, never better:
 *   - a line the model marked uncertain/unreadable        → at most Needs Review / Unsupported
 *   - a chart                                              → at most Needs Review
 *   - an AI-read round with no written total               → Needs Review unless continuity holds with the previous AND the
 *                                                            next round (no checksum otherwise: a misread digit would pass)
 * Chains, skips, slip stitches, turning chains and garment joins stay Unsupported (P5b): nothing here rewrites them.
 */
import { ConvStatus, ConversionResult, convertPatternText } from '../domain/smart-parser';
import type { TranscriptV1 } from './khayoota.types';

export interface PreviewRound {
  readonly n: number;
  readonly original: string;
  readonly normalized: string;
  readonly status: ConvStatus;
  readonly expected: number | null;
  readonly calculated: number | null;
  /** Parser message codes plus AI codes: 'ai-uncertain', 'ai-unreadable', 'ai-no-checksum', 'ai-chart'. */
  readonly codes: readonly string[];
  readonly uncertain: readonly string[];
  /** Source image (1-based) the line was read from, for multi-image submissions. */
  readonly page: number | null;
}

export interface PreviewPart {
  readonly name: string;
  readonly quantity: number;
  readonly rounds: readonly PreviewRound[];
  readonly notes: readonly string[];
  readonly status: ConvStatus;
  /** Strict text handed to the editor (one normalized line per round). */
  readonly text: string;
}

export interface PatternPreview {
  readonly id: string;
  readonly title: string | null;
  readonly sourceClass: TranscriptV1['sourceClass'];
  readonly parts: readonly PreviewPart[];
  readonly counts: { readonly rounds: number; readonly validated: number; readonly needsReview: number; readonly unsupported: number };
  readonly warnings: readonly string[];
  /** The transcript exactly as read (kept as the pattern's sourceText). */
  readonly sourceText: string;
  readonly target: 'pattern' | 'collection';
  /** Small data-URL thumbnail of the photo the user attached (memory only, never persisted). */
  readonly thumb?: string;
  /** How many photos were analysed together. */
  readonly images?: number;
}

const rank: Record<ConvStatus, number> = { validated: 0, 'needs-review': 1, unsupported: 2 };
const worse = (a: ConvStatus, b: ConvStatus): ConvStatus => (rank[b] > rank[a] ? b : a);

/** Returns null when the source is not a written pattern or chart (finished object, tutorial frame, other). */
export function previewFromTranscript(t: TranscriptV1, id: string): PatternPreview | null {
  if (t.sourceClass !== 'written' && t.sourceClass !== 'chart') return null;
  const lines = t.lines.filter((l) => l.kind !== 'other');
  if (!lines.length) return null;
  const sourceText = lines.map((l) => l.text).join('\n');
  const conv: ConversionResult = convertPatternText(sourceText, { terms: t.terms === 'uk' ? 'uk' : t.terms === 'us' ? 'us' : 'auto' });
  const byText = new Map(lines.map((l) => [l.text.trim(), l]));

  const parts: PreviewPart[] = conv.parts.map((p) => {
    const rounds = p.rounds.map((r, i, all) => {
      const line = byText.get(r.original.trim());
      const codes = r.messages.map((m) => m.code);
      let status = r.status;
      if (line?.legibility === 'unreadable') {
        status = 'unsupported';
        codes.push('ai-unreadable');
      } else if (line?.legibility === 'uncertain') {
        status = worse(status, 'needs-review');
        codes.push('ai-uncertain');
      }
      if (t.sourceClass === 'chart') {
        status = worse(status, 'needs-review');
        codes.push('ai-chart');
      }
      if (status === 'validated' && r.expected === null) {
        const prev = all[i - 1];
        const next = all[i + 1];
        const prevOk = !!prev && prev.calculated !== null && r.consumed === prev.calculated;
        const nextOk = !next || (next.status !== 'unsupported' && next.consumed === r.calculated);
        if (!(prevOk && nextOk)) {
          status = 'needs-review';
          codes.push('ai-no-checksum');
        }
      }
      return { n: r.n, original: r.original, normalized: r.normalized, status, expected: r.expected, calculated: r.calculated, codes, uncertain: line?.uncertain ?? [], page: line?.page ?? null } satisfies PreviewRound;
    });
    const status = rounds.reduce<ConvStatus>((a, r) => worse(a, r.status), rounds.length ? 'validated' : 'needs-review');
    return { name: p.name, quantity: p.quantity, rounds, notes: p.notes, status, text: p.text };
  });

  const all = parts.flatMap((p) => p.rounds);
  return {
    id,
    title: t.title ?? conv.collectionName,
    sourceClass: t.sourceClass,
    parts,
    counts: {
      rounds: all.length,
      validated: all.filter((r) => r.status === 'validated').length,
      needsReview: all.filter((r) => r.status === 'needs-review').length,
      unsupported: all.filter((r) => r.status === 'unsupported').length,
    },
    warnings: t.warnings.map((w) => w.code),
    sourceText,
    target: parts.length > 1 ? 'collection' : 'pattern',
  };
}
