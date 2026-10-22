// The route specs (#5, Slice 4): `pnpm test:routes`, and `pnpm ci:routes` in
// CI's routes job. They need variants that declare path views, so they run
// against a fixture host (tests/harness/fixture-host.mjs), built once by the
// global setup, not against this checkout's build. Everything else is the
// browser suite's config.
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import base from '../../playwright.config';

const reports = path.join(reportsDir(), 'routes');

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
  // One browser project: the interaction project's retries don't apply here.
  projects: base.projects?.filter((project) => project.name === 'chromium'),
});
