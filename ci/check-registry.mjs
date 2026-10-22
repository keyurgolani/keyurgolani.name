#!/usr/bin/env node
// The variant registry's check (#5, Slice 3): generation succeeds with no
// diagnostic, two runs write the same bytes, and git tracks none of what it
// writes. The source audit, `pnpm check:variants`, is CI's check-variants
// job (Slice 6).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { currentGate, REPO_ROOT, reportError, writeFailureRecord } from './lib/reports.mjs';

const GENERATED = 'apps/web/src/lib/generated';

const run = (command, args) =>
  spawnSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit' }).status ?? 1;

/** Every generated file's bytes, by name. */
function snapshot() {
  const dir = path.join(REPO_ROOT, GENERATED);
  return Object.fromEntries(
    readdirSync(dir)
      .sort()
      .map((name) => [name, readFileSync(path.join(dir, name), 'utf8')]),
  );
}

function fail(message, record = {}) {
  reportError(message, { file: GENERATED, title: 'variant registry' });
  const gate = currentGate();
  if (gate) writeFailureRecord({ ...gate, asset: GENERATED, ...record });
  process.exit(1);
}

const generate = () => run('pnpm', ['--filter', '@portfolio/web', 'build:registry']);

if (generate() !== 0) fail('registry generation failed', { test: 'registry generation succeeds' });
const first = snapshot();
if (generate() !== 0) fail('registry generation failed', { test: 'registry generation succeeds' });
const second = snapshot();
if (JSON.stringify(first) !== JSON.stringify(second)) {
  fail('two runs of registry generation wrote different files', {
    test: 'two runs write the same bytes',
    expected: 'identical files',
    actual: 'the second run changed them',
  });
}

const tracked = spawnSync('git', ['ls-files', '--', GENERATED], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
});
if (tracked.status !== 0 || tracked.stdout.trim() !== '') {
  fail(`git tracks generated files: ${tracked.stdout.trim().split('\n').join(', ')}`, {
    test: 'generated files are untracked',
    expected: 'none tracked',
    actual: tracked.stdout.trim(),
  });
}

console.log(
  `[registry] ${Object.keys(first).length} generated files, the same on two runs, none tracked`,
);
