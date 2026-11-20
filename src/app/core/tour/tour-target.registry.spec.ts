import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TourTargetRegistry, isOnVisiblePage } from './tour-target.registry';

/** jsdom has no layout: give an element a real-looking box (or none). */
function box(el: HTMLElement, w = 100, h = 40, x = 0, y = 0): HTMLElement {
  el.getBoundingClientRect = () => ({ x, y, width: w, height: h, top: y, left: x, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;
  return el;
}
const mk = (parent: HTMLElement, cls = ''): HTMLElement => {
  const el = document.createElement('button');
  if (cls) el.className = cls;
  parent.appendChild(el);
  return box(el);
};

describe('TourTargetRegistry', () => {
  let reg: TourTargetRegistry;
  let root: HTMLElement;
  beforeEach(() => {
    reg = new TourTargetRegistry();
    root = document.createElement('div');
    document.body.appendChild(root);
  });
  afterEach(() => root.remove());

  it('resolves a registered, visible element and forgets it when it is unregistered', () => {
    const el = mk(root);
    reg.register('tracker.tap', el);
    expect(reg.resolve('tracker.tap')).toBe(el);
    expect(reg.count('tracker.tap')).toBe(1);
    reg.unregister('tracker.tap', el);
    expect(reg.resolve('tracker.tap')).toBeNull();
    expect(reg.count('tracker.tap')).toBe(0);
  });

  it('never returns an element that is not in the document (a removed @if)', () => {
    const el = mk(root);
    reg.register('tracker.tap', el);
    el.remove();
    expect(reg.resolve('tracker.tap')).toBeNull();
  });

  it('never returns an element on an Ionic page cached behind the current one (Phase 0, S3)', () => {
    const hiddenPage = document.createElement('div');
    hiddenPage.className = 'ion-page ion-page-hidden';
    root.appendChild(hiddenPage);
    const el = mk(hiddenPage);
    reg.register('patterns.add', el);
    expect(reg.resolve('patterns.add')).toBeNull();
    hiddenPage.classList.remove('ion-page-hidden'); // the page becomes the active one again
    expect(reg.resolve('patterns.add')).toBe(el);
  });

  it('with the same id on a cached page and on the visible page, returns the visible one', () => {
    const cached = document.createElement('div');
    cached.className = 'ion-page ion-page-hidden';
    const active = document.createElement('div');
    active.className = 'ion-page';
    root.append(cached, active);
    const hiddenEl = mk(cached);
    const shownEl = mk(active);
    reg.register('tracker.undo', hiddenEl);
    reg.register('tracker.undo', shownEl);
    expect(reg.resolve('tracker.undo')).toBe(shownEl);
  });

  it('ignores hidden elements and elements with no box', () => {
    const hidden = mk(root);
    hidden.hidden = true;
    const flat = box(mk(root), 0, 0);
    reg.register('tab.learn', hidden);
    reg.register('tab.learn', flat);
    expect(reg.resolve('tab.learn')).toBeNull();
    expect(isOnVisiblePage(hidden)).toBe(false);
    expect(isOnVisiblePage(flat)).toBe(false);
  });

  it('is not fooled by an inert ancestor: the tour itself makes the app inert while a step shows, and must still find the next target', () => {
    const app = document.createElement('div');
    app.setAttribute('inert', '');
    root.appendChild(app);
    const el = mk(app);
    reg.register('tab.projects', el);
    expect(reg.resolve('tab.projects')).toBe(el);
  });

  it('whenReady waits for a late element, then for the box to hold still, and returns it', async () => {
    const el = mk(root);
    setTimeout(() => reg.register('tracker.ring', el), 60);
    const got = await reg.whenReady('tracker.ring', 2000, new AbortController().signal);
    expect(got).toBe(el);
  });

  it('whenReady gives up at the deadline with null when there is no element', async () => {
    const t0 = Date.now();
    const got = await reg.whenReady('khayoota.menu', 150, new AbortController().signal);
    expect(got).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it('whenReady stops at once when the tour is closed (abort)', async () => {
    const ac = new AbortController();
    const p = reg.whenReady('khayoota.menu', 60_000, ac.signal);
    setTimeout(() => ac.abort(), 40);
    const t0 = Date.now();
    expect(await p).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it('whenReady returns the element as it is at the deadline even if it is still moving (a page transition must not hang a tour)', async () => {
    const el = mk(root);
    let n = 0;
    el.getBoundingClientRect = () => ({ x: n++, y: 0, width: 100, height: 40, top: 0, left: n, right: 0, bottom: 0, toJSON: () => ({}) }) as DOMRect;
    reg.register('tracker.ring', el);
    expect(await reg.whenReady('tracker.ring', 200, new AbortController().signal)).toBe(el);
  });
});
