import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { AppStore } from '../state/app.store';

/** A viewport shorter than this (landscape phone, big keyboard) cannot hold a popover and its target. */
export const MIN_TOUR_HEIGHT = 420;
/** After a counting tap the tracker is left alone for this long. */
export const COUNTING_QUIET_MS = 4000;

const OVERLAY_EVENTS = [
  'ionModalWillPresent', 'ionModalDidPresent', 'ionModalDidDismiss',
  'ionAlertWillPresent', 'ionAlertDidPresent', 'ionAlertDidDismiss',
  'ionActionSheetWillPresent', 'ionActionSheetDidDismiss',
  'ionPopoverWillPresent', 'ionPopoverDidDismiss',
  'ionLoadingWillPresent', 'ionLoadingDidDismiss',
  'ionPickerWillPresent', 'ionPickerDidDismiss',
] as const;

/** Ionic's presentable overlays. Toasts are deliberately absent: they are not interactive and render above everything. */
export const OVERLAY_SELECTOR = 'ion-modal, ion-alert, ion-action-sheet, ion-popover, ion-loading, ion-picker';

/** An Ionic overlay is on screen right now (inline overlays stay in the DOM with `.overlay-hidden` while closed). */
export function ionicOverlayOpen(doc: Document = document): boolean {
  for (const el of Array.from(doc.querySelectorAll(OVERLAY_SELECTOR))) if (!el.classList.contains('overlay-hidden')) return true;
  return false;
}

const isTextField = (t: EventTarget | undefined): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'ION-INPUT' || tag === 'ION-TEXTAREA') return true;
  if (tag === 'INPUT') return !['checkbox', 'radio', 'button', 'submit', 'range', 'file', 'color'].includes((t as HTMLInputElement).type);
  return false;
};

/**
 * "Is it safe to show anything right now?" — evaluated once, here. Every automatic invitation and every start passes through it:
 * never over splash, onboarding, auth, setup, the lock screen, a loading state, an Ionic overlay, the soft keyboard, a background
 * app, a navigation in flight, a viewport too small for a popover, or someone who is counting.
 */
@Injectable({ providedIn: 'root' })
export class TourGate {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly store = inject(AppStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly url = signal(this.router.url);
  readonly navigating = signal(false);
  /** Bumped by every Ionic overlay event so `overlayOpen` re-reads the DOM. */
  private readonly overlayTick = signal(0);
  private readonly visible = signal(typeof document === 'undefined' || document.visibilityState !== 'hidden');
  private readonly viewportHeight = signal(typeof innerHeight === 'number' ? innerHeight : 800);
  private readonly typing = signal(false);
  private readonly now = signal(Date.now());

  /** `/tabs/home/patterns?x=1` → `/tabs/home/patterns` */
  readonly path = computed(() => this.url().split(/[?#]/)[0]);
  readonly inApp = computed(() => this.path().startsWith('/tabs/'));
  readonly overlayOpen = computed(() => (this.overlayTick(), ionicOverlayOpen()));
  private readonly countedRecently = computed(() => {
    const last = this.store.currentProject()?.lastWorkedAt ?? 0;
    return this.now() - last < COUNTING_QUIET_MS;
  });

  /**
   * Why the PAGE is not settled enough to show a passive invitation (card, pill) in its normal flow: not in the app proper, a navigation in
   * flight, the lock screen, loading data, or the app in the background. Typing, sheets and counting do not hide an invitation (that would
   * make the page jump under a finger); they only prevent a tour from STARTING (`blockedBy`).
   */
  readonly idleBlockedBy = computed<string | null>(() => {
    if (!this.inApp()) return 'route';
    if (this.navigating()) return 'navigating';
    if (!this.auth.ready()) return 'auth';
    if (this.auth.locked()) return 'locked';
    if (!this.store.loaded() || this.store.scope() !== this.auth.scope()) return 'loading';
    if (!this.visible()) return 'hidden';
    return null;
  });
  readonly pageIdle = computed(() => this.idleBlockedBy() === null);

  /** The first reason it is not safe to start a tour, or null. Exposed so tests and the dev log can say why. */
  readonly blockedBy = computed<string | null>(() => {
    const idle = this.idleBlockedBy();
    if (idle) return idle;
    if (this.overlayOpen()) return 'overlay';
    if (this.typing()) return 'keyboard';
    if (this.viewportHeight() < MIN_TOUR_HEIGHT) return 'viewport';
    if (this.countedRecently()) return 'counting';
    return null;
  });
  readonly quiet = computed(() => this.blockedBy() === null);

  constructor() {
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((e) => {
      if (e instanceof NavigationStart) this.navigating.set(true);
      else if (e instanceof NavigationEnd) {
        this.url.set(e.urlAfterRedirects);
        this.navigating.set(false);
      } else if (e instanceof NavigationCancel || e instanceof NavigationError) this.navigating.set(false);
    });

    if (typeof document === 'undefined') return;
    const bump = () => this.overlayTick.update((n) => n + 1);
    const onVisibility = () => this.visible.set(document.visibilityState !== 'hidden');
    const onResize = () => this.viewportHeight.set(innerHeight);
    const onFocusIn = (e: Event) => this.typing.set(isTextField(e.composedPath()[0]));
    const onFocusOut = () => this.typing.set(false);
    // Inline Ionic overlays hydrate (and gain or lose `.overlay-hidden`) at their own pace, so the DOM is watched as well as the events:
    // otherwise a first read made during hydration would stay cached as "an overlay is open".
    const isOverlayNode = (n: Node) => n instanceof Element && n.matches(OVERLAY_SELECTOR);
    const observer = new MutationObserver((list) => {
      if (list.some((m) => (m.type === 'childList' ? [...m.addedNodes, ...m.removedNodes].some(isOverlayNode) : isOverlayNode(m.target)))) bump();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    this.destroyRef.onDestroy(() => observer.disconnect());
    for (const name of OVERLAY_EVENTS) document.addEventListener(name, bump, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    this.destroyRef.onDestroy(() => {
      for (const name of OVERLAY_EVENTS) document.removeEventListener(name, bump, true);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    });

    // Re-evaluate once the counting quiet period is over (a computed cannot watch the clock by itself).
    effect((onCleanup) => {
      if (!this.countedRecently()) return;
      const last = this.store.currentProject()?.lastWorkedAt ?? 0;
      const t = setTimeout(() => this.now.set(Date.now()), Math.max(50, last + COUNTING_QUIET_MS - Date.now() + 50));
      onCleanup(() => clearTimeout(t));
    });
  }
}
