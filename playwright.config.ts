// One Playwright config for every browser job. CI runs it inside the
// digest-pinned mcr.microsoft.com/playwright:v1.58.2-noble container, whose
// browsers match @playwright/test 1.58.2 (pnpm check:pins keeps the two in
// step), so CI never downloads or caches browsers. Locally, run
// `pnpm exec playwright install chromium` once.
//
// Tests run against the built standalone server (`pnpm build` first) through
// the fixtures in tests/harness/fixtures.ts. Specs read the host's route
// table and variant registry, which is server-only (#6), so every runner and
// worker that loads this config resolves server-only as Next's server does.
import './apps/web/scripts/server-only.cjs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { reportsDir } from './ci/lib/reports.mjs';

const reports = path.join(reportsDir(), 'browser');

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: path.join(reports, 'results'),
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  // Nothing retries by default: contract, render, accessibility, and
  // performance checks never do. See the interaction project below.
  retries: 0,
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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, grepInvert: /@interaction/ },
    // Browser interaction tests opt in with `{ tag: '@interaction' }` and retry
    // once in CI. A pass on retry is a flake, which PR runs only report.
    {
      name: 'chromium-interaction',
      use: { ...devices['Desktop Chrome'] },
      grep: /@interaction/,
      retries: process.env.CI ? 1 : 0,
    },
  ],
});
