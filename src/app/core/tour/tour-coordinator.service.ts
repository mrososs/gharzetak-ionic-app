import { Injectable, InjectionToken, Injector, computed, effect, inject, signal, untracked } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { NavController } from '@ionic/angular';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { KhayootaService } from '../ai/khayoota.service';
import { I18nService } from '../i18n/i18n.service';
import { AppStore } from '../state/app.store';
import { SyncService } from '../sync/sync.service';
import { UiFeedback } from '../../shared/ui/feedback/toast.service';
import { GS_TASKS, GsTask, gsDoneCount, milestoneOf, newlyDone, taskDone } from './getting-started';
import { DefMeta, ONE_TOUR_PER_LAUNCH, canOffer, effectiveStatus, evidenceOf, recordOf } from './tour-eligibility';
import { MIN_TOUR_HEIGHT, TourGate } from './tour-gate.service';
import type { MilestoneId, TourId } from './tour-ids';
import { L, pick, renderLabels, resolveText } from './tour-labels';
import { TOUR_RENDERER } from './tour-renderer';
import { ALL_TOURS, definitionOf, routeMatches } from './tour-registry';
import { TOUR_EVENT_SINK } from './tour-event-sink';
import { TourStateService } from './tour-state.service';
import { TourTargetRegistry } from './tour-target.registry';
import type { EndReason, RenderStep, TourContext, TourDefinition, TourPrefs, TrackerLayout } from './tour.types';

/** Release kill switch (build-time, GZ_TOURS=0). Provided as a token so tests can switch it without rebuilding. */
export const TOURS_ENABLED = new InjectionToken<boolean>('TOURS_ENABLED', { providedIn: 'root', factory: () => environment.toursEnabled });

/** Backgrounded for longer than this ends a running tour; a quick switch away and back keeps it. */
export const BACKGROUND_GRACE_MS = 30_000;
const OVERLAY_WILL_PRESENT = ['ionModalWillPresent', 'ionAlertWillPresent', 'ionActionSheetWillPresent', 'ionPopoverWillPresent', 'ionLoadingWillPresent', 'ionPickerWillPresent'] as const;
/** The Khayoota page may take this long to learn what the server allows before its tour is offered. */
const KHAYOOTA_SETTLE_MS = 2500;

export interface TourOffer {
  readonly tour: TourId;
  readonly kind: 'first' | 'resume';
  readonly steps: number;
}

export type GsState = 'offer' | 'list' | 'done' | 'hidden';
export interface GsView {
  readonly state: GsState;
  readonly tasks: readonly { readonly id: GsTask; readonly done: boolean }[];
  readonly doneCount: number;
  readonly total: number;
}
const HIDDEN_VIEW: GsView = { state: 'hidden', tasks: [], doneCount: 0, total: GS_TASKS.length };

export type ReplayResult = 'started' | 'needs-project' | 'needs-parts' | 'unavailable';

interface ActiveTour {
  readonly def: TourDefinition;
  readonly replay: boolean;
  readonly cleanups: (() => void)[];
}

/**
 * The one public face of the product-tour system. Pages and UI components talk to this and nothing else: it decides who may be
 * offered what (pure rules in tour-eligibility), keeps the state, starts and ends tours, and makes sure a tour can never outlive the
 * situation it was started in (navigation, an Ionic overlay, the lock screen, a scope change, the background, Android Back, a viewport
 * too small for a popover). Every path that ends a tour goes through the renderer's `stop`, which always leaves the DOM clean.
 */
