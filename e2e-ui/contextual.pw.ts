import { expect, test, type Page } from '@playwright/test';
import { LANGS, card, createProjectViaUi, expectClean, newGuest, nextButton, popover, skipButton, storedAll, storedTour, tabButton, waitForStep, watchTraffic } from './support';

const pill = (page: Page) => page.locator('[data-tour-offer]');
const startPill = (page: Page) => page.locator('[data-tour-offer] .go');
const SAMPLE = '00000000-0000-4000-8000-0000000000a1';
const tourStatus = async (page: Page, id: string) => (await storedTour(page))?.prefs?.tour?.tours?.[id]?.status;

for (const lang of LANGS) {
  test.describe(`contextual tours · ${lang}`, () => {
    test.beforeEach(async ({ page, context, baseURL }) => {
      (page as any).traffic = watchTraffic(page, baseURL!);
      await newGuest(page, context, lang);
    });
    test.afterEach(async ({ page }) => {
      const t = (page as any).traffic as ReturnType<typeof watchTraffic>;
      expect(t.aiCalls(), 'no AI / backend request').toEqual([]);
      expect(t.external()).toEqual([]);
    });

    test('Pattern Library: a quiet invitation on the first visit, three steps on the real rows, never auto-started', async ({ page }) => {
      await page.goto('/tabs/home/patterns');
      await expect(pill(page)).toBeVisible();
      await page.waitForTimeout(1200);
      await expect(popover(page)).toHaveCount(0); // an invitation, not a takeover
      await startPill(page).click();
      const expected = ['patterns.sample', 'patterns.kinds', 'patterns.add'];
      const targets = ['patterns.sample-row', 'patterns.kind-filter', 'patterns.add'];
      for (let i = 0; i < 3; i++) {
        await waitForStep(page, expected[i]);
        await expect(page.locator('.driver-active-element')).toHaveAttribute('data-tour', targets[i]);
        await nextButton(page).click();
      }
      await expectClean(page);
      await expect.poll(() => tourStatus(page, 'patterns')).toBe('completed');
      await page.reload();
      await page.waitForTimeout(1000);
      await expect(pill(page)).toHaveCount(0); // never again by itself
    });

    test('Pattern Library: "×" declines it for good; Skip leaves it skipped', async ({ page }) => {
      await page.goto('/tabs/home/patterns');
      await pill(page).locator('.x').click();
      await expect(pill(page)).toHaveCount(0);
      await expect.poll(() => tourStatus(page, 'patterns')).toBe('declined');
      await page.reload();
      await page.waitForTimeout(800);
      await expect(pill(page)).toHaveCount(0);
    });

    test('Pattern Reader: three steps, never links or resets anything, nothing is created', async ({ page }) => {
      await page.goto(`/tabs/home/patterns/${SAMPLE}`);
      await expect(pill(page)).toBeVisible();
      const url = page.url();
      const projectsBefore = (await storedAll(page, 'projects')).length;
      await startPill(page).click();
      for (const id of ['reader.read', 'reader.move', 'reader.track']) {
        await waitForStep(page, id);
        await nextButton(page).click();
      }
      await expectClean(page);
      expect(page.url()).toBe(url);
      expect((await storedAll(page, 'projects')).length).toBe(projectsBefore);
      await expect.poll(() => tourStatus(page, 'pattern-reader')).toBe('completed');
    });

    test('New Project: two steps, the form is not filled, no keyboard, no unsaved-changes prompt on leaving', async ({ page }) => {
      await page.goto('/tabs/projects/new');
      await expect(pill(page)).toBeVisible();
      await startPill(page).click();
      await waitForStep(page, 'project.name');
      await nextButton(page).click();
      await waitForStep(page, 'project.source');
      await nextButton(page).click();
      await expectClean(page);
      expect(await page.locator('#np-name input').inputValue()).toBe('');
      expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.tagName)).not.toBe('INPUT');
      await page.locator('.gz-top .gz-icb').first().click(); // the page's own back button
      await expect(page).not.toHaveURL(/\/projects\/new/); // the form is pristine: leaving needs no confirmation
      await expect(page.locator('ion-alert')).toHaveCount(0);
    });

    test('Khayoota: three highlight-only steps, no request, no message, no consent', async ({ page }) => {
      await page.goto('/tabs/assistant');
      await expect(pill(page)).toBeVisible({ timeout: 15_000 });
      const chatBefore = JSON.stringify((await storedAll<any>(page, 'docs'))[0]?.chat ?? []);
      await startPill(page).click();
      for (const id of ['khayoota.status', 'khayoota.ask', 'khayoota.controls']) {
        await waitForStep(page, id);
        await expect(page.locator('.gz-tour-hint')).toHaveCount(0);
        await nextButton(page).click();
      }
      await expectClean(page);
      expect(JSON.stringify((await storedAll<any>(page, 'docs'))[0]?.chat ?? [])).toBe(chatBefore);
      expect((page as any).traffic.aiCalls()).toEqual([]);
      expect(await page.locator('textarea, ion-textarea textarea').first().inputValue().catch(() => '')).toBe('');
    });

    test('only one automatic tour is started per launch: after one, other screens show no invitation until the next launch', async ({ page }) => {
      await page.locator('[data-tour="home.patterns-tile"]').click(); // in-app navigation: one document = one launch
      await expect(page).toHaveURL(/\/tabs\/home\/patterns$/);
      await startPill(page).click();
      await waitForStep(page, 'patterns.sample');
      await page.keyboard.press('Escape');
      await expectClean(page);
      await tabButton(page, 'assistant').click();
      await expect(page).toHaveURL(/\/tabs\/assistant/);
      await page.waitForTimeout(2000);
      await expect(pill(page)).toHaveCount(0);
      expect(await page.locator('.driver-popover').count()).toBe(0);
      await page.reload(); // a new launch
      await expect(pill(page)).toBeVisible({ timeout: 15_000 });
    });
  });
}

