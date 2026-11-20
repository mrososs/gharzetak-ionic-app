import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

export type Lang = 'ar' | 'en';
export const LANGS: readonly Lang[] = ['ar', 'en'];

export const GUEST_BUTTON: Record<Lang, string> = { ar: 'المتابعة كضيفة', en: 'Continue as guest' };

/** Every request the page makes, so a test can prove nothing left the device. */
export interface Traffic {
  readonly urls: string[];
  /** Requests that are not served by the app itself (fonts excluded: they are static assets, not data). */
  external(): string[];
  /** Anything that looks like an AI / assistant / backend call. */
  aiCalls(): string[];
}

export function watchTraffic(page: Page, origin: string): Traffic {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  const external = () => urls.filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:') && !/fonts\.(googleapis|gstatic)\.com/.test(u) && !u.startsWith('ws://localhost') && !u.startsWith('about:'));
  return { urls, external, aiCalls: () => urls.filter((u) => /\/(ai|assistant|v1)\b|khayoota|anthropic|openai/i.test(new URL(u).pathname + new URL(u).hostname)) };
}

/** A person opening the app for the first time and choosing "continue as guest" (the entry event that arms the welcome offer). */
export async function newGuest(page: Page, context: BrowserContext, lang: Lang): Promise<void> {
  await context.addInitScript((l) => {
    try {
      if (!localStorage.getItem('gz.lang')) localStorage.setItem('gz.lang', l);
    } catch {
      /* private mode */
    }
  }, lang);
  const guest = page.getByRole('button', { name: GUEST_BUTTON[lang] });
  for (let attempt = 0; ; attempt++) {
    // The dev server compiles lazily, so the very first load under parallel workers can be slow: wait, then retry once.
    await page.goto('/auth/login');
    try {
      await guest.waitFor({ state: 'visible', timeout: 25_000 });
      break;
    } catch (e) {
      if (attempt >= 1) throw e;
    }
  }
  await guest.click();
  await page.waitForURL(/\/tabs\/home/);
  await expect(page.locator('ion-app')).toBeVisible();
}

/** The Getting Started card is the one stable thing on Home for a new person. */
export const card = (page: Page): Locator => page.locator('[data-gs]');
export const popover = (page: Page): Locator => page.locator('.driver-popover');
export const stepId = async (page: Page): Promise<string | null> => popover(page).first().getAttribute('data-tour-step');
export const nextButton = (page: Page): Locator => page.locator('.driver-popover-next-btn');
export const prevButton = (page: Page): Locator => page.locator('.driver-popover-prev-btn');
export const skipButton = (page: Page): Locator => page.locator('.driver-popover .gz-tour-skip');
export const closeButton = (page: Page): Locator => page.locator('.driver-popover-close-btn');

export async function waitForStep(page: Page, id: string): Promise<void> {
  await expect(popover(page)).toHaveAttribute('data-tour-step', id);
}

/** Everything Driver.js leaves in the page while a tour runs. After a tour ends this must all be gone. */
export async function residue(page: Page): Promise<{ popovers: number; overlays: number; active: number; inert: boolean; dummy: number; classes: number }> {
  return page.evaluate(() => ({
    popovers: document.querySelectorAll('.driver-popover').length,
    overlays: document.querySelectorAll('.driver-overlay').length,
    active: document.querySelectorAll('.driver-active-element').length,
    inert: !!document.querySelector('ion-app')?.hasAttribute('inert'),
    dummy: document.querySelectorAll('#driver-dummy-element').length,
    classes: document.querySelectorAll('[class*="driver-fade"], [class*="driver-simple"], body.driver-active, html.driver-active').length,
  }));
}

export async function expectClean(page: Page): Promise<void> {
  await expect.poll(() => residue(page), { message: 'no tour leftovers in the page' }).toEqual({ popovers: 0, overlays: 0, active: 0, inert: false, dummy: 0, classes: 0 });
}

/** The tour's persisted state for the guest scope, read straight from IndexedDB (what survives a restart). */
export async function storedTour(page: Page, scope = 'guest'): Promise<{ prefs?: { tour?: Record<string, any> }; tourEvents?: any[] } | null> {
  return page.evaluate(
    (s) =>
      new Promise((resolve) => {
        const open = indexedDB.open('gharzetak');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('docs')) {
            db.close();
            return resolve(null);
          }
          const req = db.transaction('docs', 'readonly').objectStore('docs').get(s);
          req.onsuccess = () => {
            db.close();
            resolve(((req.result as { v?: unknown } | undefined)?.v ?? null) as never);
          };
          req.onerror = () => {
            db.close();
            resolve(null);
          };
        };
      }) as Promise<never>,
    scope,
  );
}

