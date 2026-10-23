// The preview's fixture renders (#7, Slice 4): `pnpm test:preview-fixtures`,
// and `pnpm ci:preview-fixtures-browser` in CI's job of that name. They need
// fixture-environment, which only a build made with PREVIEW_FIXTURES=1
// registers, so they run against a fixture host
// (tests/harness/fixture-host.mjs) built that way once by the global setup,
// not against this checkout's build. Every screenshot they take stays in
// reports/preview-fixtures/screenshots. Everything else is the browser
// suite's config.
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import base from '../../playwright.config';

const reports = path.join(reportsDir(), 'preview-fixtures');

export default defineConfig({
  ...base,
  testDir: '.',
  outputDir: path.join(reports, 'results'),
  globalSetup: './fixture-host.setup.ts',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(reports, 'html') }],
    ['../harness/failure-reporter.ts'],
  ],
});
