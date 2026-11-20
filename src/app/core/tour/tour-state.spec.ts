import { describe, expect, it } from 'vitest';
import { LocalTourEventSink } from './tour-event-sink';
import { ALL_TOURS, definitionOf } from './tour-registry';
import { setupTour } from './tour.testkit';
import type { TourEvent } from './tour.types';

const welcome = () => definitionOf('welcome');
const ev0 = { projects: 0, progressedProjects: 0, customPatterns: 0, collections: 0, userChatMessages: 0 };

describe('TourStateService persistence', () => {
  it('writes to the current scope only, and only into that scope\'s own stored documents', async () => {
    const env = await setupTour({ scope: 'guest' });
    await env.state.ensureSeeded(ev0, ALL_TOURS);
    await env.state.noteOffered(welcome());
    await env.flush();
    expect(env.docs.get('guest')?.prefs?.tour?.tours.welcome?.status).toBe('offered');
    expect(env.docs.get('user:other')).toBeUndefined();
  });

  it('two writes in a row both land (no stale overwrite)', async () => {
    const env = await setupTour({ scope: 'guest' });
    await env.state.ensureSeeded(ev0, ALL_TOURS);
    await Promise.all([env.state.mark('patternOpened'), env.state.mark('tutorialOpened'), env.state.noteOffered(welcome())]);
    await env.flush();
    const t = env.docs.get('guest')?.prefs?.tour;
    expect(t?.milestones.patternOpened).toBeTruthy();
    expect(t?.milestones.tutorialOpened).toBeTruthy();
    expect(t?.tours.welcome?.status).toBe('offered');
  });

  it('a milestone is latched: marking it again changes nothing and says so', async () => {
    const env = await setupTour({ scope: 'guest' });
    await env.state.ensureSeeded(ev0, ALL_TOURS);
    expect(await env.state.mark('projectCreated')).toBe(true);
    const at = env.state.prefs()!.milestones.projectCreated;
    expect(await env.state.mark('projectCreated')).toBe(false);
    expect(env.state.prefs()!.milestones.projectCreated).toBe(at);
  });

  it('survives a reload: a fresh app on the same stored documents sees the same state', async () => {
    const first = await setupTour({ scope: 'guest' });
    await first.state.ensureSeeded(ev0, ALL_TOURS);
    await first.state.arm(ev0);
    await first.state.noteStarted(welcome());
    await first.state.noteEnded(welcome(), 'done', 'welcome.s6', false);
    await first.flush();
    const saved = first.docs.get('guest')!;
    const again = await setupTour({ scope: 'guest', scopes: { guest: { docs: saved } } });
    expect(again.state.record('welcome').status).toBe('completed');
    expect(again.state.prefs()?.armed).toBe(true);
  });

  it('Getting Started: hide, restore (also re-arms) and complete are each persisted', async () => {
    const env = await setupTour({ scope: 'guest' });
    await env.state.ensureSeeded(ev0, ALL_TOURS);
    await env.state.hideGettingStarted();
    expect(env.state.prefs()?.gettingStarted?.hiddenAt).toBeTruthy();
    await env.state.restoreGettingStarted();
    expect(env.state.prefs()?.gettingStarted).toEqual({});
    expect(env.state.prefs()?.armed).toBe(true);
    await env.state.completeGettingStarted();
    const at = env.state.prefs()?.gettingStarted?.completedAt;
    expect(at).toBeTruthy();
    await env.state.completeGettingStarted();
    expect(env.state.prefs()?.gettingStarted?.completedAt).toBe(at);
  });

  it('adopt copies a guest\'s tour state into an account that has none, and never overwrites one that has', async () => {
    const env = await setupTour({ scope: 'guest' });
    const from = { v: 1 as const, tours: {}, milestones: { patternOpened: 5 }, seededAt: 1, armed: true };
    await env.state.ensureSeeded(ev0, ALL_TOURS);
    await env.state.adopt(from); // guest already has state: no change
    expect(env.state.prefs()?.milestones.patternOpened).toBeUndefined();

    // The positive path (a fresh account adopting the guest's state before it is seeded) runs inside the coordinator's own effect,
    // so it is covered in tour-coordinator.spec.ts ("guest, account and scope rules").
  });

  it('a tour left "active" by a crash is recovered as an interruption on the next seed', async () => {
    const docs = { prefs: { tour: { v: 1 as const, tours: { welcome: { v: 1, status: 'active' as const, offers: 1, interruptions: 0, at: 1, step: 'welcome.s2' } }, milestones: {}, seededAt: 1 } } };
    const env = await setupTour({ scope: 'guest', scopes: { guest: { docs } } });
    await env.state.ensureSeeded(ev0, ALL_TOURS);
    expect(env.state.record('welcome').status).toBe('interrupted');
  });
});

describe('LocalTourEventSink', () => {
  const sample: TourEvent = { name: 'tour_started', tour: 'welcome', source: 'offer' };

  it('stores each event with a time and the language, in the scope\'s own documents', async () => {
    const env = await setupTour({ scope: 'guest', lang: 'ar' });
    const sink = env.injector.get(LocalTourEventSink);
    sink.record(sample);
    await env.flush();
    const rec = env.store.tourEvents();
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ name: 'tour_started', tour: 'welcome', source: 'offer', lang: 'ar' });
    expect(typeof rec[0].at).toBe('number');
    expect(env.docs.get('guest')?.tourEvents).toHaveLength(1);
  });

  it('keeps only the latest 200 events', async () => {
    const env = await setupTour({ scope: 'guest' });
    for (let i = 0; i < 230; i++) await env.store.recordTourEvent({ name: 'tour_step_viewed', tour: 'welcome', step: `s${i}`, index: i }, 'en');
    const rec = env.store.tourEvents();
    expect(rec).toHaveLength(200);
    expect((rec[0] as { step: string }).step).toBe('s30');
    expect((rec[199] as { step: string }).step).toBe('s229');
  });

  it('only ever holds the known, content-free fields', async () => {
    const env = await setupTour({ scope: 'guest' });
    const events: TourEvent[] = [
      { name: 'tour_offered', tour: 'welcome', kind: 'home-card' },
      { name: 'tour_started', tour: 'patterns', source: 'settings' },
      { name: 'tour_step_viewed', tour: 'welcome', step: 'welcome.s1', index: 0 },
      { name: 'tour_completed', tour: 'welcome' },
      { name: 'gs_task_done', task: 'pattern' },
    ];
    for (const e of events) await env.store.recordTourEvent(e, 'en');
    const allowed = new Set(['name', 'tour', 'kind', 'source', 'step', 'index', 'via', 'reason', 'task', 'at', 'lang']);
    for (const r of env.store.tourEvents()) for (const k of Object.keys(r)) expect(allowed.has(k), k).toBe(true);
  });

  it('a failing write never throws into the tour', async () => {
    const env = await setupTour({ scope: 'guest' });
    const sink = env.injector.get(LocalTourEventSink);
    (env.store as unknown as { saveDocs: () => Promise<void> }).saveDocs = async () => {
      throw new Error('disk full');
    };
    expect(() => sink.record(sample)).not.toThrow();
    await env.flush();
  });
});
