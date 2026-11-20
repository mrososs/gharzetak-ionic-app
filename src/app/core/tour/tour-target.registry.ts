import { Injectable } from '@angular/core';
import type { TargetId } from './tour-ids';

/** One animation frame, with a timer fallback so a background or test page can never hang a wait. */
export const nextFrame = (): Promise<void> =>
  new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
    setTimeout(go, 50);
  });

/**
 * Visible = in the document, not on an Ionic page that is cached behind the current one (`.ion-page-hidden`), not `hidden`, and with a
 * real box. Ionic keeps previous pages in the DOM, so a plain selector can match an element nobody can see (Phase 0, S3).
 * `inert` is deliberately NOT checked: the renderer makes the app inert during a blocked step and must still find the next target.
 */
export function isOnVisiblePage(el: Element): boolean {
  if (!el.isConnected) return false;
  if (el.closest('.ion-page-hidden, [hidden]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

const sameBox = (a: DOMRect, b: DOMRect): boolean => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

/**
 * Elements register themselves through `[gzTour]`. The registry, not a CSS selector, decides which element a step highlights, so a
 * target on a cached page, in a removed `@if`, or duplicated in two tab stacks can never be picked by mistake.
 */
@Injectable({ providedIn: 'root' })
export class TourTargetRegistry {
  private readonly map = new Map<TargetId, Set<HTMLElement>>();

  register(id: TargetId, el: HTMLElement): void {
    let set = this.map.get(id);
    if (!set) this.map.set(id, (set = new Set()));
    set.add(el);
  }

  unregister(id: TargetId, el: HTMLElement): void {
    const set = this.map.get(id);
    if (!set) return;
    set.delete(el);
    if (!set.size) this.map.delete(id);
  }

  /** The registered element for this id that is on the visible page, or null. */
  resolve(id: TargetId): HTMLElement | null {
    const set = this.map.get(id);
    if (!set) return null;
    for (const el of set) if (isOnVisiblePage(el)) return el;
    return null;
  }

  /** Test and debugging aid: how many elements are registered for an id (visible or not). */
  count(id: TargetId): number {
    return this.map.get(id)?.size ?? 0;
  }

  /**
   * Resolves with the target once it is visible and has held its box still for two frames (page transitions finished), or with the
   * element as it is at the deadline, or null when there is none. Closing the tour aborts the wait. No fixed sleeps.
   */
  async whenReady(id: TargetId, timeoutMs: number, signal: AbortSignal): Promise<HTMLElement | null> {
    const deadline = Date.now() + timeoutMs;
    let last: DOMRect | null = null;
    let steady = 0;
    while (!signal.aborted) {
      const el = this.resolve(id);
      if (el) {
        const box = el.getBoundingClientRect();
        steady = last && sameBox(last, box) ? steady + 1 : 0;
        last = box;
        if (steady >= 2) return el;
      } else {
        last = null;
        steady = 0;
      }
      if (Date.now() > deadline) return this.resolve(id);
      await nextFrame();
    }
    return null;
  }
}
