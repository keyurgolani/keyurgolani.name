import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  assign,
  attributeHarness,
  BROWSER_WALL_RATIO,
  browserWorkers,
  commandsFor,
  loadDurations,
  measure,
  mergeDurations,
  parseShard,
  plan,
  specFiles,
  SUITES,
  unitItems,
  wallOf,
  wallRatioDrift,
  wallRatios,
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
  for (const count of [1, 2, 3, 4]) {
    partitions(
      Array.from({ length: count }, (_, i) => plan('browser', `${i + 1}/${count}`, items).mine),
      items,
    );
  }
});

test("CI's browser shards, four (row 54, #175), cover every spec file exactly once, none of them empty", () => {
  const items = specFiles('tests/e2e');
  assert.equal(SUITES.browser.count, 4);
  const shards = Array.from(
    { length: SUITES.browser.count },
    (_, i) => plan('browser', `${i + 1}/${SUITES.browser.count}`, items).mine,
  );
  partitions(shards, items);
  for (const [index, shard] of shards.entries()) {
    assert.ok(shard.items.length > 0, `browser ${index + 1}/4 runs something`);
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

test("a browser shard's Playwright run ends at SHARD_GLOBAL_TIMEOUT_MINUTES with its report when the job sets it, and has no suite limit when it doesn't", () => {
  const files = ['tests/e2e/pair.spec.ts'];
  const [set] = commandsFor('browser', files, [], { SHARD_GLOBAL_TIMEOUT_MINUTES: '37' });
  assert.deepEqual(set.slice(1, 3), ['test', '--global-timeout=2220000']);
  assert.equal(set.at(-1), 'tests/e2e/pair\\.spec\\.ts$');
  for (const env of [{}, { SHARD_GLOBAL_TIMEOUT_MINUTES: '' }]) {
    const [plain] = commandsFor('browser', files, [], env);
    assert.ok(!plain.some((arg) => arg.startsWith('--global-timeout')), JSON.stringify(env));
  }
  assert.throws(
    () => commandsFor('browser', files, [], { SHARD_GLOBAL_TIMEOUT_MINUTES: 'soon' }),
    /SHARD_GLOBAL_TIMEOUT_MINUTES is "soon", not a whole number of minutes/,
  );
  // The variants shards take no suite limit from it.
  const [variants] = commandsFor('variants', ['modes'], [], { SHARD_GLOBAL_TIMEOUT_MINUTES: '37' });
  assert.ok(!variants.some((arg) => arg.startsWith('--global-timeout')));
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

test("pnpm 10's sequential output is measured too, and measuring merges into the weights instead of replacing them", () => {
  const log = [
    logLine(
      'pnpm ci:unit',
      '01:00.0',
      '> @portfolio/schema@0.1.1 test /home/runner/work/site/site/packages/schema',
    ),
    logLine('pnpm ci:unit', '01:00.5', '> tsx --test src/**/*.test.ts'),
    logLine(
      'pnpm ci:unit',
      '01:20.0',
      '> @portfolio/web@0.1.1 test /home/runner/work/site/site/apps/web',
    ),
    logLine(
      'pnpm ci:unit',
      '07:30.0',
      '> portfolio-monorepo@0.1.1 test:quality /home/runner/work/site/site',
    ),
    logLine('pnpm ci:unit', '09:12.0', '[ci] unit passed in 492.0s'),
  ].join('\n');
  const measured = measure('unit', log);
  assert.deepEqual(measured, {
    'pkg:packages/schema': 20,
    'pkg:apps/web': 370,
    'script:test:quality': 102,
  });
  // The weights a log doesn't measure stay, and the ones it does are replaced.
  const section = {
    'pkg:apps/web': 389.7,
    'pkg:packages/core': 187.8,
    'pkg:packages/kit': 65,
    'pkg:packages/schema': 20.4,
    'script:test:scripts': 330.8,
  };
  assert.deepEqual(mergeDurations(section, measured), {
    'pkg:apps/web': 370,
    'pkg:packages/core': 187.8,
    'pkg:packages/kit': 65,
    'pkg:packages/schema': 20,
    'script:test:quality': 102,
    'script:test:scripts': 330.8,
  });
  assert.deepEqual(Object.keys(mergeDurations(undefined, measured)), Object.keys(measured).sort());
});

test("a unit item the log never closes isn't measured: a job cancelled at its limit, or ended by a failure, keeps that item's weight", () => {
  const seq = (time, text) => logLine('pnpm ci:unit', time, text);
  const kit = seq(
    '01:00.0',
    '> @portfolio/kit@0.1.1 test /home/runner/work/site/site/packages/kit',
  );
  const quality = seq(
    '02:00.0',
    '> portfolio-monorepo@0.1.1 test:quality /home/runner/work/site/site',
  );
  const plan = seq(
    '11:00.0',
    '> portfolio-monorepo@0.1.1 test:variants-plan /home/runner/work/site/site',
  );
  // Cancelled at the limit, inside its last item: no [ci] line, so test:variants-plan is cut short.
  const cancelled = [
    kit,
    quality,
    plan,
    seq('11:03.7', 'ok 135 - links are read as same-origin paths'),
  ];
  assert.deepEqual(measure('unit', cancelled.join('\n')), {
    'pkg:packages/kit': 60,
    'script:test:quality': 540,
  });
  // The same job run to its end closes the item with the runner's line, and measures it.
  const finished = [...cancelled.slice(0, 3), seq('11:02.6', '[ci] unit passed in 662.6s')];
  assert.deepEqual(measure('unit', finished.join('\n')), {
    'pkg:packages/kit': 60,
    'script:test:quality': 540,
    'script:test:variants-plan': 2.6,
  });
  // Ended by a failure, its runner's line missing: the open item isn't measured either, and the
  // merge keeps the weight it had.
  const failed = [kit, quality, seq('05:00.0', ' ELIFECYCLE  Command failed with exit code 1.')];
  const measured = measure('unit', failed.join('\n'));
  assert.deepEqual(measured, { 'pkg:packages/kit': 60 });
  assert.deepEqual(mergeDurations({ 'script:test:quality': 540.8 }, measured), {
    'pkg:packages/kit': 60,
    'script:test:quality': 540.8,
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

/** The most of the browser suite's planned time its unmeasured specs may hold. */
const UNMEASURED_SHARE = 0.1;
/** The most of a browser job's test time a shard's wall may take: the rest is a slow runner's and growth's. */
const WALL_SHARE = 0.75;
/** What a browser job spends before its test step: install, caches and the build. */
const SETUP_MINUTES = 2;

/** Each spec's planned weight, as plan() weighs it: a harness module's time goes to its callers. */
function browserPlanWeights(items, durations = loadDurations()) {
  const weights = attributeHarness(durations.browser ?? {}, items, (spec) =>
    readFileSync(path.join(ROOT, spec), 'utf8'),
  );
  const known = items.map((item) => weights[item]).filter((w) => Number.isFinite(w) && w > 0);
  const sorted = [...known].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1;
  const measured = (item) => Number.isFinite(weights[item]) && weights[item] > 0;
  return { weights, median, measured };
}

test("the durations file measures CI's browser specs: those it doesn't, each weighed at the median, plan at most a tenth of the suite", () => {
  const items = specFiles('tests/e2e');
  const { weights, median, measured } = browserPlanWeights(items);
  const unmeasured = items.filter((item) => !measured(item));
  const total = items.reduce((sum, item) => sum + (measured(item) ? weights[item] : median), 0);
  const share = (unmeasured.length * median) / total;
  assert.ok(
    share <= UNMEASURED_SHARE,
    `${unmeasured.length} of ${items.length} specs unmeasured, each at the median ${median.toFixed(1)} s: ${Math.round(share * 100)}% of the ${Math.round(total)} s planned, over ${UNMEASURED_SHARE * 100}%`,
  );
});

test("every browser shard's wall, its planned time at the suite's workers times the wall ratio CI shows, takes at most three quarters of its job's test time", () => {
  const ci = parseYaml(readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8'));
  const limit = ci.jobs.browser['timeout-minutes'];
  const workers = browserWorkers();
  assert.ok(
    Number.isInteger(limit) && workers > 0,
    'the browser job sets a limit, the config its workers',
  );
  const budget = WALL_SHARE * (limit - SETUP_MINUTES);
  const items = specFiles('tests/e2e');
  for (let index = 1; index <= SUITES.browser.count; index++) {
    const { mine } = plan('browser', `${index}/${SUITES.browser.count}`, items);
    const wall = (mine.weight / workers / 60) * BROWSER_WALL_RATIO;
    assert.ok(
      wall <= budget,
      `browser ${index}/${SUITES.browser.count} plans ${mine.weight} s: ${wall.toFixed(1)} min of wall at ${workers} workers and ${BROWSER_WALL_RATIO}x, over ${WALL_SHARE} of ${limit - SETUP_MINUTES} (${budget.toFixed(1)} min)`,
    );
  }
});

test("the browser wall ratio covers every shard the durations file measured, so the budget check never runs on a ratio below CI's", () => {
  const shards = loadDurations().walls?.browser ?? [];
  assert.ok(shards.length >= 8, `${shards.length} browser shards with a measured wall`);
  assert.equal(wallRatioDrift(shards), null);
});

test('a shard that ran over the wall ratio, rounded up to 0.05, fails the ratio; one under it passes', () => {
  const shard = (ratio) => ({
    log: `logs-1/browser-${ratio}.log`,
    wall: 900,
    planned: 1200,
    ratio,
  });
  assert.equal(wallRatioDrift([shard(1.2), shard(1.49)], 1.5), null);
  assert.equal(wallRatioDrift([shard(1.2), shard(1.5)], 1.5), null);
  assert.match(
    wallRatioDrift([shard(1.2), shard(1.51)], 1.5),
    /^logs-1\/browser-1\.51\.log ran 1\.51x its planned time, 1\.55 rounded up, over the 1\.5 /,
  );
  assert.match(wallRatioDrift([]), /no browser shard has a measured wall/);
});

test("a browser shard's wall is the suite's own time from its log, and a cancelled one has none", () => {
  const line = (time, text) => `browser (1/4)\tUNKNOWN STEP\t2026-11-20T04:${time}Z ${text}`;
  const tests = [
    line('50:00.0000000', '  ✓    1 [chromium] › tests/e2e/a.spec.ts:3:1 › one (300.0s)'),
    line('55:00.0000000', '  ✓    2 [chromium] › tests/e2e/b.spec.ts:3:1 › two (300.0s)'),
  ];
  const done = [...tests, line('56:00.0000000', '[ci] browser passed in 450.0s')].join('\n');
  const cut = tests.join('\n');
  assert.equal(wallOf(done), 450);
  assert.equal(wallOf(cut), null);
  // 600 s of tests at two workers plan 300 s; the suite took 450.
  assert.deepEqual(
    wallRatios(
      [
        { log: 'done.log', text: done },
        { log: 'cut.log', text: cut },
      ],
      2,
    ),
    [{ log: 'done.log', wall: 450, planned: 600, ratio: 1.5 }],
  );
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
