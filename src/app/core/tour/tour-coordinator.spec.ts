import { afterEach, describe, expect, it, vi } from 'vitest';
import { KhayootaService } from '../ai/khayoota.service';
import { BACKGROUND_GRACE_MS } from './tour-coordinator.service';
import { FakeData, TourEnv, fakeProject, setupTour, showTarget } from './tour.testkit';
import type { TourPrefs } from './tour.types';

const armedPrefs = (over: Partial<TourPrefs> = {}): FakeData => ({ docs: { prefs: { tour: { v: 1, tours: {}, milestones: {}, seededAt: 1, armed: true, ...over } } } });
const status = (env: TourEnv, id: Parameters<TourEnv['state']['record']>[0]) => env.state.record(id).status;

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
});

describe('welcome offer and the Getting Started card', () => {
  it('a new guest that nobody armed is offered nothing (a returning or reinstalled user is never shown the welcome tour)', async () => {
    const env = await setupTour();
    expect(env.coordinator.welcomeOffer()).toBe(false);
    expect(env.coordinator.gettingStarted().state).toBe('hidden');
  });

  it('arming a new guest offers the welcome tour: the card is in its invitation state and nothing is started or dimmed', async () => {
    const env = await setupTour();
    await env.coordinator.arm();
    await env.flush();
    expect(env.coordinator.welcomeOffer()).toBe(true);
    expect(env.coordinator.gettingStarted().state).toBe('offer');
    expect(env.renderer.starts.length).toBe(0);
    expect(env.coordinator.running()).toBeNull();
  });

  it('showing the invitation on Home counts exactly one launch, and is logged once', async () => {
    const env = await setupTour();
    await env.coordinator.arm();
    await env.flush();
    await env.flush();
    expect(env.state.record('welcome')).toMatchObject({ status: 'offered', offers: 1 });
    expect(env.events.filter((e) => e.name === 'tour_offered')).toEqual([{ name: 'tour_offered', tour: 'welcome', kind: 'home-card' }]);
  });

  it('arming does nothing for a scope that already has data (an existing guest who taps "continue as guest" again)', async () => {
    const env = await setupTour({ scopes: { guest: { projects: [fakeProject()] } } });
    await env.coordinator.arm();
    await env.flush();
    expect(env.state.prefs()?.armed).toBeUndefined();
    expect(env.coordinator.welcomeOffer()).toBe(false);
    expect(env.coordinator.gettingStarted().state).toBe('hidden');
  });

  it('the invitation is not counted while the person is somewhere other than Home', async () => {
    const env = await setupTour({ url: '/tabs/tracker' });
    await env.coordinator.arm();
    await env.flush();
    expect(env.state.record('welcome').offers).toBe(0);
    await env.goto('/tabs/home');
    expect(env.state.record('welcome').offers).toBe(1);
  });

  it('after the offer was shown on the maximum number of launches the card turns into the list instead of nagging', async () => {
    const env = await setupTour({ scopes: { guest: armedPrefs({ tours: { welcome: { v: 1, status: 'offered', offers: 3, interruptions: 0, at: 1 } } }) } });
    expect(env.coordinator.welcomeOffer()).toBe(false);
    expect(env.coordinator.gettingStarted().state).toBe('list');
    expect(env.events.some((e) => e.name === 'tour_offered')).toBe(false);
  });

  it('"Not now" declines for good and the card switches to the list', async () => {
    const env = await setupTour();
    await env.coordinator.arm();
    await env.flush();
    await env.coordinator.decline('welcome');
    await env.flush();
    expect(status(env, 'welcome')).toBe('declined');
    expect(env.coordinator.gettingStarted().state).toBe('list');
    expect(env.events).toContainEqual({ name: 'tour_declined', tour: 'welcome', via: 'not-now' });
  });

  it('the list has five tasks, none done for a new user', async () => {
    const env = await setupTour({ scopes: { guest: armedPrefs({ tours: { welcome: { v: 1, status: 'declined', offers: 1, interruptions: 0, at: 1 } } }) } });
    const v = env.coordinator.gettingStarted();
    expect(v.state).toBe('list');
    expect(v.tasks.map((t) => t.id)).toEqual(['pattern', 'project', 'tracker', 'learn', 'khayoota']);
    expect(v.doneCount).toBe(0);
  });
});

