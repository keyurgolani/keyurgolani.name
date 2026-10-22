// The fixture gate (#7, item 10), built in #19 Slice 2 for #7, #6, and #11:
// which build-time flag admits each test fixture package, by the package's
// directory. A `portfolio.fixture: true` package registers only when the flag
// its directory maps to holds a value its row accepts; registry generation
// fails on a fixture package no row maps; and a build without a package's
// flag fails if that package's ids reach the registry another way.
//
// Each fixture family adds a row. A flag may have several rows, each admitting
// its own directories at its own values: #6's BUDGET_FIXTURES takes 1 and
// over, and each admits different fixtures. FIXTURE_FLAGS in the generated
// metadata module holds one boolean per flag, true when the flag's value
// admits any of its rows.

import fs from 'node:fs';
import path from 'node:path';
import type { FixtureGate } from '@portfolio/variant-contract/node';

export interface FixtureRow {
  /** The environment variable, such as APPEARANCE_FIXTURES. */
  readonly flag: string;
  /** Its key in the generated FIXTURE_FLAGS, such as appearance. */
  readonly key: string;
  /**
   * The fixture packages' directories, relative to the repository root, such
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
];

type Environment = Readonly<Record<string, string | undefined>>;

function matches(pattern: string, directory: string): boolean {
  return pattern.endsWith('*')
    ? directory.startsWith(pattern.slice(0, -1)) &&
        !directory.slice(pattern.length - 1).includes('/')
    : directory === pattern;
}

/** The row that maps `directory`, relative to the repository root, if any. */
export function fixtureRow(
  directory: string,
  rows: readonly FixtureRow[] = FIXTURE_ROWS,
): FixtureRow | undefined {
  return rows.find((row) => row.directories.some((pattern) => matches(pattern, directory)));
}

/**
 * The gate registry generation runs with: a fixture package's real
 * directory, relative to `repoRoot`, picks its row, and the row's flag in
 * `env` admits it or not. A package outside the repository, such as one
 * installed from a registry, matches no row.
 */
export function fixtureGate(
  env: Environment,
  repoRoot: string,
  rows: readonly FixtureRow[] = FIXTURE_ROWS,
): FixtureGate {
  // Both sides real, so a temporary copy of the workspace, under macOS's
  // /var -> /private/var, maps as the checkout does.
  const root = fs.realpathSync(repoRoot);
  return ({ dir }) => {
    let real: string;
    try {
      real = fs.realpathSync(dir);
    } catch {
      return { mapped: false };
    }
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
