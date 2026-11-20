import { expect, test } from '@playwright/test';
import { LANGS, box, card, closeButton, expectClean, newGuest, nextButton, popover, prevButton, skipButton, storedTour, tabButton, viewport, waitForStep, watchTraffic } from './support';

const WELCOME_STEPS = ['welcome.patterns', 'welcome.projects', 'welcome.tracker', 'welcome.learn', 'welcome.khayoota', 'welcome.settings'];
const WELCOME_TARGETS = ['home.patterns-tile', 'tab.projects', 'tab.tracker', 'tab.learn', 'tab.assistant', 'home.avatar'];

for (const lang of LANGS) {
  test.describe(`welcome tour · ${lang}`, () => {
    test.beforeEach(async ({ page, context, baseURL }) => {
      // Defined on the page for the traffic assertions at the end of each test.
      (page as any).traffic = watchTraffic(page, baseURL!);
      await newGuest(page, context, lang);
    });
    test.afterEach(async ({ page }) => {
      const t = (page as any).traffic as ReturnType<typeof watchTraffic>;
      expect(t.aiCalls(), 'the tour makes no AI or backend request').toEqual([]);
      expect(t.external(), 'nothing leaves the device').toEqual([]);
    });

    test('a new guest is invited, not interrupted: the card appears, nothing dims, nothing auto-starts', async ({ page }) => {
      await expect(card(page)).toHaveAttribute('data-gs', 'offer');
      await page.waitForTimeout(1500);
      await expectClean(page);
      await expect(popover(page)).toHaveCount(0);
      await expect(page.locator('[data-gs-start]')).toBeVisible();
      await expect(page.locator('[data-gs-notnow]')).toBeVisible();
      const html = page.locator('html');
      await expect(html).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    });

    test('Start runs six steps on the real targets; Next walks them; Done finishes and leaves a clean page', async ({ page }) => {
      await page.locator('[data-gs-start]').click();
      for (let i = 0; i < WELCOME_STEPS.length; i++) {
        await waitForStep(page, WELCOME_STEPS[i]);
        const active = page.locator('.driver-active-element');
        await expect(active).toHaveCount(1);
        await expect(active).toHaveAttribute('data-tour', WELCOME_TARGETS[i]);
        await expect(page.locator('.gz-tour-dots i')).toHaveCount(6);
        await expect(page.locator('.gz-tour-dots i.on')).toHaveCount(1);
        if (i < WELCOME_STEPS.length - 1) await nextButton(page).click();
      }
      await expect(skipButton(page)).toHaveCount(0); // the last step has nothing left to skip
      await nextButton(page).click(); // "Done"
      await expectClean(page);
      await expect(card(page)).toHaveAttribute('data-gs', 'list');
      await expect.poll(async () => (await storedTour(page))?.prefs?.tour?.tours?.welcome?.status).toBe('completed');
    });

    test('controls are at least 44×44 CSS px and the popover keeps a margin from the screen edge', async ({ page }) => {
      await page.locator('[data-gs-start]').click();
      await waitForStep(page, 'welcome.patterns');
      const vp = await viewport(page);
      for (const id of WELCOME_STEPS) {
        await waitForStep(page, id);
        const pop = await box(popover(page).first());
        expect(pop.x).toBeGreaterThanOrEqual(15);
        expect(pop.x + pop.width).toBeLessThanOrEqual(vp.width - 15);
        expect(pop.y).toBeGreaterThanOrEqual(0);
        expect(pop.y + pop.height).toBeLessThanOrEqual(vp.height);
        for (const b of [nextButton(page), closeButton(page), skipButton(page), prevButton(page)]) {
          if (!(await b.count()) || !(await b.isVisible())) continue;
          const bb = await box(b.first());
          expect(bb.width, 'width').toBeGreaterThanOrEqual(43.5);
          expect(bb.height, 'height').toBeGreaterThanOrEqual(43.5);
        }
        if (id !== WELCOME_STEPS[WELCOME_STEPS.length - 1]) await nextButton(page).click();
      }
    });

    test('the popover never shows a scrollbar or scrolls when its content fits (no overflow from the arrow or anything else)', async ({ page }) => {
      await page.locator('[data-gs-start]').click();
      for (const id of WELCOME_STEPS) {
        await waitForStep(page, id);
        const m = await popover(page).evaluate((el) => {
          const p = el as HTMLElement;
          return { over: p.scrollHeight - p.clientHeight, bar: p.offsetWidth - p.clientWidth - (parseFloat(getComputedStyle(p).borderLeftWidth) + parseFloat(getComputedStyle(p).borderRightWidth)) };
        });
        expect(m.over, `${id}: content taller than the box`).toBeLessThanOrEqual(0);
        expect(m.bar, `${id}: a scrollbar takes width`).toBeLessThanOrEqual(0);
        if (id !== WELCOME_STEPS[WELCOME_STEPS.length - 1]) await nextButton(page).click();
      }
    });

    test('Back goes to the previous step; Skip ends it cleanly and nothing restarts after a reload', async ({ page }) => {
      await page.locator('[data-gs-start]').click();
      await waitForStep(page, 'welcome.patterns');
      await nextButton(page).click();
      await waitForStep(page, 'welcome.projects');
      await prevButton(page).click();
      await waitForStep(page, 'welcome.patterns');
      await nextButton(page).click();
      await skipButton(page).click();
      await expectClean(page);
      await expect(card(page)).toHaveAttribute('data-gs', 'list');
      await expect.poll(async () => (await storedTour(page))?.prefs?.tour?.tours?.welcome?.status).toBe('skipped');
      await page.reload();
      await expect(card(page)).toHaveAttribute('data-gs', 'list');
      await page.waitForTimeout(1200);
      await expect(popover(page)).toHaveCount(0);
    });

    test('Escape closes it and the app is usable straight away', async ({ page }) => {
      await page.locator('[data-gs-start]').click();
      await waitForStep(page, 'welcome.patterns');
      await page.keyboard.press('Escape');
      await expectClean(page);
      await tabButton(page, 'projects').click();
      await expect(page).toHaveURL(/\/tabs\/projects/);
    });

    test('"Not now" turns the card into the checklist for good: no second invitation after reload', async ({ page }) => {
      await page.locator('[data-gs-notnow]').click();
      await expect(card(page)).toHaveAttribute('data-gs', 'list');
      await expect(page.locator('[data-task]')).toHaveCount(5);
      await page.reload();
      await expect(card(page)).toHaveAttribute('data-gs', 'list');
      await expect(page.locator('[data-gs-start]')).toHaveCount(0);
    });

    test('the finished tour does not come back by itself, even after more launches', async ({ page }) => {
      await page.locator('[data-gs-start]').click();
      for (let i = 0; i < 5; i++) {
        await waitForStep(page, WELCOME_STEPS[i]);
        await nextButton(page).click();
      }
      await nextButton(page).click();
      await expectClean(page);
      for (let i = 0; i < 3; i++) {
        await page.reload();
        await expect(card(page)).toHaveAttribute('data-gs', 'list');
        await page.waitForTimeout(600);
        await expect(popover(page)).toHaveCount(0);
      }
    });

    test('only the visible page is ever targeted: after visiting other tabs and coming back, the highlight is on screen', async ({ page }) => {
      for (const tab of ['projects', 'tracker', 'learn'] as const) {
        await tabButton(page, tab).click();
        await expect(page).toHaveURL(new RegExp(`/tabs/${tab}`));
      }
      await tabButton(page, 'home').click();
      await expect(page).toHaveURL(/\/tabs\/home$/);
      await page.locator('[data-gs-start]').click();
      await waitForStep(page, 'welcome.patterns');
      const info = await page.evaluate(() => {
        const el = document.querySelector('.driver-active-element') as HTMLElement;
        const r = el.getBoundingClientRect();
        return { hiddenAncestor: !!el.closest('.ion-page-hidden'), w: r.width, h: r.height, onScreen: r.bottom > 0 && r.top < window.innerHeight };
      });
      expect(info).toMatchObject({ hiddenAncestor: false, onScreen: true });
      expect(info.w).toBeGreaterThan(20);
    });

    test('the words and layout follow the language: direction, labels, and Next/Back sides', async ({ page }) => {
      await page.locator('[data-gs-start]').click();
      await waitForStep(page, 'welcome.patterns');
      await nextButton(page).click();
      await waitForStep(page, 'welcome.projects');
      const dir = await popover(page).evaluate((e) => getComputedStyle(e).direction);
      expect(dir).toBe(lang === 'ar' ? 'rtl' : 'ltr');
      const next = await box(nextButton(page));
      const prev = await box(prevButton(page));
      // Reading order: in English "Back" is left of "Next", in Arabic it is right of it.
      if (lang === 'en') expect(prev.x).toBeLessThan(next.x);
      else expect(prev.x).toBeGreaterThan(next.x);
      const text = (await nextButton(page).textContent())?.trim();
      expect(text).toBe(lang === 'ar' ? 'التالي' : 'Next');
      const title = (await popover(page).locator('.driver-popover-title').textContent()) ?? '';
      expect(title).toMatch(lang === 'ar' ? /[؀-ۿ]/ : /[A-Za-z]/);
      expect(title).toContain(lang === 'ar' ? 'خطوة' : 'Step');
    });

    test('rapid taps on Next never skip a step, stall, or leave a half-closed tour', async ({ page }) => {
      await page.locator('[data-gs-start]').click();
      await waitForStep(page, 'welcome.patterns');
      // 20 clicks, 25 ms apart, on whatever Next button is on screen at that moment (the popover is rebuilt for each step).
      await page.evaluate(async () => {
        for (let i = 0; i < 20; i++) {
          (document.querySelector('.driver-popover-next-btn') as HTMLElement | null)?.click();
          await new Promise((r) => setTimeout(r, 25));
        }
      });
      await page.waitForTimeout(800);
      // Whatever the outcome, the tour is either completely gone or completely there: never a popover without its overlay, or the reverse.
      const r = await import('./support').then((m) => m.residue(page));
      const whole = r.popovers === 0 && r.overlays === 0 && r.active === 0 && !r.inert && r.dummy === 0;
      const running = r.popovers === 1 && r.overlays === 1 && r.active === 1;
      expect(whole || running, JSON.stringify(r)).toBe(true);
      const st = (await storedTour(page))?.prefs?.tour?.tours?.welcome?.status;
      expect(whole ? 'completed' : 'active').toBe(st);
    });

    test('a tap on the dimmed area does not close the tour or reach the page behind', async ({ page }) => {
      await page.locator('[data-gs-start]').click();
      await waitForStep(page, 'welcome.patterns');
      await page.touchscreen.tap(20, 120);
      await page.touchscreen.tap(340, 300);
      await page.waitForTimeout(400);
      await waitForStep(page, 'welcome.patterns');
      await expect(page).toHaveURL(/\/tabs\/home$/);
    });
  });
}
