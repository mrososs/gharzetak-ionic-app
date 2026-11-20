// The ONLY file that may reference driver.js. The package itself is imported lazily, when a tour actually starts, so the engine never
// weighs on normal start-up. Everything the rest of the app knows about the engine is the `TourRenderer` interface.
import type { Alignment, DestroyReason, DriveStep, Driver, PopoverDOM } from 'driver.js';
import type { EndReason, RenderCallbacks, RenderOptions, RenderStep, TourRenderer } from './tour.types';

/** How long a step waits for its target (page transitions, lazy data) before the step is skipped or the tour ends. */
const WAIT_MS = 2500;
/** The design rule: the popover keeps this far from the screen edge. */
const EDGE_PX = 16;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Driver.js behind the `TourRenderer` interface. It encodes what the Phase 0 device spike proved (docs/product-tour-discovery/phase-0-results.md):
 *  F1 a tap on the dimmed area must not close the tour                    → overlayClickBehavior 'none'
 *  F2 the highlighted element is live by default                          → disableActiveInteraction on every blocked step
 *  F3 `instruction` / `advanceOn` make Next inert                         → neither is used; an action step listens for the tap itself
 *  F4 default buttons are 23 px tall and the progress text reverses in RTL → own dots and 44 px buttons (theme/tour.scss)
 *  F5 the popover sat 10 px from the screen edge                          → clamped to 16 px
 *  S1 the highlight does not follow `ion-content` scrolling               → refresh() on the content's own scroll events
 * plus: logical (RTL-mirrored) alignment, own keyboard handling (arrow keys follow the reading direction), inert background for
 * blocked steps, focus restoration, and a DOM clean-up that does not depend on the engine having cleaned up after itself.
 */
export class DriverTourRenderer implements TourRenderer {
  private drv: Driver | null = null;
  private steps: readonly RenderStep[] = [];
  private options!: RenderOptions;
  private cb!: RenderCallbacks;
  private abort = new AbortController();
  private ended = true;
  private index = -1;
  private showToken = 0;
  private busy = false;
  private shownAny = false;
  private currentEl: Element | null = null;
  private lastStepId: string | undefined;
  private savedFocus: HTMLElement | null = null;
  private stepCleanups: (() => void)[] = [];
  private globalCleanups: (() => void)[] = [];
  private raf = 0;
  private inertSet = false;

  get active(): boolean {
    return !this.ended;
  }

  async start(steps: readonly RenderStep[], startIndex: number, options: RenderOptions, cb: RenderCallbacks): Promise<void> {
    if (!this.ended) this.stop('replaced');
    this.steps = steps;
    this.options = options;
    this.cb = cb;
    this.abort = new AbortController();
    this.ended = false;
    this.index = -1;
    this.shownAny = false;
    this.lastStepId = undefined;
    this.savedFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    let mod: typeof import('driver.js');
    try {
      mod = await import('driver.js');
    } catch (e) {
      this.ended = true;
      throw e;
    }
    if (this.ended) return; // stopped while the engine was loading
    try {
      this.drv = mod.driver(this.config());
      this.installGlobalListeners();
      await this.show(startIndex, 1);
    } catch (e) {
      this.finish('error');
      throw e;
    }
  }

  retext(options: Pick<RenderOptions, 'dir' | 'labels'>): void {
    if (this.ended) return;
    this.options = { ...this.options, ...options };
    const pop = this.popover();
    if (pop && this.index >= 0) this.applyTexts(pop, this.index);
    this.refresh();
  }

  refresh(): void {
    if (this.ended) return;
    try {
      this.drv?.refresh();
    } catch {
      /* a failed re-measure is not worth ending a tour for */
    }
  }

  stop(reason: EndReason): void {
    if (this.ended) {
      this.domCleanup(); // idempotent safety net
      return;
    }
    this.finish(reason);
  }

  // ---- engine configuration ---------------------------------------------------------------------------------------------------

