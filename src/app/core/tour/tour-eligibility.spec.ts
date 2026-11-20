import { describe, expect, it } from 'vitest';
import { TOUR_IDS, type TourId } from './tour-ids';
import {
  DefMeta, MAX_INTERRUPTIONS, PILL_OFFER_VISITS, WELCOME_OFFER_LAUNCHES, applyDeclined, applyEnded, applyOffered, applyStarted, canOffer, effectiveStatus, emptyRecord, emptyTourPrefs,
  endStatusOf, evidenceCancels, recoverActive, seedTourPrefs, withMilestone,
} from './tour-eligibility';
import type { Evidence, TourPrefs, TourRecord } from './tour.types';

const NOW = 1_700_000_000_000;
const ev = (o: Partial<Evidence> = {}): Evidence => ({ projects: 0, progressedProjects: 0, customPatterns: 0, collections: 0, userChatMessages: 0, ...o });
const def = (id: TourId, over: Partial<DefMeta> = {}): DefMeta => ({ id, version: 1, offer: id === 'welcome' ? 'home-card' : 'pill', ...over });
const rec = (o: Partial<TourRecord> = {}): TourRecord => ({ ...emptyRecord(), v: 1, ...o });
const prefs = (tours: TourPrefs['tours'] = {}, extra: Partial<TourPrefs> = {}): TourPrefs => ({ v: 1, tours, milestones: {}, seededAt: NOW, ...extra });

describe('evidenceCancels — a tour is never offered for something the person has already done', () => {
  it('a brand-new scope cancels nothing', () => {
    for (const id of TOUR_IDS) expect(evidenceCancels(id, ev())).toBe(false);
  });

  it('welcome is cancelled by any project, custom pattern, multi-part pattern or Khayoota message', () => {
    expect(evidenceCancels('welcome', ev({ projects: 1 }))).toBe(true);
    expect(evidenceCancels('welcome', ev({ customPatterns: 1 }))).toBe(true);
    expect(evidenceCancels('welcome', ev({ collections: 1 }))).toBe(true);
    expect(evidenceCancels('welcome', ev({ userChatMessages: 1 }))).toBe(true);
  });

  it('the two built-in sample patterns are never evidence (every account has them)', () => {
    expect(evidenceCancels('welcome', ev({ customPatterns: 0 }))).toBe(false);
    expect(evidenceCancels('patterns', ev())).toBe(false);
  });

  it('feature tours are cancelled only by their own feature', () => {
    expect(evidenceCancels('patterns', ev({ customPatterns: 1 }))).toBe(true);
    expect(evidenceCancels('pattern-reader', ev({ collections: 1 }))).toBe(true);
    expect(evidenceCancels('patterns', ev({ projects: 3, progressedProjects: 3 }))).toBe(false);
    expect(evidenceCancels('tracker-simple', ev({ progressedProjects: 1 }))).toBe(true);
    expect(evidenceCancels('tracker-simple', ev({ projects: 1, progressedProjects: 0 }))).toBe(false); // a project nobody has counted on yet still needs the tour
    expect(evidenceCancels('project-create', ev({ projects: 1 }))).toBe(true);
    expect(evidenceCancels('khayoota', ev({ userChatMessages: 1 }))).toBe(true);
    expect(evidenceCancels('khayoota', ev({ projects: 1 }))).toBe(false);
  });
});

describe('seedTourPrefs — what is already known is remembered, once', () => {
  it('marks exactly the tours the evidence cancels as not_needed, and is unarmed by default', () => {
    const p = seedTourPrefs(ev({ projects: 2, progressedProjects: 1 }), NOW);
    expect(p.armed).toBeUndefined();
    expect(p.seededAt).toBe(NOW);
    expect(p.tours.welcome?.status).toBe('not_needed');
    expect(p.tours['project-create']?.status).toBe('not_needed');
    expect(p.tours['tracker-simple']?.status).toBe('not_needed');
    expect(p.tours.patterns).toBeUndefined();
    expect(p.tours.khayoota).toBeUndefined();
  });

  it('an empty scope seeds nothing', () => {
    expect(seedTourPrefs(ev(), NOW).tours).toEqual({});
  });
});

