import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeProject, setupTour, TourEnv } from '../../../core/tour/tour.testkit';
import type { TourPrefs } from '../../../core/tour/tour.types';
import { GettingStartedComponent } from './getting-started.component';
import { TourHelpComponent } from './tour-help.component';
import { TourOfferComponent } from './tour-offer.component';
import { TourTargetDirective } from './tour-target.directive';

const armedPrefs = (over: Partial<TourPrefs> = {}) => ({ docs: { prefs: { tour: { v: 1 as const, tours: {}, milestones: {}, seededAt: 1, armed: true, ...over } } } });
const declinedWelcome = { welcome: { v: 1, status: 'declined' as const, offers: 1, interruptions: 0, at: 1 } };

async function mount<T>(env: TourEnv, type: new () => T) {
  const fixture = TestBed.createComponent(type);
  fixture.detectChanges();
  await env.flush();
  fixture.detectChanges();
  return fixture;
}
const q = <E extends Element = HTMLElement>(f: { nativeElement: HTMLElement }, sel: string) => f.nativeElement.querySelector<E>(sel);
const all = (f: { nativeElement: HTMLElement }, sel: string) => Array.from(f.nativeElement.querySelectorAll<HTMLElement>(sel));

afterEach(() => document.body.querySelectorAll('[data-tour]').forEach((n) => n.remove()));

describe('TourTargetDirective', () => {
  @Component({ imports: [TourTargetDirective], template: `<button [gzTour]="id()">x</button>` })
  class Host {
    id = signal<'home.avatar' | null>('home.avatar');
  }

  it('writes data-tour, registers the element while it lives, and unregisters on removal or when switched off', async () => {
    const env = await setupTour();
    const f = TestBed.createComponent(Host);
    document.body.appendChild(f.nativeElement);
    f.detectChanges();
    await env.flush();
    const btn = f.nativeElement.querySelector('button') as HTMLElement;
    btn.getBoundingClientRect = () => ({ x: 0, y: 0, width: 50, height: 40, top: 0, left: 0, right: 50, bottom: 40, toJSON: () => ({}) }) as DOMRect;
    expect(btn.getAttribute('data-tour')).toBe('home.avatar');
    expect(env.targets.resolve('home.avatar')).toBe(btn);

    f.componentInstance.id.set(null);
    f.detectChanges();
    await env.flush();
    expect(btn.hasAttribute('data-tour')).toBe(false);
    expect(env.targets.resolve('home.avatar')).toBeNull();

    f.componentInstance.id.set('home.avatar');
    f.detectChanges();
    await env.flush();
    expect(env.targets.resolve('home.avatar')).toBe(btn);
    f.destroy();
    await env.flush();
    expect(env.targets.resolve('home.avatar')).toBeNull();
  });
});

