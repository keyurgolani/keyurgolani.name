#!/usr/bin/env node
// The variant registry's check (#5, Slice 3): generation succeeds with no
// diagnostic, two runs write the same bytes, and git tracks none of what it
// writes: the generated modules, and the appearance packs' compiled files
// (#19, Slice 2). It runs twice under each fixture flag's values,
// APPEARANCE_FIXTURES=1 for the appearance fixture packs and
// QUALITY_FIXTURES=1 and meta for #11's tier fixtures, then twice with none,
// so the checkout ends as a production build leaves it. The source audit,
// `pnpm check:variants`, is CI's check-variants job (Slice 6).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURE_FLAG } from './lib/fixture-flags.mjs';
import { currentGate, REPO_ROOT, reportError, writeFailureRecord } from './lib/reports.mjs';

const GENERATED = 'apps/web/src/lib/generated';
const PACKS = 'apps/web/public/_portfolio/pack';

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

// Every fixture flag cleared, as ci/test-profiles.mjs clears them.
const unflagged = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !FIXTURE_FLAG.test(name)),
);
const states = [
  { label: 'with APPEARANCE_FIXTURES=1', env: { ...unflagged, APPEARANCE_FIXTURES: '1' } },
  { label: 'with QUALITY_FIXTURES=1', env: { ...unflagged, QUALITY_FIXTURES: '1' } },
  { label: 'with QUALITY_FIXTURES=meta', env: { ...unflagged, QUALITY_FIXTURES: 'meta' } },
  { label: 'without a fixture flag', env: unflagged },
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
  `[registry] ${files} generated files without a fixture flag, the same on two runs under each of ${states.length} flag states, none tracked`,
);
