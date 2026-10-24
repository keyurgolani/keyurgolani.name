// The scheduled cross-product (#20): `pnpm test:catalog`, and `pnpm
// ci:catalog-full` in the scheduled workflow's catalog-full shards, after
// `pnpm build`. One worker runs its shard's tuples in one demo server, so
// a shard's load is one browser and one server. The spec writes each
// failing tuple's record itself, naming its pack, axis, and tuple, so the
// generic failure reporter stays out.
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import base from '../../playwright.config';

const reports = path.join(reportsDir(), 'catalog');

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: /cross-product\.spec\.ts$/,
  outputDir: path.join(reports, 'results'),
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(reports, 'html') }]],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
