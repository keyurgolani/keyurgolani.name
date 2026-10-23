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
// with rows of their own.

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

test('every fixture package in the workspace maps to a row of the table', () => {
  const marked = fs
    .readdirSync(path.join(REPO_ROOT, 'packages'))
    .filter((dir) => {
      const file = path.join(REPO_ROOT, 'packages', dir, 'package.json');
      return (
        fs.existsSync(file) &&
        (JSON.parse(fs.readFileSync(file, 'utf8')) as { portfolio?: { fixture?: unknown } })
          .portfolio?.fixture === true
      );
    })
    .sort();
  assert.deepEqual(marked, [
    'appearance-fixtures-languages',
    'appearance-fixtures-schemes',
    'appearance-fixtures-typography',
    'quality-fixtures-languages',
    'quality-fixtures-schemes',
    'quality-fixtures-schemes-meta',
    'quality-fixtures-typography',
  ]);
  for (const dir of marked) assert.ok(fixtureRow(`packages/${dir}`), dir);
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
  assert.deepEqual(fixtureFlags({}), { appearance: false, quality: false });
  assert.deepEqual(fixtureFlags({ APPEARANCE_FIXTURES: '1' }), {
    appearance: true,
    quality: false,
  });
  assert.deepEqual(fixtureFlags({ APPEARANCE_FIXTURES: 'yes' }), {
    appearance: false,
    quality: false,
  });
  // quality is true under either value, since each admits quality fixture packs into the build.
  assert.deepEqual(fixtureFlags({ QUALITY_FIXTURES: '1' }), { appearance: false, quality: true });
  assert.deepEqual(fixtureFlags({ QUALITY_FIXTURES: 'meta' }), {
    appearance: false,
    quality: true,
  });
  assert.deepEqual(fixtureFlags({ QUALITY_FIXTURES: 'yes' }), {
    appearance: false,
    quality: false,
  });
  // A flag has one key and a key one flag, however many rows the flag has.
  const keys = new Map<string, Set<string>>();
  for (const { flag, key } of FIXTURE_ROWS) keys.set(key, (keys.get(key) ?? new Set()).add(flag));
  for (const [key, flags] of keys) assert.equal(flags.size, 1, key);
  assert.equal(new Set(FIXTURE_ROWS.map(({ flag }) => flag)).size, keys.size);

  // A flag whose values admit different fixtures, as #6's BUDGET_FIXTURES will: a row per value.
  const rows: FixtureRow[] = [
    ...FIXTURE_ROWS,
    {
      flag: 'BUDGET_FIXTURES',
      key: 'budget',
      directories: ['packages/budget-fixtures'],
      values: ['1', 'over'],
    },
    {
      flag: 'BUDGET_FIXTURES',
      key: 'budget',
      directories: ['packages/budget-fixtures-over'],
      values: ['over'],
    },
  ];
  assert.deepEqual(fixtureFlags({ BUDGET_FIXTURES: '1' }, rows), {
    appearance: false,
    quality: false,
    budget: true,
  });
  assert.deepEqual(fixtureFlags({ BUDGET_FIXTURES: 'over' }, rows), {
    appearance: false,
    quality: false,
    budget: true,
  });
  assert.deepEqual(fixtureFlags({ BUDGET_FIXTURES: '2' }, rows), {
    appearance: false,
    quality: false,
    budget: false,
  });

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-fixture-gate-'));
  try {
    const root = workspace(scratch, 'repo', [
      'packages/budget-fixtures',
      'packages/budget-fixtures-over',
    ]);
    const admits = (value: string, dir: string) => {
      const decision = fixtureGate(
        { BUDGET_FIXTURES: value },
        rows,
      )({
        name: `@portfolio/${dir}`,
        dir: path.join(root, 'packages', dir),
      });
      return decision.mapped && decision.admitted;
    };
    assert.deepEqual(
      [admits('1', 'budget-fixtures'), admits('1', 'budget-fixtures-over')],
      [true, false],
    );
    assert.deepEqual(
      [admits('over', 'budget-fixtures'), admits('over', 'budget-fixtures-over')],
      [true, true],
    );
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
