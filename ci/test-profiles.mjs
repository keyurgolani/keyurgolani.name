#!/usr/bin/env node
// `pnpm --filter @portfolio/web test:profiles` (#1, Verification item 2).
// Builds the app once with no deployment setting in the environment, then
// boots the standalone server under read-only (tests/e2e/profiles.spec.ts)
// and demo (tests/e2e/demo.spec.ts) for the route matrix and the canary
// scan: GET and POST to every route and operation, with no seeded path or
// secret in any response body or header. Under owner it only checks the
// refusal to start without a password hash and a data directory, a startup
// row; #2 reruns the matrix under owner with its provider.
//
// Environment:
//   TEST_PROFILES_WORKERS  Playwright workers (default 2)
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
const workers = `--workers=${process.env.TEST_PROFILES_WORKERS || '2'}`;
// pnpm when this runs as a pnpm script; the one on PATH otherwise.
const pnpm = process.env.npm_execpath ? [process.execPath, process.env.npm_execpath] : ['pnpm'];

function run(label, [command, ...args], cwd) {
  console.log(`[test:profiles] ${label}`);
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`[test:profiles] ${label} failed (exit ${result.status ?? result.signal})`);
    process.exit(result.status || 1);
  }
}

run('build with no profile set', [...pnpm, 'run', 'build'], WEB);
run(
  'read-only and demo: the route matrix and the canary scan',
  [
    process.execPath,
    PLAYWRIGHT,
    'test',
    'tests/e2e/profiles.spec.ts',
    'tests/e2e/demo.spec.ts',
    workers,
  ],
  REPO_ROOT,
);
run(
  'owner: refuses to start without a password hash and a data directory',
  [
    process.execPath,
    PLAYWRIGHT,
    'test',
    'tests/e2e/startup.spec.ts',
    '--grep',
    'owner, with no password hash or data directory',
    '--workers=1',
  ],
  REPO_ROOT,
);
console.log('[test:profiles] passed');
