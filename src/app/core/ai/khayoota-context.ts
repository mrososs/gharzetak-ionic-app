/**
 * The project context Khayoota receives — built ON THE DEVICE, from the revision the project actually follows.
 *
 *  - Always via `AppStore.trackerView(p)`: a pinned standalone project uses its PINNED text, a multi-piece project uses the
 *    frozen piece snapshot of the ACTIVE piece. The latest edited pattern is never used for a pinned project.
 *  - Only the open project: never other projects, notes, photos, the user's name or e-mail, or the full pattern text.
 *  - Numbers (totals, consumed) come from the deterministic parser, never from the model.
 */
import { parsePattern } from '../domain/pattern-parser';
import { instanceLabel, instanceProgress, siblingsOf } from '../domain/collections';
import { patternContext, patternStats } from '../domain/tracker-engine';
import type { Project } from '../models/models';
import type { AppStore } from '../state/app.store';
import type { KhayootaContextV1 } from './khayoota.types';

type StoreView = Pick<AppStore, 'trackerView' | 'viewTerms'>;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const ORDINALS: readonly [RegExp, number][] = [
  [/(?:الحادي|الحادى)\s*عشر/, 11],
  [/(?:الثاني|التاني|الثانى|التانى)\s*عشر/, 12],
  [/(?:الأول|الاول|الأولاني|الاولاني)/, 1],
  [/(?:الثاني|التاني|الثانى|التانى)/, 2],
  [/(?:الثالث|التالت)/, 3],
  [/الرابع/, 4],
  [/الخامس/, 5],
  [/السادس/, 6],
  [/السابع/, 7],
  [/(?:الثامن|التامن)/, 8],
  [/التاسع/, 9],
  [/العاشر/, 10],
];
const toInt = (d: string) => Number.parseInt(d.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)), 10);

/**
 * Round numbers the user names in the question ("R7", "round 7", "الدور ٧", "الدور السابع"), at most 2, in order.
 * Only these rounds' text is added to the context, so "explain round 7" works even when the counter is elsewhere.
 */
export function roundsMentioned(question: string): number[] {
  const out: number[] = [];
  const add = (n: number) => {
    if (Number.isFinite(n) && n > 0 && n <= 1000 && !out.includes(n)) out.push(n);
  };
  for (const m of question.matchAll(/(?:\b(?:r|rnd|round|row)\s*#?\s*|(?:ال)?دور\s*(?:رقم\s*)?)([0-9٠-٩]{1,3})(?![0-9٠-٩])/gi)) add(toInt(m[1]!));
  for (const m of question.matchAll(/(?:ال)?دور\s+(ال\S+(?:\s+عشر)?)/g)) {
    const hit = ORDINALS.find(([re]) => re.test(m[1]!));
    if (hit) add(hit[1]);
  }
  return out.slice(0, 2);
}

export function buildKhayootaContext(store: StoreView, p: Project | null, question = ''): KhayootaContextV1 | undefined {
  if (!p) return undefined;
  const view = store.trackerView(p);
  const kind: 'simple' | 'pattern' | 'collection' = p.parts?.length ? 'collection' : p.tracker.mode === 'pattern' ? 'pattern' : 'simple';
  const ctx: KhayootaContextV1 = {
    v: 1,
    viewTerms: store.viewTerms(),
    project: { id: p.id, name: clip(p.name, 120), category: p.category, kind },
  };

  // Active piece of a multi-piece project.
  if (view?.instance && p.parts?.length) {
    const inst = view.instance;
    const sameKind = p.parts.filter((i) => i.partId === inst.partId && !i.retired);
    ctx.part = { instanceId: inst.id, name: clip(view.snapshot?.name ?? view.source?.name ?? '', 80), index: Math.max(1, sameKind.indexOf(inst) + 1), of: Math.max(1, sameKind.length) };
    const unfinished = p.parts
      .filter((i) => !i.retired && !instanceProgress(i, (p.partSnapshots ?? []).find((s) => s.partId === i.partId)).done)
      .slice(0, 10)
      .map((i) => ({ instanceId: i.id, label: clip(instanceLabel(i, (p.partSnapshots ?? []).find((s) => s.partId === i.partId), siblingsOf(p.parts ?? [], i)), 100) }));
    if (unfinished.length) ctx.unfinishedParts = unfinished;
  }

  const tracker = view?.tracker ?? p.tracker;
  if (tracker.mode === 'pattern' && view?.source) {
    const parsed = parsePattern(view.source.text);
    const c = patternContext(parsed, tracker.cursor);
    if (c) {
      const r = c.round;
      const idx = tracker.cursor.roundIndex;
      ctx.pattern = {
        source: view.instance ? 'snapshot' : p.patternPin ? 'pinned' : 'live',
        rev: p.patternPin?.rev ?? p.collectionRev ?? 1,
        outdated: view.outdated,
        terms: view.source.terms,
      };
      ctx.round = {
        n: r.n,
        text: clip(r.raw, 300),
        declaredTotal: r.declared,
        calculatedTotal: r.ok ? r.prod : null,
        consumed: r.ok ? r.cons : null,
        mismatch: r.mismatch,
        joins: [...r.joins].slice(0, 10),
        position: { done: tracker.cursor.ptr, of: r.acts.length },
      };
      const near = [parsed.rounds[idx - 1], parsed.rounds[idx + 1]].filter((x): x is NonNullable<typeof x> => !!x);
      // Rounds the user asks about by number, from the SAME (pinned / snapshot) revision; max 4 entries in total.
      for (const n of roundsMentioned(question)) {
        const asked = parsed.rounds.find((x) => x.n === n);
        if (asked && asked.n !== r.n && !near.some((x) => x.n === n) && near.length < 4) near.push(asked);
      }
      if (near.length) ctx.nearby = near.map((x) => ({ n: x.n, text: clip(x.raw, 300) }));
      const stats = patternStats(parsed, tracker.cursor);
      if (stats) ctx.percent = Math.round(stats.progress * 100);
    }
  } else {
    const s = tracker.simple;
    ctx.round = { n: s.round, text: '', declaredTotal: s.target || null, calculatedTotal: s.target || null, consumed: null, mismatch: false, joins: [], simpleCount: { count: s.count, target: s.target } };
  }
  return ctx;
}