/** Everything in one object store of the app's IndexedDB (what survives a restart). */
export async function storedAll<T = any>(page: Page, store: 'projects' | 'patterns' | 'collections' | 'docs'): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<unknown[]>((resolve) => {
        const open = indexedDB.open('gharzetak');
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(name)) {
            db.close();
            return resolve([]);
          }
          const req = db.transaction(name, 'readonly').objectStore(name).getAll();
          req.onsuccess = () => {
            db.close();
            resolve((req.result as { v: unknown }[]).map((r) => r.v));
          };
          req.onerror = () => {
            db.close();
            resolve([]);
          };
        };
      }) as Promise<never[]>,
    store,
  ) as Promise<T[]>;
}

/** Runs `fn` in the page with the app's store (dev build only: found through Angular's debug hooks). Used only to seed synthetic data. */
export async function withStore<A, R>(page: Page, fn: (store: any, arg: A) => R | Promise<R>, arg: A): Promise<R> {
  return page.evaluate(
    async ({ src, arg: a }) => {
      const ng = (window as any).ng;
      let store: any;
      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (!el.tagName.startsWith('GZ-')) continue;
        const c = ng?.getComponent?.(el);
        if (c?.store?.addCollection && c.store.projects) {
          store = c.store;
          break;
        }
      }
      if (!store) throw new Error('the app store was not found (is this a dev build?)');
      return await new Function('store', 'arg', `return (${src})(store, arg)`)(store, a);
    },
    { src: fn.toString(), arg },
  ) as Promise<R>;
}

/** Creates a project through the real "new project" form. A pattern text makes it a pattern-mode project; none makes it a simple counter. */
export async function createProjectViaUi(page: Page, name: string, o: { pattern?: string; collection?: string } = {}): Promise<void> {
  await page.goto(`/tabs/projects/new${o.collection ? `?collection=${o.collection}` : ''}`);
  await page.locator('#np-name input').fill(name);
  if (o.pattern) await page.locator('#np-pat').fill(o.pattern);
  await page.locator('form button[type="submit"]').click();
  await expect.poll(() => page.url(), { message: 'the project was saved' }).not.toMatch(/\/projects\/new/);
}

/** A multi-part collection (two parts, three pieces) added through the store. */
export async function seedCollection(page: Page): Promise<string> {
  return withStore(
    page,
    async (store, _: null) => {
      const id = crypto.randomUUID();
      const now = Date.now();
      await store.addCollection({
        id,
        name: 'QA bear',
        description: '',
        level: 'beginner',
        terms: 'us',
        coverLocalUrl: null,
        rev: 1,
        suggestedMinutes: 0,
        sourceText: '',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        parts: [
          { id: crypto.randomUUID(), name: 'Head', quantity: 1, text: 'R1: 6sc in MR [6]\nR2: inc x 6 [12]', assemblyNotes: '' },
          { id: crypto.randomUUID(), name: 'Arms', quantity: 2, text: 'R1: 6sc in MR [6]\nR2: 6sc [6]', assemblyNotes: '' },
        ],
      });
      return id;
    },
    null,
  );
}

export type TabId ='home' | 'projects' | 'tracker' | 'learn' | 'assistant';

/** A tab-bar button. (Ionic does not reflect `tab` as an attribute, so projects/tracker/learn/Khayoota are found by their tour marker.) */
export const tabButton = (page: Page, id: TabId): Locator => (id === 'home' ? page.locator('ion-tab-button').first() : page.locator(`ion-tab-button[data-tour="tab.${id}"]`));

/** Box of an element inside the viewport, in CSS pixels. */
export async function box(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  // The popover is rebuilt for each step: wait for the new one to have a box instead of reading the gap in between.
  let b = await l.boundingBox();
  for (let i = 0; i < 40 && !b; i++) {
    await new Promise((r) => setTimeout(r, 75));
    b = await l.boundingBox();
  }
  if (!b) throw new Error('element has no box');
  return b;
}

export async function viewport(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
}
