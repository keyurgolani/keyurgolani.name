// The quality cells' config (#11, Slice 1): the browser suite's config
// (#12's, Playwright 1.58.2), with the cells' specs, one project per engine
// the run mode plans, and the quality reporter. `pnpm quality:pr` and `pnpm
// quality:full` run it through tests/quality/run.ts, which builds the
// quality host, plants the canary, and judges the run. Tests of one cell
// share its server, so the cells don't run fully parallel; different cells
// do, on two workers. Nothing retries: accessibility and performance
// assertions never do.
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import base from '../../playwright.config';
import { RUN_ENGINES, type Engine } from './lib/matrix';

const reports = path.join(reportsDir(), 'quality');
const mode = process.env.QUALITY_MODE === 'full' ? 'full' : 'pr';

const DEVICES: Readonly<Record<Engine, (typeof devices)[string]>> = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
};

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: ['cells.spec.ts', 'harness.spec.ts', ...(mode === 'full' ? ['visual.spec.ts'] : [])],
  outputDir: path.join(reports, 'results'),
  fullyParallel: false,
  retries: 0,
  workers: 2,
  globalSetup: './global-setup.ts',
  reporter: [['list'], ['./reporter.ts']],
  use: { ...base.use, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: RUN_ENGINES[mode].map((engine) => ({ name: engine, use: { ...DEVICES[engine] } })),
});
