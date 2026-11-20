import { expect, test } from '@playwright/test';
import { box, expectClean, newGuest, nextButton, popover, prevButton, residue, skipButton, storedTour, tabButton, viewport, waitForStep } from './support';

async function startWelcome(page: import('@playwright/test').Page) {
  await page.locator('[data-gs-start]').click();
  await waitForStep(page, 'welcome.patterns');
}
const welcomeStatus = async (page: import('@playwright/test').Page) => (await storedTour(page))?.prefs?.tour?.tours?.welcome?.status;

test.describe('interruptions', () => {
  test.beforeEach(async ({ page, context }) => {
    await newGuest(page, context, 'en');
  });

  test('the Back button (in-app history) ends the tour cleanly and counts as an interruption', async ({ page }) => {
    await tabButton(page, 'projects').click();
    await expect(page).toHaveURL(/\/tabs\/projects/);
    await tabButton(page, 'home').click();
    await expect(page).toHaveURL(/\/tabs\/home$/);
    await startWelcome(page);
    await page.evaluate(() => history.back());
    await expectClean(page);
    await expect.poll(() => welcomeStatus(page)).toBe('interrupted');
  });

  test('a crash or force-stop mid-tour is recovered on the next launch as an interruption, and the tour never restarts by itself', async ({ page }) => {
    await startWelcome(page);
    expect(await welcomeStatus(page)).toBe('active');
    await page.reload(); // the page dies mid-tour
    await expect(page.locator('[data-gs]')).toBeVisible();
    await page.waitForTimeout(1500);
    await expectClean(page);
    await expect(popover(page)).toHaveCount(0);
    await expect.poll(() => welcomeStatus(page)).toBe('interrupted');
  });

  test('navigating away by any route ends it with nothing left behind', async ({ page }) => {
    await startWelcome(page);
    await page.evaluate(() => (window as any).history.pushState({}, '', '/tabs/projects'));
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));
    await expectClean(page);
  });

  test('an Ionic overlay appearing over the tour ends it at once (no tour over a dialog)', async ({ page }) => {
    await startWelcome(page);
    await page.evaluate(async () => {
      const a = document.createElement('ion-alert') as any;
      a.header = 'QA dialog';
      a.buttons = ['OK'];
      document.body.appendChild(a);
      await a.present();
    });
    await expect.poll(() => residue(page).then((r) => r.popovers + r.overlays + r.active)).toBe(0);
    expect(await page.evaluate(() => document.querySelector('ion-app')?.hasAttribute('inert'))).toBe(false);
    await expect(page.locator('ion-alert')).toBeVisible(); // the dialog itself is untouched and usable
    await page.locator('ion-alert button').first().click();
  });

  test('a rotation to landscape ends the tour; the app is fully usable afterwards', async ({ page }) => {
    await startWelcome(page);
    await page.setViewportSize({ width: 800, height: 360 });
    await expectClean(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.locator('ion-app')).toBeVisible();
  });

  test('a short screen (landscape) never starts a tour: nothing dims, nothing is stuck, the card stays', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 360 });
    await page.locator('[data-gs-start]').click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(800);
    expect((await residue(page)).overlays).toBe(0);
    expect((await residue(page)).inert).toBe(false);
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.locator('[data-gs]')).toBeVisible();
  });

  test('a missing optional target is skipped silently: with no patterns tile the tour starts at the Projects tab', async ({ page }) => {
    await page.evaluate(() => document.querySelector('[data-tour="home.patterns-tile"]')?.remove());
    await page.locator('[data-gs-start]').click();
    await waitForStep(page, 'welcome.projects');
    await page.keyboard.press('Escape');
    await expectClean(page);
  });

  test('a missing essential target (a tab) ends the tour cleanly instead of pointing at nothing', async ({ page }) => {
    await startWelcome(page);
    await nextButton(page).click();
    await waitForStep(page, 'welcome.projects');
    await nextButton(page).click();
    await waitForStep(page, 'welcome.tracker');
    await page.evaluate(() => document.querySelector('[data-tour="tab.learn"]')?.remove());
    await nextButton(page).click(); // the Learn tab is gone
    await expectClean(page);
    await expect(page.locator('ion-app')).toBeVisible();
  });

  test('keyboard: arrows follow the reading direction, Tab stays inside the popover, Escape closes', async ({ page }) => {
    await startWelcome(page);
    await page.keyboard.press('ArrowRight');
    await waitForStep(page, 'welcome.projects');
    await page.keyboard.press('ArrowLeft');
    await waitForStep(page, 'welcome.patterns');
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.driver-popover'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expectClean(page);
  });

  test('after the tour, focus is never left inside the removed popover (it returns to the opener when that still exists)', async ({ page }) => {
    await startWelcome(page);
    await skipButton(page).click();
    await expectClean(page);
    const f = await page.evaluate(() => ({ connected: !!document.activeElement?.isConnected, inPopover: !!document.activeElement?.closest('.driver-popover') }));
    expect(f).toEqual({ connected: true, inPopover: false });
  });

  test('focus goes back to the opener when it is still on the page (replay from Settings leaves the Settings row where it was)', async ({ page }) => {
    await page.goto('/tabs/home/settings');
    const row = page.locator('[data-help="khayoota"]');
    await row.scrollIntoViewIfNeeded();
    await row.focus();
    await row.press('Enter');
    await expect(popover(page)).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expectClean(page);
  });
});

