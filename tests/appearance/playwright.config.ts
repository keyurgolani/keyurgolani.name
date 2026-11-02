// The appearance specs (#19, Slice 3): `pnpm test:appearance`, and `pnpm
// ci:appearance-browser` in CI's appearance job. They need the fixture packs
// and the /_fixtures/appearance page, which only a build made with
// APPEARANCE_FIXTURES=1 has, so they run against a fixture host
// (tests/harness/fixture-host.mjs) built that way once by the global setup,
// not against this checkout's build. Everything else is the browser suite's
// config.
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import base from '../../playwright.config';

const reports = path.join(reportsDir(), 'appearance');

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
