// The quality cells' config (#11, Slice 1): the browser suite's config
// (#12's, Playwright 1.58.2), with the cells' specs and the quality
// reporter. `pnpm quality:pr` and `pnpm quality:full` run it through
// tests/quality/run.ts, which builds the quality host, plants the canary,
// and judges the run; without them it stops.
//
// A cell's server is a worker fixture, which Playwright sets per project,
// so the plan's servers each get a project per engine the mode plans, and
// each cell test carries its server's tag, which only that project's grep
// takes. The harness's own checks get a project per engine too. Tests of
// one project share its server, so they run in order on one worker; two
// projects run at once. Nothing retries: accessibility and performance
// assertions never do.
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import base from '../../playwright.config';
import { runCanary } from './lib/env';
import { RUN_ENGINES, type Engine } from './lib/matrix';
import { HARNESS_SERVER, planServers } from './lib/server';
import { loadPlan } from './plan';

const reports = path.join(reportsDir(), 'quality');
const plan = await loadPlan();
// Fails here, before any test, when run.ts planted none.
runCanary();

const DEVICES: Readonly<Record<Engine, (typeof devices)[string]>> = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
};

const cellSpecs = ['cells.spec.ts', ...(plan.mode === 'full' ? ['visual.spec.ts'] : [])];

export default defineConfig({
  ...base,
  testDir: '.',
  outputDir: path.join(reports, 'results'),
  fullyParallel: false,
  retries: 0,
  workers: 2,
  reporter: [['list'], ['./reporter.ts']],
  use: { ...base.use, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: RUN_ENGINES[plan.mode].flatMap((engine) => [
    {
      name: `${engine} harness`,
      testMatch: ['harness.spec.ts', 'canary.spec.ts'],
      use: { ...DEVICES[engine], cellServer: HARNESS_SERVER },
    },
    ...planServers(plan).map(({ id, label, server }) => ({
      name: `${engine} ${id}`,
      testMatch: cellSpecs,
      grep: new RegExp(`@server-${id}(?![0-9a-f])`),
      use: { ...DEVICES[engine], cellServer: server },
      metadata: { server: label },
    })),
  ]),
});
