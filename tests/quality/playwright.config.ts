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
// assertions never do. A quality:pr shard runs only its own spec files in
// each project (lib/pr-shards.ts).
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import base from '../../playwright.config';
import { TRACE_LAUNCH_ARGS } from '../harness/trace/policy.mjs';
import { runCanary, runShard } from './lib/env';
import { RUN_ENGINES, type Engine } from './lib/matrix';
import {
  CELL_SPEC,
  HARNESS_SPECS,
  harnessProject,
  PERF_SPEC,
  prShard,
  serverProject,
  shardFiles,
} from './lib/pr-shards';
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

/** Each engine's device, and for Chromium, #6's trace policy: no name but loopback resolves, and no proxy is used. */
const engineUse = (engine: Engine) => ({
  ...DEVICES[engine],
  // Named outright, so summary.json can say which engine each test ran on.
  browserName: engine,
  ...(engine === 'chromium' ? { launchOptions: { args: [...TRACE_LAUNCH_ARGS] } } : {}),
});

// perf.spec.ts runs each target's representative cell on the same servers (#11, 11-3).
const cellSpecs = [CELL_SPEC, PERF_SPEC, ...(plan.mode === 'full' ? ['visual.spec.ts'] : [])];

// A PR shard (lib/pr-shards.ts) keeps every project, so each shard's
// summary lists them all, and runs only the spec files it was given in each.
const shard = runShard();
if (shard && plan.mode !== 'pr') throw new Error("QUALITY_SHARD is for quality:pr's shards.");
const assigned = shard ? shardFiles(prShard(plan, RUN_ENGINES[plan.mode], shard)) : null;
const specsFor = (project: string, specs: readonly string[]) =>
  assigned ? specs.filter((file) => assigned.get(project)?.includes(file)) : [...specs];

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
      name: harnessProject(engine),
      testMatch: specsFor(harnessProject(engine), HARNESS_SPECS),
      use: { ...engineUse(engine), cellServer: HARNESS_SERVER },
    },
    ...planServers(plan).map(({ id, label, server }) => ({
      name: serverProject(engine, id),
      testMatch: specsFor(serverProject(engine, id), cellSpecs),
      grep: new RegExp(`@server-${id}(?![0-9a-f])`),
      use: { ...engineUse(engine), cellServer: server },
      metadata: { server: label },
    })),
  ]),
});
