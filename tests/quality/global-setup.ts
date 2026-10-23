// The quality config's global setup (#11, Slice 1): run.ts builds the
// quality host and plants the canary before Playwright starts, and passes
// both in the environment. A direct `playwright test --config
// tests/quality/playwright.config.ts` gets them here instead, built once
// before any server starts and removed after the last test. The build runs
// alone, so nothing it loads the machine with lands on a test's timing.
import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { plantCanary } from './lib/artifacts.mjs';
import { buildQualityHost } from './lib/build.mjs';

export default function setup(config: FullConfig): (() => void) | undefined {
  process.env.QUALITY_CANARY ??= plantCanary();
  if (process.env.QUALITY_WEB) return undefined;
  const log = path.join(path.dirname(config.projects[0]!.outputDir), 'quality-host.log');
  const started = Date.now();
  const host = buildQualityHost({ log });
  console.log(`[quality] quality host built in ${Math.round((Date.now() - started) / 1000)}s`);
  process.env.QUALITY_WEB = host.web;
  return () => host.remove();
}
