import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRegistry } from '@portfolio/variant-contract/node';
import { FIXTURE_FLAG } from '../../../ci/lib/fixture-flags.mjs';
import {
  FIXTURE_ROWS,
  fixtureFlags,
  fixtureGate,
  fixtureRow,
  type FixtureRow,
} from './fixture-gate';
import { packHooks, registryOptions } from './registry-options';

// The fixture gate (#7, item 10; built in #19, Slice 2): a table of which flag
// admits each fixture package by its directory, which #7, #6, and #11 extend
// with rows of their own. #6's BUDGET_FIXTURES takes two values, each
// admitting its own fixture variants.

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** A pnpm workspace in `parent`, with a directory for each path given. */
function workspace(parent: string, name: string, dirs: readonly string[]): string {
  const root = path.join(parent, name);
  for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), "packages: ['apps/*', 'packages/*']\n");
  return root;
}

test('APPEARANCE_FIXTURES=1 admits packages/appearance-fixtures-*, and nothing else maps', () => {
  const row = fixtureRow('packages/appearance-fixtures-schemes');
  assert.deepEqual(row, {
    flag: 'APPEARANCE_FIXTURES',
    key: 'appearance',
    directories: ['packages/appearance-fixtures-*'],
    values: ['1'],
  });
  for (const directory of [
    'packages/appearance-schemes',
    'packages/appearance-fixtures',
    'packages/appearance-fixtures-schemes/nested',
    'tests/packages/appearance-fixtures-schemes',
    '../packages/appearance-fixtures-schemes',
  ]) {
    assert.equal(fixtureRow(directory), undefined, directory);
  }
});

test("every row's flag is one ci/test-profiles.mjs clears, so the profile matrix builds without it", () => {
  assert.ok(FIXTURE_ROWS.length > 0);
  for (const { flag } of FIXTURE_ROWS) assert.match(flag, FIXTURE_FLAG, flag);
  for (const name of ['APPEARANCE', 'appearance_FIXTURES', 'APPEARANCE_FIXTURE', 'X_FIXTURES_1']) {
    assert.doesNotMatch(name, FIXTURE_FLAG, name);
  }
});

/** Each workspace package directory under packages/, as pnpm-workspace.yaml lists them. */
function packageDirs(): string[] {
  const under = (parent: string) =>
    fs
      .readdirSync(path.join(REPO_ROOT, parent))
      .map((dir) => `${parent}/${dir}`)
      .filter((dir) => fs.existsSync(path.join(REPO_ROOT, dir, 'package.json')));
  return [...under('packages'), ...under('packages/budget-fixtures')].sort();
}

test('every fixture package in the workspace maps to a row of the table', () => {
  const marked = packageDirs().filter(
    (dir) =>
      (
        JSON.parse(fs.readFileSync(path.join(REPO_ROOT, dir, 'package.json'), 'utf8')) as {
          portfolio?: { fixture?: unknown };
        }
      ).portfolio?.fixture === true,
  );
  assert.deepEqual(marked, [
    'packages/appearance-fixtures-languages',
    'packages/appearance-fixtures-schemes',
    'packages/appearance-fixtures-typography',
    'packages/budget-fixtures/fixture-over-budget',
    'packages/budget-fixtures/fixture-variant-light',
    'packages/budget-fixtures/fixture-variant-medium',
    'packages/preview-fixtures',
    'packages/quality-fixtures-languages',
    'packages/quality-fixtures-schemes',
    'packages/quality-fixtures-schemes-meta',
    'packages/quality-fixtures-typography',
  ]);
  for (const dir of marked) assert.ok(fixtureRow(dir), dir);
});

