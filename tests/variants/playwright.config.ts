// The variant specs (#5, Slice 6): `pnpm test:variants`, and `pnpm
// ci:variants` in CI's variants job. Every registered composition on every
// contract fixture and on the bundled sample, in six modes, the hidden
// canary, and render parity, against the standalone build (`pnpm build`
// first), or the one PORTFOLIO_VARIANTS_WEB names. Each composition and
// fixture is a project, since each needs its own server, and the modes'
// own checks are one more, which needs none, in a run of every variant
// only. Screenshots compare
// against tests/variants/__screenshots__/ only in the pinned Playwright
// image, where CI's variants job sets PORTFOLIO_SCREENSHOTS=compare;
// anywhere else they're attached to the report. Everything else is the
// browser suite's config.
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import base from '../../playwright.config';
import { SCREENSHOT_COMPARISON } from '../harness/screenshots.mjs';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { fixtureApp, LISTED_ONLY, SAMPLE_APP, UNDER_TEST } from './target';

const reports = path.join(reportsDir(), 'variants');

export default defineConfig({
  ...base,
  testDir: '.',
  outputDir: path.join(reports, 'results'),
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  // A missing baseline fails the run, which writes it for CI's variants job
  // to upload. Baselines come from that job's run in the pinned image, not
  // from a local one.
  updateSnapshots: 'missing',
  expect: {
    // Every pixel the same as its baseline: the variants job renders on one
    // platform. #11 owns the thresholds (tests/harness/screenshots.mjs).
    toHaveScreenshot: { ...SCREENSHOT_COMPARISON },
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(reports, 'html') }],
    ['../harness/failure-reporter.ts'],
  ],
  projects: [
    ...UNDER_TEST.flatMap((variant) => {
      const { id } = variant.manifest;
      return [
        ...CONTRACT_FIXTURES.map((fixture) => ({
          name: `${id}/${fixture.name}`,
          testMatch:
            fixture.name === 'hidden-canary'
              ? ['fixtures.spec.ts', 'parity.spec.ts', 'hidden.spec.ts']
              : ['fixtures.spec.ts', 'parity.spec.ts'],
          use: { ...devices['Desktop Chrome'], appOptions: fixtureApp(fixture, variant) },
          metadata: { variant: id, fixture: fixture.name },
        })),
        {
          name: `${id}/sample`,
          testMatch: ['sample.spec.ts'],
          use: { ...devices['Desktop Chrome'], appOptions: SAMPLE_APP },
          metadata: { variant: id },
        },
      ];
    }),
    // The modes' own checks, on pages of their own: no server, no variant.
    // A run for the variants PORTFOLIO_VARIANTS_ONLY lists, such as
    // test:external-variant's, leaves them to the full run, since they
    // check no variant.
    ...(LISTED_ONLY
      ? []
      : [{ name: 'modes', testMatch: ['modes.spec.ts'], use: { ...devices['Desktop Chrome'] } }]),
  ],
});
