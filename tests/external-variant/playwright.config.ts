// The reference variant's own checks (#5, Slice 6), which `pnpm
// test:external-variant` runs in its worktree once the tarball is installed
// and built: the colophon view, the compact control off and on, and the
// badge enhancement's lazy load. The six modes, the hidden canary, and render
// parity are the variant specs', which it runs for acme-reference alone.
// Each project needs its own server. Everything else is the browser suite's
// config.
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import base from '../../playwright.config';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import type { AppOptions } from '../harness/fixtures';
import { fixtureApp, SAMPLE_APP, UNDER_TEST } from '../variants/target';
import { compactSite, REFERENCE_ID } from './reference';

const reports = path.join(reportsDir(), 'external-variant');

const reference = UNDER_TEST.find(({ manifest }) => manifest.id === REFERENCE_ID);
if (!reference) {
  throw new Error(
    `The build under test doesn't register ${REFERENCE_ID}. Run these checks with pnpm test:external-variant.`,
  );
}
const complete = contractFixture('complete');

// The harness's worker option, so each project's server is typed.
export default defineConfig<object, { appOptions: AppOptions }>({
  ...base,
  testDir: '.',
  outputDir: path.join(reports, 'results'),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(reports, 'html') }],
    ['../harness/failure-reporter.ts'],
  ],
  projects: [
    {
      name: `${REFERENCE_ID}/complete`,
      grep: /@defaults/,
      use: { ...devices['Desktop Chrome'], appOptions: fixtureApp(complete, reference) },
    },
    {
      name: `${REFERENCE_ID}/compact`,
      grep: /@compact/,
      use: {
        ...devices['Desktop Chrome'],
        appOptions: {
          ...fixtureApp(complete, reference),
          siteText: compactSite(complete, reference),
        },
      },
    },
    {
      name: `${REFERENCE_ID}/sample`,
      grep: /@sample/,
      use: { ...devices['Desktop Chrome'], appOptions: SAMPLE_APP },
    },
  ],
});