@Injectable({ providedIn: 'root' })
export class TourCoordinator {
  private readonly store = inject(AppStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly nav = inject(NavController);
  private readonly i18n = inject(I18nService);
  private readonly injector = inject(Injector);
  private readonly gate = inject(TourGate);
  private readonly state = inject(TourStateService);
  private readonly targets = inject(TourTargetRegistry);
  private readonly renderer = inject(TOUR_RENDERER);
  private readonly sink = inject(TOUR_EVENT_SINK);
  private readonly killed = !inject(TOURS_ENABLED);

  /** Two engine failures in one session switch automatic offers and starts off (the Getting Started list keeps working). */
  private readonly engineBroken = signal(false);
  private engineErrors = 0;
  readonly running = signal<{ tour: TourId; stepId: string } | null>(null);
  /** Reported by the tracker page: which of its layouts is on screen. */
  readonly trackerLayout = signal<TrackerLayout>('none');

  private active: ActiveTour | null = null;
  private starting = false;
  private readonly startedThisLaunch = signal(false);
  private readonly welcomeShownThisLaunch = signal(false);
  /** Bumped on every change of page: a pill counts once per visit. */
  private readonly visitId = signal(0);
  private readonly pillCounted = new Map<TourId, number>();
  private readonly khayootaWaited = signal(false);
  private seededFor: string | null = null;

  private readonly loadedScope = computed(() => this.store.loaded() && this.store.scope() === this.auth.scope());
  private readonly evidence = computed(() => evidenceOf({ projects: this.store.projects(), patterns: this.store.patterns(), collections: this.store.collections(), chat: this.store.chat() }));

  /** The tour system is switched on at all. */
  readonly enabled = computed(() => !this.killed);

  /** Home shows the welcome invitation (state A of the Getting Started card). */
  readonly welcomeOffer = computed(() => {
    if (this.killed || !this.loadedScope()) return false;
    if (this.running()?.tour === 'welcome') return true; // the card keeps its shape while its own tour runs
    if (this.engineBroken() || this.running()) return false;
    return canOffer(definitionOf('welcome'), this.state.prefs(), this.evidence(), this.welcomeShownThisLaunch()).ok;
  });

  /** What the Getting Started card should show. */
  readonly gettingStarted = computed<GsView>(() => {
    if (this.killed || !this.loadedScope()) return HIDDEN_VIEW;
    const prefs = this.state.prefs();
    if (!prefs?.armed || prefs.gettingStarted?.hiddenAt) return HIDDEN_VIEW;
    const done = taskDone({ milestones: prefs.milestones, projects: this.store.projects(), chat: this.store.chat() });
    const tasks = GS_TASKS.map((id) => ({ id, done: done[id] }));
    const doneCount = gsDoneCount(done);
    const base = { tasks, doneCount, total: GS_TASKS.length };
    if (doneCount === GS_TASKS.length) return prefs.gettingStarted?.completedAt && prefs.gettingStarted.completedAt >= this.launchedAt ? { state: 'done', ...base } : HIDDEN_VIEW;
    return { state: this.welcomeOffer() ? 'offer' : 'list', ...base };
  });

  private readonly launchedAt = Date.now();

  constructor() {
    // A page visit = a change of path. Pills count once per visit.
    effect(() => {
      this.gate.path();
      untracked(() => this.visitId.update((n) => n + 1));
    });

    // Khayoota learns what the server allows a moment after the tab opens; its tour waits for that (or for a short deadline).
    effect((onCleanup) => {
      if (this.gate.path() !== '/tabs/assistant') {
        untracked(() => this.khayootaWaited.set(false));
        return;
      }
      const t = setTimeout(() => this.khayootaWaited.set(true), KHAYOOTA_SETTLE_MS);
      onCleanup(() => clearTimeout(t));
    });

    // A scope has just finished loading. One effect decides, in this order (the order matters):
    //  1. Guest → account within one session: the account inherits the guest's tour state, once, if it has none of its own. A guest scope
    //     loaded at start-up for someone who was already signed in is never "the guest who just signed up" (auth.guest() was false then).
    //  2. A scope with no tour state yet: remember what is already known (so later deletions never re-offer a tour), and turn a tour a
    //     crash left "active" into an interruption.
    let snap: { scope: string; wasGuest: boolean; tour: TourPrefs | undefined } | null = null;
    effect(() => {
      if (this.killed || !this.loadedScope()) return;
      const scope = this.store.scope();
      const tour = this.store.prefs().tour;
      untracked(() => {
        const prev = snap;
        snap = { scope, wasGuest: this.auth.guest(), tour };
        if (prev && prev.wasGuest && prev.scope === 'guest' && scope.startsWith('user:') && !tour && prev.tour) {
          this.seededFor = scope;
          void this.state.adopt(prev.tour);
          return;
        }
        if (this.seededFor === scope && tour) return;
        this.seededFor = scope;
        void this.state.ensureSeeded(this.evidence(), ALL_TOURS);
      });
    });

    // The welcome invitation counts one launch when it is really on Home in front of the person.
    effect(() => {
      if (!this.welcomeOffer() || this.welcomeShownThisLaunch() || !this.gate.pageIdle() || this.gate.path() !== '/tabs/home') return;
      untracked(() => {
        this.welcomeShownThisLaunch.set(true);
        const def = definitionOf('welcome');
        this.sink.record({ name: 'tour_offered', tour: 'welcome', kind: 'home-card' });
        void this.state.noteOffered(def);
      });
    });

    // Getting Started: remember tasks that are true now (so Undo or a delete never un-ticks them), and note completion once. This works
    // from the stored state itself, not from the card's view (which is, by design, hidden once everything is done and acknowledged).
    effect(() => {
      if (this.killed || !this.loadedScope()) return;
      const prefs = this.state.prefs();
      if (!prefs?.armed || prefs.gettingStarted?.hiddenAt) return;
      const input = { milestones: prefs.milestones, projects: this.store.projects(), chat: this.store.chat() };
      untracked(() => {
        for (const t of newlyDone(input)) {
          this.sink.record({ name: 'gs_task_done', task: t });
          void this.state.mark(milestoneOf(t));
        }
        if (gsDoneCount(taskDone(input)) === GS_TASKS.length && !prefs.gettingStarted?.completedAt) {
          this.sink.record({ name: 'gs_completed' });
          void this.state.completeGettingStarted();
        }
      });
    });

    // Things that end a running tour on their own.
    effect(() => {
      const locked = this.auth.locked();
      untracked(() => {
        if (locked && this.renderer.active) this.stop('lock');
      });
    });
    let lastScope = this.auth.scope();
    effect(() => {
      const scope = this.auth.scope();
      untracked(() => {
        if (scope !== lastScope && this.renderer.active) this.stop('scope-change');
        lastScope = scope;
      });
    });
    // The language changed while a tour is open: new words, new direction.
    effect(() => {
      const lang = this.i18n.lang();
      untracked(() => {
        if (this.renderer.active) this.renderer.retext({ dir: lang === 'ar' ? 'rtl' : 'ltr', labels: renderLabels(lang) });
      });
    });
  }

  // ---- context --------------------------------------------------------------------------------------------------------------------

  /** `hasProjects` means "has an unfinished project". The Khayoota mode is read from the status line itself: the one machine-readable truth. */
  private buildCtx(): TourContext {
    const lang = this.i18n.lang();
    const kh = this.khayootaSettled();
    return {
      lang,
      guest: this.auth.guest() && !this.auth.signedIn(),
      hasProjects: this.store.projects().some((p) => p.status !== 'done'),
      trackerLayout: this.trackerLayout(),
      khayootaMode: this.targets.resolve('khayoota.status')?.getAttribute('data-mode') ?? '',
      khayootaSettled: kh,
    };
  }

  private khayootaSettled(): boolean {
    if (this.gate.path() !== '/tabs/assistant') return false;
    if (this.khayootaWaited() || !this.auth.signedIn()) return true;
    const kh = this.injector.get(KhayootaService);
    return !kh.configured || kh.status() !== null || kh.statusError() !== null;
  }

  // ---- invitations ------------------------------------------------------------------------------------------------------------------

  /**
   * The invitation pill for the first of these tours that applies on this page right now, or null. Read inside a `computed`.
   * A pill is a passive, in-flow element: it needs only a settled PAGE (`pageIdle`), never a tour-safe moment.
   */
  pillOffer(tours: readonly TourId[]): TourOffer | null {
    if (this.killed || this.engineBroken() || this.running()) return null;
    if (ONE_TOUR_PER_LAUNCH && this.startedThisLaunch()) return null;
    if (!this.gate.pageIdle() || !this.loadedScope()) return null;
    const ctx = this.buildCtx();
    const prefs = this.state.prefs();
    const ev = this.evidence();
    const visit = this.visitId();
    for (const id of tours) {
      const def = definitionOf(id);
      if (!routeMatches(def, this.gate.path()) || !def.canRun(ctx)) continue;
      const d = canOffer(def, prefs, ev, this.pillCounted.get(id) === visit);
      if (d.ok) return { tour: id, kind: d.kind, steps: def.steps.length };
    }
    return null;
  }

  /** A pill is on screen for this visit: count it once. */
  notePillShown(offer: TourOffer): void {
    const visit = this.visitId();
    if (this.pillCounted.get(offer.tour) === visit) return;
    this.pillCounted.set(offer.tour, visit);
    this.sink.record({ name: 'tour_offered', tour: offer.tour, kind: offer.kind });
    void this.state.noteOffered(definitionOf(offer.tour));
  }

  /** "Not now" / × on an invitation. */
  async decline(tour: TourId): Promise<void> {
    this.sink.record({ name: 'tour_declined', tour, via: 'not-now' });
    await this.state.noteDeclined(definitionOf(tour));
  }

  /** Whether a start would be safe right now (the full quiet gate). */
  canStartNow(): boolean {
    return !this.killed && !this.engineBroken() && !this.starting && !this.renderer.active && this.gate.quiet();
  }

  // ---- starting ------------------------------------------------------------------------------------------------------------------------

  /** The person tapped "Start" on an invitation. */
  async accept(tour: TourId): Promise<boolean> {
    if (!this.canStartNow()) return false;
    const def = definitionOf(tour);
    const rec = this.state.record(tour);
    const resumeAt = rec.status === 'interrupted' ? rec.step : undefined;
    return (await this.run(def, { source: 'offer', replay: false, resumeAt })) === 'started';
  }

  /**
   * Settings → replay. Goes to the tour's screen first, waits (with a deadline, never a fixed sleep) until it is safe, then starts. A replay
   * never changes a finished record to anything worse and does not count as the launch's one automatic tour.
   */
  async replay(tour: TourId): Promise<ReplayResult> {
    if (this.killed || this.engineBroken()) return 'unavailable';
    let id = tour;
    const project = this.store.currentProject();
    const isTracker = tour === 'tracker-simple' || tour === 'tracker-pattern' || tour === 'tracker-parts';
    if (isTracker && !project) return 'needs-project';
    if (tour === 'tracker-parts' && !project?.parts?.length) return 'needs-parts';
    if (this.renderer.active) this.stop('replaced');

    const first = definitionOf(tour);
    if (!routeMatches(first, this.gate.path())) {
      try {
        await (first.entry.mode === 'root' ? this.nav.navigateRoot(first.entry.url) : this.nav.navigateForward(first.entry.url));
      } catch {
        return 'unavailable';
      }
    }
    if (!(await this.whenQuiet(4000))) return 'unavailable';

    if (isTracker && tour !== 'tracker-parts') {
      // The tracker has several layouts: pick the tour that matches what is on screen.
      if (!(await this.when(() => this.trackerLayout() !== 'none', 3000))) return 'needs-project';
      const layout = this.trackerLayout();
      id = layout === 'pattern' || layout === 'parts-pattern' ? 'tracker-pattern' : 'tracker-simple';
    }
    const result = await this.run(definitionOf(id), { source: 'settings', replay: true });
    return result === 'started' ? 'started' : 'unavailable';
  }

  private async run(def: TourDefinition, o: { source: 'offer' | 'settings'; replay: boolean; resumeAt?: string }): Promise<'started' | 'unavailable'> {
    if (this.killed || this.engineBroken() || this.starting || this.renderer.active) return 'unavailable';
    this.starting = true;
    try {
      const ctx = this.buildCtx();
      if (!def.canRun(ctx) || !routeMatches(def, this.gate.path())) return 'unavailable';
      const defs = def.steps.filter((s) => !s.when || s.when(ctx));
      if (!defs.length) return 'unavailable';
      const steps: RenderStep[] = defs.map((s) => ({
        id: s.id,
        waitFor: (ms, signal) => this.targets.whenReady(s.target, ms, signal),
        side: s.side ?? 'auto',
        align: s.align ?? 'center',
        interaction: s.interaction ?? 'blocked',
        ifMissing: s.ifMissing,
        stage: s.stage,
      }));
      const startIndex = Math.max(0, defs.findIndex((s) => s.id === o.resumeAt));
      const textFor = (i: number) => {
        const c = this.buildCtx();
        const lang = this.i18n.lang();
        const s = defs[i];
        return { title: pick(resolveText(s.title, c), lang), body: pick(resolveText(s.body, c), lang), hint: s.hint ? pick(resolveText(s.hint, c), lang) : undefined };
      };

      const active: ActiveTour = { def, replay: o.replay, cleanups: [] };
      this.active = active;
      if (!o.replay) await this.state.noteStarted(def);
      if (o.source === 'offer') this.startedThisLaunch.set(true);
      this.sink.record(o.replay ? { name: 'tour_replayed', tour: def.id } : { name: 'tour_started', tour: def.id, source: o.source });
      this.running.set({ tour: def.id, stepId: defs[startIndex].id });
      this.armGuards(active);

      const lang = this.i18n.lang();
      await this.renderer.start(
        steps,
        startIndex,
        { dir: lang === 'ar' ? 'rtl' : 'ltr', reducedMotion: this.prefersReducedMotion(), textFor, labels: renderLabels(lang) },
        {
          stepShown: (id, index, total) => {
            this.running.set({ tour: def.id, stepId: id });
            this.sink.record({ name: 'tour_step_viewed', tour: def.id, step: id, index });
            void this.state.noteStep(def, id);
            void total;
          },
          stepSkippedMissing: (id) => this.sink.record({ name: 'tour_target_missing', tour: def.id, step: id }),
          ended: (reason, last) => this.onEnded(active, reason, last),
        },
      );
      return 'started';
    } catch {
      // The engine failed to load or start. If the adapter already ended the tour it has been counted; otherwise count it now.
      if (this.active) this.onEnded(this.active, 'error', this.running()?.stepId);
      return 'unavailable';
    } finally {
      this.starting = false;
    }
  }

  private prefersReducedMotion(): boolean {
    const os = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return os || this.store.prefs().joy?.motion === 'reduced';
  }

  // ---- ending ------------------------------------------------------------------------------------------------------------------------------

  /** Ends a running tour (or just clears guards if none is running). Always safe to call. */
  stop(reason: EndReason): void {
    try {
      this.renderer.stop(reason);
    } catch {
      /* the renderer's own teardown is exception-safe; this is the last line */
    }
    if (!this.renderer.active && this.active) this.onEnded(this.active, reason, this.running()?.stepId);
  }

  private onEnded(active: ActiveTour, reason: EndReason, last: string | undefined): void {
    if (this.active !== active) return; // already handled
    this.active = null;
    for (const f of active.cleanups.splice(0)) {
      try {
        f();
      } catch {
        /* ignore */
      }
    }
    this.running.set(null);
    const def = active.def;
    if (reason === 'error') {
      this.engineErrors++;
      if (this.engineErrors >= 2) this.engineBroken.set(true);
    }
    void this.state.noteEnded(def, reason, last, active.replay);
    if (reason === 'done') this.sink.record({ name: 'tour_completed', tour: def.id });
    else if (reason === 'skip' || reason === 'close' || reason === 'back') this.sink.record({ name: 'tour_skipped', tour: def.id, step: last ?? '', via: reason });
    else this.sink.record({ name: 'tour_interrupted', tour: def.id, step: last, reason });
    if (reason === 'done' && def.onComplete === 'toast-welcome-done') void this.injector.get(UiFeedback).toast(pick(L.welcomeDone, this.i18n.lang()));
  }

  // ---- guards for a running tour -------------------------------------------------------------------------------------------------------------

  private armGuards(a: ActiveTour): void {
    const stop = (r: EndReason) => () => this.stop(r);
    const nav = this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) this.stop('navigation'); // the tour never navigates while it is running
      else if (e instanceof NavigationEnd && !routeMatches(a.def, e.urlAfterRedirects)) this.stop('navigation');
    });
    a.cleanups.push(() => nav.unsubscribe());

    // An Ionic overlay is about to appear: leave first, so it is never left behind an untappable dimmer (Phase 0, S2).
    for (const name of OVERLAY_WILL_PRESENT) {
      const h = stop('overlay');
      document.addEventListener(name, h, true);
      a.cleanups.push(() => document.removeEventListener(name, h, true));
    }

    // Android hardware Back closes the tour instead of navigating (Phase 0, S7). Ionic runs the highest priority first.
    const onBack = (ev: Event) => (ev as CustomEvent<{ register: (priority: number, handler: () => void) => void }>).detail.register(100, () => this.stop('back'));
    document.addEventListener('ionBackButton', onBack);
    a.cleanups.push(() => document.removeEventListener('ionBackButton', onBack));

    // Background: a quick switch keeps the tour, a long one ends it.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') timer = setTimeout(() => this.stop('background'), BACKGROUND_GRACE_MS);
      else {
        clearTimeout(timer);
        this.renderer.refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    a.cleanups.push(() => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    });

    // A viewport too short for a popover (landscape phone): leave. Otherwise re-measure.
    const onResize = () => (innerHeight < MIN_TOUR_HEIGHT ? this.stop('viewport') : this.renderer.refresh());
    window.addEventListener('resize', onResize);
    a.cleanups.push(() => window.removeEventListener('resize', onResize));
  }

  // ---- waiting (conditions with deadlines, never fixed sleeps) ----------------------------------------------------------------------------

  private async when(cond: () => boolean, timeoutMs: number): Promise<boolean> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (cond()) return true;
      await new Promise<void>((r) => setTimeout(r, 40));
    }
    return cond();
  }

  private whenQuiet(timeoutMs: number): Promise<boolean> {
    return this.when(() => this.gate.quiet(), timeoutMs);
  }

  // ---- milestones, Getting Started, arming -------------------------------------------------------------------------------------------------------

  /** A real action happened (a sample pattern was opened, a tutorial was opened). */
  async mark(id: MilestoneId): Promise<void> {
    if (this.killed) return;
    await this.state.mark(id);
  }

  /** Entry event: a guest started, an account was created, a Google account is new. From now on the welcome tour may be offered. */
  async arm(): Promise<void> {
    if (this.killed) return;
    await this.store.whenScopeLoaded(this.auth.scope());
    await this.state.arm(this.evidence());
  }

  /**
   * A plain sign-in on a device: arm only for an account that is demonstrably new — it never finished or skipped setup, and, once the
   * first sync has settled, it holds no data. Never blocks the sign-in.
   */
  async armIfFreshAccount(): Promise<void> {
    if (this.killed) return;
    await this.store.whenScopeLoaded(this.auth.scope());
    await this.waitForFirstSync(8000);
    if (this.store.profile().onboarded) return;
    await this.state.arm(this.evidence());
  }

  private async waitForFirstSync(timeoutMs: number): Promise<void> {
    const sync = this.injector.get(SyncService);
    if (!sync.active()) return;
    const start = Date.now();
    let sawSyncing = false;
    while (Date.now() - start < timeoutMs) {
      const s = sync.state();
      if (s === 'syncing') sawSyncing = true;
      if ((s === 'idle' || s === 'offline' || s === 'error') && (sawSyncing || Date.now() - start > 1500)) return;
      await new Promise<void>((r) => setTimeout(r, 100));
    }
  }

  async hideGettingStarted(): Promise<void> {
    this.sink.record({ name: 'gs_hidden' });
    await this.state.hideGettingStarted();
  }

  async restoreGettingStarted(): Promise<void> {
    this.sink.record({ name: 'gs_restored' });
    await this.state.restoreGettingStarted();
  }

  /** A Getting Started row was tapped: go where that task is done. Nothing is created or changed for the user. */
  async openTask(task: GsTask): Promise<void> {
    switch (task) {
      case 'pattern':
        await this.nav.navigateForward('/tabs/home/patterns');
        break;
      case 'project':
        await this.nav.navigateForward('/tabs/projects/new');
        break;
      case 'tracker':
        await (this.store.currentProject() ? this.nav.navigateRoot('/tabs/tracker') : this.nav.navigateForward('/tabs/projects/new'));
        break;
      case 'learn':
        await this.nav.navigateRoot('/tabs/learn');
        break;
      case 'khayoota':
        await this.nav.navigateRoot('/tabs/assistant');
        break;
    }
  }

  /** Called by the tracker page whenever its layout changes (and reset when it goes away). */
  setTrackerLayout(layout: TrackerLayout): void {
    this.trackerLayout.set(layout);
  }

  /** The effective status of a tour in this scope (derived rules applied). For tests and the developer event view. */
  statusOf(tour: TourId): string {
    const def: DefMeta = definitionOf(tour);
    return effectiveStatus(recordOf(this.state.prefs(), tour), def, false);
  }
}
