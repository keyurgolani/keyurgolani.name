import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECK_JOBS,
  CONTROL_JOBS,
  classify,
  globToRegExp,
  parseNameStatus,
  RULES,
  selectJobs,
  workflowJobIds,
} from './select-jobs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CI_YML = readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

// ci.yml's jobs today, plus the ones open branches add, so every fixture sees
// the whole map.
const WORKFLOW = [...CONTROL_JOBS, ...CHECK_JOBS];
const ALL = CHECK_JOBS;
const PRODUCT = CHECK_JOBS.filter((job) => job !== 'docs');

const draft = (files) =>
  selectJobs({
    files: files.map((f) => (typeof f === 'string' ? { status: 'M', path: f } : f)),
    event: 'pull_request',
    baseRef: 'next',
    draft: true,
    workflowJobs: WORKFLOW,
  });

const sorted = (jobs) => [...jobs].sort();
const assertJobs = (selection, expected, complete = false) => {
  assert.equal(selection.complete, complete, selection.reasons.join('; '));
  assert.deepEqual(sorted(selection.jobs), sorted(expected));
};

// One fixture per change class. Each names the job set it must select.
const CLASSES = [
  {
    name: 'docs-only',
    files: ['docs/deployment.md', 'README.md', 'docs/screenshots/01-home-hero-editorial.png'],
    jobs: ['static', 'unit', 'docs'],
  },
  {
    name: 'schema-only',
    files: ['packages/schema/src/compose.ts', 'packages/schema/src/kinds/projects.ts'],
    jobs: PRODUCT,
  },
  {
    name: 'one pack',
    files: ['packages/appearance-schemes/packs/warm-parchment/pack.json'],
    jobs: PRODUCT.filter((job) => job !== 'check-variants'),
  },
  {
    name: 'one fixture pack',
    files: [
      'packages/appearance-fixtures-schemes/packs/high-contrast/pack.json',
      'packages/quality-fixtures-schemes/packs/stable/pack.json',
    ],
    jobs: ['static', 'unit', 'build', 'appearance-browser', 'quality-pr', 'quality-meta'],
  },
  {
    name: 'one variant',
    files: ['packages/variant-aurora/src/layout.tsx', 'packages/variant-aurora/manifest.json'],
    jobs: [
      'static',
      'unit',
      'build',
      'browser',
      'routes',
      'check-variants',
      'variants',
      'external-variant',
      'preview-fixtures-browser',
      'trace',
      'quality-pr',
    ],
  },
  {
    name: 'Studio',
    files: ['apps/web/src/app/(studio)/studio/page.tsx', 'apps/web/src/server/owner/session.ts'],
    jobs: [
      'static',
      'unit',
      'build',
      'browser',
      'routes',
      'image',
      'profiles',
      'preview-fixtures-browser',
      'quality-pr',
    ],
  },
  {
    name: 'container',
    files: ['deploy/compose.owner.yml', 'docker-compose.yml', 'ci/image-smoke.mjs'],
    jobs: ['static', 'unit', 'image', 'profiles'],
  },
  {
    name: 'image smoke only',
    files: ['ci/image-smoke.mjs', 'ci/test-security-proxy.mjs'],
    jobs: ['static', 'unit', 'image'],
  },
  {
    name: 'container helpers check-standalone imports',
    files: ['ci/lib/container.mjs'],
    jobs: ['static', 'unit', 'build', 'image', 'profiles'],
  },
  {
    name: 'profile smoke',
    files: ['ci/smoke-profiles.mjs', 'ci/lib/profile-checks.mjs', 'ci/profile-checks.test.mjs'],
    jobs: ['static', 'unit', 'image', 'profiles'],
  },
  {
    name: 'one Compose example under deploy/',
    files: ['deploy/compose.demo.yml'],
    jobs: ['static', 'unit', 'image', 'profiles'],
  },
  { name: 'Dockerignore', files: ['.dockerignore'], jobs: ALL, complete: true },
  {
    name: 'proxy stack the security suite uses',
    files: ['tests/harness/proxy-stack.mjs'],
    jobs: ['static', 'unit', 'browser', 'image'],
  },
  { name: 'release', files: ['Dockerfile'], jobs: ALL, complete: true },
  {
    name: 'workflow file',
    files: ['.github/workflows/scheduled.yml'],
    jobs: ALL,
    complete: true,
  },
  { name: 'lockfile', files: ['pnpm-lock.yaml'], jobs: ALL, complete: true },
  { name: 'root config', files: ['tsconfig.base.json'], jobs: ALL, complete: true },
  { name: 'the selector itself', files: ['ci/select-jobs.mjs'], jobs: ALL, complete: true },
  { name: 'an unmapped path', files: ['brand-new/thing.txt'], jobs: ALL, complete: true },
  {
    name: 'a deleted package',
    files: [
      { status: 'D', path: 'packages/variant-aurora/package.json' },
      { status: 'D', path: 'packages/variant-aurora/src/layout.tsx' },
    ],
    jobs: ALL,
    complete: true,
  },
  {
    name: 'a renamed package',
    files: [
      {
        status: 'R',
        oldPath: 'packages/variant-aurora/package.json',
        path: 'packages/variant-borealis/package.json',
      },
    ],
    jobs: ALL,
    complete: true,
  },
  { name: 'legacy only', files: ['legacy/variant-editorial/src/index.ts'], jobs: ['static'] },
  { name: 'browser specs only', files: ['tests/e2e/studio.spec.ts'], jobs: ['static', 'browser'] },
  {
    name: 'docs and one variant',
    files: ['docs/variants.md', 'packages/fallback-composition/src/index.tsx'],
    jobs: [
      'static',
      'unit',
      'docs',
      'build',
      'browser',
      'routes',
      'check-variants',
      'variants',
      'external-variant',
      'preview-fixtures-browser',
      'trace',
      'quality-pr',
    ],
  },
];