  private config() {
    const o = this.options;
    const texts = (i: number) => o.textFor(i);
    const steps: DriveStep[] = this.steps.map((s, i) => ({
      element: () => this.currentEl as Element,
      disableActiveInteraction: s.interaction !== 'action',
      popover: {
        title: texts(i).title,
        description: texts(i).body,
        side: s.side === 'auto' ? undefined : s.side,
        align: this.physicalAlign(s.align),
      },
    }));
    return {
      steps,
      animate: !o.reducedMotion,
      duration: 250,
      popoverClass: 'gz-tour',
      overlayColor: '#35253e',
      overlayOpacity: 0.58,
      stagePadding: 6,
      stageRadius: 20,
      popoverOffset: 10,
      overlayClickBehavior: 'none' as const, // F1
      disableActiveInteraction: true, // F2 (an action step overrides it for itself)
      allowClose: true,
      allowKeyboardControl: false, // our own handler below: arrow keys follow the reading direction
      showProgress: false, // dots instead (F4)
      smoothScroll: false,
      nextBtnText: o.labels.next,
      prevBtnText: o.labels.prev,
      doneBtnText: o.labels.done,
      closeBtnLabel: o.labels.close,
      onNextClick: () => void this.goNext(),
      onDoneClick: () => this.finish('done'),
      onPrevClick: () => void this.goPrev(),
      onCloseClick: () => this.finish('close'),
      onPopoverRender: (pop: PopoverDOM, opts: { index: number | undefined }) => this.decorate(pop, opts.index ?? this.index),
      onPopoverPositioned: (pop: PopoverDOM) => this.clamp(pop), // F5
      onHighlighted: (_el: Element | undefined, _step: DriveStep, opts: { index: number | undefined }) => this.afterHighlight(opts.index ?? this.index),
      onDestroyed: (_el: Element | undefined, _step: DriveStep, opts: { reason?: DestroyReason }) => this.onEngineDestroyed(opts.reason),
    };
  }

  /** Steps say start/end (logical); the engine measures from the left. In RTL the two swap. */
  private physicalAlign(a: 'start' | 'center' | 'end'): Alignment {
    if (a === 'center' || this.options.dir === 'ltr') return a;
    return a === 'start' ? 'end' : 'start';
  }

  private popover(): PopoverDOM | undefined {
    return (this.drv?.getState('popover') as PopoverDOM | undefined) ?? undefined;
  }

  // ---- stepping ------------------------------------------------------------------------------------------------------------------

  /** Shows step `index`, or the next one in `dir` that has a target. Every wait is abortable; closing the tour ends it at once. */
  private async show(index: number, dir: 1 | -1): Promise<void> {
    const token = ++this.showToken;
    let i = index;
    while (i >= 0 && i < this.steps.length) {
      const step = this.steps[i];
      const el = await step.waitFor(WAIT_MS, this.abort.signal);
      if (this.ended || token !== this.showToken) return;
      if (el) {
        this.present(i, el);
        return;
      }
      this.cb.stepSkippedMissing(step.id);
      if (step.ifMissing === 'end') return this.finish('missing-target');
      i += dir;
    }
    if (dir === 1) this.finish(this.shownAny ? 'done' : 'missing-target');
    // Going back past the first step: the current step simply stays.
  }

  private present(i: number, el: Element): void {
    const drv = this.drv;
    if (!drv) return;
    const step = this.steps[i];
    this.runStepCleanups();
    this.currentEl = el;
    this.index = i;
    this.lastStepId = step.id;
    this.setInert(step.interaction !== 'action'); // blocked steps: nothing behind the dimmer can be reached by touch, keyboard or a screen reader
    this.attachScrollRefresh(el);
    this.attachActionTap(step, el);
    if (drv.isActive()) drv.moveTo(i);
    else drv.drive(i);
  }

  private afterHighlight(index: number): void {
    if (this.ended || index < 0) return;
    this.shownAny = true;
    this.cb.stepShown(this.steps[index].id, index, this.steps.length);
  }

  private async goNext(): Promise<void> {
    if (this.ended || this.busy) return;
    this.busy = true;
    try {
      if (this.index >= this.steps.length - 1) this.finish('done');
      else await this.show(this.index + 1, 1);
    } finally {
      this.busy = false;
    }
  }

