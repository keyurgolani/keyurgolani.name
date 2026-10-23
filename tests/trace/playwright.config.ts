// The runtime trace (#6, Slice 1): `pnpm test:trace`, which passes its own
// options in the environment (tests/harness/trace/options.mjs). The policy
// project proves the network policy on loopback first (policy.spec.ts), and
// every trace project depends on it, so a broken policy traces nothing. Then
// one project per selection (targets.ts), each against its own
// app-under-test server from the standalone build (`pnpm build` first), or
// against the server --base-url names. Cases run one at a time, since long
// tasks and idle work are timings, and Playwright's own tracing stays off
// for the same reason. Chromium launches with the policy's flags: it
// resolves nothing but 127.0.0.1 and localhost and uses no proxy.
// Everything else is the browser suite's config.
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import base from '../../playwright.config';
import { readTraceEnv } from '../harness/trace/options.mjs';
import { TRACE_LAUNCH_ARGS } from '../harness/trace/policy.mjs';
import { traceTargets } from './targets';

const reports = path.join(reportsDir(), 'trace');

export default defineConfig({
  ...base,
  testDir: '.',
  outputDir: path.join(reports, 'results'),
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [
    ['list'],
    ['./report-writer.ts', { outputFile: path.join(reports, 'trace-report.json') }],
    ['../harness/failure-reporter.ts'],
  ],
  use: {
    ...base.use,
    trace: 'off',
    launchOptions: { args: TRACE_LAUNCH_ARGS },
  },
  projects: [
    { name: 'policy', testMatch: 'policy.spec.ts', use: { ...devices['Desktop Chrome'] } },
    ...traceTargets(readTraceEnv()).map(({ appOptions, ...target }) => ({
      name: target.name,
      testMatch: /(?:^|\/)(?:trace|modes)\.spec\.ts$/,
      dependencies: ['policy'],
      use: { ...devices['Desktop Chrome'], ...(appOptions ? { appOptions } : {}) },
      metadata: { ...target },
    })),
  ],
});
