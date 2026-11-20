import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverTourRenderer } from './driver-tour-renderer';
import type { EndReason, RenderCallbacks, RenderLabels, RenderOptions, RenderStep } from './tour.types';

/** The real Driver.js against a small fake app shell (jsdom has no layout, scrolling or ResizeObserver: those are stubbed). */
const labels = (lang: 'en' | 'ar' = 'en'): RenderLabels =>
  lang === 'en'
    ? { next: 'Next', prev: 'Back', done: 'Done', skip: 'Skip', close: 'Close tour', progress: (n, t) => `Step ${n} of ${t}` }
    : { next: 'التالي', prev: 'السابق', done: 'تمام', skip: 'تخطّي', close: 'إغلاق الجولة', progress: (n, t) => `خطوة ${n} من ${t}` };

interface Shell {
  app: HTMLElement;
  els: HTMLElement[];
  steps: RenderStep[];
  events: { shown: string[]; missing: string[]; ended: { reason: EndReason; last: string | undefined }[] };
  cb: RenderCallbacks;
  options(over?: Partial<RenderOptions>): RenderOptions;
}

function shell(n: number, over: { interaction?: ('blocked' | 'action')[]; missing?: number[]; ifMissing?: ('skip' | 'end')[] } = {}): Shell {
  const app = document.createElement('ion-app');
  document.body.appendChild(app);
  const els = Array.from({ length: n }, (_, i) => {
    const b = document.createElement('button');
    b.textContent = `target ${i}`;
    b.getBoundingClientRect = () => ({ x: 10 + i * 20, y: 300, width: 60, height: 40, top: 300, left: 10 + i * 20, right: 70 + i * 20, bottom: 340, toJSON: () => ({}) }) as DOMRect;
    app.appendChild(b);
    return b;
  });
  const steps: RenderStep[] = els.map((el, i) => ({
    id: `t.s${i}`,
    waitFor: async () => (over.missing?.includes(i) ? null : el),
    side: 'auto',
    align: 'start',
    interaction: over.interaction?.[i] ?? 'blocked',
    ifMissing: over.ifMissing?.[i] ?? 'skip',
  }));
  const events: Shell['events'] = { shown: [], missing: [], ended: [] };
  const cb: RenderCallbacks = {
    stepShown: (id) => events.shown.push(id),
    stepSkippedMissing: (id) => events.missing.push(id),
    ended: (reason, last) => events.ended.push({ reason, last }),
  };
  const options = (o: Partial<RenderOptions> = {}): RenderOptions => ({
    dir: 'ltr',
    reducedMotion: true,
    labels: labels(),
    textFor: (i) => ({ title: `Title ${i}`, body: `Body ${i}`, hint: 'Try it' }),
    ...o,
  });
  return { app, els, steps, events, cb, options };
}

const popover = () => document.querySelector<HTMLElement>('.driver-popover');
const nextBtn = () => document.querySelector<HTMLButtonElement>('.driver-popover-next-btn')!;
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const frame = async () => {
  await tick(30);
  await tick(30);
};
const driverResidue = () => document.querySelectorAll('[class*="driver-"], .driver-popover, .driver-overlay, #driver-dummy-element').length;