  private async goPrev(): Promise<void> {
    if (this.ended || this.busy || this.index <= 0) return;
    this.busy = true;
    try {
      await this.show(this.index - 1, -1);
    } finally {
      this.busy = false;
    }
  }

  // ---- per-step behaviour -----------------------------------------------------------------------------------------------------------

  /** S1: the engine only watches `window` scrolling; Ionic scrolls inside `ion-content`, so re-measure on that scroller's events. */
  private attachScrollRefresh(el: Element): void {
    const content = el.closest('ion-content') as (HTMLElement & { getScrollElement?: () => Promise<HTMLElement> }) | null;
    if (!content?.getScrollElement) return;
    const token = this.showToken;
    void content.getScrollElement().then((sc) => {
      if (this.ended || token !== this.showToken) return;
      const onScroll = () => {
        if (this.raf) return;
        this.raf = requestAnimationFrame(() => {
          this.raf = 0;
          this.refresh();
        });
      };
      sc.addEventListener('scroll', onScroll, { passive: true });
      this.stepCleanups.push(() => sc.removeEventListener('scroll', onScroll));
    });
  }

  /** F3: the invited tap. A listener on the real control advances once, one frame after the app's own handler has run. Next always works too. */
  private attachActionTap(step: RenderStep, el: Element): void {
    if (step.interaction !== 'action') return;
    const at = this.index;
    const onTap = () =>
      requestAnimationFrame(() => {
        if (!this.ended && this.index === at) void this.goNext();
      });
    el.addEventListener('click', onTap, { once: true });
    this.stepCleanups.push(() => el.removeEventListener('click', onTap));
  }

  private runStepCleanups(): void {
    for (const f of this.stepCleanups.splice(0)) {
      try {
        f();
      } catch {
        /* ignore */
      }
    }
  }

  private setInert(on: boolean): void {
    const app = document.querySelector('ion-app');
    if (!app) return;
    app.toggleAttribute('inert', on);
    this.inertSet = on;
  }

  // ---- popover decoration ------------------------------------------------------------------------------------------------------------

  private decorate(pop: PopoverDOM, index: number): void {
    const step = this.steps[index];
    if (!step) return;
    pop.wrapper.querySelectorAll('.gz-tour-dots, .gz-tour-skip, .gz-tour-hint').forEach((n) => n.remove());
    const total = this.steps.length;

    const dots = document.createElement('span');
    dots.className = 'gz-tour-dots';
    dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < total; i++) {
      const d = document.createElement('i');
      d.className = i === index ? 'on' : i < index ? 'past' : '';
      dots.appendChild(d);
    }
    pop.footer.insertBefore(dots, pop.footer.firstChild);