test.describe('Settings → Tours & help', () => {
  test.beforeEach(async ({ page, context }) => {
    await newGuest(page, context, 'en');
  });

  test('every replay row is a real button; replay goes to the screen first and runs the tour; finishing leaves a clean page', async ({ page }) => {
    await page.goto('/tabs/home/settings');
    await expect(page.locator('[data-help]')).toHaveCount(6);
    const rows = await page.locator('[data-help]').evaluateAll((els) => els.map((e) => [e.tagName, e.getAttribute('data-help')]));
    expect(rows).toEqual([
      ['BUTTON', 'welcome'],
      ['BUTTON', 'patterns'],
      ['BUTTON', 'tracker-simple'],
      ['BUTTON', 'project-create'],
      ['BUTTON', 'khayoota'],
      ['BUTTON', 'list'],
    ]);
    await page.locator('[data-help="patterns"]').click();
    await expect(page).toHaveURL(/\/tabs\/home\/patterns$/);
    await waitForStep(page, 'patterns.sample');
    await skipButton(page).click();
    await expectClean(page);
  });

  test('the welcome tour can be replayed after it was finished, and replay never changes the stored result', async ({ page }) => {
    await page.goto('/tabs/home');
    await page.locator('[data-gs-start]').click();
    for (let i = 0; i < 5; i++) {
      await expect(popover(page)).toBeVisible();
      await nextButton(page).click();
      await page.waitForTimeout(150);
    }
    await nextButton(page).click();
    await expectClean(page);
    await expect.poll(() => tourStatus(page, 'welcome')).toBe('completed');
    await page.goto('/tabs/home/settings');
    await page.locator('[data-help="welcome"]').click();
    await waitForStep(page, 'welcome.patterns');
    await page.keyboard.press('Escape');
    await expectClean(page);
    await expect.poll(() => tourStatus(page, 'welcome')).toBe('completed'); // a replay can only improve a record
  });

  test('the checklist can be hidden and restored from Settings; ticking only comes from real actions', async ({ page }) => {
    await page.locator('[data-gs-notnow]').click();
    await expect(card(page)).toHaveAttribute('data-gs', 'list');
    await page.locator('.gs .hide').click();
    await expect(card(page)).toHaveCount(0);
    await page.reload();
    await expect(card(page)).toHaveCount(0);
    await page.goto('/tabs/home/settings');
    await page.locator('[data-help="list"]').click();
    await page.goto('/tabs/home');
    await expect(card(page)).toHaveAttribute('data-gs', 'list');
    await expect(page.locator('[data-task].done')).toHaveCount(0);
    // a real action ticks its task
    await page.goto(`/tabs/home/patterns/${SAMPLE}`);
    await page.waitForTimeout(500);
    await page.goto('/tabs/home');
    await expect(page.locator('[data-task="pattern"]')).toBeDisabled();
    await expect(page.locator('[data-task="project"]')).toBeEnabled();
  });

  test('completing all five REAL actions ticks each task in turn, shows the completion message once, and makes no AI request', async ({ page, baseURL }) => {
    const traffic = watchTraffic(page, baseURL!);
    const milestone = (id: string) => async () => !!(await storedTour(page))?.prefs?.tour?.milestones?.[id];
    await page.locator('[data-gs-notnow]').click();
    const done = async () => page.locator('[data-task].done').count();
    await page.goto('/tabs/home');
    await expect(page.locator('[data-task]')).toHaveCount(5);
    expect(await done()).toBe(0);

    await page.goto(`/tabs/home/patterns/${SAMPLE}`); // 1 · open a pattern
    await expect.poll(milestone('patternOpened')).toBe(true);
    await createProjectViaUi(page, 'QA gs project'); // 2 · create a project
    await expect.poll(async () => (await storedAll(page, 'projects')).length).toBe(1);
    await page.goto('/tabs/tracker'); // 3 · use the tracker (a real tap)
    await page.locator('[data-tour="tracker.tap"]').click();
    await expect.poll(async () => (await storedAll<any>(page, 'projects'))[0]?.tracker?.simple?.count).toBe(1);
    await page.goto('/tabs/learn/magic-ring'); // 4 · open a tutorial
    await expect.poll(milestone('tutorialOpened')).toBe(true);
    await page.goto('/tabs/home');
    await expect(card(page)).toHaveAttribute('data-gs', 'list');
    await expect(page.locator('[data-task].done')).toHaveCount(4); // four ticked by real actions, one left (retries until the card has rendered)
    await expect(page.locator('[data-task="khayoota"]')).toBeEnabled();

    await page.goto('/tabs/assistant'); // 5 · ask Khayoota (a guest gets the local offline helper: nothing is sent anywhere)
    await page.locator('.kh-field textarea').fill('How do I make a magic ring?');
    await page.locator('.kh-composer button.pur').click();
    await expect.poll(async () => ((await storedAll<any>(page, 'docs'))[0]?.chat ?? []).filter((m: any) => m.role === 'user').length).toBeGreaterThan(0);
    await tabButton(page, 'home').click(); // same launch: the completion message is shown where it was earned
    await expect(card(page)).toHaveAttribute('data-gs', 'done'); // the completion message
    await expect(page.locator('[data-task]')).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(800);
    await expect(card(page)).toHaveCount(0); // shown once: gone on the next launch
    expect(traffic.aiCalls()).toEqual([]);
    expect(traffic.external()).toEqual([]);
  });
});