describe('DriverTourRenderer (real Driver.js)', () => {
  let r: DriverTourRenderer;
  let sh: Shell;
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
    r = new DriverTourRenderer();
  });
  afterEach(() => {
    r.stop('error');
    sh?.app.remove();
    document.body.querySelectorAll('.driver-popover, .driver-overlay').forEach((n) => n.remove());
  });

  it('shows the first step with the app\'s own controls: step id, spoken progress, dots, Skip, 44px-class buttons, closed-world dialog semantics', async () => {
    sh = shell(3);
    await r.start(sh.steps, 0, sh.options(), sh.cb);
    await frame();
    const p = popover()!;
    expect(p).toBeTruthy();
    expect(p.getAttribute('data-tour-step')).toBe('t.s0');
    expect(p.getAttribute('aria-modal')).toBe('true');
    expect(p.classList.contains('gz-tour')).toBe(true);
    expect(p.querySelector('.driver-popover-title')?.textContent).toBe('Title 0 — Step 1 of 3');
    expect(p.querySelector('.driver-popover-title .gz-sr')?.textContent).toContain('Step 1 of 3');
    expect(p.querySelector('.driver-popover-description')?.textContent).toBe('Body 0');
    expect(p.querySelectorAll('.gz-tour-dots i').length).toBe(3);
    expect(p.querySelector('.gz-tour-dots i.on')).toBeTruthy();
    expect(p.querySelector('.gz-tour-dots')?.getAttribute('aria-hidden')).toBe('true');
    expect(p.querySelector('.gz-tour-skip')?.textContent).toBe('Skip');
    expect(p.querySelector('.driver-popover-close-btn')?.getAttribute('aria-label')).toBe('Close tour');
    expect(p.querySelector('.gz-tour-hint')).toBeNull(); // blocked step: no hint strip
    expect(sh.app.hasAttribute('inert')).toBe(true); // nothing behind the dimmer can be reached
    expect(sh.events.shown).toEqual(['t.s0']);
    expect(r.active).toBe(true);
  });

  it('Next walks the steps, the last button reads Done, Skip disappears on the last step, and finishing is "done"', async () => {
    sh = shell(3);
    await r.start(sh.steps, 0, sh.options(), sh.cb);
    await frame();
    nextBtn().click();
    await frame();
    expect(popover()!.getAttribute('data-tour-step')).toBe('t.s1');
    expect(popover()!.querySelector('.driver-popover-title')?.firstChild?.textContent).toBe('Title 1');
    nextBtn().click();
    await frame();
    expect(popover()!.getAttribute('data-tour-step')).toBe('t.s2');
    expect(nextBtn().textContent).toBe('Done');
    expect(popover()!.querySelector('.gz-tour-skip')).toBeNull();
    nextBtn().click();
    await frame();
    expect(sh.events.ended).toEqual([{ reason: 'done', last: 't.s2' }]);
    expect(sh.events.shown).toEqual(['t.s0', 't.s1', 't.s2']);
    expect(driverResidue()).toBe(0);
    expect(sh.app.hasAttribute('inert')).toBe(false);
    expect(r.active).toBe(false);
  });

  it('Back returns to the previous step', async () => {
    sh = shell(3);
    await r.start(sh.steps, 0, sh.options(), sh.cb);
    await frame();
    nextBtn().click();
    await frame();
    document.querySelector<HTMLButtonElement>('.driver-popover-prev-btn')!.click();
    await frame();
    expect(popover()!.getAttribute('data-tour-step')).toBe('t.s0');
  });

  it('Skip, ×, and Escape end it as skip / close / close, each leaving the DOM clean and the app interactive', async () => {
    for (const [how, expected] of [['skip', 'skip'], ['x', 'close'], ['esc', 'close']] as const) {
      sh = shell(3);
      r = new DriverTourRenderer();
      await r.start(sh.steps, 0, sh.options(), sh.cb);
      await frame();
      if (how === 'skip') popover()!.querySelector<HTMLButtonElement>('.gz-tour-skip')!.click();
      else if (how === 'x') popover()!.querySelector<HTMLButtonElement>('.driver-popover-close-btn')!.click();
      else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await frame();
      expect(sh.events.ended.map((e) => e.reason), how).toEqual([expected]);
      expect(driverResidue(), how).toBe(0);
      expect(sh.app.hasAttribute('inert'), how).toBe(false);
      sh.app.remove();
    }
  });

  it('a tap on the dimmed area does nothing (Phase 0, F1)', async () => {
    sh = shell(2);
    await r.start(sh.steps, 0, sh.options(), sh.cb);
    await frame();
    const overlay = document.querySelector('.driver-overlay')!;
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    overlay.querySelector('path')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await frame();
    expect(sh.events.ended).toEqual([]);
    expect(r.active).toBe(true);
  });

  it('arrow keys follow the reading direction: Right is next in English, Left is next in Arabic', async () => {
    sh = shell(3);
    await r.start(sh.steps, 0, sh.options(), sh.cb);
    await frame();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await frame();
    expect(popover()!.getAttribute('data-tour-step')).toBe('t.s1');
    r.stop('skip');
    sh.app.remove();

    sh = shell(3);
    r = new DriverTourRenderer();
    await r.start(sh.steps, 0, sh.options({ dir: 'rtl', labels: labels('ar') }), sh.cb);
    await frame();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await frame();
    expect(popover()!.getAttribute('data-tour-step')).toBe('t.s0'); // Right is "previous" when reading right to left (and there is none before step 0)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await frame();
    expect(popover()!.getAttribute('data-tour-step')).toBe('t.s1');
  });

  it('Arabic: right-to-left labels, a "start" alignment mirrored for the engine, and an Arabic close name', async () => {
    sh = shell(2);
    await r.start(sh.steps, 0, sh.options({ dir: 'rtl', labels: labels('ar') }), sh.cb);
    await frame();
    const p = popover()!;
    expect(nextBtn().textContent).toBe('التالي');
    expect(p.querySelector('.gz-tour-skip')?.textContent).toBe('تخطّي');
    expect(p.querySelector('.driver-popover-close-btn')?.getAttribute('aria-label')).toBe('إغلاق الجولة');
    expect(p.querySelector('.driver-popover-title .gz-sr')?.textContent).toContain('خطوة 1 من 2');
    expect(p.className).toMatch(/driver-popover-align-end/); // logical "start" is the engine's "end" in RTL
  });

  it('a missing target: "skip" steps are skipped silently, "end" steps end the tour, and an all-missing tour reports it', async () => {
    sh = shell(3, { missing: [1], ifMissing: ['skip', 'skip', 'skip'] });
    await r.start(sh.steps, 0, sh.options(), sh.cb);
    await frame();
    nextBtn().click();
    await frame();
    expect(sh.events.missing).toEqual(['t.s1']);
    expect(popover()!.getAttribute('data-tour-step')).toBe('t.s2');
    r.stop('skip');
    sh.app.remove();

    sh = shell(3, { missing: [1], ifMissing: ['skip', 'end', 'skip'] });
    r = new DriverTourRenderer();
    await r.start(sh.steps, 0, sh.options(), sh.cb);
    await frame();
    nextBtn().click();
    await frame();
    expect(sh.events.ended.map((e) => e.reason)).toEqual(['missing-target']);
    expect(driverResidue()).toBe(0);
    sh.app.remove();

    sh = shell(2, { missing: [0, 1] });
    r = new DriverTourRenderer();
    await r.start(sh.steps, 0, sh.options(), sh.cb);
    await frame();
    expect(sh.events.ended.map((e) => e.reason)).toEqual(['missing-target']);
    expect(popover()).toBeNull();
  });

  describe('the invited tap', () => {
    it('keeps the app interactive, shows the hint, leaves Next enabled, and one tap advances exactly once', async () => {
      sh = shell(3, { interaction: ['blocked', 'action', 'blocked'] });
      await r.start(sh.steps, 0, sh.options(), sh.cb);
      await frame();
      nextBtn().click();
      await frame();
      const p = popover()!;
      expect(p.getAttribute('data-tour-step')).toBe('t.s1');
      expect(sh.app.hasAttribute('inert')).toBe(false);
      expect(p.getAttribute('aria-modal')).toBe('false');
      expect(p.querySelector('.gz-tour-hint')?.textContent).toBe('Try it');
      expect(nextBtn().getAttribute('aria-disabled')).toBeNull(); // Phase 0, F3: the engine's own action mode makes Next inert
      let taps = 0;
      sh.els[1].addEventListener('click', () => taps++);
      sh.els[1].click();
      await frame();
      expect(taps).toBe(1);
      expect(popover()!.getAttribute('data-tour-step')).toBe('t.s2');
      expect(sh.events.shown).toEqual(['t.s0', 't.s1', 't.s2']); // advanced once, not twice
      expect(sh.app.hasAttribute('inert')).toBe(true); // the next, blocked step closes the app off again
      sh.els[1].click(); // a second tap is not the tour's business any more
      await frame();
      expect(sh.events.shown).toEqual(['t.s0', 't.s1', 't.s2']);
    });

    it('Next works without performing the action', async () => {
      sh = shell(3, { interaction: ['blocked', 'action', 'blocked'] });
      await r.start(sh.steps, 0, sh.options(), sh.cb);
      await frame();
      nextBtn().click();
      await frame();
      nextBtn().click();
      await frame();
      expect(popover()!.getAttribute('data-tour-step')).toBe('t.s2');
    });

    it('tapping then pressing Next at the same moment still advances only once', async () => {
      sh = shell(4, { interaction: ['action', 'blocked', 'blocked', 'blocked'] });
      await r.start(sh.steps, 0, sh.options(), sh.cb);
      await frame();
      sh.els[0].click();
      nextBtn().click();
      await frame();
      await frame();
      expect(popover()!.getAttribute('data-tour-step')).toBe('t.s1');
    });
  });

  it('text is written as text, never as markup (a step can never inject HTML)', async () => {
    sh = shell(1);
    await r.start(sh.steps, 0, sh.options({ textFor: () => ({ title: '<img src=x onerror=alert(1)>', body: '<b>bold</b><script>1</script>' }) }), sh.cb);
    await frame();
    expect(popover()!.querySelector('img')).toBeNull();
    expect(popover()!.querySelector('b')).toBeNull();
    expect(popover()!.querySelector('script')).toBeNull();
    expect(popover()!.querySelector('.driver-popover-description')?.textContent).toBe('<b>bold</b><script>1</script>');
  });

  it('Tab stays inside the popover while the app is closed off', async () => {
    sh = shell(2);
    await r.start(sh.steps, 0, sh.options(), sh.cb);
    await frame();
    const items = Array.from(popover()!.querySelectorAll<HTMLElement>('button:not([disabled])'));
    items[items.length - 1].focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[0]);
  });

  it('stop is idempotent and cleans up after itself, even if the engine\'s own teardown left things behind', async () => {
    sh = shell(2);
    await r.start(sh.steps, 0, sh.options(), sh.cb);
    await frame();
    r.stop('navigation');
    r.stop('navigation');
    r.stop('overlay');
    expect(sh.events.ended).toEqual([{ reason: 'navigation', last: 't.s0' }]);
    const stray = document.createElement('div');
    stray.className = 'driver-popover';
    document.body.appendChild(stray);
    sh.els[0].classList.add('driver-active-element', 'keep-me');
    sh.els[0].setAttribute('aria-controls', 'driver-popover-content');
    sh.els[0].setAttribute('aria-expanded', 'true');
    sh.app.setAttribute('inert', '');
    r.stop('error'); // already ended: only the safety sweep runs
    expect(driverResidue()).toBe(0);
    expect(sh.els[0].className).toBe('keep-me');
    expect(sh.els[0].hasAttribute('aria-controls')).toBe(false);
    expect(sh.app.hasAttribute('inert')).toBe(false);
  });

  it('stopping while the engine is still loading ends the tour once and never shows anything', async () => {
    sh = shell(2);
    const started = r.start(sh.steps, 0, sh.options(), sh.cb);
    r.stop('navigation');
    await started;
    await frame();
    expect(sh.events.ended).toHaveLength(1);
    expect(popover()).toBeNull();
    expect(driverResidue()).toBe(0);
  });

  it('starting a new tour while one is showing replaces it cleanly', async () => {
    sh = shell(2);
    await r.start(sh.steps, 0, sh.options(), sh.cb);
    await frame();
    await r.start(sh.steps, 1, sh.options(), sh.cb);
    await frame();
    expect(sh.events.ended.map((e) => e.reason)).toEqual(['replaced']);
    expect(document.querySelectorAll('.driver-popover')).toHaveLength(1);
    expect(popover()!.getAttribute('data-tour-step')).toBe('t.s1');
  });

  it('retext switches the words and direction of the open step', async () => {
    sh = shell(2);
    await r.start(sh.steps, 0, sh.options(), sh.cb);
    await frame();
    r.retext({ dir: 'rtl', labels: labels('ar') });
    expect(nextBtn().textContent).toBe('التالي');
    expect(popover()!.querySelector('.gz-tour-skip')?.textContent).toBe('تخطّي');
    expect(popover()!.querySelector('.driver-popover-title .gz-sr')?.textContent).toContain('خطوة 1 من 2');
  });

  it('after the tour focus goes back to where it was (or stays on a real element), never to nowhere', async () => {
    sh = shell(2);
    sh.els[0].focus();
    expect(document.activeElement).toBe(sh.els[0]);
    await r.start(sh.steps, 0, sh.options(), sh.cb);
    await frame();
    r.stop('skip');
    expect(document.activeElement).toBe(sh.els[0]);
  });

  it('a callback that throws cannot wedge teardown', async () => {
    sh = shell(2);
    const bad: RenderCallbacks = { ...sh.cb, ended: () => { throw new Error('app bookkeeping failed'); } };
    await r.start(sh.steps, 0, sh.options(), bad);
    await frame();
    expect(() => r.stop('skip')).not.toThrow();
    expect(driverResidue()).toBe(0);
    expect(sh.app.hasAttribute('inert')).toBe(false);
  });
});