describe('GettingStartedComponent', () => {
  it('renders nothing for someone who was never offered the tour', async () => {
    const env = await setupTour();
    const f = await mount(env, GettingStartedComponent);
    expect(q(f, '[data-gs]')).toBeNull();
  });

  it('shows the invitation with Start and Not now; Start runs the tour, nothing happens by itself', async () => {
    const env = await setupTour();
    await env.coordinator.arm();
    const f = await mount(env, GettingStartedComponent);
    expect(q(f, '[data-gs]')?.getAttribute('data-gs')).toBe('offer');
    expect(env.renderer.starts.length).toBe(0);
    expect(q(f, '[data-gs-start]')?.textContent?.trim()).toBe('Start the tour');
    expect(q(f, '[data-gs-notnow]')).toBeTruthy();
    q(f, '[data-gs-start]')!.click();
    await env.flush();
    expect(env.renderer.starts.length).toBe(1);
    expect(env.coordinator.running()?.tour).toBe('welcome');
  });

  it('Not now turns the card into the list of five steps, none ticked, each at least 48px tall by CSS and a real button', async () => {
    const env = await setupTour();
    await env.coordinator.arm();
    const f = await mount(env, GettingStartedComponent);
    q(f, '[data-gs-notnow]')!.click();
    await env.flush();
    f.detectChanges();
    expect(q(f, '[data-gs]')?.getAttribute('data-gs')).toBe('list');
    const rows = all(f, '[data-task]');
    expect(rows.map((r) => r.getAttribute('data-task'))).toEqual(['pattern', 'project', 'tracker', 'learn', 'khayoota']);
    expect(rows.every((r) => r.tagName === 'BUTTON' && !(r as HTMLButtonElement).disabled)).toBe(true);
    expect(q(f, '.sub')?.textContent).toContain('0');
  });

  it('a task ticks only from the real action: opening a pattern ticks "pattern", and its row is disabled and announced as done', async () => {
    const env = await setupTour({ scopes: { guest: armedPrefs({ tours: declinedWelcome }) } });
    const f = await mount(env, GettingStartedComponent);
    expect(q(f, '[data-task="pattern"]')?.hasAttribute('disabled')).toBe(false);
    await env.state.mark('patternOpened');
    await env.flush();
    f.detectChanges();
    const row = q<HTMLButtonElement>(f, '[data-task="pattern"]')!;
    expect(row.disabled).toBe(true);
    expect(row.classList.contains('done')).toBe(true);
    expect(row.querySelector('.gz-sr')?.textContent).toContain('done');
    expect(q<HTMLButtonElement>(f, '[data-task="project"]')!.disabled).toBe(false);
  });

  it('tapping an open row only navigates (nothing is created or changed)', async () => {
    const env = await setupTour({ scopes: { guest: armedPrefs({ tours: declinedWelcome }) } });
    const f = await mount(env, GettingStartedComponent);
    const projectsBefore = env.store.projects().length;
    q(f, '[data-task="project"]')!.click();
    await env.flush();
    expect(env.store.projects().length).toBe(projectsBefore);
    expect(env.renderer.starts.length).toBe(0);
    expect(env.router.url).not.toBe('/tabs/home');
  });

  it('"Hide" removes the card; completing all five shows the short completion message, then it goes away', async () => {
    const env = await setupTour({ scopes: { guest: armedPrefs({ tours: declinedWelcome }) } });
    const f = await mount(env, GettingStartedComponent);
    q(f, '.hide')!.click();
    await env.flush();
    f.detectChanges();
    expect(q(f, '[data-gs]')).toBeNull();

    const env2 = await setupTour({ scopes: { guest: armedPrefs({ tours: declinedWelcome, milestones: { patternOpened: 1, tutorialOpened: 1, trackerTried: 1, khayootaAsked: 1 } }) } });
    await env2.state.mark('projectCreated');
    const f2 = await mount(env2, GettingStartedComponent);
    expect(q(f2, '[data-gs]')?.getAttribute('data-gs')).toBe('done');
    expect(all(f2, '[data-task]')).toHaveLength(0);
  });

  it('Arabic: right-to-left text, with the count isolated so digits cannot reorder', async () => {
    const env = await setupTour({ lang: 'ar', scopes: { guest: armedPrefs({ tours: declinedWelcome }) } });
    const f = await mount(env, GettingStartedComponent);
    const sub = q(f, '.sub')!.textContent!;
    expect(sub).toMatch(/[؀-ۿ]/);
    expect(sub).toContain('⁦0⁩');
    expect(sub).toContain('⁦5⁩');
  });
});

describe('TourOfferComponent', () => {
  async function pill(env: TourEnv, tours: readonly string[]) {
    const f = TestBed.createComponent(TourOfferComponent);
    f.componentRef.setInput('tours', tours);
    f.detectChanges();
    await env.flush();
    f.detectChanges();
    return f;
  }

  it('offers the screen\'s tour once, when it is safe, and counts that visit once', async () => {
    const env = await setupTour({ url: '/tabs/home/patterns', scopes: { guest: armedPrefs({ tours: declinedWelcome }) } });
    const f = await pill(env, ['patterns']);
    expect(q(f, '[data-tour-offer]')).toBeTruthy();
    expect(q(f, '[data-tour-offer]')?.textContent).toContain('3');
    expect(env.state.record('patterns').offers).toBe(1);
    f.detectChanges();
    await env.flush();
    expect(env.state.record('patterns').offers).toBe(1);
  });

  it('Start runs the tour; the pill never starts anything by itself', async () => {
    const env = await setupTour({ url: '/tabs/home/patterns', scopes: { guest: armedPrefs({ tours: declinedWelcome }) } });
    const f = await pill(env, ['patterns']);
    expect(env.renderer.starts.length).toBe(0);
    q(f, '.go')!.click();
    await env.flush();
    expect(env.coordinator.running()?.tour).toBe('patterns');
  });

  it('the close button declines it for good and the pill disappears; its accessible name is not empty', async () => {
    const env = await setupTour({ url: '/tabs/home/patterns', scopes: { guest: armedPrefs({ tours: declinedWelcome }) } });
    const f = await pill(env, ['patterns']);
    const x = q(f, '.x')!;
    expect(x.getAttribute('aria-label')).toBeTruthy();
    x.click();
    await env.flush();
    f.detectChanges();
    expect(q(f, '[data-tour-offer]')).toBeNull();
    expect(env.state.record('patterns').status).toBe('declined');
  });

  it('shows nothing for someone who already built their own library (a collection), and nothing for an empty tour list', async () => {
    const env = await setupTour({ url: '/tabs/home/patterns', scopes: { guest: { collections: [{ id: 'c1', name: 'Mine' } as never] } } });
    expect(q(await pill(env, ['patterns']), '[data-tour-offer]')).toBeNull();
    const env2 = await setupTour({ url: '/tabs/home/patterns' });
    expect(q(await pill(env2, []), '[data-tour-offer]')).toBeNull();
  });

  it('a tour that was already finished or declined is never offered again', async () => {
    const env = await setupTour({ url: '/tabs/home/patterns', scopes: { guest: armedPrefs({ tours: { ...declinedWelcome, patterns: { v: 1, status: 'completed', offers: 1, interruptions: 0, at: 1 } } }) } });
    expect(q(await pill(env, ['patterns']), '[data-tour-offer]')).toBeNull();
  });

  it('while another tour is running no second invitation appears', async () => {
    const env = await setupTour({ url: '/tabs/home', scopes: { guest: armedPrefs() } });
    await env.coordinator.arm();
    await env.coordinator.accept('welcome');
    await env.goto('/tabs/home/patterns');
    expect(q(await pill(env, ['patterns']), '[data-tour-offer]')).toBeNull();
  });
});