for (const { name, files, jobs, complete = false } of CLASSES) {
  test(`a ${name} change selects its job set`, () => {
    assertJobs(draft(files), jobs, complete);
  });
}

test('an unmapped path selects every job, whatever else changed', () => {
  const selection = draft(['docs/deployment.md', 'somewhere/new.bin']);
  assertJobs(selection, ALL, true);
  assert.ok(selection.reasons.includes('somewhere/new.bin is unmapped'));
  assert.equal(classify('somewhere/new.bin'), null);
});

test('a rename is classified by both its paths', () => {
  const selection = draft([
    { status: 'R', oldPath: 'docs/old.md', path: 'packages/schema/src/new.ts' },
  ]);
  assertJobs(selection, [...PRODUCT, 'docs']);
});

test('a PR ready for review, a PR into main, a push, and an empty diff run everything', () => {
  const base = { files: [{ status: 'M', path: 'docs/a.md' }], workflowJobs: WORKFLOW };
  for (const input of [
    { ...base, event: 'pull_request', baseRef: 'next', draft: false },
    { ...base, event: 'pull_request', baseRef: 'main', draft: true },
    { ...base, event: 'push', baseRef: '', draft: false },
    { ...base, files: [], event: 'pull_request', baseRef: 'next', draft: true },
  ]) {
    assertJobs(selectJobs(input), ALL, true);
  }
});

test('the complete run is every check job ci.yml has, and never a control job', () => {
  const selection = selectJobs({
    files: [],
    event: 'push',
    workflowJobs: ['changes', 'static', 'unit', 'gate', 'publish', 'selected'],
  });
  assert.deepEqual(selection.jobs, ['static', 'unit']);
});

test('a ci.yml job the selector does not know always runs', () => {
  const selection = selectJobs({
    files: [{ status: 'M', path: 'docs/a.md' }],
    event: 'pull_request',
    baseRef: 'next',
    draft: true,
    workflowJobs: [...WORKFLOW, 'brand-new-suite'],
  });
  assert.equal(selection.complete, false);
  assert.ok(selection.jobs.includes('brand-new-suite'));
});

test('a selection never names a job ci.yml lacks', () => {
  const selection = selectJobs({
    files: [{ status: 'M', path: 'packages/variant-x/src/a.ts' }],
    event: 'pull_request',
    baseRef: 'next',
    draft: true,
    workflowJobs: ['changes', 'static', 'unit', 'variants', 'gate'],
  });
  assert.deepEqual(selection.jobs, ['static', 'unit', 'variants']);
});

test('the map covers every job in ci.yml', () => {
  const jobs = workflowJobIds(CI_YML);
  assert.ok(jobs.includes('gate') && jobs.includes('static'), `read ${jobs.join(', ')}`);
  const unmapped = jobs.filter((job) => !CHECK_JOBS.includes(job) && !CONTROL_JOBS.includes(job));
  assert.deepEqual(unmapped, [], 'add each new ci.yml job to CHECK_JOBS and its rules');
});

