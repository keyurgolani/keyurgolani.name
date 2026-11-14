// Evidence only, never merged: the native UI's browser reads on CI Linux, with the repository's
// own browser config. scheme.spec.ts runs in Chromium, Firefox and WebKit, to read what each
// engine computes for the root's scrollbar; the scrubber and the classic-bar looks run in
// Chromium. Run with `--config _ci-evidence/native/playwright.config.ts`.
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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testMatch: /scheme\.spec\.ts$/ },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testMatch: /scheme\.spec\.ts$/ },
  ],
});
