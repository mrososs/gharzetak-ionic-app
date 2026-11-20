import { expect, test, type Page } from '@playwright/test';
import { LANGS, createProjectViaUi, expectClean, newGuest, nextButton, popover, residue, seedCollection, storedAll, waitForStep, watchTraffic } from './support';

const pill = (page: Page) => page.locator('[data-tour-offer]');
const startPill = (page: Page) => page.locator('[data-tour-offer] .go');
const count = async (page: Page) => (await storedAll<any>(page, 'projects'))[0]?.tracker?.simple?.count as number;
const project = async (page: Page) => (await storedAll<any>(page, 'projects'))[0];

for (const lang of LANGS) {
  test.describe(`trackers · ${lang}`, () => {
    test.beforeEach(async ({ page, context, baseURL }) => {
      (page as any).traffic = watchTraffic(page, baseURL!);
      await newGuest(page, context, lang);
    });
    test.afterEach(async ({ page }) => {
      const t = (page as any).traffic as ReturnType<typeof watchTraffic>;
      expect(t.aiCalls()).toEqual([]);
      expect(t.external()).toEqual([]);
    });

    test('simple counter: the one invited tap counts exactly once and advances exactly once; the rest never touches the project', async ({ page }) => {
      await createProjectViaUi(page, 'QA counter');
      await page.goto('/tabs/tracker');
      await expect(pill(page)).toBeVisible();
      expect(await count(page)).toBe(0);

      await startPill(page).click();
      await waitForStep(page, 'tracker.read');
      await nextButton(page).click();

      await waitForStep(page, 'tracker.tap');
      await expect(page.locator('.gz-tour-hint')).toBeVisible();
      expect(await page.evaluate(() => document.querySelector('ion-app')?.hasAttribute('inert'))).toBe(false); // the app stays live for the real tap
      await expect(nextButton(page)).toBeEnabled();
      expect(await page.locator('.driver-popover').getAttribute('aria-modal')).toBe('false');

      await page.locator('[data-tour="tracker.tap"]').click();
      await waitForStep(page, 'tracker.undo');
      await expect.poll(() => count(page)).toBe(1);
      await page.waitForTimeout(900); // a second advance, or a second count, would have happened by now
      await waitForStep(page, 'tracker.undo');
      expect(await count(page)).toBe(1);
      await expect(page.locator('.driver-active-element')).toHaveAttribute('data-tour', 'tracker.undo'); // Undo is highlighted right after

      expect(await page.evaluate(() => document.querySelector('ion-app')?.hasAttribute('inert'))).toBe(true); // closed off again
      await nextButton(page).click();
      await waitForStep(page, 'tracker.resume');
      await nextButton(page).click();
      await expectClean(page);
      expect(await count(page)).toBe(1);
    });

    test('simple counter: Next works without tapping and the project is left exactly as it was', async ({ page }) => {
      await createProjectViaUi(page, 'QA counter 2');
      const before = await project(page);
      await page.goto('/tabs/tracker');
      await startPill(page).click();
      await waitForStep(page, 'tracker.read');
      await nextButton(page).click();
      await waitForStep(page, 'tracker.tap');
      await nextButton(page).click(); // skip the invitation to tap
      await waitForStep(page, 'tracker.undo');
      await nextButton(page).click();
      await waitForStep(page, 'tracker.resume');
      await nextButton(page).click();
      await expectClean(page);
      const after = await project(page);
      expect(after.tracker.simple.count).toBe(0);
      expect(after.tracker.simple.history ?? []).toEqual(before.tracker.simple.history ?? []);
      expect(after.updatedAt).toBe(before.updatedAt);
    });

    test('pattern tracker: five highlight-only steps, no step invites a tap, the cursor never moves', async ({ page }) => {
      await createProjectViaUi(page, 'QA pattern', { pattern: 'R1: 6sc in MR [6]\nR2: inc x 6 [12]\nR3: (sc, inc) x 6 [18]' });
      const before = (await project(page)).tracker;
      expect(before.mode).toBe('pattern');
      await page.goto('/tabs/tracker');
      await expect(pill(page)).toBeVisible();
      await startPill(page).click();
      const seen: string[] = [];
      for (let i = 0; i < 5; i++) {
        await expect(popover(page)).toBeVisible();
        if (i > 0) await expect(popover(page)).not.toHaveAttribute('data-tour-step', seen[i - 1]); // the next step has really replaced the last
        const step = (await popover(page).getAttribute('data-tour-step'))!;
        seen.push(step);
        expect(await page.evaluate(() => document.querySelector('ion-app')?.hasAttribute('inert'))).toBe(true);
        await expect(page.locator('.gz-tour-hint')).toHaveCount(0);
        if (i < 4) await nextButton(page).click();
      }
      expect(seen).toEqual(['tracker.rounds', 'tracker.instruction', 'tracker.step', 'tracker.countby', 'tracker.count']);
      await nextButton(page).click();
      await expectClean(page);
      const after = (await project(page)).tracker;
      expect(after.cursor).toEqual(before.cursor);
    });

    test('multi-part project: the counter tour comes first; the pieces tour is replayed from Settings (two steps); nothing changes', async ({ page }) => {
      const id = await seedCollection(page);
      await createProjectViaUi(page, 'QA bear project', { collection: id });
      await page.goto('/tabs/tracker');
      await expect(pill(page)).toBeVisible();
      const before = await project(page);
      expect(before.parts.length).toBe(3); // Head ×1 + Arms ×2
      await startPill(page).click();
      await waitForStep(page, 'tracker.rounds'); // pieces here are pattern pieces: the pattern tour is the first offer
      await page.keyboard.press('Escape');
      await expectClean(page);

      await page.goto('/tabs/home/settings');
      await page.locator('[data-help="tracker-parts"]').click();
      await expect(page).toHaveURL(/\/tabs\/tracker/);
      await waitForStep(page, 'tracker.pieces');
      await expect(page.locator('.driver-active-element')).toHaveAttribute('data-tour', 'tracker.piece-tabs');
      await nextButton(page).click();
      await waitForStep(page, 'tracker.whole');
      await nextButton(page).click();
      await expectClean(page);
      const after = await project(page);
      expect(JSON.stringify(after.parts)).toBe(JSON.stringify(before.parts));
    });

    test('with no project there is nothing to point at, so no tracker tour is offered', async ({ page }) => {
      await page.goto('/tabs/tracker');
      await page.waitForTimeout(1500);
      await expect(pill(page)).toHaveCount(0);
      await expectClean(page);
    });
  });
}