describe('starting and ending the welcome tour', () => {
  async function armed() {
    const env = await setupTour();
    await env.coordinator.arm();
    await env.flush();
    return env;
  }

  it('Start runs the six steps in the current language; the status is persisted as active', async () => {
    const env = await armed();
    expect(await env.coordinator.accept('welcome')).toBe(true);
    expect(env.renderer.starts.length).toBe(1);
    const s = env.renderer.last;
    expect(s.steps.map((x) => x.id)).toEqual(['welcome.patterns', 'welcome.projects', 'welcome.tracker', 'welcome.learn', 'welcome.khayoota', 'welcome.settings']);
    expect(s.options.dir).toBe('ltr');
    expect(s.options.textFor(0).title).toBe('Your patterns live here');
    expect(s.options.labels.next).toBe('Next');
    expect(s.steps.every((x) => x.interaction === 'blocked')).toBe(true);
    expect(status(env, 'welcome')).toBe('active');
    expect(env.coordinator.running()).toMatchObject({ tour: 'welcome', stepId: 'welcome.patterns' });
    expect(env.events).toContainEqual({ name: 'tour_started', tour: 'welcome', source: 'offer' });
  });

  it('in Arabic the same tour is right-to-left with Arabic words', async () => {
    const env = await armed();
    env.i18n.lang.set('ar');
    await env.flush();
    await env.coordinator.accept('welcome');
    expect(env.renderer.last.options.dir).toBe('rtl');
    expect(env.renderer.last.options.textFor(1).title).toBe('مشاريعي');
    expect(env.renderer.last.options.labels.skip).toBe('تخطّي');
  });

  it('finishing completes it, shows the closing toast and switches the card to the list; each step viewed is logged and remembered', async () => {
    const env = await armed();
    await env.coordinator.accept('welcome');
    env.renderer.show(2);
    env.renderer.stop('done');
    await env.flush();
    expect(status(env, 'welcome')).toBe('completed');
    expect(env.toast).toHaveBeenCalledTimes(1);
    expect(env.coordinator.gettingStarted().state).toBe('list');
    expect(env.coordinator.running()).toBeNull();
    expect(env.events.map((e) => e.name)).toEqual(expect.arrayContaining(['tour_started', 'tour_step_viewed', 'tour_completed']));
    expect(env.events.filter((e) => e.name === 'tour_step_viewed')).toHaveLength(2);
  });

  it('Skip, ×, Android Back and Escape are all "skipped": remembered, never offered again, and never mistaken for a completion', async () => {
    for (const reason of ['skip', 'close', 'back'] as const) {
      const env = await armed();
      await env.coordinator.accept('welcome');
      env.renderer.stop(reason);
      await env.flush();
      expect(status(env, 'welcome'), reason).toBe('skipped');
      expect(env.events.some((e) => e.name === 'tour_completed')).toBe(false);
      expect(env.coordinator.welcomeOffer()).toBe(false);
      expect(env.toast).not.toHaveBeenCalled();
    }
  });

  it('an interruption by the app is recorded as interrupted, with the step it reached, not as skipped or completed', async () => {
    const env = await armed();
    await env.coordinator.accept('welcome');
    env.renderer.show(3);
    env.renderer.stop('overlay');
    await env.flush();
    expect(env.state.record('welcome')).toMatchObject({ status: 'interrupted', step: 'welcome.learn', interruptions: 1 });
    expect(env.events).toContainEqual({ name: 'tour_interrupted', tour: 'welcome', step: 'welcome.learn', reason: 'overlay' });
  });

  it('a second tour cannot start while one is running (no overlapping tours), and a double tap on Start starts one', async () => {
    const env = await armed();
    const [a, b] = await Promise.all([env.coordinator.accept('welcome'), env.coordinator.accept('welcome')]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(env.renderer.starts.length).toBe(1);
    await env.goto('/tabs/home'); // same page: no navigation interruption
    expect(await env.coordinator.accept('welcome')).toBe(false);
  });

  it('it never starts when the screen is not safe: an Ionic overlay is open, the lock screen is up, or the keyboard is open', async () => {
    const env = await armed();
    const sheet = document.createElement('ion-modal'); // a real Ionic element in jsdom: it hydrates asynchronously and starts out closed
    document.body.appendChild(sheet);
    await env.flush();
    sheet.classList.remove('overlay-hidden'); // what Ionic does when it presents an overlay (a closed one keeps the class)
    document.dispatchEvent(new CustomEvent('ionModalDidPresent'));
    await env.flush();
    expect(env.gate.blockedBy()).toBe('overlay');
    expect(await env.coordinator.accept('welcome')).toBe(false);
    sheet.classList.add('overlay-hidden');
    document.dispatchEvent(new CustomEvent('ionModalDidDismiss'));
    await env.flush();
    expect(env.gate.blockedBy()).toBeNull();
    env.auth.locked.set(true);
    await env.flush();
    expect(await env.coordinator.accept('welcome')).toBe(false);
    env.auth.locked.set(false);
    sheet.remove();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true, composed: true }));
    await env.flush();
    expect(env.gate.blockedBy()).toBe('keyboard');
    expect(await env.coordinator.accept('welcome')).toBe(false);
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    input.remove();
    expect(env.renderer.starts.length).toBe(0);
  });

  it('it is never offered or started anywhere outside the app proper (login, onboarding, setup, Design System)', async () => {
    const env = await armed();
    for (const url of ['/auth/login', '/onboarding/welcome', '/setup/avatar', '/design-system']) {
      await env.goto(url);
      expect(env.gate.blockedBy(), url).toBe('route');
      expect(await env.coordinator.accept('welcome'), url).toBe(false);
    }
    expect(env.renderer.starts.length).toBe(0);
  });
});

