// The runtime trace (#6, Slice 1): `pnpm test:trace`, which passes its own
// options in the environment (tests/harness/trace/options.mjs). One project
// per selection (targets.ts), each against its own app-under-test server
// from the standalone build (`pnpm build` first), or against the server
// --base-url names. Cases run one at a time, since long tasks and idle work
// are timings, and Playwright's own tracing stays off for the same reason.
// The browser resolves nothing but 127.0.0.1 and localhost. Everything
// else is the browser suite's config.
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import base from '../../playwright.config';
import { readTraceEnv } from '../harness/trace/options.mjs';
import { traceTargets } from './targets';

const reports = path.join(reportsDir(), 'trace');

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'trace.spec.ts',
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
    launchOptions: {
      args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
    },
  },
  projects: traceTargets(readTraceEnv()).map(({ appOptions, ...target }) => ({
    name: target.name,
    use: { ...devices['Desktop Chrome'], ...(appOptions ? { appOptions } : {}) },
    metadata: { ...target },
  })),
});