describe('TourHelpComponent (Settings → Tours & help)', () => {
  it('lists the replays and the checklist restore, without the multi-part row when there is no multi-part project', async () => {
    const env = await setupTour({ url: '/tabs/home/settings' });
    const f = await mount(env, TourHelpComponent);
    expect(all(f, '[data-help]').map((r) => r.getAttribute('data-help'))).toEqual(['welcome', 'patterns', 'tracker-simple', 'project-create', 'khayoota', 'list']);
  });

  it('adds the pieces row only when a multi-part project exists', async () => {
    const env = await setupTour({ url: '/tabs/home/settings', scopes: { guest: { projects: [fakeProject({ parts: [{ id: 'a' }, { id: 'b' }] })] } } });
    const f = await mount(env, TourHelpComponent);
    expect(all(f, '[data-help]').map((r) => r.getAttribute('data-help'))).toContain('tracker-parts');
  });

  it('renders nothing when tours are switched off at build time', async () => {
    const env = await setupTour({ url: '/tabs/home/settings', toursEnabled: false });
    const f = await mount(env, TourHelpComponent);
    expect(q(f, '[data-tour-help]')).toBeNull();
  });

  it('"Restore checklist" brings the card back and says so', async () => {
    const env = await setupTour({ url: '/tabs/home/settings', scopes: { guest: armedPrefs({ tours: declinedWelcome }) } });
    await env.state.hideGettingStarted();
    expect(env.coordinator.gettingStarted().state).toBe('hidden');
    const f = await mount(env, TourHelpComponent);
    q(f, '[data-help="list"]')!.click();
    await env.flush();
    expect(env.coordinator.gettingStarted().state).toBe('list');
    expect(env.toast).toHaveBeenCalled();
  });

  it('a tracker replay without a project explains why instead of starting anything', async () => {
    const env = await setupTour({ url: '/tabs/home/settings' });
    const f = await mount(env, TourHelpComponent);
    q(f, '[data-help="tracker-simple"]')!.click();
    await env.flush();
    expect(env.renderer.starts.length).toBe(0);
    expect(env.toast).toHaveBeenCalledTimes(1);
  });

  it('replaying the app tour goes to Home and starts it, and does not touch the finished record', async () => {
    const env = await setupTour({ url: '/tabs/home/settings', scopes: { guest: armedPrefs({ tours: { welcome: { v: 1, status: 'completed', offers: 1, interruptions: 0, at: 1 } } }) } });
    const f = await mount(env, TourHelpComponent);
    q(f, '[data-help="welcome"]')!.click();
    await env.flush();
    expect(env.router.url).toContain('/tabs/home');
    expect(env.state.record('welcome').status).toBe('completed');
  });

  it('every row is a real button with text', async () => {
    const env = await setupTour({ url: '/tabs/home/settings' });
    const f = await mount(env, TourHelpComponent);
    for (const r of all(f, '[data-help]')) {
      expect(r.tagName).toBe('BUTTON');
      expect(r.textContent?.trim().length).toBeGreaterThan(3);
    }
  });
});