describe('guards: a running tour can never outlive the situation it was started in', () => {
  async function running(url = '/tabs/home') {
    const env = await setupTour({ url });
    await env.coordinator.arm();
    await env.flush();
    expect(await env.coordinator.accept('welcome')).toBe(true);
    return env;
  }

  it('leaving the page ends it before the transition (navigation)', async () => {
    const env = await running();
    await env.goto('/tabs/projects');
    expect(env.renderer.stops).toEqual(['navigation']);
    expect(env.coordinator.running()).toBeNull();
    expect(status(env, 'welcome')).toBe('interrupted');
  });

  it('an Ionic overlay about to appear ends it first, so it can never be left behind an untappable dimmer', async () => {
    for (const name of ['ionModalWillPresent', 'ionAlertWillPresent', 'ionActionSheetWillPresent', 'ionPopoverWillPresent', 'ionLoadingWillPresent']) {
      const env = await running();
      document.dispatchEvent(new CustomEvent(name));
      expect(env.renderer.stops, name).toEqual(['overlay']);
    }
  });

  it('Android Back registers at priority 100 while a tour runs and closes it instead of navigating', async () => {
    const env = await running();
    const registered: { priority: number; handler: () => void }[] = [];
    document.dispatchEvent(new CustomEvent('ionBackButton', { detail: { register: (priority: number, handler: () => void) => registered.push({ priority, handler }) } }));
    expect(registered).toHaveLength(1);
    expect(registered[0].priority).toBe(100);
    registered[0].handler();
    expect(env.renderer.stops).toEqual(['back']);
    expect(status(env, 'welcome')).toBe('skipped');
  });

  it('after the tour ends, Back is no longer intercepted and no listener is left behind', async () => {
    const env = await running();
    env.renderer.stop('skip');
    const registered: unknown[] = [];
    document.dispatchEvent(new CustomEvent('ionBackButton', { detail: { register: (p: number) => registered.push(p) } }));
    document.dispatchEvent(new CustomEvent('ionModalWillPresent'));
    expect(registered).toEqual([]);
    expect(env.renderer.stops).toEqual(['skip']);
  });

  it('the lock screen, a scope change (sign-out or another account) and a too-short viewport each end it', async () => {
    let env = await running();
    env.auth.locked.set(true);
    await env.flush();
    expect(env.renderer.stops).toEqual(['lock']);

    env = await running();
    env.auth.scope.set('user:other');
    await env.flush();
    expect(env.renderer.stops).toEqual(['scope-change']);

    env = await running();
    Object.defineProperty(window, 'innerHeight', { value: 360, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(env.renderer.stops).toEqual(['viewport']);
  });

  it('a rotation that still leaves room only re-measures', async () => {
    const env = await running();
    window.dispatchEvent(new Event('resize'));
    expect(env.renderer.stops).toEqual([]);
    expect(env.renderer.refreshes).toBeGreaterThan(0);
  });

  it('backgrounded: a quick switch away keeps the tour and re-measures; a long absence ends it', async () => {
    const env = await running();
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS - 1000);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS * 2);
    expect(env.renderer.stops).toEqual([]);
    expect(env.renderer.refreshes).toBeGreaterThan(0);

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(BACKGROUND_GRACE_MS + 1);
    expect(env.renderer.stops).toEqual(['background']);
  });

  it('changing the language while a tour is open re-texts it in the new language and direction', async () => {
    const env = await running();
    env.i18n.lang.set('ar');
    await env.flush();
    expect(env.renderer.retexts.at(-1)).toMatchObject({ dir: 'rtl' });
    expect((env.renderer.retexts.at(-1) as { labels: { next: string } }).labels.next).toBe('التالي');
    expect(env.renderer.last.options.textFor(0).title).toBe('باتروناتك هنا');
  });

  it('stopping when nothing runs is harmless', async () => {
    const env = await setupTour();
    expect(() => env.coordinator.stop('skip')).not.toThrow();
    expect(env.coordinator.running()).toBeNull();
  });
});