describe('canOffer', () => {
  it('the welcome tour needs an entry event (armed); without it a returning or reinstalled user is never offered it', () => {
    expect(canOffer(def('welcome'), prefs(), ev()).ok).toBe(false);
    expect(canOffer(def('welcome'), null, ev()).ok).toBe(false);
    expect(canOffer(def('welcome'), prefs({}, { armed: true }), ev()).ok).toBe(true);
  });

  it('an armed scope that has since got data (the person has used the app) is no longer offered the welcome tour', () => {
    expect(canOffer(def('welcome'), prefs({}, { armed: true }), ev({ projects: 1 })).ok).toBe(false);
  });

  it('feature tours need no arming', () => {
    expect(canOffer(def('patterns'), null, ev()).ok).toBe(true);
    expect(canOffer(def('patterns'), prefs(), ev({ customPatterns: 1 })).ok).toBe(false);
  });

  it('completed, skipped, declined and not_needed are never offered again automatically', () => {
    for (const status of ['completed', 'skipped', 'declined', 'not_needed'] as const) {
      expect(canOffer(def('patterns'), prefs({ patterns: rec({ status }) }), ev()).ok, status).toBe(false);
    }
  });

  it('an interrupted pill tour earns one "resume" offer; the welcome card does not resume', () => {
    expect(canOffer(def('patterns'), prefs({ patterns: rec({ status: 'interrupted', interruptions: 1 }) }), ev())).toEqual({ ok: true, kind: 'resume' });
    expect(canOffer(def('welcome'), prefs({ welcome: rec({ status: 'interrupted', interruptions: 1 }) }, { armed: true }), ev()).ok).toBe(false);
  });
});

describe('offer budgets — the system must not nag', () => {
  it(`the welcome card is shown on ${WELCOME_OFFER_LAUNCHES} launches, then counts as declined (unless it is on screen right now)`, () => {
    const d = def('welcome');
    const seen = rec({ status: 'offered', offers: WELCOME_OFFER_LAUNCHES });
    expect(effectiveStatus(seen, d, false)).toBe('declined');
    expect(effectiveStatus(seen, d, true)).toBe('offered');
    expect(effectiveStatus(rec({ status: 'offered', offers: WELCOME_OFFER_LAUNCHES - 1 }), d, false)).toBe('offered');
    expect(canOffer(d, prefs({ welcome: seen }, { armed: true }), ev(), false).ok).toBe(false);
    expect(canOffer(d, prefs({ welcome: seen }, { armed: true }), ev(), true).ok).toBe(true);
  });

  it(`a pill is shown on ${PILL_OFFER_VISITS} visits`, () => {
    const d = def('patterns');
    expect(effectiveStatus(rec({ status: 'offered', offers: PILL_OFFER_VISITS - 1 }), d)).toBe('offered');
    expect(effectiveStatus(rec({ status: 'offered', offers: PILL_OFFER_VISITS }), d)).toBe('declined');
  });

  it('a resume offer that was ignored the maximum number of times becomes skipped', () => {
    expect(effectiveStatus(rec({ status: 'interrupted', interruptions: 1, offers: PILL_OFFER_VISITS }), def('patterns'))).toBe('skipped');
  });

  it('a tour interrupted twice is skipped', () => {
    expect(effectiveStatus(rec({ status: 'interrupted', interruptions: MAX_INTERRUPTIONS }), def('patterns'))).toBe('skipped');
  });
});

