// A release candidate's quality scope and its named records (RC1's gate, path (a)): what the
// candidate's rc-quality runs of #11's full plan, and the failing cells it ships with, each named
// with its owner and the routed row that fixes it before the final release.
//
// quality/release/scope.json says which candidate the files are for (`release`, X.Y.Z-rc.N, or
// X.Y.Z for a final's rule), its scope, and where its records list is:
//
// - `full`: every cell of the full plan, as quality:full plans it with no scope file;
// - `default-packs`: every composition and surface the full plan has, in every state, display
//   mode, width, row and engine, on its own default packs alone (the language, scheme and
//   typography its sentinel cell renders, the ones quality:pr runs); every other pack, the tier
//   packs and the fixture packs are out of scope, named unswept in the file.
//
// The records list (quality/release/records.json) holds one entry a failing cell test: its cell,
// viewport, row and engine, as the run's summary names it, its `owner`, and the `routed` row that
// fixes it ("row 33"). The gate (lib/verdict.ts) fails on a failing cell test the list doesn't
// name, and on a listed one that ran and passed, since a fixed record leaves the list. A final
// release keeps the full matrix's rule: scope `full` and an empty list.
//
// release.yml's and rc-preflight.yml's quality jobs name the file in QUALITY_RELEASE_SCOPE; with
// no such variable, quality:full plans the whole matrix and the list is empty, as before.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../../ci/lib/reports.mjs';
import type { Plan } from '../cells';
import type { SummaryTest } from '../reporter';

export const SCOPES = ['full', 'default-packs'] as const;
export type ReleaseScopeKind = (typeof SCOPES)[number];

export interface ReleaseScope {
  /** The candidate (X.Y.Z-rc.N) the files are for, or a final (X.Y.Z), which holds the full rule. */
  readonly release: string;
  readonly scope: ReleaseScopeKind;
  /** What the scope leaves out, in words, for the candidate's notes. */
  readonly unswept: string;
  /** The records list, relative to the scope file. */
  readonly records: string;
}

/** One failing cell test a candidate ships with. */
export interface ListedRecord {
  readonly cell: string;
  readonly viewport: string;
  readonly row: string;
  readonly engine: string;
  /** Who fixes it: a lane or a person. */
  readonly owner: string;
  /** The routed row that fixes it before the final release: "row <n>", such as row 33 or row 22b. */
  readonly routed: string;
}

/** What a printed entry holds for its owner and row until someone fills them: validation refuses both. */
export const OWNER_PLACEHOLDER = '<owner: the lane or person who fixes it>';
export const ROUTED_PLACEHOLDER = '<routed: the row that fixes it, as row <n>>';

const RELEASE = /^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/;
const OWNER = /^[A-Za-z][A-Za-z0-9 ._-]{0,63}$/;
const ROUTED = /^row [1-9]\d*[a-z]?$/;

/** The env variable a release job names its scope file in. */
export const SCOPE_ENV = 'QUALITY_RELEASE_SCOPE';

/** Why `scope` isn't a valid scope file, one problem a line; none when it is. */
export function scopeProblems(scope: unknown): string[] {
  const problems: string[] = [];
  const value = scope as Partial<ReleaseScope> | null;
  if (!value || typeof value !== 'object') return ['the scope file is not an object'];
  if (typeof value.release !== 'string' || !RELEASE.test(value.release))
    problems.push(`release is ${JSON.stringify(value.release)}, not X.Y.Z or X.Y.Z-rc.N`);
  if (!SCOPES.includes(value.scope as ReleaseScopeKind))
    problems.push(`scope is ${JSON.stringify(value.scope)}, not one of ${SCOPES.join(', ')}`);
  if (typeof value.unswept !== 'string' || (value.scope !== 'full' && value.unswept.trim() === ''))
    problems.push('unswept must say, in words, what a narrowed scope leaves out');
  if (typeof value.records !== 'string' || value.records.trim() === '')
    problems.push('records must name the records list');
  return problems;
}

/** Why `records` isn't a valid list for `scope`, one problem a line; none when it is. */
export function recordsProblems(
  records: unknown,
  scope: Pick<ReleaseScope, 'release' | 'scope'>,
): string[] {
  const problems: string[] = [];
  if (!Array.isArray(records)) return ['the records list is not an array'];
  const seen = new Set<string>();
  records.forEach((entry: Partial<ListedRecord>, at) => {
    const where = `entry ${at + 1}`;
    for (const field of ['cell', 'viewport', 'row', 'engine'] as const) {
      if (typeof entry?.[field] !== 'string' || entry[field]!.trim() === '')
        problems.push(`${where}: ${field} is missing`);
    }
    if (typeof entry?.owner !== 'string' || !OWNER.test(entry.owner))
      problems.push(`${where}: owner is ${JSON.stringify(entry?.owner)}, not a lane or person`);
    if (typeof entry?.routed !== 'string' || !ROUTED.test(entry.routed))
      problems.push(`${where}: routed is ${JSON.stringify(entry?.routed)}, not "row <n>"`);
    const key = recordKey(entry as ListedRecord);
    if (seen.has(key)) problems.push(`${where}: listed twice`);
    seen.add(key);
  });
  // A final release keeps the full matrix's rule: every cell, and none failing.
  if (!scope.release.includes('-rc.')) {
    if (scope.scope !== 'full')
      problems.push(`${scope.release} is a final release: its scope must be full`);
    if (records.length > 0)
      problems.push(`${scope.release} is a final release: its records list must be empty`);
  }
  return problems;
}