test('BUDGET_FIXTURES=1 admits the light and medium fixture variants, and over the one over budget, alone', () => {
  const decide = (value: string | undefined, dir: string) => {
    const decision = fixtureGate({ BUDGET_FIXTURES: value })({
      name: `@portfolio/${dir}`,
      dir: path.join(REPO_ROOT, 'packages', 'budget-fixtures', dir),
    });
    assert.ok(decision.mapped, dir);
    assert.equal(decision.flag, 'BUDGET_FIXTURES', dir);
    return decision.admitted;
  };
  const dirs = ['fixture-variant-light', 'fixture-variant-medium', 'fixture-over-budget'];
  assert.deepEqual(
    dirs.map((dir) => decide('1', dir)),
    [true, true, false],
  );
  assert.deepEqual(
    dirs.map((dir) => decide('over', dir)),
    [false, false, true],
  );
  for (const value of [undefined, '', '0', 'true', 'OVER', ' 1', '1,over']) {
    assert.deepEqual(
      dirs.map((dir) => decide(value, dir)),
      [false, false, false],
      String(value),
    );
  }
  // Another directory under budget-fixtures/ isn't a row's, so a fixture there fails generation.
  assert.equal(fixtureRow('packages/budget-fixtures/fixture-variant-heavy'), undefined);
  assert.equal(fixtureRow('packages/budget-fixtures'), undefined);
});

test('the host registers each budget fixture only under the value that admits it', async () => {
  const fixtures = ['fixture-over-budget', 'fixture-variant-light', 'fixture-variant-medium'];
  const registered = async (env: Record<string, string | undefined>) => {
    const result = await readRegistry(registryOptions(env));
    assert.ok(result.ok, JSON.stringify(result.diagnostics, null, 2));
    const ids = result.variants.map(({ manifest }) => manifest.id);
    // Each fixture is decided, admitted or not, every time.
    assert.deepEqual(
      result.fixtures
        .filter(({ flag }) => flag === 'BUDGET_FIXTURES')
        .map(({ packageName }) => packageName.replace('@portfolio/', '')),
      fixtures,
    );
    return ids.filter((id) => fixtures.includes(id));
  };
  assert.deepEqual(await registered({}), []);
  assert.deepEqual(await registered({ BUDGET_FIXTURES: '1' }), [
    'fixture-variant-light',
    'fixture-variant-medium',
  ]);
  assert.deepEqual(await registered({ BUDGET_FIXTURES: 'over' }), ['fixture-over-budget']);
});

test('pnpm check:registry runs under every value a row admits, and with none', () => {
  // ci/check-registry.mjs can't import this table, so it lists the states
  // itself; a row's value it doesn't list would go unchecked.
  const source = fs.readFileSync(path.join(REPO_ROOT, 'ci', 'check-registry.mjs'), 'utf8');
  for (const { flag, values } of FIXTURE_ROWS) {
    for (const value of values) {
      assert.ok(
        source.includes(`${flag}: '${value}'`),
        `check:registry runs no state with ${flag}=${value}`,
      );
    }
  }
  assert.match(source, /label: 'without a fixture flag', env: unflagged/);
});

const QUALITY_DIRS = [
  'quality-fixtures-languages',
  'quality-fixtures-schemes',
  'quality-fixtures-typography',
  'quality-fixtures-schemes-meta',
];

test('QUALITY_FIXTURES=1 admits the nine tier packs, and meta the low-contrast scheme too', () => {
  const decide = (value: string | undefined, dir: string) => {
    const decision = fixtureGate({ QUALITY_FIXTURES: value })({
      name: `@portfolio/${dir}`,
      dir: path.join(REPO_ROOT, 'packages', dir),
    });
    assert.ok(decision.mapped, dir);
    assert.equal(decision.flag, 'QUALITY_FIXTURES', dir);
    return decision.admitted;
  };
  assert.deepEqual(
    QUALITY_DIRS.map((dir) => decide('1', dir)),
    [true, true, true, false],
  );
  assert.deepEqual(
    QUALITY_DIRS.map((dir) => decide('meta', dir)),
    [true, true, true, true],
  );
  for (const value of [undefined, '', '0', 'true', 'META', ' 1', '1,meta', 'all']) {
    assert.deepEqual(
      QUALITY_DIRS.map((dir) => decide(value, dir)),
      [false, false, false, false],
      String(value),
    );
  }
  // The rows name their directories outright, so a new quality-fixtures-*
  // directory maps to no row and its fixture fails generation.
  assert.equal(fixtureRow('packages/quality-fixtures-variants'), undefined);
  assert.equal(fixtureRow('packages/quality-fixtures'), undefined);
});