describe('transitions', () => {
  const d = def('patterns');

  it('offering counts visits and moves not_started → offered', () => {
    const a = applyOffered(emptyRecord(), d, NOW);
    expect(a).toMatchObject({ status: 'offered', offers: 1, v: 1 });
    expect(applyOffered(a, d, NOW + 1).offers).toBe(2);
  });

  it('start → active, decline → declined', () => {
    expect(applyStarted(rec({ status: 'offered' }), d, NOW).status).toBe('active');
    expect(applyDeclined(rec({ status: 'offered' }), d, NOW).status).toBe('declined');
  });

  it('end reasons map to the three outcomes that matter', () => {
    expect(endStatusOf('done')).toBe('completed');
    for (const r of ['skip', 'close', 'back'] as const) expect(endStatusOf(r)).toBe('skipped');
    for (const r of ['navigation', 'overlay', 'background', 'viewport', 'scope-change', 'lock', 'missing-target', 'error', 'replaced'] as const) expect(endStatusOf(r)).toBe('interrupted');
  });

  it('completed / skipped / interrupted are all different and are never confused', () => {
    expect(applyEnded(rec({ status: 'active' }), d, 'done', 's3', NOW).status).toBe('completed');
    expect(applyEnded(rec({ status: 'active' }), d, 'skip', 's2', NOW)).toMatchObject({ status: 'skipped', step: 's2' });
    expect(applyEnded(rec({ status: 'active' }), d, 'overlay', 's2', NOW)).toMatchObject({ status: 'interrupted', step: 's2', interruptions: 1 });
  });

  it('the second interruption ends it (skipped) so the person is never chased', () => {
    const first = applyEnded(rec({ status: 'active' }), d, 'navigation', 's1', NOW);
    expect(first.status).toBe('interrupted');
    const second = applyEnded(applyStarted(first, d, NOW), d, 'navigation', 's1', NOW);
    expect(second.status).toBe('skipped');
  });

  it('a replay can only improve a record: finishing completes it, anything else leaves it exactly as it was', () => {
    const skipped = rec({ status: 'skipped', step: 's2' });
    expect(applyEnded(skipped, d, 'done', undefined, NOW, true).status).toBe('completed');
    expect(applyEnded(skipped, d, 'skip', 's1', NOW, true)).toBe(skipped);
    expect(applyEnded(skipped, d, 'overlay', 's1', NOW, true)).toBe(skipped);
    const completed = rec({ status: 'completed' });
    expect(applyEnded(completed, d, 'skip', 's1', NOW, true)).toBe(completed);
    expect(applyEnded(completed, d, 'error', 's1', NOW, true)).toBe(completed);
  });

  it('a crash that left a tour "active" becomes an interruption on the next load, never a silent completion', () => {
    const p = prefs({ patterns: rec({ status: 'active', step: 'patterns.kinds' }), welcome: rec({ status: 'completed' }) });
    const next = recoverActive(p, [def('patterns'), def('welcome', { offer: 'home-card' })], NOW);
    expect(next.tours.patterns).toMatchObject({ status: 'interrupted', step: 'patterns.kinds' });
    expect(next.tours.welcome?.status).toBe('completed');
    expect(recoverActive(next, [def('patterns')], NOW)).toBe(next); // idempotent: nothing active any more
  });
});

describe('tour definition versions', () => {
  it('a version bump never re-offers a finished tour unless the definition says announceOnBump', () => {
    const done = rec({ v: 1, status: 'completed' });
    expect(effectiveStatus(done, def('patterns', { version: 2 }))).toBe('completed');
    expect(effectiveStatus(done, def('patterns', { version: 2, announceOnBump: true }))).toBe('not_started');
  });

  it('an announced bump still never reaches someone who has not seen the tour as finished', () => {
    expect(effectiveStatus(rec({ v: 1, status: 'not_needed' }), def('patterns', { version: 2, announceOnBump: true }))).toBe('not_needed');
  });

  it('an app update with no definition change offers nothing new to an established user', () => {
    const established = seedTourPrefs(ev({ projects: 1, progressedProjects: 1, customPatterns: 1, userChatMessages: 1 }), NOW);
    for (const id of TOUR_IDS) expect(canOffer(def(id), established, ev({ projects: 1, progressedProjects: 1, customPatterns: 1, userChatMessages: 1 })).ok, id).toBe(false);
  });
});

describe('milestones', () => {
  it('are remembered once and keep their first time', () => {
    const a = withMilestone(emptyTourPrefs(NOW), 'patternOpened', 5);
    expect(a.milestones.patternOpened).toBe(5);
    expect(withMilestone(a, 'patternOpened', 9)).toBe(a);
  });
});
