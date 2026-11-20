import type { ChatMessage, Pattern, Project } from '../models/models';
import { projectHasProgress } from './getting-started';
import { TOUR_IDS, type MilestoneId, type TourId } from './tour-ids';
import type { EndReason, Evidence, TourDefinition, TourPrefs, TourRecord, TourStatus } from './tour.types';

/** The welcome invitation may be shown on this many launches; the next launch records it as declined. */
export const WELCOME_OFFER_LAUNCHES = 3;
/** A first-visit pill may be shown on this many visits to its screen. */
export const PILL_OFFER_VISITS = 2;
/** A tour interrupted by the app earns exactly one "Resume" offer; a second interruption ends it. */
export const MAX_INTERRUPTIONS = 2;
/** At most one tour is started per app launch without an explicit tap in Settings. */
export const ONE_TOUR_PER_LAUNCH = true;

export type DefMeta = Pick<TourDefinition, 'id' | 'version' | 'offer'> & { readonly announceOnBump?: boolean };

export const emptyRecord = (): TourRecord => ({ v: 0, status: 'not_started', offers: 0, interruptions: 0, at: 0 });

export const emptyTourPrefs = (now = 0): TourPrefs => ({ v: 1, tours: {}, milestones: {}, ...(now ? { seededAt: now } : {}) });

export const recordOf = (prefs: TourPrefs | null | undefined, id: TourId): TourRecord => prefs?.tours[id] ?? emptyRecord();

// ---- evidence -------------------------------------------------------------------------------------------------------------------

/** What the stored scope says about earlier use. Sample patterns are never evidence: every account has them. */
export function evidenceOf(s: { projects: readonly Project[]; patterns: readonly Pattern[]; collections: readonly unknown[]; chat: readonly ChatMessage[] }): Evidence {
  return {
    projects: s.projects.length,
    progressedProjects: s.projects.filter(projectHasProgress).length,
    customPatterns: s.patterns.filter((p) => !p.isSample).length,
    collections: s.collections.length,
    userChatMessages: s.chat.filter((m) => m.role === 'user').length,
  };
}

/** True when the person has plainly used the feature this tour explains, so the tour would only repeat what she already knows. */
export function evidenceCancels(tour: TourId, ev: Evidence): boolean {
  switch (tour) {
    case 'welcome':
      return ev.projects > 0 || ev.customPatterns > 0 || ev.collections > 0 || ev.userChatMessages > 0;
    case 'patterns':
    case 'pattern-reader':
      return ev.customPatterns > 0 || ev.collections > 0;
    case 'tracker-simple':
    case 'tracker-pattern':
    case 'tracker-parts':
      return ev.progressedProjects > 0;
    case 'project-create':
      return ev.projects > 0;
    case 'khayoota':
      return ev.userChatMessages > 0;
  }
}

/** First evaluation of a scope that has no tour state: remember what is already known, so later deletions never re-offer it. */
export function seedTourPrefs(ev: Evidence, now: number, armed = false): TourPrefs {
  const tours: Partial<Record<TourId, TourRecord>> = {};
  for (const id of TOUR_IDS) if (evidenceCancels(id, ev)) tours[id] = { v: 1, status: 'not_needed', offers: 0, interruptions: 0, at: now };
  return { v: 1, tours, milestones: {}, seededAt: now, ...(armed ? { armed: true } : {}) };
}

// ---- status -----------------------------------------------------------------------------------------------------------------------

const limitOf = (def: DefMeta): number => (def.offer === 'home-card' ? WELCOME_OFFER_LAUNCHES : PILL_OFFER_VISITS);

/**
 * The status the rest of the app should act on. Two derived rules keep the stored data simple:
 *  - an invitation shown the maximum number of times counts as declined (unless it is on screen right now: `shownNow`);
 *  - a tour interrupted twice, or whose resume offer was ignored the maximum number of times, counts as skipped.
 * A newer definition version only re-offers a finished tour when the definition says `announceOnBump`.
 */