test("QUALITY_FIXTURES admits nothing APPEARANCE_FIXTURES does, and the reverse, so neither changes the other's packs", () => {
  const admitted = (env: Record<string, string>) =>
    [
      'appearance-fixtures-languages',
      'appearance-fixtures-schemes',
      'appearance-fixtures-typography',
      ...QUALITY_DIRS,
    ].filter((dir) => {
      const decision = fixtureGate(env)({
        name: `@portfolio/${dir}`,
        dir: path.join(REPO_ROOT, 'packages', dir),
      });
      return decision.mapped && decision.admitted;
    });
  assert.deepEqual(admitted({ APPEARANCE_FIXTURES: '1' }), [
    'appearance-fixtures-languages',
    'appearance-fixtures-schemes',
    'appearance-fixtures-typography',
  ]);
  assert.deepEqual(admitted({ QUALITY_FIXTURES: '1' }), QUALITY_DIRS.slice(0, 3));
  assert.deepEqual(admitted({ QUALITY_FIXTURES: 'meta' }), QUALITY_DIRS);
  assert.deepEqual(admitted({ APPEARANCE_FIXTURES: '1', QUALITY_FIXTURES: '1' }), [
    'appearance-fixtures-languages',
    'appearance-fixtures-schemes',
    'appearance-fixtures-typography',
    ...QUALITY_DIRS.slice(0, 3),
  ]);
});

test('the host registers the tier packs only under QUALITY_FIXTURES, and the low-contrast one only under meta', async () => {
  const tier = ['language', 'scheme', 'typography'].flatMap((axis) =>
    ['stable', 'extended', 'experimental'].map((name) => `fixture-${axis}-${name}`),
  );
  const low = 'fixture-scheme-experimental-low-contrast';
  const registered = async (env: Record<string, string | undefined>) => {
    const result = await readRegistry(registryOptions(env));
    assert.ok(result.ok, JSON.stringify(result.diagnostics, null, 2));
    // Each quality fixture package is decided, admitted or not, every time.
    assert.deepEqual(
      result.fixtures
        .filter(({ flag }) => flag === 'QUALITY_FIXTURES')
        .map(({ packageName }) => packageName.replace('@portfolio/', '')),
      [...QUALITY_DIRS.slice(0, 2), QUALITY_DIRS[3], QUALITY_DIRS[2]],
    );
    return result.packs
      .map(({ manifest }) => manifest.id)
      .filter((id) => tier.includes(id) || id === low)
      .sort();
  };
  assert.deepEqual(await registered({}), []);
  assert.deepEqual(await registered({ QUALITY_FIXTURES: '1' }), [...tier].sort());
  assert.deepEqual(await registered({ QUALITY_FIXTURES: 'meta' }), [...tier, low].sort());
  // A tier pack keeps its tier, so the gates read Stable, Extended, and Experimental from it.
  const result = await readRegistry(registryOptions({ QUALITY_FIXTURES: 'meta' }));
  for (const { manifest } of result.packs) {
    const id = manifest.id;
    const tierName = /^fixture-(?:language|scheme|typography)-(stable|extended|experimental)/.exec(
      id,
    )?.[1];
    if (tierName) assert.equal((manifest as { tier?: string }).tier, tierName, id);
  }
});