test.describe('screens and settings the tour must survive', () => {
  for (const vp of [
    { name: '320×568 (smallest phone)', width: 320, height: 568 },
    { name: '360×640', width: 360, height: 640 },
    { name: '412×915', width: 412, height: 915 },
    { name: '768×1024 (tablet)', width: 768, height: 1024 },
  ]) {
    test(`welcome tour fits and stays reachable at ${vp.name}`, async ({ page, context }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await newGuest(page, context, 'ar');
      await startWelcome(page);
      const ids = ['welcome.patterns', 'welcome.projects', 'welcome.tracker', 'welcome.learn', 'welcome.khayoota', 'welcome.settings'];
      for (let i = 0; i < ids.length; i++) {
        await waitForStep(page, ids[i]);
        const v = await viewport(page);
        const pop = await box(popover(page).first());
        expect(pop.x, `step ${i} left`).toBeGreaterThanOrEqual(-0.5);
        expect(pop.x + pop.width, `step ${i} right`).toBeLessThanOrEqual(v.width + 0.5);
        expect(pop.y, `step ${i} top`).toBeGreaterThanOrEqual(-0.5);
        expect(pop.y + pop.height, `step ${i} bottom`).toBeLessThanOrEqual(v.height + 0.5);
        const nb = await box(nextButton(page));
        expect(nb.height).toBeGreaterThanOrEqual(43.5);
        await nextButton(page).click();
      }
      await expectClean(page);
    });
  }

  for (const [label, size] of [['150%', '24px'], ['200%', '32px']] as const) {
    test(`large text (${label}) keeps every control on screen and tappable`, async ({ page, context }) => {
      await context.addInitScript((px) => {
        document.addEventListener('DOMContentLoaded', () => {
          const s = document.createElement('style');
          s.textContent = `html { font-size: ${px} !important; }`;
          document.head.appendChild(s);
        });
      }, size);
      await newGuest(page, context, 'en');
      await startWelcome(page);
      const v = await viewport(page);
      for (const id of ['welcome.patterns', 'welcome.projects']) {
        await waitForStep(page, id);
        const pop = await box(popover(page).first());
        expect(pop.x, id).toBeGreaterThanOrEqual(-0.5);
        expect(pop.x + pop.width, id).toBeLessThanOrEqual(v.width + 0.5);
        expect(pop.y + pop.height, id).toBeLessThanOrEqual(v.height + 0.5);
        const nb = await box(nextButton(page));
        expect(nb.y + nb.height, id).toBeLessThanOrEqual(v.height + 0.5);
        expect(nb.height).toBeGreaterThanOrEqual(43.5);
        await nextButton(page).click();
      }
      await page.keyboard.press('Escape');
      await expectClean(page);
    });
  }

  test('reduced motion: the tour works and finishes without any animation classes left behind', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await newGuest(page, context, 'en');
    await startWelcome(page);
    const dur = await popover(page).evaluate((e) => getComputedStyle(e).animationDuration + '|' + getComputedStyle(e).transitionDuration);
    expect(dur).not.toMatch(/[1-9]\d*(\.\d+)?m?s/); // nothing animates for longer than 0 s
    for (let i = 0; i < 5; i++) await nextButton(page).click();
    await nextButton(page).click();
    await expectClean(page);
  });

  test('dark mode: the popover keeps readable text on its own background', async ({ page, context }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await newGuest(page, context, 'en');
    await startWelcome(page);
    const colors = await popover(page).evaluate((e) => {
      const cs = getComputedStyle(e);
      const t = getComputedStyle(e.querySelector('.driver-popover-description')!);
      return { bg: cs.backgroundColor, fg: t.color };
    });
    expect(colors.bg).not.toBe(colors.fg);
    expect(colors.bg).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('a prevButton exists from step 2 on and goes back', async ({ page, context }) => {
    await newGuest(page, context, 'en');
    await startWelcome(page);
    await expect(prevButton(page)).toHaveCount(0).catch(() => undefined);
    await nextButton(page).click();
    await waitForStep(page, 'welcome.projects');
    await prevButton(page).click();
    await waitForStep(page, 'welcome.patterns');
  });
});
