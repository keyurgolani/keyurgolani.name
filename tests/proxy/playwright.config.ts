// #2's security suite through the HTTPS proxy fixture:
// `pnpm --filter @portfolio/web test:security:proxy`, or `pnpm ci:security-proxy`
// in CI's image job. One worker, since each one starts the image behind
// Caddy, and no browser: every request goes out through
// tests/harness/http-client.mjs. Its specs read the route table, whose
// variant registry is server-only (#6), so it resolves server-only as Next's
// server does.
import '../../apps/web/scripts/server-only.cjs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';

const reports = path.join(reportsDir(), 'security-proxy');

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
});
