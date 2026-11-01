// The fixture gate (#7, item 10), built in #19 Slice 2 for #7, #6, and #11:
// which build-time flag admits each test fixture package, by the package's
// directory. A `portfolio.fixture: true` package registers only when the flag
// its directory maps to holds a value its row accepts; registry generation
// fails on a fixture package no row maps; and a build without a package's
// flag fails if that package's ids reach the registry another way.
//
// Each fixture family adds a row. A flag may have several rows, each admitting
// its own directories at its own values: #6's BUDGET_FIXTURES=1 admits the
// light and medium fixture variants, and BUDGET_FIXTURES=over the one over
// its budget, alone. FIXTURE_FLAGS in the generated metadata module holds
// one boolean per flag, true when the flag's value admits any of its rows.

import fs from 'node:fs';
import path from 'node:path';
import type { FixtureGate } from '@portfolio/variant-contract/node';

export interface FixtureRow {
  /** The environment variable, such as APPEARANCE_FIXTURES. */
  readonly flag: string;
  /** Its key in the generated FIXTURE_FLAGS, such as appearance. */
  readonly key: string;
  /**
   * The fixture packages' directories, relative to the workspace root, such
   * as packages/appearance-fixtures-*. A trailing * matches the rest of the
   * directory's name.
   */
  readonly directories: readonly string[];
  /** The flag's values that admit these directories, such as 1. */
  readonly values: readonly string[];
}

export const FIXTURE_ROWS: readonly FixtureRow[] = [
  {
    flag: 'APPEARANCE_FIXTURES',
    key: 'appearance',
    directories: ['packages/appearance-fixtures-*'],
    values: ['1'],
  },
  // #7's environment fixture, fixture-environment, which preview renders style against.
  {
    flag: 'PREVIEW_FIXTURES',
    key: 'preview',
    directories: ['packages/preview-fixtures'],
    values: ['1'],
  },
  // #11, Slice 1, item 9: the nine tier fixture packs, which the quality
  // build sets QUALITY_FIXTURES=1 for, and quality:meta's build too.
  {
    flag: 'QUALITY_FIXTURES',
    key: 'quality',
    directories: [
      'packages/quality-fixtures-languages',
      'packages/quality-fixtures-schemes',
      'packages/quality-fixtures-typography',
    ],
    values: ['1', 'meta'],
  },
  // The known-bad low-contrast scheme, under meta alone. The table admits
  // packages by directory, so it has a package of its own.
  {
    flag: 'QUALITY_FIXTURES',
    key: 'quality',
    directories: ['packages/quality-fixtures-schemes-meta'],
    values: ['meta'],
  },
  // #6, Slice 2: the variants the trace publishes in turn.
  {
    flag: 'BUDGET_FIXTURES',
    key: 'budget',
    directories: [
      'packages/budget-fixtures/fixture-variant-light',
      'packages/budget-fixtures/fixture-variant-medium',
      // The trace's typography profile, which ships a font for the font
      // budget and the fonts-blocked mode to count and block.
      'packages/budget-fixtures/fixture-type-font',
    ],
    values: ['1'],
  },
  // The variant over its budget, which the budget check must fail, on its own.
  {
    flag: 'BUDGET_FIXTURES',
    key: 'budget',
    directories: ['packages/budget-fixtures/fixture-over-budget'],
    values: ['over'],
  },
];

type Environment = Readonly<Record<string, string | undefined>>;

function matches(pattern: string, directory: string): boolean {
  return pattern.endsWith('*')
    ? directory.startsWith(pattern.slice(0, -1)) &&
        !directory.slice(pattern.length - 1).includes('/')
    : directory === pattern;
}

/** The row that maps `directory`, relative to its workspace's root, if any. */
export function fixtureRow(
  directory: string,
  rows: readonly FixtureRow[] = FIXTURE_ROWS,
): FixtureRow | undefined {
  return rows.find((row) => row.directories.some((pattern) => matches(pattern, directory)));
}

/** The root of the pnpm workspace `dir` is in: the nearest directory with a pnpm-workspace.yaml. */
function workspaceRoot(dir: string): string | undefined {
  for (let current = dir; ; current = path.dirname(current)) {
    try {
      if (fs.statSync(path.join(current, 'pnpm-workspace.yaml')).isFile()) return current;
    } catch {
      // Not this one.
    }
    if (path.dirname(current) === current) return undefined;
  }
}

/**
 * The gate registry generation runs with. A fixture package's real
 * directory, relative to the root of the workspace that holds it, picks its
 * row, and the row's flag in `env` admits it or not. A workspace package is
 * read where pnpm linked it from, which is this repository, or the checkout
 * a scratch copy links its installs to. A package installed from a registry
 * is under node_modules, where no row maps.
 */
export function fixtureGate(
  env: Environment,
  rows: readonly FixtureRow[] = FIXTURE_ROWS,
): FixtureGate {
  return ({ dir }) => {
    let real: string;
    try {
      real = fs.realpathSync(dir);
    } catch {
      return { mapped: false };
    }
    const root = workspaceRoot(path.dirname(real));
    if (!root) return { mapped: false };
    const row = fixtureRow(path.relative(root, real).split(path.sep).join('/'), rows);
    if (!row) return { mapped: false };
    return { mapped: true, flag: row.flag, admitted: row.values.includes(env[row.flag] ?? '') };
  };
}

/** FIXTURE_FLAGS: one boolean per flag key, true when the flag's value admits any of its rows. */
export function fixtureFlags(
  env: Environment,
  rows: readonly FixtureRow[] = FIXTURE_ROWS,
): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const row of rows) {
    flags[row.key] = (flags[row.key] ?? false) || row.values.includes(env[row.flag] ?? '');
  }
  return flags;
}
