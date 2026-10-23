#!/usr/bin/env node
// The variant registry's check (#5, Slice 3): generation succeeds with no
// diagnostic, two runs write the same bytes, and git tracks none of what it
// writes: the generated modules, the appearance packs' compiled files (#19,
// Slice 2), and the variants' compiled stylesheets with the images they name
// and their experience segments (#6, Slice 2). It runs twice under each
// fixture flag's values, APPEARANCE_FIXTURES=1 for the appearance fixture
// packs, #7's PREVIEW_FIXTURES=1 for fixture-environment, QUALITY_FIXTURES=1
// and meta for #11's tier fixtures, and BUDGET_FIXTURES=1 and over for the
// budget fixture variants, then twice with none, so the checkout ends as a
// production build leaves it. The source audit, `pnpm check:variants`, is
// CI's check-variants job (Slice 6).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { FIXTURE_FLAG } from './lib/fixture-flags.mjs';
import { currentGate, REPO_ROOT, reportError, writeFailureRecord } from './lib/reports.mjs';

const GENERATED = 'apps/web/src/lib/generated';
/** What the host serves from public/_portfolio/: packs, variant stylesheets, and their images. */
const SERVED = ['pack', 'font', 'variant', 'asset', 'still'].map(
  (dir) => `apps/web/public/_portfolio/${dir}`,
);
/** Each variant's experience segment, a route per variant in the app directory (#6, Slice 2). */
const SEGMENTS = 'apps/web/src/app/(site)/%5Fexperience';
/** #6's catalog fixture page, which generation writes only with BUDGET_FIXTURES (scripts/fixture-routes.ts). */
const FIXTURE_ROUTE = 'apps/web/src/app/(studio)/studio/%5Fcatalog-fixture';

const run = (command, args, env) =>
  spawnSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit', env }).status ?? 1;

/** Every file's bytes under each directory, by path. */
function snapshot() {
  const files = {};
  const walk = (dir) => {
    if (!existsSync(path.join(REPO_ROOT, dir))) return;
    for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else files[file] = readFileSync(path.join(REPO_ROOT, file)).toString('base64');
    }
  };
  for (const dir of [GENERATED, ...SERVED, SEGMENTS, FIXTURE_ROUTE]) walk(dir);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
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
  { label: 'with PREVIEW_FIXTURES=1', env: { ...unflagged, PREVIEW_FIXTURES: '1' } },
  { label: 'with QUALITY_FIXTURES=1', env: { ...unflagged, QUALITY_FIXTURES: '1' } },
  { label: 'with QUALITY_FIXTURES=meta', env: { ...unflagged, QUALITY_FIXTURES: 'meta' } },
  { label: 'with BUDGET_FIXTURES=1', env: { ...unflagged, BUDGET_FIXTURES: '1' } },
  { label: 'with BUDGET_FIXTURES=over', env: { ...unflagged, BUDGET_FIXTURES: 'over' } },
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

// The last state has no flag, so it leaves no fixture route behind.
if (existsSync(path.join(REPO_ROOT, FIXTURE_ROUTE))) {
  fail(`registry generation without a fixture flag left ${FIXTURE_ROUTE}`, {
    test: 'a fixture route exists only with its flag',
    expected: 'no fixture route',
    actual: FIXTURE_ROUTE,
  });
}

const tracked = spawnSync(
  'git',
  ['ls-files', '--', GENERATED, ...SERVED, SEGMENTS, FIXTURE_ROUTE],
  {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  },
);
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
