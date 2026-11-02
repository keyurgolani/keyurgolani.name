// The rehearsal's state shard (#20 PR 3): `pnpm test:catalog-states`, and
// `pnpm ci:catalog-states` in catalog-rehearsal.yml. It builds the
// appearance specs' fixture host first (APPEARANCE_FIXTURES=1, which serves
// /_fixtures/appearance), then one worker loads its pages in one server. The
// spec writes each failing page's record itself.
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import base from '../../playwright.config';

const reports = path.join(reportsDir(), 'catalog');

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: /states\.spec\.ts$/,
  globalSetup: '../appearance/fixture-host.setup.ts',
  outputDir: path.join(reports, 'states-results'),
  fullyParallel: false,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(reports, 'states-html') }],
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
