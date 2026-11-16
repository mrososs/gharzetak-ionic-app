import { CategoryId, P1_TEXT, P2_TEXT, SAMPLE_PATTERN_BASE_ID, SAMPLE_PATTERN_HEAD_ID, YarnId } from '../data/catalog';
import { createPatternCursor, createSimpleCounter } from '../domain/tracker-engine';
import type { Pattern, Project, TrackerData } from '../models/models';

export const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export function defaultTracker(target = 30): TrackerData {
  return {
    mode: 'simple',
    simple: createSimpleCounter({ target, perTap: 1 }),
    patternId: null,
    cursor: createPatternCursor(),
    updatedAt: Date.now(),
  };
}

export interface NewProjectInput {
  name: string;
  category: CategoryId;
  hook: string;
  yarn: YarnId;
  target: number;
  coverLocalUrl: string | null;
  patternId: string | null;
  totalRounds?: number;
}

export function createProject(input: NewProjectInput): Project {
  const now = Date.now();
  const tracker = defaultTracker(input.target > 0 ? input.target : 30);
  return {
    id: uuid(),
    name: input.name.trim(),
    category: input.category,
    hook: input.hook,
    yarn: input.yarn,
    status: 'active',
    notes: '',
    coverLocalUrl: input.coverLocalUrl,
    coverPath: null,
    photos: [],
    workedSeconds: 0,
    estimatedHours: 0,
    lastWorkedAt: now,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    tracker: input.patternId
      ? { ...tracker, mode: 'pattern', patternId: input.patternId, simple: { ...tracker.simple, totalRounds: input.totalRounds ?? 0 } }
      : tracker,
  };
}

/** Built-in sample patterns (bundled for offline use; same IDs as the DB seed). */
export function samplePatterns(): Pattern[] {
  const base = { isSample: true, level: 'beginner' as const, terms: 'us' as const, source: 'sample' as const, file: null, attribution: 'Gharzetak sample', sourceUrl: '', updatedAt: 0, deletedAt: null };
  return [
    { ...base, id: SAMPLE_PATTERN_HEAD_ID, name: 'Amigurumi head (shaped sphere)', nameAr: 'رأس أميجورومي (كرة بتشكيل)', nameEn: 'Amigurumi head (shaped sphere)', text: P1_TEXT, position: 4 },
    { ...base, id: SAMPLE_PATTERN_BASE_ID, name: 'Round coaster / basket base', nameAr: 'قاعدة سلة / كوستر دائري', nameEn: 'Round coaster / basket base', text: P2_TEXT, position: 0 },
  ];
}