describe('engine failure and the kill switch', () => {
  it('an engine that cannot start leaves the app untouched; two failures switch tours off but keep the Getting Started list', async () => {
    const env = await setupTour();
    await env.coordinator.arm();
    await env.flush();
    env.renderer.failStart = true;
    expect(await env.coordinator.accept('welcome')).toBe(false);
    expect(env.coordinator.running()).toBeNull();
    expect(status(env, 'welcome')).toBe('interrupted');
    expect(env.coordinator.welcomeOffer()).toBe(false); // an interrupted welcome is not re-offered by the card
    expect(await env.coordinator.accept('welcome')).toBe(false);
    await env.goto('/tabs/home/patterns');
    expect(env.coordinator.pillOffer(['patterns'])).toBeNull(); // broken: no more automatic offers
    expect(await env.coordinator.replay('patterns')).toBe('unavailable');
    expect(env.coordinator.gettingStarted().state).toBe('list');
  });

  it('with the build-time kill switch off every tour surface is silent and nothing is written', async () => {
    const env = await setupTour({ toursEnabled: false });
    await env.coordinator.arm();
    await env.coordinator.mark('patternOpened');
    await env.flush();
    expect(env.coordinator.enabled()).toBe(false);
    expect(env.coordinator.welcomeOffer()).toBe(false);
    expect(env.coordinator.gettingStarted().state).toBe('hidden');
    expect(env.coordinator.pillOffer(['welcome'])).toBeNull();
    expect(await env.coordinator.accept('welcome')).toBe(false);
    expect(await env.coordinator.replay('welcome')).toBe('unavailable');
    expect(env.renderer.starts.length).toBe(0);
    expect(env.docs.get('guest')?.prefs?.tour).toBeUndefined();
    expect(env.events).toEqual([]);
  });
});

