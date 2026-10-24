// The variant specs (#5, Slice 6): `pnpm test:variants`, and `pnpm
// ci:variants` in CI's variants job. Every registered composition on every
// contract fixture and on the bundled sample, in six modes, the hidden
// canary, case-study pages (#10b), and render parity, against the standalone build (`pnpm build`
// first), or the one PORTFOLIO_VARIANTS_WEB names. Each composition and
// fixture is a project, since each needs its own server, and the modes'
// own checks are one more, which needs none, when the run checks every
// variant. Screenshots compare against tests/variants/__screenshots__/
// only in the pinned Playwright image, where CI's variants job sets
// PORTFOLIO_SCREENSHOTS=compare; anywhere else they're attached to the
// report. Everything else is the browser suite's config.
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import base from '../../playwright.config';
import { SCREENSHOT_COMPARISON } from '../harness/screenshots.mjs';
import { CONTRACT_FIXTURES } from '../../packages/variant-contract/src/node/fixtures';
import { fixtureApp, LISTED_ONLY, SAMPLE_APP, UNDER_TEST } from './target';

const reports = path.join(reportsDir(), 'variants');

/**
 * A composition's pages without WebGL. A variant's screenshots and parity
 * are of its document, what every device without its WebGL enhancement
 * gets, and a live canvas never holds two frames the same. Whether
 * Chromium has WebGL otherwise depends on the platform: macOS's headless
 * build has none, and the pinned Linux image's has SwiftShader's. A WebGL
 * enhancement's own paths are its e2e specs' (tests/e2e/spatial-stage.spec.ts).
 */
const NO_WEBGL = { launchOptions: { args: ['--disable-3d-apis'] } };

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
              ? ['fixtures.spec.ts', 'parity.spec.ts', 'case-study.spec.ts', 'hidden.spec.ts']
              : ['fixtures.spec.ts', 'parity.spec.ts', 'case-study.spec.ts'],
          use: {
            ...devices['Desktop Chrome'],
            ...NO_WEBGL,
            appOptions: fixtureApp(fixture, variant),
          },
          metadata: { variant: id, fixture: fixture.name },
        })),
        {
          name: `${id}/sample`,
          testMatch: ['sample.spec.ts'],
          use: { ...devices['Desktop Chrome'], ...NO_WEBGL, appOptions: SAMPLE_APP },
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
