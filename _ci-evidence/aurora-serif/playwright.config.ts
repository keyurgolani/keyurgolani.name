// Evidence only, never merged: Aurora Glass's load-shift pins on CI Linux, with the repository's own
// browser config, from this folder, so the base twin runs them too. Run with
// `--config _ci-evidence/aurora-serif/playwright.config.ts`.
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import base from '../../playwright.config';

export default defineConfig({
  ...base,
  testDir: '.',
  // The base's reporters, their paths from this folder.
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(reportsDir(), 'browser', 'html') }],
    ['../../tests/harness/failure-reporter.ts'],
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
