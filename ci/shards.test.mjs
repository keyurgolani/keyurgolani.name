import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assign,
  attributeHarness,
  commandsFor,
  loadDurations,
  measure,
  parseShard,
  plan,
  specFiles,
  unitItems,
  workspacePackages,
} from './shards.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const partitions = (shards, items) => {
  const all = shards.flatMap((s) => s.items);
  assert.equal(all.length, new Set(all).size, 'no item is in two shards');
  assert.deepEqual([...all].sort(), [...new Set(items)].sort(), 'every item is in a shard');
};

test('a shard is <index>/<count> with the index in range', () => {
  assert.deepEqual(parseShard('2/3'), { index: 2, count: 3 });
  for (const bad of ['0/3', '4/3', '1/0', '1', 'a/b', '', undefined]) {
    assert.throws(() => parseShard(bad), /index/);
  }
});

test('assignment partitions the items, longest first onto the lightest shard', () => {
  const weights = { a: 50, b: 40, c: 30, d: 20, e: 10 };
  const shards = assign(Object.keys(weights), weights, 2);
  partitions(shards, Object.keys(weights));
  assert.deepEqual(
    shards.map((s) => s.items),
    [
      ['a', 'd', 'e'],
      ['b', 'c'],
    ],
  );
  assert.deepEqual(
    shards.map((s) => s.weight),
    [80, 70],
  );
});

test('assignment is the same whatever order the items come in', () => {
  const weights = { a: 5, b: 5, c: 5, d: 1 };
  const one = assign(['a', 'b', 'c', 'd'], weights, 3);
  const two = assign(['d', 'c', 'b', 'a'], weights, 3);
  assert.deepEqual(one, two);
});

test('an item with no measured duration weighs the median, and is never left out', () => {
  const shards = assign(['new', 'a', 'b', 'c'], { a: 10, b: 20, c: 30 }, 2);
  partitions(shards, ['new', 'a', 'b', 'c']);
  assert.equal(
    shards.reduce((sum, s) => sum + s.weight, 0),
    80,
  );
  // Nothing measured: everything weighs 1.
  partitions(assign(['x', 'y', 'z'], {}, 2), ['x', 'y', 'z']);
});

test('more shards than items leaves the extra shards empty', () => {
  const shards = assign(['a'], { a: 3 }, 3);
  partitions(shards, ['a']);
  assert.deepEqual(
    shards.map((s) => s.items.length),
    [1, 0, 0],
  );
});