/** A listed record's key, and a summary test's, to match them by. */
export const recordKey = (each: Pick<ListedRecord, 'cell' | 'viewport' | 'row' | 'engine'>) =>
  JSON.stringify([each.cell, each.viewport, each.row, each.engine]);

export const testRecordKey = (test: Pick<SummaryTest, 'cell' | 'viewport' | 'row' | 'engine'>) =>
  recordKey({
    cell: test.cell ?? '',
    viewport: test.viewport ?? '',
    row: test.row ?? '',
    engine: test.engine ?? '',
  });

/** A loaded scope file and its list, or why they can't be read: a release job fails on either. */
export interface LoadedScope {
  readonly file: string;
  readonly scope: ReleaseScope;
  readonly records: readonly ListedRecord[];
}

/**
 * The scope file `env` names (SCOPE_ENV, relative to the repository), with its records list, or
 * null when it names none. Throws, naming every problem, when either file is invalid. A tag's
 * rc-verify refuses one whose file is another release's (ci/release/verify-scope.mjs).
 */
export function loadReleaseScope(env: NodeJS.ProcessEnv = process.env): LoadedScope | null {
  const named = env[SCOPE_ENV];
  if (named === undefined || named === '') return null;
  const file = path.resolve(REPO_ROOT, named);
  const scope = JSON.parse(readFileSync(file, 'utf8')) as ReleaseScope;
  const problems = scopeProblems(scope);
  if (problems.length > 0) throw new Error(`${named}: ${problems.join('; ')}`);
  const listFile = path.resolve(path.dirname(file), scope.records);
  const records = JSON.parse(readFileSync(listFile, 'utf8')) as ListedRecord[];
  const listed = recordsProblems(records, scope);
  if (listed.length > 0)
    throw new Error(`${path.relative(REPO_ROOT, listFile)}: ${listed.join('; ')}`);
  return { file, scope, records };
}

const packKey = (tuple: Plan['cells'][number]['tuple']) =>
  `${tuple.designLanguage}/${tuple.colorScheme}/${tuple.typography}`;

/**
 * `plan` cut to `scope`: `full` keeps it whole; `default-packs` keeps every target's cells on its
 * own default packs (its sentinel cells' language, scheme and typography), no tier or fixture pack,
 * in every state, display mode, viewport and row, and the tests of those cells. The targets stay,
 * so each still needs results.
 */
export function scopePlan<P extends Pick<Plan, 'cells' | 'tests'>>(
  plan: P,
  scope: Pick<ReleaseScope, 'scope'>,
): P {
  if (scope.scope === 'full') return plan;
  const defaults = new Map<string, Set<string>>();
  for (const cell of plan.cells) {
    if (!cell.sentinel || cell.pack !== undefined || cell.fixture) continue;
    const target = `${cell.kind}:${cell.target}`;
    defaults.set(target, (defaults.get(target) ?? new Set()).add(packKey(cell.tuple)));
  }
  const cells = plan.cells.filter(
    (cell) =>
      cell.pack === undefined &&
      !cell.fixture &&
      defaults.get(`${cell.kind}:${cell.target}`)?.has(packKey(cell.tuple)) === true,
  );
  const ids = new Set(cells.map((cell) => cell.id));
  return { ...plan, cells, tests: plan.tests.filter((test) => ids.has(test.cell.id)) };
}

/**
 * A ready-to-paste list entry for a failing cell test the list doesn't name: its cell, viewport,
 * row and engine, and placeholders for its owner and routed row, which the list's validation
 * refuses until someone fills them, so an entry pasted as printed fails the gate.
 */
export function listEntry(test: Pick<SummaryTest, 'cell' | 'viewport' | 'row' | 'engine'>): string {
  return JSON.stringify({
    cell: test.cell ?? '',
    viewport: test.viewport ?? '',
    row: test.row ?? '',
    engine: test.engine ?? '',
    owner: OWNER_PLACEHOLDER,
    routed: ROUTED_PLACEHOLDER,
  });
}