    if (index < total - 1) {
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'gz-tour-skip';
      skip.addEventListener('click', () => this.finish('skip'));
      pop.footerButtons.insertBefore(skip, pop.footerButtons.firstChild);
    }
    if (step.interaction === 'action') {
      const hint = document.createElement('div');
      hint.className = 'gz-tour-hint';
      hint.setAttribute('role', 'note');
      pop.description.insertAdjacentElement('afterend', hint);
    }
    pop.wrapper.setAttribute('data-tour-step', step.id);
    pop.wrapper.setAttribute('aria-modal', step.interaction === 'action' ? 'false' : 'true');
    this.applyTexts(pop, index);
  }

  /** Text is written with textContent (never innerHTML) from the definition for the language that is current right now. */
  private applyTexts(pop: PopoverDOM, index: number): void {
    const t = this.options.textFor(index);
    const L = this.options.labels;
    pop.title.textContent = t.title;
    const sr = document.createElement('span');
    sr.className = 'gz-sr';
    sr.textContent = ` — ${L.progress(index + 1, this.steps.length)}`;
    pop.title.appendChild(sr);
    pop.description.textContent = t.body;
    const skip = pop.footerButtons.querySelector('.gz-tour-skip');
    if (skip) skip.textContent = L.skip;
    const hint = pop.wrapper.querySelector('.gz-tour-hint');
    if (hint) hint.textContent = t.hint ?? '';
    pop.nextButton.textContent = index >= this.steps.length - 1 ? L.done : L.next;
    pop.previousButton.textContent = L.prev;
    pop.closeButton.setAttribute('aria-label', L.close);
  }

  /** F5: the engine keeps ~10 px from the edge; the design says 16. */
  private clamp(pop: PopoverDOM): void {
    const w = pop.wrapper;
    const left = parseFloat(w.style.left);
    if (Number.isNaN(left)) return;
    const r = w.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    let dx = 0;
    if (r.left < EDGE_PX) dx = EDGE_PX - r.left;
    else if (r.right > vw - EDGE_PX) dx = vw - EDGE_PX - r.right;
    if (dx) w.style.left = `${left + dx}px`;
  }

  // ---- global behaviour ----------------------------------------------------------------------------------------------------------------

  private installGlobalListeners(): void {
    const onKey = (e: KeyboardEvent) => {
      if (this.ended) return;
      const inField = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if (e.key === 'Escape') {
        e.preventDefault();
        this.finish('close');
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !inField) {
        e.preventDefault();
        const forward = (e.key === 'ArrowRight') !== (this.options.dir === 'rtl'); // Left is "next" when reading right-to-left
        void (forward ? this.goNext() : this.goPrev());
      } else if (e.key === 'Tab' && this.inertSet) {
        const pop = this.popover();
        const items = pop ? Array.from(pop.wrapper.querySelectorAll<HTMLElement>(FOCUSABLE)) : [];
        if (!items.length) return;
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1;
        e.preventDefault();
        items[next].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    this.globalCleanups.push(() => document.removeEventListener('keydown', onKey, true));
  }

  private onEngineDestroyed(reason: DestroyReason | undefined): void {
    if (this.ended) return;
    const map: Record<DestroyReason, EndReason> = { done: 'done', close: 'close', escape: 'close', overlay: 'close', replaced: 'replaced', api: 'error' };
    this.finish(reason ? map[reason] : 'error');
  }

  // ---- teardown ---------------------------------------------------------------------------------------------------------------------------

  /** Every exit path ends here, exactly once. Nothing in it can throw, and the DOM is clean afterwards whatever the engine did. */
  private finish(reason: EndReason): void {
    if (this.ended) return;
    this.ended = true;
    this.showToken++;
    this.abort.abort();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.runStepCleanups();
    for (const f of this.globalCleanups.splice(0)) {
      try {
        f();
      } catch {
        /* ignore */
      }
    }
    if (this.inertSet) this.setInert(false);
    const drv = this.drv;
    this.drv = null;
    try {
      drv?.destroy();
    } catch {
      /* the DOM sweep below does not depend on it */
    }
    this.domCleanup();
    this.restoreFocus();
    const last = this.lastStepId;
    this.currentEl = null;
    try {
      this.cb.ended(reason, last);
    } catch {
      /* the app's own bookkeeping must not be able to wedge teardown */
    }
  }

  /** Removes anything of the engine that could still be on the page (a failed destroy must never leave a stuck overlay). */
  private domCleanup(): void {
    document.querySelectorAll('.driver-popover, .driver-overlay, .driver-live-region, .driver-layer, #driver-dummy-element').forEach((n) => n.remove());
    document.querySelectorAll('[class*="driver-"]').forEach((n) => {
      const keep = Array.from(n.classList).filter((c) => !c.startsWith('driver-'));
      if (keep.length) n.setAttribute('class', keep.join(' '));
      else n.removeAttribute('class');
    });
    document.querySelectorAll('[aria-controls="driver-popover-content"]').forEach((n) => ['aria-haspopup', 'aria-expanded', 'aria-controls'].forEach((a) => n.removeAttribute(a)));
    document.body.style.removeProperty('--driver-animation-duration');
    document.querySelector('ion-app')?.removeAttribute('inert');
  }

  private restoreFocus(): void {
    try {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return; // focus is somewhere real already
      const target = this.savedFocus && this.savedFocus.isConnected ? this.savedFocus : null;
      target?.focus({ preventScroll: true });
    } catch {
      /* focus restoration is a courtesy */
    }
  }
}