describe('first-visit offer pills', () => {
  it('a screen\'s pill appears only on its own screen and never starts anything by itself', async () => {
    const env = await setupTour({ url: '/tabs/home/patterns' });
    expect(env.coordinator.pillOffer(['patterns'])).toEqual({ tour: 'patterns', kind: 'first', steps: 3 });
    expect(env.coordinator.pillOffer(['project-create'])).toBeNull();
    await env.goto('/tabs/home');
    expect(env.coordinator.pillOffer(['patterns'])).toBeNull();
    expect(env.renderer.starts.length).toBe(0);
  });

  it('a pill is counted once per visit and stops after two visits', async () => {
    const env = await setupTour({ url: '/tabs/home/patterns' });
    const offer = env.coordinator.pillOffer(['patterns'])!;
    env.coordinator.notePillShown(offer);
    env.coordinator.notePillShown(offer); // same visit: not counted twice
    await env.flush();
    expect(env.state.record('patterns').offers).toBe(1);
    await env.goto('/tabs/home');
    await env.goto('/tabs/home/patterns');
    env.coordinator.notePillShown(env.coordinator.pillOffer(['patterns'])!);
    await env.flush();
    expect(env.state.record('patterns').offers).toBe(2);
    await env.goto('/tabs/home');
    await env.goto('/tabs/home/patterns');
    expect(env.coordinator.pillOffer(['patterns'])).toBeNull();
  });

  it('declining a pill is permanent', async () => {
    const env = await setupTour({ url: '/tabs/home/patterns' });
    await env.coordinator.decline('patterns');
    await env.flush();
    expect(env.coordinator.pillOffer(['patterns'])).toBeNull();
    await env.goto('/tabs/home');
    await env.goto('/tabs/home/patterns');
    expect(env.coordinator.pillOffer(['patterns'])).toBeNull();
  });

  it('only one tour is started per app launch without an explicit tap in Settings: after one starts, no other pill appears', async () => {
    const env = await setupTour({ url: '/tabs/home/patterns' });
    expect(await env.coordinator.accept('patterns')).toBe(true);
    env.renderer.stop('done');
    await env.flush();
    await env.goto('/tabs/projects/new');
    expect(env.coordinator.pillOffer(['project-create'])).toBeNull();
  });

  it('an interrupted pill tour is offered to resume exactly once, at the step it reached; a second interruption ends it', async () => {
    const env = await setupTour({ url: '/tabs/home/patterns' });
    await env.coordinator.accept('patterns');
    env.renderer.show(1);
    env.renderer.stop('overlay');
    await env.flush();
    expect(status(env, 'patterns')).toBe('interrupted');
    expect(env.coordinator.pillOffer(['patterns'])).toBeNull(); // not again in this launch
    // next launch
    const env2 = await setupTour({ url: '/tabs/home/patterns', scopes: { guest: { docs: { prefs: { tour: { v: 1, tours: { patterns: env.state.record('patterns') }, milestones: {}, seededAt: 1 } } } } } });
    expect(env2.coordinator.pillOffer(['patterns'])).toEqual({ tour: 'patterns', kind: 'resume', steps: 3 });
    expect(await env2.coordinator.accept('patterns')).toBe(true);
    expect(env2.renderer.last.startIndex).toBe(1);
    env2.renderer.stop('navigation');
    await env2.flush();
    expect(status(env2, 'patterns')).toBe('skipped');
  });

  it('never for something the person has already done: patterns with a pattern of her own, the new-project tour with projects, the tracker tour with progress', async () => {
    const env = await setupTour({ url: '/tabs/tracker', scopes: { guest: { projects: [fakeProject({ count: 3 })] } } });
    env.coordinator.setTrackerLayout('simple');
    expect(env.coordinator.pillOffer(['tracker-simple'])).toBeNull();
    await env.goto('/tabs/projects/new');
    expect(env.coordinator.pillOffer(['project-create'])).toBeNull();
  });

  it('a project nobody has counted on yet still gets the tracker tour, chosen by the layout the page reports', async () => {
    const env = await setupTour({ url: '/tabs/tracker', scopes: { guest: { projects: [fakeProject()] } } });
    env.coordinator.setTrackerLayout('simple');
    expect(env.coordinator.pillOffer(['tracker-simple', 'tracker-parts'])).toMatchObject({ tour: 'tracker-simple' });
    expect(env.coordinator.pillOffer(['tracker-pattern'])).toBeNull(); // wrong layout
    env.coordinator.setTrackerLayout('parts-pattern');
    expect(env.coordinator.pillOffer(['tracker-simple', 'tracker-parts'])).toMatchObject({ tour: 'tracker-parts' });
    env.coordinator.setTrackerLayout('none');
    expect(env.coordinator.pillOffer(['tracker-simple', 'tracker-pattern', 'tracker-parts'])).toBeNull();
  });

  it('the Khayoota pill waits until the server status has settled, and the copy follows the mode the screen itself shows', async () => {
    const env = await setupTour({ url: '/tabs/assistant' });
    const kh = env.injector.get(KhayootaService) as unknown as { configured: boolean; status: { set(v: unknown): void } };
    kh.configured = true;
    env.auth.signedIn.set(true);
    await env.flush();
    expect(env.coordinator.pillOffer(['khayoota'])).toBeNull(); // signed in, AI configured, status unknown yet
    kh.status.set({ enabled: false });
    await env.flush();
    expect(env.coordinator.pillOffer(['khayoota'])).toMatchObject({ tour: 'khayoota' });

    showTarget(env, 'khayoota.status', { 'data-mode': 'soon' });
    expect(await env.coordinator.accept('khayoota')).toBe(true);
    expect(env.renderer.last.options.textFor(0).body).toMatch(/still in testing/);
    expect(env.renderer.last.options.textFor(0).body).not.toMatch(/answers with AI/);
    expect(env.renderer.last.steps.every((s) => s.interaction === 'blocked')).toBe(true);
  });
});

