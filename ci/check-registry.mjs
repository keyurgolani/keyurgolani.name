#!/usr/bin/env node
// Regenerates the variant registry and fails when the committed
// registry.styles.generated.ts differs from the generator's output. Never
// cache the generated registries; #5 replaces this with its run-twice
// determinism check.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { currentGate, REPO_ROOT, reportError, writeFailureRecord } from './lib/reports.mjs';

const COMMITTED = 'apps/web/src/lib/registry.styles.generated.ts';

const run = (command, args) =>
  spawnSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit' }).status ?? 1;

if (run(process.execPath, [path.join('apps', 'web', 'scripts', 'build-registry.mjs')]) !== 0) {
  reportError('the registry generator failed');
  process.exit(1);
}
if (run('git', ['ls-files', '--error-unmatch', COMMITTED]) !== 0) {
  reportError(`${COMMITTED} is not committed`, { file: COMMITTED });
  process.exit(1);
}
if (run('git', ['diff', '--exit-code', '--', COMMITTED]) !== 0) {
  const message =
    `${COMMITTED} differs from the generator's output. ` +
    'Run pnpm --filter @portfolio/web build:registry and commit the result.';
  reportError(message, { file: COMMITTED, title: 'stale registry' });
  const gate = currentGate();
  if (gate) {
    writeFailureRecord({
      ...gate,
      test: 'committed registry matches the generator',
      asset: COMMITTED,
      expected: 'generator output',
      actual: 'committed file differs',
    });
  }
  process.exit(1);
}
console.log(`[registry] ${COMMITTED} matches the generator`);
