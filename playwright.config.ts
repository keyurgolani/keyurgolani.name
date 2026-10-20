// One Playwright config for every browser job. CI runs it inside the
// digest-pinned mcr.microsoft.com/playwright:v1.58.2-noble container, whose
// browsers match @playwright/test 1.58.2 (pnpm check:pins keeps the two in
// step), so CI never downloads or caches browsers. Locally, run
// `pnpm exec playwright install chromium` once.
//
// Tests run against the built standalone server (`pnpm build` first) through
// the fixtures in tests/harness/fixtures.ts.
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { reportsDir } from './ci/lib/reports.mjs';

const reports = path.join(reportsDir(), 'browser');

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: path.join(reports, 'results'),
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // Browser interaction tests retry once in CI; a pass on retry is a flake.
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(reports, 'html') }],
    ['./tests/harness/failure-reporter.ts'],
  ],
  use: {
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