describe('replay from Settings', () => {
  it('replaying the app tour from Settings leaves Settings, returns to the Home root and starts at step 1', async () => {
    const env = await setupTour({ url: '/tabs/home/settings' });
    expect(await env.coordinator.replay('welcome')).toBe('started');
    expect(env.nav.navigateRoot).toHaveBeenCalledWith('/tabs/home');
    expect(env.router.url).toBe('/tabs/home');
    expect(env.renderer.last.startIndex).toBe(0);
    expect(env.events).toContainEqual({ name: 'tour_replayed', tour: 'welcome' });
  });

  it('a replay never makes a record worse: skipping or an interruption leaves "completed" as it was; finishing upgrades "skipped"', async () => {
    const env = await setupTour({ url: '/tabs/home/settings', scopes: { guest: armedPrefs({ tours: { welcome: { v: 1, status: 'completed', offers: 1, interruptions: 0, at: 1 }, patterns: { v: 1, status: 'skipped', offers: 1, interruptions: 0, at: 1 } } }) } });
    await env.coordinator.replay('welcome');
    env.renderer.stop('skip');
    await env.flush();
    expect(status(env, 'welcome')).toBe('completed');
    await env.coordinator.replay('patterns');
    env.renderer.stop('overlay');
    await env.flush();
    expect(status(env, 'patterns')).toBe('skipped');
    await env.coordinator.replay('patterns');
    env.renderer.stop('done');
    await env.flush();
    expect(status(env, 'patterns')).toBe('completed');
  });

  it('a replay does not count as the launch\'s one automatic tour', async () => {
    const env = await setupTour({ url: '/tabs/home/settings' });
    await env.coordinator.replay('welcome');
    env.renderer.stop('done');
    await env.flush();
    await env.goto('/tabs/home/patterns');
    expect(env.coordinator.pillOffer(['patterns'])).not.toBeNull();
  });

  it('the tracker tour needs a project and says so; the pieces tour needs a multi-part project', async () => {
    const none = await setupTour({ url: '/tabs/home/settings' });
    expect(await none.coordinator.replay('tracker-simple')).toBe('needs-project');
    expect(none.renderer.starts.length).toBe(0);
    expect(none.nav.navigateRoot).not.toHaveBeenCalled(); // it did not even navigate

    const single = await setupTour({ url: '/tabs/home/settings', scopes: { guest: { projects: [fakeProject()] } } });
    expect(await single.coordinator.replay('tracker-parts')).toBe('needs-parts');
    expect(single.renderer.starts.length).toBe(0);
  });

  it('the tracker replay picks the tour that matches the layout on screen', async () => {
    const env = await setupTour({ url: '/tabs/home/settings', scopes: { guest: { projects: [fakeProject()] } } });
    env.coordinator.setTrackerLayout('pattern');
    expect(await env.coordinator.replay('tracker-simple')).toBe('started');
    expect(env.renderer.last.steps).toHaveLength(5); // the pattern tracker tour, not the 4-step simple one
    expect(env.renderer.last.steps.every((s) => s.interaction === 'blocked')).toBe(true);
  });

  it('a replay that cannot become safe in time reports it instead of hanging', async () => {
    const env = await setupTour({ url: '/tabs/home/settings' });
    env.auth.locked.set(true);
    expect(await env.coordinator.replay('welcome')).toBe('unavailable');
    expect(env.renderer.starts.length).toBe(0);
  }, 10_000);
});

