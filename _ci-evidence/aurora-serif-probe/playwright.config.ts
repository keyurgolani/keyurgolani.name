// Evidence only, never merged: which of a type pack's faces moves what at load on CI Linux, with the
// repository's own browser config, from this folder. Run with
// `--config _ci-evidence/aurora-serif-probe/playwright.config.ts`.
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
