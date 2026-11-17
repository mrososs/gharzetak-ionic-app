import { Bilingual } from './joy.copy';
import { ACHIEVEMENT_IDS, AchievementId } from './joy.models';

export interface AchievementDef {
  readonly id: AchievementId;
  readonly emoji: string;
  readonly name: Bilingual;
  /** What to do to earn it (shown while locked). */
  readonly hint: Bilingual;
}

/** The eight approved achievements — personal encouragement only, no levels, no leaderboards. */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'first_round', emoji: '🧶', name: { ar: 'أول دور', en: 'First round' }, hint: { ar: 'خلّصي أول دور بالعدّاد', en: 'Finish your first round with the counter' } },
  { id: 'rounds_10', emoji: '🌱', name: { ar: '10 أدوار', en: '10 rounds' }, hint: { ar: 'عشرة أدوار بالعدّاد', en: 'Ten counted rounds' } },
  { id: 'rounds_50', emoji: '🌸', name: { ar: '50 دور', en: '50 rounds' }, hint: { ar: 'خمسين دور بالعدّاد', en: 'Fifty counted rounds' } },
  { id: 'first_project', emoji: '✨', name: { ar: 'أول مشروع', en: 'First project' }, hint: { ar: 'ابدئي أول مشروع', en: 'Start your first project' } },
  { id: 'first_multipart', emoji: '🧩', name: { ar: 'مشروع بقطع', en: 'Multi-part maker' }, hint: { ar: 'ابدئي مشروع من مجموعة قطع', en: 'Start a multi-part project' } },
  { id: 'first_piece', emoji: '🧸', name: { ar: 'أول قطعة', en: 'First piece' }, hint: { ar: 'خلّصي أول قطعة', en: 'Finish your first piece' } },
  { id: 'first_finished', emoji: '🏆', name: { ar: 'أول تحفة', en: 'First masterpiece' }, hint: { ar: 'خلّصي مشروع كامل', en: 'Finish a whole project' } },
  { id: 'first_amigurumi', emoji: '🐰', name: { ar: 'أميجورومي!', en: 'Amigurumi!' }, hint: { ar: 'خلّصي أول أميجورومي', en: 'Finish your first amigurumi' } },
];

/** What a real counting / finishing event can earn. Everything else is credited silently by back-fill, never celebrated out of the blue. */
export const EARNED_BY_EVENT: Readonly<Record<'round' | 'part' | 'project', readonly AchievementId[]>> = {
  round: ['first_round', 'rounds_10', 'rounds_50'],
  part: ['first_piece'],
  project: ['first_finished', 'first_amigurumi'],
};
/** What the act of creating a project can earn. */
export const EARNED_BY_CREATION: readonly AchievementId[] = ['first_project', 'first_multipart'];

export const achievementDef = (id: string): AchievementDef | null => ACHIEVEMENTS.find((a) => a.id === id) ?? null;

/**
 * Everything the rules need, each fact derived from REAL data: ledger rows that were created by genuine events, or durable project data.
 * Round counts are never inferred from tracker positions (jumps, edits and imports make those unreliable).
 */
export interface AchievementFacts {
  /** Live `round` rows in the ledger (rounds completed by a real counting tap, on this device or migrated from guest mode). */
  readonly rounds: number;
  /** Live projects (not deleted). */
  readonly projects: number;
  /** A live project made from a collection with at least two pieces. */
  readonly multipart: boolean;
  /** A `part` row exists, or (back-fill only) a piece is already finished. */
  readonly piece: boolean;
  /** A `project` row exists, or a project already has status "done". */
  readonly finished: boolean;
  /** A project with category amigurumi has status "done". */
  readonly amigurumiDone: boolean;
}

/** Which achievements these facts earn. Pure; the caller decides what is new. */
export function metAchievements(f: AchievementFacts): AchievementId[] {
  const met: AchievementId[] = [];
  if (f.rounds >= 1) met.push('first_round');
  if (f.rounds >= 10) met.push('rounds_10');
  if (f.rounds >= 50) met.push('rounds_50');
  if (f.projects >= 1) met.push('first_project');
  if (f.multipart) met.push('first_multipart');
  if (f.piece) met.push('first_piece');
  if (f.finished) met.push('first_finished');
  if (f.amigurumiDone) met.push('first_amigurumi');
  return ACHIEVEMENT_IDS.filter((id) => met.includes(id));
}