test('unit items are the packages pnpm -r tests, then the root scripts the test script chains', () => {
  const packages = [
    { dir: 'apps/web', name: '@portfolio/web', test: true },
    { dir: 'packages/schema', name: '@portfolio/schema', test: true },
    { dir: 'packages/no-tests', name: '@portfolio/x', test: false },
  ];
  assert.deepEqual(unitItems('pnpm -r test && pnpm test:scripts', packages), [
    'pkg:apps/web',
    'pkg:packages/schema',
    'script:test:scripts',
  ]);
  // #11 adds a root suite this way.
  assert.deepEqual(unitItems('pnpm -r test && pnpm test:scripts && pnpm test:quality', []), [
    'script:test:scripts',
    'script:test:quality',
  ]);
  assert.throws(() => unitItems('vitest run', packages), /must start with/);
  assert.throws(() => unitItems('pnpm -r test && node --test x', packages), /can't shard/);
});

test("the tree's unit items cover every package with tests and the root test script", () => {
  const root = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const packages = workspacePackages();
  const items = unitItems(root.scripts.test, packages);
  for (const dir of ['apps/web', 'packages/schema', 'packages/kit', 'packages/core']) {
    assert.ok(items.includes(`pkg:${dir}`), dir);
  }
  assert.ok(items.includes('script:test:scripts'));
  for (const count of [1, 2, 3, 4]) {
    partitions(
      Array.from({ length: count }, (_, i) => plan('unit', `${i + 1}/${count}`, items).mine),
      items,
    );
  }
});

test('the browser shards split every spec file in tests/e2e', () => {
  const items = specFiles('tests/e2e');
  assert.ok(items.length > 10 && items.every((f) => /^tests\/e2e\/.+\.spec\.ts$/.test(f)));
  for (const count of [1, 2, 3]) {
    partitions(
      Array.from({ length: count }, (_, i) => plan('browser', `${i + 1}/${count}`, items).mine),
      items,
    );
  }
});

test('a unit shard without the web package writes the registry before the root scripts', () => {
  const packages = [
    { dir: 'apps/web', name: '@portfolio/web', test: true },
    { dir: 'packages/core', name: '@portfolio/core', test: true },
  ];
  const tail = (commands) => commands.map((c) => c.slice(c.indexOf('--filter') > 0 ? 0 : 0));
  const without = tail(commandsFor('unit', ['pkg:packages/core', 'script:test:scripts'], packages));
  const text = without.map((c) => c.join(' '));
  assert.equal(text.length, 3);
  assert.match(text[0], /--filter @portfolio\/core run test$/);
  // One package at a time, so a timing test never shares the runner with another suite.
  assert.match(text[0], / --workspace-concurrency=1 /);
  assert.match(text[1], /--filter @portfolio\/web run build:registry$/);
  assert.match(text[2], / test:scripts$/);

  const withWeb = commandsFor('unit', ['pkg:apps/web', 'script:test:scripts'], packages).map((c) =>
    c.join(' '),
  );
  assert.equal(withWeb.length, 2);
  assert.ok(!withWeb.some((c) => c.includes('build:registry')));
  assert.equal(commandsFor('unit', ['pkg:packages/core'], packages).length, 1);
});

test('browser and variants shards pass exact files and projects to Playwright', () => {
  const [browser] = commandsFor('browser', ['tests/e2e/pair.spec.ts']);
  assert.equal(browser.at(-1), 'tests/e2e/pair\\.spec\\.ts$');
  const re = new RegExp(browser.at(-1));
  assert.ok(re.test('/w/tests/e2e/pair.spec.ts'));
  assert.ok(!re.test('/w/tests/e2e/pair-rtl.spec.ts'));
  const [variants] = commandsFor('variants', ['fallback/sample', 'modes']);
  assert.deepEqual(variants.slice(-2), ['--project=fallback/sample', '--project=modes']);
  assert.ok(variants.includes('tests/variants/playwright.config.ts'));
});

test("a harness module's tests count for the specs that call what they import from it", () => {
  const sources = {
    'tests/e2e/demo.spec.ts':
      "import { DEMO_APP, profileMatrix } from '../harness/profile-matrix';\nprofileMatrix('demo');\n",
    'tests/e2e/owner.spec.ts':
      "import {\n  ownerApp,\n  profileMatrix,\n} from '../harness/profile-matrix';\nprofileMatrix('owner', {});\n",
    'tests/e2e/studio.spec.ts':
      "import { ownerApp } from '../harness/profile-matrix';\nconst app = ownerApp('x');\n",
    'tests/e2e/smoke.spec.ts': "test('x', () => {});\n",
  };
  const weights = attributeHarness(
    {
      'tests/harness/profile-matrix.ts': 30,
      'tests/e2e/smoke.spec.ts': 4,
      'tests/e2e/demo.spec.ts': 1,
    },
    Object.keys(sources),
    (spec) => sources[spec],
  );
  assert.deepEqual(weights, {
    'tests/e2e/smoke.spec.ts': 4,
    'tests/e2e/demo.spec.ts': 16,
    'tests/e2e/owner.spec.ts': 15,
  });
});

const logLine = (step, time, text) => `job\t${step}\t2026-10-23T05:${time}Z ${text}`;

test('unit durations are measured per package and per root script from a job log', () => {
  const log = [
    logLine('pnpm ci:unit', '01:00.0', 'packages/schema test$ tsx --test x'),
    logLine('pnpm ci:unit', '01:10.0', 'packages/core test$ tsx --test x'),
    logLine('pnpm ci:unit', '01:15.5', 'packages/schema test: Done'),
    logLine('pnpm ci:unit', '01:40.0', 'packages/core test: Done'),
    logLine('pnpm ci:unit', '01:41.0', '> portfolio-monorepo@0.1.1 test:scripts /home/runner/x'),
    logLine('pnpm ci:unit', '02:21.0', '[ci] unit passed in 81.0s'),
  ].join('\n');
  assert.deepEqual(measure('unit', log), {
    'pkg:packages/schema': 15.5,
    'pkg:packages/core': 30,
    'script:test:scripts': 40,
  });
});

test('Playwright durations are summed per spec file, or per project for variants', () => {
  const log = [
    logLine(
      'pnpm ci:browser',
      '01:00.0',
      '  ✓    1 [chromium] › tests/e2e/a.spec.ts:10:1 › one (1.5s)',
    ),
    logLine(
      'pnpm ci:browser',
      '01:01.0',
      '  ✓    2 [chromium] › tests/e2e/a.spec.ts:20:1 › two (500ms)',
    ),
    logLine(
      'pnpm ci:browser',
      '01:02.0',
      '  ✘    3 [chromium-interaction] › tests/e2e/b.spec.ts:5:1 › three (1.2m)',
    ),
    logLine('pnpm ci:browser', '01:03.0', '  4 passed (2.0m)'),
  ].join('\n');
  assert.deepEqual(measure('browser', log), {
    'tests/e2e/a.spec.ts': 2,
    'tests/e2e/b.spec.ts': 72,
  });
  assert.deepEqual(measure('variants', log), { chromium: 2, 'chromium-interaction': 72 });
});

test('the measured durations cover the suites CI shards', () => {
  const durations = loadDurations();
  for (const suite of ['unit', 'browser', 'variants']) {
    assert.ok(Object.keys(durations[suite] ?? {}).length > 5, suite);
  }
});

function workspace(yaml, dirs) {
  const root = mkdtempSync(path.join(tmpdir(), 'shards-ws-'));
  writeFileSync(path.join(root, 'pnpm-workspace.yaml'), yaml);
  for (const [dir, manifest] of Object.entries(dirs)) {
    mkdirSync(path.join(root, dir), { recursive: true });
    if (manifest) writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify(manifest));
  }
  return root;
}