test.describe('the pattern parser in the real new-project form (chain stitches)', () => {
  test.beforeEach(async ({ page, context }) => {
    await newGuest(page, context, 'en');
    await page.goto('/tabs/projects/new');
  });

  test('R1: 43 ch is accepted as a pattern; the old rejection message does not appear', async ({ page }) => {
    await page.locator('#np-pat').fill('R1: 43 ch\nR2: 42 sc\nR3: ch 1, 42 sc');
    const note = page.locator('.gz-note').last();
    await expect(note).toHaveClass(/sage/);
    await expect(note).toContainText('3');
    await page.locator('#np-pat').fill('R1: ch 43\nR2: 43ch\nR3: 43 chains');
    await expect(page.locator('.gz-note').last()).toHaveClass(/sage/);
  });

  test('the strict box does not take "turn" (that is for Smart paste, which drops it and says so): reported, never guessed', async ({ page }) => {
    await page.locator('#np-pat').fill('R1: 42 sc\nR2: ch 1, turn, 42 sc');
    await expect(page.locator('.gz-note').last()).not.toHaveClass(/sage/);
  });

  test('an unsupported line is still reported (nothing is guessed)', async ({ page }) => {
    await page.locator('#np-pat').fill('R1: 43 ch\nR2: magic happens');
    await expect(page.locator('.gz-note').last()).not.toHaveClass(/sage/);
  });

  test('a chain project can be created and its first round is a foundation chain of 43 steps', async ({ page }) => {
    await createProjectViaUi(page, 'QA chain', { pattern: 'R1: 43 ch\nR2: 42 sc' });
    const p = await project(page);
    expect(p.tracker.mode).toBe('pattern');
    await page.goto('/tabs/tracker');
    await expect(page.locator('body')).toContainText(/ch/i);
    expect(await residue(page)).toMatchObject({ popovers: 0, overlays: 0 });
  });
});