describe('Getting Started tasks follow real actions', () => {
  const declined = { welcome: { v: 1, status: 'declined' as const, offers: 1, interruptions: 0, at: 1 } };

  it('creating a project and counting tick their tasks and are remembered; deleting the project does not un-tick them', async () => {
    const env = await setupTour({ scopes: { guest: armedPrefs({ tours: declined }) } });
    expect(env.coordinator.gettingStarted().doneCount).toBe(0);
    await env.store.addProject(fakeProject({ count: 2 }));
    await env.flush();
    const v = env.coordinator.gettingStarted();
    expect(v.tasks.find((t) => t.id === 'project')?.done).toBe(true);
    expect(v.tasks.find((t) => t.id === 'tracker')?.done).toBe(true);
    expect(env.state.prefs()?.milestones).toMatchObject({ projectCreated: expect.any(Number), trackerTried: expect.any(Number) });
    expect(env.events.filter((e) => e.name === 'gs_task_done')).toHaveLength(2);
    await env.store.deleteProject('p1');
    await env.flush();
    expect(env.coordinator.gettingStarted().doneCount).toBe(2);
  });

  it('a project nobody has counted on does not tick "tracker"', async () => {
    const env = await setupTour({ scopes: { guest: armedPrefs({ tours: declined }) } });
    await env.store.addProject(fakeProject());
    await env.flush();
    const v = env.coordinator.gettingStarted();
    expect(v.tasks.find((t) => t.id === 'project')?.done).toBe(true);
    expect(v.tasks.find((t) => t.id === 'tracker')?.done).toBe(false);
  });

  it('viewing tour steps never ticks anything', async () => {
    const env = await setupTour({ scopes: { guest: armedPrefs() } });
    await env.coordinator.accept('welcome');
    for (let i = 0; i < 6; i++) env.renderer.show(i);
    env.renderer.stop('done');
    await env.flush();
    expect(env.coordinator.gettingStarted().doneCount).toBe(0);
  });

  it('opening a sample pattern and a tutorial are recorded by the pages that really open them', async () => {
    const env = await setupTour({ scopes: { guest: armedPrefs({ tours: declined }) } });
    await env.coordinator.mark('patternOpened');
    await env.coordinator.mark('tutorialOpened');
    await env.flush();
    expect(env.coordinator.gettingStarted().tasks.filter((t) => t.done).map((t) => t.id)).toEqual(['pattern', 'learn']);
  });

  it('five done: a completion message for this launch only, then the card is gone; it can be hidden and restored', async () => {
    const env = await setupTour({ scopes: { guest: armedPrefs({ tours: declined, milestones: { patternOpened: 1, tutorialOpened: 1, projectCreated: 1, trackerTried: 1 } }) } });
    expect(env.coordinator.gettingStarted().state).toBe('list');
    await env.store.setChat([{ id: 'u1', role: 'user', text: 'x' }]);
    await env.flush();
    expect(env.coordinator.gettingStarted().state).toBe('done');
    expect(env.events).toContainEqual({ name: 'gs_completed' });
    await env.coordinator.hideGettingStarted();
    await env.flush();
    expect(env.coordinator.gettingStarted().state).toBe('hidden');
    await env.coordinator.restoreGettingStarted();
    await env.flush();
    expect(env.coordinator.gettingStarted().state).not.toBe('hidden');
  });

  it('hide is remembered and the Settings restore brings the list back, even for someone the app treated as established', async () => {
    const env = await setupTour({ scopes: { guest: { projects: [fakeProject({ count: 1 })], docs: { prefs: { tour: { v: 1, tours: { welcome: { v: 1, status: 'not_needed', offers: 0, interruptions: 0, at: 1 } }, milestones: {}, seededAt: 1 } } } } } });
    expect(env.coordinator.gettingStarted().state).toBe('hidden');
    await env.coordinator.restoreGettingStarted();
    await env.flush();
    expect(env.coordinator.gettingStarted().state).toBe('list');
    expect(env.coordinator.welcomeOffer()).toBe(false); // she has used the app: the welcome tour itself is not offered
  });

  it('tapping a row only navigates: nothing is created or changed', async () => {
    const env = await setupTour({ scopes: { guest: armedPrefs({ tours: declined }) } });
    await env.coordinator.openTask('pattern');
    expect(env.router.url).toBe('/tabs/home/patterns');
    await env.coordinator.openTask('tracker'); // no project: goes to create one, not to an empty tracker
    expect(env.router.url).toBe('/tabs/projects/new');
    await env.coordinator.openTask('learn');
    expect(env.router.url).toBe('/tabs/learn');
    await env.coordinator.openTask('khayoota');
    expect(env.router.url).toBe('/tabs/assistant');
    expect(env.store.projects()).toEqual([]);
    expect(env.renderer.starts.length).toBe(0);
  });
});