export function effectiveStatus(rec: TourRecord, def: DefMeta, shownNow = false): TourStatus {
  let s = rec.status;
  if (def.announceOnBump && rec.v > 0 && def.version > rec.v && (s === 'completed' || s === 'skipped' || s === 'declined')) return 'not_started';
  const exhausted = rec.offers >= limitOf(def) && !shownNow;
  if (s === 'offered' && exhausted) s = 'declined';
  if (s === 'interrupted' && (rec.interruptions >= MAX_INTERRUPTIONS || exhausted)) s = 'skipped';
  return s;
}

export interface OfferDecision {
  readonly ok: boolean;
  readonly kind: 'first' | 'resume';
}
const NO: OfferDecision = { ok: false, kind: 'first' };

/** May this tour be offered automatically right now? (Page-level preconditions and the quiet gate are checked elsewhere.) */
export function canOffer(def: DefMeta, prefs: TourPrefs | null | undefined, ev: Evidence, shownNow = false): OfferDecision {
  if (evidenceCancels(def.id, ev)) return NO;
  const p = prefs ?? emptyTourPrefs();
  if (def.id === 'welcome' && !p.armed) return NO;
  const eff = effectiveStatus(recordOf(p, def.id), def, shownNow);
  if (eff === 'not_started' || eff === 'offered') return { ok: true, kind: 'first' };
  if (eff === 'interrupted' && def.offer === 'pill') return { ok: true, kind: 'resume' };
  return NO;
}

// ---- transitions ------------------------------------------------------------------------------------------------------------------

const touch = (rec: TourRecord, def: DefMeta, now: number, patch: Partial<TourRecord>): TourRecord => ({ ...rec, v: def.version, at: now, ...patch });

/** An invitation was shown (one launch for the card, one visit for a pill). */
export function applyOffered(rec: TourRecord, def: DefMeta, now: number): TourRecord {
  const s = effectiveStatus(rec, def, true);
  if (s === 'not_started') return touch({ ...rec, offers: 0, interruptions: 0, step: undefined }, def, now, { status: 'offered', offers: 1 });
  if (s === 'offered' || s === 'interrupted') return touch(rec, def, now, { offers: rec.offers + 1 });
  return rec;
}

export function applyStarted(rec: TourRecord, def: DefMeta, now: number): TourRecord {
  return touch(rec, def, now, { status: 'active' });
}

export function applyDeclined(rec: TourRecord, def: DefMeta, now: number): TourRecord {
  return touch(rec, def, now, { status: 'declined' });
}

export const endStatusOf = (reason: EndReason): 'completed' | 'skipped' | 'interrupted' => (reason === 'done' ? 'completed' : reason === 'skip' || reason === 'close' || reason === 'back' ? 'skipped' : 'interrupted');

/**
 * A tour ended. A replay (from Settings) can only improve a record: finishing it marks it completed, anything else leaves it alone,
 * so replaying never makes the app nag.
 */
export function applyEnded(rec: TourRecord, def: DefMeta, reason: EndReason, step: string | undefined, now: number, replay = false): TourRecord {
  const kind = endStatusOf(reason);
  if (replay) return kind === 'completed' ? touch(rec, def, now, { status: 'completed', step: undefined }) : rec;
  if (kind === 'completed') return touch(rec, def, now, { status: 'completed', step: undefined });
  if (kind === 'skipped') return touch(rec, def, now, { status: 'skipped', step });
  const interruptions = rec.interruptions + 1;
  return touch(rec, def, now, { status: interruptions >= MAX_INTERRUPTIONS ? 'skipped' : 'interrupted', interruptions, step });
}

/** A crash or kill leaves `active` on disk: on the next load it becomes an interruption (never a silent completion). */
export function recoverActive(prefs: TourPrefs, defs: readonly DefMeta[], now: number): TourPrefs {
  let changed = false;
  const tours = { ...prefs.tours };
  for (const def of defs) {
    const rec = tours[def.id];
    if (rec?.status === 'active') {
      tours[def.id] = applyEnded(rec, def, 'background', rec.step, now);
      changed = true;
    }
  }
  return changed ? { ...prefs, tours } : prefs;
}

export function withMilestone(prefs: TourPrefs, id: MilestoneId, now: number): TourPrefs {
  return prefs.milestones[id] ? prefs : { ...prefs, milestones: { ...prefs.milestones, [id]: now } };
}
