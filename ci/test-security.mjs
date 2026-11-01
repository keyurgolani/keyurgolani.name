#!/usr/bin/env node
// `pnpm --filter @portfolio/web test:security` (#2): builds the app once
// with no deployment setting in the environment, then runs the security
// suite (tests/harness/security-suite.ts) straight against the built server
// under owner with the password provider, over http on 127.0.0.1 with no
// trusted proxy hop: tests/e2e/security.spec.ts. `test:security:proxy` runs
// the same suite through the HTTPS proxy fixture.
//
// Environment:
//   TEST_SECURITY_WORKERS  Playwright workers (default 1)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REPO_ROOT } from './lib/reports.mjs';

const WEB = path.join(REPO_ROOT, 'apps', 'web');
const PLAYWRIGHT = path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
// Every deployment setting, so nothing set in the caller's shell reaches the build.
const DEPLOYMENT = /^(PORTFOLIO_|GITHUB_TOKEN(_FILE)?$|NEXT_PUBLIC_BASE_URL$)/;
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !DEPLOYMENT.test(name)),
);
const workers = `--workers=${process.env.TEST_SECURITY_WORKERS || '1'}`;
// pnpm when this runs as a pnpm script; the one on PATH otherwise.
const pnpm = process.env.npm_execpath ? [process.execPath, process.env.npm_execpath] : ['pnpm'];

function run(label, [command, ...args], cwd) {
  console.log(`[test:security] ${label}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[test:security] ${label} failed (exit ${result.status ?? result.signal})`);
    process.exit(result.status || 1);
  }
}

run('build with no profile set', [...pnpm, 'run', 'build'], WEB);
run(
  'owner over http with no trusted hop: the security suite',
  [process.execPath, PLAYWRIGHT, 'test', 'tests/e2e/security.spec.ts', workers],
  REPO_ROOT,
);
console.log('[test:security] passed');