test('every check job in ci.yml waits on changes and runs only when selected', () => {
  const jobs = workflowJobIds(CI_YML).filter((job) => CHECK_JOBS.includes(job));
  for (const job of jobs) {
    const block = CI_YML.split(/\n(?= {2}[A-Za-z0-9_-]+:\s*(?:#.*)?\n)/).find((b) =>
      b.startsWith(`  ${job}:`),
    );
    assert.ok(block, `${job} has a block`);
    assert.match(block, /needs:[^\n]*\bchanges\b/, `${job} needs changes`);
    assert.ok(
      block.includes(`contains(fromJSON(needs.changes.outputs.jobs), '${job}')`),
      `${job} runs only when the selection names it`,
    );
  }
});

test('gate and selected need every check job in ci.yml, and changes', () => {
  const jobs = workflowJobIds(CI_YML).filter((job) => CHECK_JOBS.includes(job));
  for (const control of ['gate', 'selected']) {
    const block = CI_YML.split(/\n(?= {2}[A-Za-z0-9_-]+:\s*(?:#.*)?\n)/).find((b) =>
      b.startsWith(`  ${control}:`),
    );
    const needs = /needs:\s*\[([^\]]*)\]/
      .exec(block)?.[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    assert.ok(needs, `${control} lists its needs`);
    assert.deepEqual(sorted(needs), sorted(['changes', ...jobs]), control);
  }
});

test('the image, the Dockerfile, .dockerignore, deploy/, the profile smoke, and the container helpers select profiles', () => {
  for (const file of [
    'apps/web/src/server/config.ts',
    'apps/web/src/server/owner/auth-secret.ts',
    'packages/core/src/store/store.ts',
    'tests/harness/startup-rows.mjs',
    'Dockerfile',
    '.dockerignore',
    'deploy/compose.owner.yml',
    'docker-compose.yml',
    'ci/smoke-profiles.mjs',
    'ci/lib/profile-checks.mjs',
    'ci/lib/container.mjs',
  ]) {
    const selection = draft([file]);
    assert.ok(selection.jobs.includes('profiles'), `${file} selects ${selection.jobs.join(', ')}`);
  }
});

test('every rule that selects profiles selects image, whose saved image profiles loads', () => {
  for (const rule of RULES) {
    if (rule.complete || !rule.jobs.includes('profiles')) continue;
    assert.ok(rule.jobs.includes('image'), `${rule.class} (${rule.paths[0]}) leaves out image`);
  }
});

test('every rule names only known jobs, and every check job has a rule or the complete run', () => {
  const named = new Set();
  for (const rule of RULES) {
    if (rule.complete) continue;
    for (const job of rule.jobs) {
      assert.ok(CHECK_JOBS.includes(job), `${rule.class} names unknown job ${job}`);
      named.add(job);
    }
  }
  // static joins every selection; the rest each have a rule of their own.
  assert.deepEqual(
    CHECK_JOBS.filter((job) => job !== 'static' && !named.has(job)),
    [],
  );
});

test('globs match whole segments', () => {
  assert.ok(globToRegExp('docs/**').test('docs/a/b.md'));
  assert.ok(globToRegExp('tests/harness/**').test('tests/harness/x.mjs'));
  assert.ok(globToRegExp('packages/variant-*/**').test('packages/variant-a/src/x.ts'));
  assert.ok(!globToRegExp('packages/variant-*/**').test('packages/variant-contract-x'));
  assert.ok(!globToRegExp('README.md').test('docs/README.md'));
  assert.ok(!globToRegExp('README.md').test('READMEXmd'));
  assert.ok(globToRegExp('**/x.md').test('x.md'));
  assert.ok(globToRegExp('apps/web/src/app/(studio)/**').test('apps/web/src/app/(studio)/a.tsx'));
});

test('narrow rules win over the broad ones they carve out of', () => {
  assert.equal(classify('ci/image-smoke.mjs').class, 'container');
  assert.equal(classify('ci/check-pins.mjs').class, 'ci script');
  assert.equal(classify('ci/gate.mjs').class, 'selector');
  assert.equal(classify('tests/harness/trace/a.ts').class, 'trace');
  assert.equal(classify('tests/harness/compose/a.yml').class, 'container');
  assert.equal(classify('tests/harness/fixtures.ts').class, 'harness');
  assert.equal(classify('apps/web/src/server/owner/x.ts').class, 'studio');
  assert.equal(classify('apps/web/src/server/config.ts').class, 'host');
  assert.equal(classify('packages/variant-contract/src/a.ts').class, 'shared package');
});

test('git name-status output parses, renames with both paths', () => {
  const text = [
    'M',
    'a.md',
    'R087',
    'old/b.ts',
    'new/b.ts',
    'D',
    'c.json',
    'A',
    'd e.txt',
    '',
  ].join('\0');
  assert.deepEqual(parseNameStatus(text), [
    { status: 'M', path: 'a.md' },
    { status: 'R', oldPath: 'old/b.ts', path: 'new/b.ts' },
    { status: 'D', path: 'c.json' },
    { status: 'A', path: 'd e.txt' },
  ]);
});

test('job ids are read from the top level of jobs only', () => {
  const text = [
    'name: ci',
    'on: push',
    'jobs:',
    '  static: # lint',
    '    name: static',
    '    steps:',
    '      - run: x',
    '  unit:',
    '    needs: [static]',
    'env:',
    '  FOO: bar',
  ].join('\n');
  assert.deepEqual(workflowJobIds(text), ['static', 'unit']);
});