describe('guest, account and scope rules', () => {
  const guestTour: TourPrefs = { v: 1, tours: { welcome: { v: 1, status: 'completed', offers: 1, interruptions: 0, at: 1 } }, milestones: { patternOpened: 7 }, seededAt: 1, armed: true };

  it('a guest who signs up in the same session brings the tour progress along, so nothing is offered twice', async () => {
    const env = await setupTour({ scopes: { guest: { docs: { prefs: { tour: guestTour } } }, 'user:abc': {} } });
    env.auth.scope.set('user:abc');
    env.auth.guest.set(false);
    env.auth.signedIn.set(true);
    await env.store.whenScopeLoaded('user:abc');
    await env.flush();
    expect(env.docs.get('user:abc')?.prefs?.tour).toEqual(guestTour);
    expect(env.coordinator.welcomeOffer()).toBe(false);
  });

  it('an account that already has its own tour state keeps it', async () => {
    const own: TourPrefs = { v: 1, tours: {}, milestones: {}, seededAt: 5 };
    const env = await setupTour({ scopes: { guest: { docs: { prefs: { tour: guestTour } } }, 'user:abc': { docs: { prefs: { tour: own } } } } });
    env.auth.scope.set('user:abc');
    env.auth.guest.set(false);
    await env.store.whenScopeLoaded('user:abc');
    await env.flush();
    expect(env.docs.get('user:abc')?.prefs?.tour).toEqual(own);
  });

  it('a signed-in person whose old guest data merely loads first at start-up never inherits it (she was not a guest)', async () => {
    const env = await setupTour({ guest: false, scopes: { guest: { docs: { prefs: { tour: guestTour } } }, 'user:abc': {} } });
    env.auth.scope.set('user:abc');
    await env.store.whenScopeLoaded('user:abc');
    await env.flush();
    expect(env.docs.get('user:abc')?.prefs?.tour?.milestones).not.toEqual(guestTour.milestones);
    expect(env.docs.get('user:abc')?.prefs?.tour?.armed).toBeUndefined();
  });

  it('switching from one account to another carries nothing across, and each account keeps its own state', async () => {
    const a: TourPrefs = { v: 1, tours: { patterns: { v: 1, status: 'completed', offers: 1, interruptions: 0, at: 1 } }, milestones: {}, seededAt: 1 };
    const env = await setupTour({ scope: 'user:a', guest: false, scopes: { 'user:a': { docs: { prefs: { tour: a } } }, 'user:b': {} } });
    env.auth.scope.set('user:b');
    await env.store.whenScopeLoaded('user:b');
    await env.flush();
    expect(env.state.record('patterns').status).toBe('not_started');
    expect(env.docs.get('user:a')?.prefs?.tour).toEqual(a);
    env.auth.scope.set('user:a');
    await env.store.whenScopeLoaded('user:a');
    await env.flush();
    expect(env.state.record('patterns').status).toBe('completed');
  });

  it('a scope with data but no tour state is seeded as established: no welcome offer, no pill for what is already known', async () => {
    const env = await setupTour({ scopes: { guest: { projects: [fakeProject({ count: 5 })] } } });
    await env.flush();
    expect(env.state.prefs()?.seededAt).toBeGreaterThan(0);
    expect(env.state.record('welcome').status).toBe('not_needed');
    expect(env.state.record('project-create').status).toBe('not_needed');
    expect(env.state.record('tracker-simple').status).toBe('not_needed');
    expect(env.coordinator.welcomeOffer()).toBe(false);
  });

  it('a tour a crash left "active" becomes an interruption when the app next loads', async () => {
    const env = await setupTour({ scopes: { guest: { docs: { prefs: { tour: { v: 1, tours: { patterns: { v: 1, status: 'active', step: 'patterns.kinds', offers: 1, interruptions: 0, at: 1 } }, milestones: {}, seededAt: 1 } } } } } });
    expect(env.state.record('patterns')).toMatchObject({ status: 'interrupted', step: 'patterns.kinds' });
  });

  it('a plain sign-in of an account that finished setup is never offered the welcome tour; a demonstrably fresh one is', async () => {
    const finished = await setupTour({ scope: 'user:old', guest: false, scopes: { 'user:old': { docs: { profile: { onboarded: true } as never } } } });
    await finished.coordinator.armIfFreshAccount();
    await finished.flush();
    expect(finished.state.prefs()?.armed).toBeUndefined();

    const fresh = await setupTour({ scope: 'user:new', guest: false, scopes: { 'user:new': {} } });
    await fresh.coordinator.armIfFreshAccount();
    await fresh.flush();
    expect(fresh.state.prefs()?.armed).toBe(true);
    expect(fresh.coordinator.welcomeOffer()).toBe(true);
  });
});
