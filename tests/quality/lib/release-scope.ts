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
// The records list (quality/release/records.json) holds one entry a failure record: its cell,
// viewport, row and engine, as the run's summary names its test, the record's check, rule and
// target element, its `owner`, and the `routed` row that fixes it ("row 33"); the key and its
// matcher are ci/release/release-records.mjs's, which rc-verify uses too. The gate
// (lib/verdict.ts) fails on a failure the list doesn't name, and on a listed one that's gone from
// a test that ran, since a fixed record leaves the list. A final release keeps the full matrix's
// rule: scope `full` and an empty list.
//
// release.yml's and rc-preflight.yml's quality jobs name the file in QUALITY_RELEASE_SCOPE; with
// no such variable, quality:full plans the whole matrix and the list is empty, as before.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../../ci/lib/reports.mjs';
import { isRelease, recordsProblems } from '../../../ci/release/release-records.mjs';
import type { Plan } from '../cells';
import { RUN_ENGINES } from './matrix';

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

/**
 * One failure record a candidate ships with: one rule failing on one element in one cell test,
 * keyed by the record's own fields, its owner and routed row beside (ci/release/release-records.mjs).
 */
export interface ListedRecord {
  readonly cell: string;
  readonly viewport: string;
  readonly row: string;
  readonly engine: string;
  /** The failure record's check: axe, focus, contrast, and the rest. */
  readonly check: string;
  /** The rule within the check that failed, such as color-contrast. */
  readonly rule: string;
  /** The element (failureTarget), or null for a record with none. */
  readonly target: string | null;
  /** Who fixes it: a lane or a person. */
  readonly owner: string;
  /** The routed row that fixes it before the final release: "row <n>", such as row 33 or row 22b. */
  readonly routed: string;
  /** For readers; never matched. */
  readonly note?: string;
  /** Seen failing and passing on one commit: its test may pass (quality/release/SCHEMA.md). */
  readonly flaky?: true;
  /** A flaky entry's evidence: the commit, and a run where it failed and one where it passed. */
  readonly seen?: { readonly commit: string; readonly failed: string; readonly passed: string };
}

export {
  failureTarget,
  isFlaky,
  MAX_FLAKY,
  judgeListed,
  listEntry,
  OWNER_PLACEHOLDER,
  recordKey,
  recordsProblems,
  ROUTED_PLACEHOLDER,
  testFailures,
} from '../../../ci/release/release-records.mjs';

/** The scope file's fields, and the records list it names: the one file beside it, by one name. */
const SCOPE_FIELDS = ['release', 'scope', 'unswept', 'records'];
export const RECORDS_FILE = 'records.json';

/** The env variable a release job names its scope file in. */
export const SCOPE_ENV = 'QUALITY_RELEASE_SCOPE';

/** Why `scope` isn't a valid scope file, one problem a line; none when it is. */
export function scopeProblems(scope: unknown): string[] {
  const problems: string[] = [];
  const value = scope as Partial<ReleaseScope> | null;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return ['the scope file is not an object'];
  for (const field of Object.keys(value)) {
    if (!SCOPE_FIELDS.includes(field)) problems.push(`${field} is not a field`);
  }
  if (!isRelease(value.release))
    problems.push(`release is ${JSON.stringify(value.release)}, not X.Y.Z or X.Y.Z-rc.N`);
  if (!SCOPES.includes(value.scope as ReleaseScopeKind))
    problems.push(`scope is ${JSON.stringify(value.scope)}, not one of ${SCOPES.join(', ')}`);
  if (typeof value.unswept !== 'string' || (value.scope !== 'full' && value.unswept.trim() === ''))
    problems.push('unswept must say, in words, what a narrowed scope leaves out');
  if (value.records !== RECORDS_FILE)
    problems.push(
      `records is ${JSON.stringify(value.records)}, not ${JSON.stringify(RECORDS_FILE)}`,
    );
  return problems;
}

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
  // Beside the scope file, as rc-verify's readScope (ci/release/verify-scope.mjs) finds it.
  const listFile = path.join(path.dirname(file), RECORDS_FILE);
  const records = JSON.parse(readFileSync(listFile, 'utf8')) as ListedRecord[];
  const listed = [
    ...recordsProblems(records, scope),
    // The engines a release run launches: an entry on any other names a test no run has.
    ...(Array.isArray(records) ? records : []).flatMap((entry, at) =>
      typeof entry?.engine === 'string' &&
      !(RUN_ENGINES.full as readonly string[]).includes(entry.engine)
        ? [
            `entry ${at + 1}: engine is ${JSON.stringify(entry.engine)}, not one of ${RUN_ENGINES.full.join(', ')}`,
          ]
        : [],
    ),
  ];
  if (listed.length > 0)
    throw new Error(`${path.relative(REPO_ROOT, listFile)}: ${listed.join('; ')}`);
  return { file, scope, records };
}

/**
 * The scope a run of `mode` may judge by: the one `env` names, or null without one. Throws when
 * the run can't take one: a release scope is quality:full's, judged whole (`whole`, as
 * quality:release merges and as a full run on one machine plans), never a PR run's or a night's
 * slice, so the everyday gate stays strict however its env is set.
 */
export function releaseScopeFor(
  mode: string | undefined,
  whole: boolean,
  env: NodeJS.ProcessEnv = process.env,
): LoadedScope | null {
  const loaded = loadReleaseScope(env);
  if (!loaded) return null;
  if (mode !== 'full')
    throw new Error(`a release scope is quality:full's, and this run is quality:${mode ?? 'pr'}`);
  if (!whole)
    throw new Error("a release scope judges the whole plan, and this run isn't the whole plan");
  return loaded;
}

/**
 * run.ts's release scope for a run of `mode` on `night` (null for the whole plan, as a release
 * shard and a full run on one machine plan it): the scope, or the setup failure that refuses the
 * run, by rule release-scope. A PR run or a night's slice whose env names a scope is refused, and
 * judged with no list.
 */
export function runReleaseScope(
  mode: string | undefined,
  night: string | null,
  env: NodeJS.ProcessEnv = process.env,
): {
  readonly scope: LoadedScope | null;
  readonly refused: { rule: string; message: string } | null;
} {
  try {
    // A shard of the release plan is the whole plan's part: its merge judges the whole.
    return { scope: releaseScopeFor(mode, night === null, env), refused: null };
  } catch (error) {
    return {
      scope: null,
      refused: { rule: 'release-scope', message: (error as Error).message.split('\n')[0]! },
    };
  }
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
