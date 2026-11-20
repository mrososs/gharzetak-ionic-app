import { defineConfig } from '@playwright/test';

// Browser-level regression tests for the product tour (docs/product-tour-discovery/09, 10). They run the real app in a real Chrome
// against `ng serve` with no backend (guest-only), as a phone-sized touch device. Nothing is sent anywhere: the suite asserts that.
//   npm run test:ui                 (headless)
//   npm run test:ui -- --headed
// A browser download is not needed: the installed Chrome is used (set PW_CHANNEL=chromium after `npx playwright install chromium` to use the bundled one).
const PORT = Number(process.env['PW_PORT'] ?? 4310);
const channel = process.env['PW_CHANNEL'] ?? 'chrome';

export default defineConfig({
  testDir: './e2e-ui',
  testMatch: '**/*.pw.ts',
  timeout: 60_000,
  expect: { timeout: 12_000 }, // headroom for a loaded machine: the dev server compiles lazily and four workers share it
  fullyParallel: true,
  workers: process.env['CI'] ? 2 : 4,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-ui/report' }]],
  outputDir: 'e2e-ui/results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: channel === 'chromium' ? undefined : channel,
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  webServer: {
    command: `"${process.execPath}" node_modules/@angular/cli/bin/bootstrap.js serve --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
