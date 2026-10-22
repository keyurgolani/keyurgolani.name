#!/usr/bin/env node
// `pnpm --filter @portfolio/web test:security:proxy` (#2), and
// `pnpm ci:security-proxy` in CI's image job: the security suite
// (tests/harness/security-suite.ts) against the image under owner, behind
// the HTTPS proxy fixture with one trusted hop: tests/proxy/security.spec.ts,
// under tests/proxy/playwright.config.ts. It needs the image, which
// `pnpm ci:image` builds, and a container runtime, and no browser.
//
// Environment:
//   PORTFOLIO_IMAGE   the image under test (default portfolio:ci)
//   CONTAINER_CLI     docker (default) or finch
//   CONTAINER_PREFIX  Compose project name prefix (default portfolio-ci-)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REPO_ROOT } from './lib/reports.mjs';

const PLAYWRIGHT = path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const CONFIG = path.join(REPO_ROOT, 'tests', 'proxy', 'playwright.config.ts');

console.log(
  `[test:security:proxy] the security suite through the HTTPS proxy, on ${process.env.PORTFOLIO_IMAGE || 'portfolio:ci'}`,
);
const result = spawnSync(process.execPath, [PLAYWRIGHT, 'test', '-c', CONFIG], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
});
if (result.status !== 0) {
  console.error(`[test:security:proxy] failed (exit ${result.status ?? result.signal})`);
  process.exit(result.status || 1);
}
console.log('[test:security:proxy] passed');