test("the gate reads a fixture package's real directory, relative to its workspace's root", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-fixture-gate-'));
  try {
    const name = '@portfolio/appearance-fixtures-schemes';
    const registryInstall =
      'node_modules/.pnpm/evil@1.0.0/node_modules/@acme/appearance-fixtures-evil';
    const checkout = workspace(scratch, 'checkout', [
      'packages/appearance-fixtures-schemes',
      'apps/web/node_modules/@portfolio',
      registryInstall,
    ]);
    // Installed as pnpm links a workspace package.
    const installed = path.join(checkout, 'apps', 'web', 'node_modules', '@portfolio');
    fs.symlinkSync(
      path.join(checkout, 'packages', 'appearance-fixtures-schemes'),
      path.join(installed, 'appearance-fixtures-schemes'),
      'dir',
    );
    const dir = path.join(installed, 'appearance-fixtures-schemes');
    const decide = (env: Record<string, string | undefined>, at = dir) =>
      fixtureGate(env)({ name, dir: at });

    assert.deepEqual(decide({ APPEARANCE_FIXTURES: '1' }), {
      mapped: true,
      flag: 'APPEARANCE_FIXTURES',
      admitted: true,
    });
    // Only a value the row lists admits: unset, empty, 0, and true don't.
    for (const value of [undefined, '', '0', 'true', ' 1']) {
      assert.deepEqual(
        decide({ APPEARANCE_FIXTURES: value }),
        { mapped: true, flag: 'APPEARANCE_FIXTURES', admitted: false },
        String(value),
      );
    }

    // A scratch copy whose installs link to the checkout's, as
    // ci/fresh-clone.test.mjs makes one, reads the package where the link leads.
    const copy = workspace(scratch, 'copy', ['apps/web']);
    fs.symlinkSync(
      path.join(checkout, 'apps', 'web', 'node_modules'),
      path.join(copy, 'apps', 'web', 'node_modules'),
      'dir',
    );
    const linked = path.join(
      copy,
      'apps',
      'web',
      'node_modules',
      '@portfolio',
      'appearance-fixtures-schemes',
    );
    assert.deepEqual(decide({}, linked), {
      mapped: true,
      flag: 'APPEARANCE_FIXTURES',
      admitted: false,
    });

    // A package installed from a registry, a directory in no workspace, and
    // one that isn't there map to no flag.
    const loose = path.join(scratch, 'loose', 'packages', 'appearance-fixtures-schemes');
    fs.mkdirSync(loose, { recursive: true });
    const env = { APPEARANCE_FIXTURES: '1' };
    for (const at of [
      path.join(checkout, registryInstall),
      loose,
      path.join(checkout, 'packages', 'gone'),
    ]) {
      assert.deepEqual(decide(env, at), { mapped: false }, at);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('FIXTURE_FLAGS has one boolean per flag, true when its value admits any of its rows', () => {
  const none = { appearance: false, preview: false, quality: false, budget: false };
  assert.deepEqual(fixtureFlags({}), none);
  assert.deepEqual(fixtureFlags({ APPEARANCE_FIXTURES: '1' }), { ...none, appearance: true });
  assert.deepEqual(fixtureFlags({ APPEARANCE_FIXTURES: 'yes' }), none);
  assert.deepEqual(fixtureFlags({ PREVIEW_FIXTURES: '1' }), { ...none, preview: true });
  assert.deepEqual(fixtureFlags({ PREVIEW_FIXTURES: 'yes' }), none);
  // quality is true under either value, since each admits quality fixture packs into the build.
  assert.deepEqual(fixtureFlags({ QUALITY_FIXTURES: '1' }), { ...none, quality: true });
  assert.deepEqual(fixtureFlags({ QUALITY_FIXTURES: 'meta' }), { ...none, quality: true });
  assert.deepEqual(fixtureFlags({ QUALITY_FIXTURES: 'yes' }), none);
  // budget is true under either value, each admitting its own fixture variants.
  assert.deepEqual(fixtureFlags({ BUDGET_FIXTURES: '1' }), { ...none, budget: true });
  assert.deepEqual(fixtureFlags({ BUDGET_FIXTURES: 'over' }), { ...none, budget: true });
  assert.deepEqual(fixtureFlags({ BUDGET_FIXTURES: 'all' }), none);
  // A flag has one key and a key one flag, however many rows the flag has.
  const keys = new Map<string, Set<string>>();
  for (const { flag, key } of FIXTURE_ROWS) keys.set(key, (keys.get(key) ?? new Set()).add(flag));
  for (const [key, flags] of keys) assert.equal(flags.size, 1, key);
  assert.equal(new Set(FIXTURE_ROWS.map(({ flag }) => flag)).size, keys.size);

  // A flag whose values admit different fixtures, as BUDGET_FIXTURES does: a
  // row per value, and a value that two rows list admits both.
  const rows: FixtureRow[] = [
    {
      flag: 'TRIAL_FIXTURES',
      key: 'trial',
      directories: ['packages/trial-a'],
      values: ['1', 'all'],
    },
    { flag: 'TRIAL_FIXTURES', key: 'trial', directories: ['packages/trial-b'], values: ['all'] },
  ];
  assert.deepEqual(fixtureFlags({ TRIAL_FIXTURES: '1' }, rows), { trial: true });
  assert.deepEqual(fixtureFlags({ TRIAL_FIXTURES: 'all' }, rows), { trial: true });
  assert.deepEqual(fixtureFlags({ TRIAL_FIXTURES: '2' }, rows), { trial: false });

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-fixture-gate-'));
  try {
    const root = workspace(scratch, 'repo', ['packages/trial-a', 'packages/trial-b']);
    const admits = (value: string, dir: string) => {
      const decision = fixtureGate(
        { TRIAL_FIXTURES: value },
        rows,
      )({
        name: `@portfolio/${dir}`,
        dir: path.join(root, 'packages', dir),
      });
      return decision.mapped && decision.admitted;
    };
    assert.deepEqual([admits('1', 'trial-a'), admits('1', 'trial-b')], [true, false]);
    assert.deepEqual([admits('all', 'trial-a'), admits('all', 'trial-b')], [true, true]);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('appearance-fixtures-schemes with its fixture mark removed fails generation, flag or not', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-fixture-gate-'));
  try {
    const root = workspace(scratch, 'repo', ['apps/web/node_modules/@portfolio']);
    const name = '@portfolio/appearance-fixtures-schemes';
    const copy = path.join(root, 'packages', 'appearance-fixtures-schemes');
    fs.cpSync(path.join(REPO_ROOT, 'packages', 'appearance-fixtures-schemes'), copy, {
      recursive: true,
    });
    const pkg = JSON.parse(fs.readFileSync(path.join(copy, 'package.json'), 'utf8'));
    delete pkg.portfolio.fixture;
    fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify(pkg));
    fs.symlinkSync(
      copy,
      path.join(root, 'apps', 'web', 'node_modules', '@portfolio', 'appearance-fixtures-schemes'),
      'dir',
    );
    const hostDir = path.join(root, 'apps', 'web');
    fs.writeFileSync(
      path.join(hostDir, 'package.json'),
      JSON.stringify({ name: '@portfolio/web', dependencies: { [name]: 'workspace:*' } }),
    );
    for (const env of [{}, { APPEARANCE_FIXTURES: '1' }]) {
      const result = await readRegistry({
        hostDir,
        packs: packHooks(),
        fixtures: fixtureGate(env),
      });
      const own = result.diagnostics.filter((record) => record.package === name);
      assert.deepEqual(
        own.map(({ code, pointer }) => [code, pointer]),
        [['registry.fixture-unmarked', '/portfolio/fixture']],
        JSON.stringify(env),
      );
      assert.equal(result.ok, false);
      assert.ok(result.packs.every(({ packageName }) => packageName !== name));
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('PREVIEW_FIXTURES=1 admits packages/preview-fixtures, and nothing else maps to it (#7, Slice 4)', () => {
  assert.deepEqual(fixtureRow('packages/preview-fixtures'), {
    flag: 'PREVIEW_FIXTURES',
    key: 'preview',
    directories: ['packages/preview-fixtures'],
    values: ['1'],
  });
  for (const directory of [
    'packages/preview-fixtures-extra',
    'packages/preview',
    'packages/preview-fixtures/nested',
    'tests/packages/preview-fixtures',
  ]) {
    assert.equal(fixtureRow(directory), undefined, directory);
  }
});

const PREVIEW_FIXTURES = '@portfolio/preview-fixtures';

/**
 * A scratch host whose apps/web depends on copies of packages/preview-fixtures,
 * named and marked as `copies` says, each linked as pnpm links a workspace package.
 */
function previewHost(
  scratch: string,
  copies: readonly { dir: string; name: string; fixture: boolean }[],
): string {
  const root = workspace(scratch, 'repo', ['apps/web/node_modules']);
  const dependencies: Record<string, string> = {};
  for (const { dir, name, fixture } of copies) {
    const copy = path.join(root, 'packages', dir);
    fs.cpSync(path.join(REPO_ROOT, 'packages', 'preview-fixtures'), copy, {
      recursive: true,
      filter: (source) => !source.split(path.sep).includes('node_modules'),
    });
    const pkg = JSON.parse(fs.readFileSync(path.join(copy, 'package.json'), 'utf8'));
    pkg.name = name;
    if (fixture) pkg.portfolio.fixture = true;
    else delete pkg.portfolio.fixture;
    fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify(pkg));
    const link = path.join(root, 'apps', 'web', 'node_modules', ...name.split('/'));
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(copy, link, 'dir');
    dependencies[name] = 'workspace:*';
  }
  const hostDir = path.join(root, 'apps', 'web');
  fs.writeFileSync(
    path.join(hostDir, 'package.json'),
    JSON.stringify({ name: '@portfolio/web', dependencies }),
  );
  return hostDir;
}

test('preview-fixtures with no row for its directory fails generation, flag or not (#7, Slice 4)', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-fixture-gate-'));
  try {
    const hostDir = previewHost(scratch, [
      { dir: 'preview-fixtures', name: PREVIEW_FIXTURES, fixture: true },
    ]);
    const rows = FIXTURE_ROWS.filter(({ flag }) => flag !== 'PREVIEW_FIXTURES');
    for (const env of [{}, { PREVIEW_FIXTURES: '1' }]) {
      const result = await readRegistry({
        hostDir,
        packs: packHooks(),
        fixtures: fixtureGate(env, rows),
      });
      const own = result.diagnostics.filter((record) => record.package === PREVIEW_FIXTURES);
      assert.deepEqual(
        own.map(({ code, pointer }) => [code, pointer]),
        [['registry.fixture-unmapped', '/portfolio/fixture']],
        JSON.stringify(env),
      );
      assert.equal(result.ok, false);
      assert.ok(result.variants.every(({ manifest }) => manifest.id !== 'fixture-environment'));
    }
    // With its row, the flag registers it, and without the flag nothing does.
    const admitted = await readRegistry({
      hostDir,
      packs: packHooks(),
      fixtures: fixtureGate({ PREVIEW_FIXTURES: '1' }),
    });
    assert.deepEqual(
      admitted.variants.map(({ manifest }) => manifest.id),
      ['fixture-environment'],
    );
    assert.deepEqual(admitted.fixtures, [
      {
        packageName: PREVIEW_FIXTURES,
        flag: 'PREVIEW_FIXTURES',
        admitted: true,
        ids: ['fixture-environment'],
      },
    ]);
    const unflagged = await readRegistry({
      hostDir,
      packs: packHooks(),
      fixtures: fixtureGate({}),
    });
    assert.deepEqual(unflagged.variants, []);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('a build without PREVIEW_FIXTURES fails when fixture-environment reaches the registry another way (#7, Slice 4)', async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-fixture-gate-'));
  try {
    const hostDir = previewHost(scratch, [
      { dir: 'preview-fixtures', name: PREVIEW_FIXTURES, fixture: true },
      // Another package that registers the fixture's id, outside every fixture directory.
      { dir: 'environment-copy', name: '@portfolio/environment-copy', fixture: false },
    ]);
    const result = await readRegistry({ hostDir, packs: packHooks(), fixtures: fixtureGate({}) });
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.diagnostics
        .filter(({ code }) => code === 'registry.fixture-leak')
        .map(({ package: name, actual }) => [name, actual]),
      [['@portfolio/environment-copy', 'fixture-environment']],
    );
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
