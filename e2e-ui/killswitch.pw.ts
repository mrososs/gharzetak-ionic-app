import { expect, test } from '@playwright/test';
import { newGuest, popover } from './support';

// Runs only against a build made with GZ_TOURS=0 (the build-time kill switch):
//   GZ_TOURS=0 node scripts/set-env.mjs && PW_KILLSWITCH=1 PW_PORT=4311 npx playwright test e2e-ui/killswitch.pw.ts
// then `node scripts/set-env.mjs` again to restore the default environment.
test.describe('GZ_TOURS=0 (kill switch)', () => {
  test.skip(!process.env['PW_KILLSWITCH'], 'needs a GZ_TOURS=0 build');

  test('no tour surface exists anywhere, the rest of the app is unaffected, and the engine is never even downloaded', async ({ page, context }) => {
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url()));
    await newGuest(page, context, 'en');
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-gs]')).toHaveCount(0); // no Getting Started card, not even the invitation
    await expect(popover(page)).toHaveCount(0);

    await page.goto('/tabs/home/patterns');
    await expect(page.locator('[data-tour="patterns.add"]')).toBeVisible(); // the page itself works
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-tour-offer]')).toHaveCount(0);

    await page.goto('/tabs/home/settings');
    await expect(page.locator('[data-tour-help]')).toHaveCount(0); // no "Tours & help"
    await expect(page.getByRole('button', { name: /intro|المقدمة/i }).first()).toBeVisible(); // "Replay app intro" (the onboarding slides) is separate and stays

    await page.goto('/tabs/projects/new');
    await expect(page.locator('#np-name')).toBeVisible();
    expect(urls.some((u) => /driver/i.test(u)), 'the tour engine is not downloaded').toBe(false);
  });
});
