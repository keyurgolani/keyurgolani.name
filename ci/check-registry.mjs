#!/usr/bin/env node
// The variant registry's check (#5, Slice 3): generation succeeds with no
// diagnostic, two runs write the same bytes, and git tracks none of what it
// writes: the generated modules, and the appearance packs' compiled files
// (#19, Slice 2). It runs twice with APPEARANCE_FIXTURES=1, which admits the
// fixture packs, then twice without, so the checkout ends as a production
// build leaves it. The source audit, `pnpm check:variants`, is CI's
// check-variants job (Slice 6).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { currentGate, REPO_ROOT, reportError, writeFailureRecord } from './lib/reports.mjs';

const GENERATED = 'apps/web/src/lib/generated';
const PACKS = 'apps/web/public/_portfolio/pack';
const FLAG = 'APPEARANCE_FIXTURES';

const run = (command, args, env) =>
  spawnSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit', env }).status ?? 1;

/** Every file's bytes in each directory, by path. */
function snapshot() {
  const files = {};
  for (const dir of [GENERATED, PACKS]) {
    for (const name of readdirSync(path.join(REPO_ROOT, dir)).sort()) {
      files[`${dir}/${name}`] = readFileSync(path.join(REPO_ROOT, dir, name)).toString('base64');
    }
  }
  return files;
}

function fail(message, record = {}) {
  reportError(message, { file: GENERATED, title: 'variant registry' });
  const gate = currentGate();
  if (gate) writeFailureRecord({ ...gate, asset: GENERATED, ...record });
  process.exit(1);
}

const unflagged = { ...process.env };
delete unflagged[FLAG];
const states = [
  { label: `with ${FLAG}=1`, env: { ...unflagged, [FLAG]: '1' } },
  { label: `without ${FLAG}`, env: unflagged },
];

let files = 0;
for (const { label, env } of states) {
  const generate = () => run('pnpm', ['--filter', '@portfolio/web', 'build:registry'], env);
  if (generate() !== 0) {
    fail(`registry generation failed ${label}`, { test: 'registry generation succeeds' });
  }
  const first = snapshot();
  if (generate() !== 0) {
    fail(`registry generation failed ${label}`, { test: 'registry generation succeeds' });
  }
  const second = snapshot();
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    const changed = [...new Set([...Object.keys(first), ...Object.keys(second)])].filter(
      (file) => first[file] !== second[file],
    );
    fail(`two runs of registry generation ${label} wrote different files: ${changed.join(', ')}`, {
      test: 'two runs write the same bytes',
      expected: 'identical files',
      actual: `the second run changed ${changed.join(', ')}`,
    });
  }
  files = Object.keys(second).length;
}

const tracked = spawnSync('git', ['ls-files', '--', GENERATED, PACKS], {
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
  `[registry] ${files} generated files without ${FLAG}, the same on two runs with it and two without, none tracked`,
);
