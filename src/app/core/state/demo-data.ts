import { SAMPLE_PATTERN_BASE_ID, SAMPLE_PATTERN_HEAD_ID } from '../data/catalog';
import { createPatternCursor, createSimpleCounter } from '../domain/tracker-engine';
import { Project } from '../models/models';
import { AppStore } from './app.store';
import { createProject } from './factories';

/**
 * QA helper: the prototype's seven sample projects, loaded ONLY on request, ONLY into the guest
 * scope (never into a real account). Used for visual comparison with the approved screens.
 */
export async function loadDemoProjects(store: AppStore): Promise<number> {
  if (store.scope() !== 'guest') return 0;
  const now = Date.now();
  const DAY = 86400000;
  const isAr = document.documentElement.lang !== 'en';
  const mk = (nameAr: string, nameEn: string, o: Partial<Project> & { simple?: Parameters<typeof createSimpleCounter>[0]; pattern?: { id: string; ri: number; ptr: number } }): Project => {
    const base = createProject({ name: isAr ? nameAr : nameEn, category: o.category ?? 'amigurumi', hook: o.hook ?? '3.0', yarn: o.yarn ?? 'cotton', target: 30, coverLocalUrl: null, patternId: null });
    return {
      ...base,
      status: o.status ?? 'active',
      lastWorkedAt: o.lastWorkedAt ?? now,
      workedSeconds: o.workedSeconds ?? 0,
      estimatedHours: o.estimatedHours ?? 0,
      tracker: o.pattern
        ? { ...base.tracker, mode: 'pattern', patternId: o.pattern.id, cursor: createPatternCursor({ roundIndex: o.pattern.ri, ptr: o.pattern.ptr }), simple: createSimpleCounter({ totalRounds: 11 }) }
        : { ...base.tracker, simple: createSimpleCounter(o.simple) },
    };
  };
  const list = [
    mk('دمية أرنب لطيف', 'Cute bunny doll', { category: 'amigurumi', hook: '3.0', yarn: 'cotton', lastWorkedAt: now - 2 * 3600000, workedSeconds: 8100, estimatedHours: 6, pattern: { id: SAMPLE_PATTERN_HEAD_ID, ri: 4, ptr: 8 } }),
    mk('بطانية مربعات جراني', 'Granny square blanket', { category: 'home', hook: '4.0', yarn: 'acrylic', lastWorkedAt: now - DAY, workedSeconds: 21600, estimatedHours: 20, simple: { round: 3, target: 36, perTap: 3, count: 12, totalRounds: 8 } }),
    mk('شنطة زهور صيفية', 'Summer flower bag', { category: 'accessories', hook: '3.5', yarn: 'milk', lastWorkedAt: now - 4 * DAY, workedSeconds: 9000, estimatedHours: 8, simple: { round: 2, target: 24, perTap: 4, count: 8, totalRounds: 10 } }),
    mk('سلة تخزين قطن', 'Cotton storage basket', { category: 'home', hook: '5.0', yarn: 'cotton', status: 'paused', lastWorkedAt: now - 9 * DAY, workedSeconds: 5400, estimatedHours: 5, pattern: { id: SAMPLE_PATTERN_BASE_ID, ri: 3, ptr: 0 } }),
    mk('بلوفر أطفال', "Child's sweater", { category: 'clothes', hook: '4.5', yarn: 'wool', status: 'paused', lastWorkedAt: now - 21 * DAY, workedSeconds: 25200, estimatedHours: 18, simple: { round: 14, target: 60, perTap: 6, count: 24, totalRounds: 36 } }),
    mk('دبدوب تيدي صغير', 'Little teddy bear', { category: 'gifts', hook: '3.0', yarn: 'velvet', status: 'done', lastWorkedAt: now - 30 * DAY, workedSeconds: 14400, estimatedHours: 5, simple: { round: 12, target: 18, perTap: 3, count: 18, totalRounds: 12 } }),
    mk('طقم كوستر', 'Coaster set', { category: 'home', hook: '3.5', yarn: 'cotton', status: 'done', lastWorkedAt: now - 45 * DAY, workedSeconds: 7200, estimatedHours: 3, pattern: { id: SAMPLE_PATTERN_BASE_ID, ri: 5, ptr: 36 } }),
  ];
  for (const p of list.reverse()) await store.addProject(p);
  await store.setCurrentProject(list[list.length - 1].id);
  return list.length;
}
