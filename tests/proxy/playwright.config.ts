// Two projects through the HTTPS proxy fixture, one worker each.
//
// - security: #2's security suite, `pnpm --filter @portfolio/web
//   test:security:proxy`, or `pnpm ci:security-proxy` in CI's image job. Each
//   worker starts the image behind Caddy, and there's no browser: every
//   request goes out through tests/harness/http-client.mjs. Its specs read
//   the route table, whose variant registry is server-only (#6), so it
//   resolves server-only as Next's server does.
// - demo-origin: the demo origin against the owner's in Chromium (#9),
//   `pnpm ci:demo-origin` in the image job, which starts the stack with the
//   demo beside the owner and runs this project alone in the pinned
//   Playwright image (ci/demo-origin.mjs). Chromium maps the fixture's two
//   names to the proxy on loopback, and takes the proxy's local CA.
import '../../apps/web/scripts/server-only.cjs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import { DEMO_HOST, PROXY_HOST } from '../harness/proxy-stack.mjs';

// demo-origin's run, which alone sets DEMO_ORIGIN_PORT, reports apart from the suite's.
const reports = path.join(
  reportsDir(),
  process.env.DEMO_ORIGIN_PORT ? 'demo-origin' : 'security-proxy',
);

const DEMO_ORIGIN_SPEC = /demo-origin\.spec\.ts$/;

export default defineConfig({
  testDir: '.',
  outputDir: path.join(reports, 'results'),
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  // Every request goes through the proxy, and the leak scan sends a few hundred.
  timeout: 120_000,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(reports, 'html') }],
    ['../harness/failure-reporter.ts'],
  ],
  projects: [
    { name: 'security', testIgnore: DEMO_ORIGIN_SPEC },
    {
      name: 'demo-origin',
      testMatch: DEMO_ORIGIN_SPEC,
      use: {
        browserName: 'chromium',
        ignoreHTTPSErrors: true,
        launchOptions: {
          args: [`--host-resolver-rules=MAP ${PROXY_HOST} 127.0.0.1,MAP ${DEMO_HOST} 127.0.0.1`],
        },
      },
    },
  ],
});