test('workspace entries resolve in every quoting, as directories, globs, and excludes', () => {
  const root = workspace(
    [
      'packages:',
      "  - 'apps/*'",
      '  - "packages/*"',
      '  - tools/*',
      '  - ./scripts/runner',
      "  - '!packages/skip-me'",
      "  - 'experiments/*'",
      "  - '!gone/package'",
      '',
    ].join('\n'),
    {
      'apps/web': { name: '@x/web', scripts: { test: 't' } },
      'packages/a': { name: '@x/a', scripts: { test: 't' } },
      'packages/skip-me': { name: '@x/skip', scripts: { test: 't' } },
      'packages/no-manifest': null,
      'tools/lint': { name: '@x/lint' },
      'scripts/runner': { name: '@x/runner', scripts: { test: 't' } },
    },
  );
  try {
    assert.deepEqual(workspacePackages(root), [
      { dir: 'apps/web', name: '@x/web', test: true },
      { dir: 'packages/a', name: '@x/a', test: true },
      { dir: 'scripts/runner', name: '@x/runner', test: true },
      { dir: 'tools/lint', name: '@x/lint', test: false },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a workspace entry the shards cannot resolve throws', () => {
  for (const [entry, message] of [
    ["'packages/**'", /can't resolve/],
    ["'apps/{web,docs}'", /can't resolve/],
    ["'missing/dir'", /no package\.json/],
    ["'.'", /names the root/],
    ["'./'", /names the root/],
  ]) {
    const root = workspace(`packages:\n  - ${entry}\n`, {});
    try {
      assert.throws(() => workspacePackages(root), message, entry);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  const empty = workspace('strictDepBuilds: true\n', {});
  try {
    assert.throws(() => workspacePackages(empty), /lists no packages/);
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
});

test('a symlinked package directory is followed, as pnpm follows it', () => {
  const root = workspace("packages:\n  - 'packages/*'\n", {
    'elsewhere/real': { name: '@x/real', scripts: { test: 't' } },
    packages: null,
  });
  try {
    symlinkSync(path.join(root, 'elsewhere', 'real'), path.join(root, 'packages', 'linked'));
    assert.deepEqual(workspacePackages(root), [
      { dir: 'packages/linked', name: '@x/real', test: true },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
