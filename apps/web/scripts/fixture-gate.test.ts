import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRegistry } from '@portfolio/variant-contract/node';
import {
  FIXTURE_ROWS,
  fixtureFlags,
  fixtureGate,
  fixtureRow,
  type FixtureRow,
} from './fixture-gate';
import { packHooks } from './registry-options';

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
  ]);
  for (const dir of marked) assert.ok(fixtureRow(`packages/${dir}`), dir);
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
  assert.deepEqual(fixtureFlags({}), { appearance: false });
  assert.deepEqual(fixtureFlags({ APPEARANCE_FIXTURES: '1' }), { appearance: true });
  assert.deepEqual(fixtureFlags({ APPEARANCE_FIXTURES: 'yes' }), { appearance: false });
  assert.deepEqual(
    FIXTURE_ROWS.map(({ key }) => key),
    [...new Set(FIXTURE_ROWS.map(({ key }) => key))],
  );

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
    budget: true,
  });
  assert.deepEqual(fixtureFlags({ BUDGET_FIXTURES: 'over' }, rows), {
    appearance: false,
    budget: true,
  });
  assert.deepEqual(fixtureFlags({ BUDGET_FIXTURES: '2' }, rows), {
    appearance: false,
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
