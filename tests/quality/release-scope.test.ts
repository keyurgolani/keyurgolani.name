import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { planCells, type Plan } from './cells';
import { RUN_ENGINES } from './lib/matrix';
import { loadRegistrations } from './lib/registration';
import {
  listEntry,
  loadReleaseScope,
  OWNER_PLACEHOLDER,
  recordsProblems,
  ROUTED_PLACEHOLDER,
  SCOPE_ENV,
  scopePlan,
  scopeProblems,
  type ListedRecord,
} from './lib/release-scope';
import { mergeShards, readShards } from './lib/shards';
import { judge, type VerdictInput } from './lib/verdict';
import { ALSO_RUNS, CELL, cellTest, HELD, PLAN, PROBE, RUNS, summary } from './meta/runner-cases';
import { SHARD_1, SHARD_2, writeShards } from './meta/shard-cases';
import { checkoutMeta, withTierPacks } from './plan-fixtures';

// A release candidate's quality scope and records list (lib/release-scope.ts): the file's rules,
// the scope's cut of the full plan, and the gate the verdict holds a release run to with it.

const SCOPE_FILE = 'quality/release/scope.json';
const CANDIDATE = { release: '1.0.0-rc.1', scope: 'default-packs' } as const;

/** A filled entry for RUNS's test, the fallback cell at 1440x900, default, on Chromium. */
const LISTED: ListedRecord = {
  cell: CELL,
  viewport: RUNS.viewport.id,
  row: RUNS.row.id,
  engine: 'chromium',
  owner: 'lane E',
  routed: 'row 33',
};

const FAILED = { outcome: 'unexpected', status: 'failed', expectedStatus: 'passed' } as const;

/** A release run's verdict on PLAN: both cell tests run, RUNS's as `runs` says. */
function verdict(runs: 'passed' | 'failed', listed: VerdictInput['listed']) {
  return judge({
    plan: PLAN,
    engines: ['chromium'],
    summary: summary([
      cellTest(RUNS, runs === 'failed' ? FAILED : {}),
      cellTest(ALSO_RUNS),
      cellTest(
        { ...RUNS, viewport: { id: '390x844' } },
        {
          outcome: 'skipped',
          status: 'skipped',
          expectedStatus: 'skipped',
          skipReason: 'Stand-in until #1 and #3 can make a revision unavailable on demand.',
        },
      ),
      PROBE,
    ]),
    missingBrowsers: [],
    canary: { before: [HELD], after: [] },
    ...(listed !== undefined ? { listed } : {}),
  });
}

const rules = (failures: readonly { rule: string }[]) => failures.map((each) => each.rule).sort();

test('the checked-in scope is RC1 on its default packs, with an empty records list, and loads', () => {
  const loaded = loadReleaseScope({ [SCOPE_ENV]: SCOPE_FILE })!;
  assert.equal(loaded.scope.release, '1.0.0-rc.1');
  assert.equal(loaded.scope.scope, 'default-packs');
  assert.deepEqual(loaded.records, []);
  // No scope env, no scope: quality:full plans the whole matrix as before.
  assert.equal(loadReleaseScope({}), null);
});

test('an empty records list with a clean matrix passes the gate', () => {
  const clean = verdict('passed', []);
  assert.deepEqual(clean.failures, []);
  assert.equal(clean.ok, true);
});

test("a failing cell outside the records list fails the gate, printing a ready-to-paste entry the list refuses until it's filled", () => {
  const failed = verdict('failed', []);
  assert.equal(failed.ok, false);
  assert.deepEqual(rules(failed.failures), ['tests-failed', 'unlisted-failure']);
  const message = failed.failures.find((each) => each.rule === 'unlisted-failure')!.message;
  const printed = JSON.parse(message.slice(message.indexOf('{'))) as ListedRecord;
  assert.deepEqual(printed, { ...LISTED, owner: OWNER_PLACEHOLDER, routed: ROUTED_PLACEHOLDER });
  assert.equal(
    message,
    `${cellTest(RUNS).title} failed, and the records list doesn't name it. To list it, fill in its owner and routed row: ${listEntry(cellTest(RUNS))}`,
  );
  // Pasted as printed, it's refused by its owner and routed row alone.
  assert.deepEqual(recordsProblems([printed], CANDIDATE), [
    `entry 1: owner is ${JSON.stringify(OWNER_PLACEHOLDER)}, not a lane or person`,
    `entry 1: routed is ${JSON.stringify(ROUTED_PLACEHOLDER)}, not "row <n>"`,
  ]);
  // Filled, it lists the failure, and the gate passes.
  assert.deepEqual(
    recordsProblems([{ ...printed, owner: 'lane E', routed: 'row 33' }], CANDIDATE),
    [],
  );
  assert.deepEqual(verdict('failed', [LISTED]).failures, []);
  // A run with no scope file has no list: the failure fails as tests-failed, as before.
  assert.deepEqual(rules(verdict('failed', undefined).failures), ['tests-failed']);
});

test('a listed cell that passes fails the gate, since a fixed record leaves the list', () => {
  const passed = verdict('passed', [LISTED]);
  assert.equal(passed.ok, false);
  assert.deepEqual(rules(passed.failures), ['listed-passed']);
  assert.match(
    passed.failures[0]!.message,
    /passed, and the records list names it: take its entry out/,
  );
  // A listed entry the whole run doesn't plan fails too, so a stale entry can't linger.
  const stale = verdict('passed', [{ ...LISTED, viewport: '1280x800' }]);
  assert.deepEqual(rules(stale.failures), ['listed-unplanned']);
});

test("the merge judges a release's shards against the list, as a single run's verdict does", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-release-merge-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const merged = (runs: 'passed' | 'failed', listed: readonly ListedRecord[]) => {
    const dir = mkdtempSync(path.join(root, 'run-'));
    // Shard 1 judged itself against the list, as rc-quality's shards do.
    const own = verdict(runs, listed);
    writeShards(dir, [
      {
        ...SHARD_1,
        tests: [cellTest(RUNS, runs === 'failed' ? FAILED : {}), PROBE],
        verdict: { ...SHARD_1.verdict, ok: own.ok, failures: own.failures },
      },
      SHARD_2,
    ]);
    return mergeShards(readShards(dir), { expected: 2, listed });
  };
  assert.deepEqual(merged('passed', []).failures, []);
  assert.deepEqual(merged('failed', [LISTED]).failures, []);
  assert.deepEqual(rules(merged('failed', []).failures), ['tests-failed', 'unlisted-failure']);
  assert.deepEqual(rules(merged('passed', [LISTED]).failures), ['listed-passed']);
});

test('a records entry names its cell, viewport, row and engine, an owner, and a routed row: a blank or placeholder owner or row is refused', () => {
  assert.deepEqual(recordsProblems([LISTED], CANDIDATE), []);
  for (const [field, value, problem] of [
    ['owner', '', 'owner is "", not a lane or person'],
    ['owner', '   ', 'owner is "   ", not a lane or person'],
    ['owner', undefined, 'owner is undefined, not a lane or person'],
    [
      'owner',
      OWNER_PLACEHOLDER,
      `owner is ${JSON.stringify(OWNER_PLACEHOLDER)}, not a lane or person`,
    ],
    ['routed', '', 'routed is "", not "row <n>"'],
    ['routed', undefined, 'routed is undefined, not "row <n>"'],
    ['routed', 'row', 'routed is "row", not "row <n>"'],
    ['routed', 'row 0', 'routed is "row 0", not "row <n>"'],
    ['routed', 'TBD', 'routed is "TBD", not "row <n>"'],
    [
      'routed',
      ROUTED_PLACEHOLDER,
      `routed is ${JSON.stringify(ROUTED_PLACEHOLDER)}, not "row <n>"`,
    ],
    ['cell', '', 'cell is missing'],
    ['engine', undefined, 'engine is missing'],
  ] as const) {
    const entry = { ...LISTED, [field]: value };
    assert.deepEqual(
      recordsProblems([entry], CANDIDATE),
      [`entry 1: ${problem}`],
      `${field} ${String(value)}`,
    );
  }
  assert.deepEqual(recordsProblems([{ ...LISTED, routed: 'row 22b' }], CANDIDATE), []);
  assert.deepEqual(recordsProblems([LISTED, LISTED], CANDIDATE), ['entry 2: listed twice']);
  assert.deepEqual(recordsProblems({}, CANDIDATE), ['the records list is not an array']);
});

test('a final release keeps the full matrix: scope full and an empty records list', () => {
  assert.deepEqual(recordsProblems([], { release: '1.0.0', scope: 'full' }), []);
  assert.deepEqual(recordsProblems([], { release: '1.0.0', scope: 'default-packs' }), [
    '1.0.0 is a final release: its scope must be full',
  ]);
  assert.deepEqual(recordsProblems([LISTED], { release: '1.0.0', scope: 'full' }), [
    '1.0.0 is a final release: its records list must be empty',
  ]);
});

test('a scope file names its release, scope, what it leaves unswept, and its list, or it is refused, and the loader throws on either file', (t) => {
  const good = {
    release: '1.0.0-rc.1',
    scope: 'default-packs',
    unswept: 'the other packs',
    records: 'records.json',
  };
  assert.deepEqual(scopeProblems(good), []);
  assert.deepEqual(scopeProblems({ ...good, scope: 'full', unswept: '' }), []);
  assert.deepEqual(scopeProblems({ ...good, release: 'v1.0.0-rc.1' }), [
    'release is "v1.0.0-rc.1", not X.Y.Z or X.Y.Z-rc.N',
  ]);
  assert.deepEqual(scopeProblems({ ...good, scope: 'some-packs' }), [
    'scope is "some-packs", not one of full, default-packs',
  ]);
  assert.deepEqual(scopeProblems({ ...good, unswept: ' ' }), [
    'unswept must say, in words, what a narrowed scope leaves out',
  ]);
  assert.deepEqual(scopeProblems({ ...good, records: '' }), ['records must name the records list']);
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-release-scope-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'scope.json'), JSON.stringify(good));
  writeFileSync(path.join(dir, 'records.json'), JSON.stringify([{ ...LISTED, owner: '' }]));
  assert.throws(
    () => loadReleaseScope({ [SCOPE_ENV]: path.join(dir, 'scope.json') }),
    /records\.json: entry 1: owner is "", not a lane or person$/,
  );
  writeFileSync(path.join(dir, 'scope.json'), JSON.stringify({ ...good, scope: 'none' }));
  assert.throws(
    () => loadReleaseScope({ [SCOPE_ENV]: path.join(dir, 'scope.json') }),
    /scope\.json: scope is "none", not one of full, default-packs$/,
  );
});

let full: Plan;
test.before(async () => {
  full = planCells({
    meta: withTierPacks(checkoutMeta()),
    registrations: await loadRegistrations(),
    mode: 'full',
  });
});

test('default-packs keeps every composition and surface on its own default packs, in every state, display mode, viewport and row, and no tier or fixture pack', () => {
  const cut = scopePlan(full, { scope: 'default-packs' });
  assert.equal(scopePlan(full, { scope: 'full' }), full);
  assert.ok(cut.cells.length > 0 && cut.cells.length < full.cells.length);
  const target = (cell: Plan['cells'][number]) => `${cell.kind}:${cell.target}`;
  const tuple = (cell: Plan['cells'][number]) =>
    `${cell.tuple.designLanguage}/${cell.tuple.colorScheme}/${cell.tuple.typography}`;
  const defaults = new Map<string, Set<string>>();
  for (const cell of full.cells.filter((each) => each.sentinel && !each.pack && !each.fixture)) {
    defaults.set(target(cell), (defaults.get(target(cell)) ?? new Set()).add(tuple(cell)));
  }
  // Every target the full plan has, each on its own default packs alone.
  assert.deepEqual(
    [...new Set(cut.cells.map(target))].sort(),
    [...new Set(full.cells.map(target))].sort(),
  );
  for (const cell of cut.cells) {
    assert.equal(cell.pack, undefined, cell.id);
    assert.equal(cell.fixture, false, cell.id);
    assert.ok(defaults.get(target(cell))!.has(tuple(cell)), cell.id);
  }
  // Every one of those cells, and every test of each.
  const kept = full.cells.filter(
    (cell) => !cell.pack && !cell.fixture && defaults.get(target(cell))?.has(tuple(cell)),
  );
  assert.deepEqual(cut.cells, kept);
  const ids = new Set(kept.map((cell) => cell.id));
  assert.deepEqual(
    cut.tests,
    full.tests.filter((each) => ids.has(each.cell.id)),
  );
  // Each target's states, display modes, viewports and rows are the full plan's.
  const axes = (plan: Pick<Plan, 'tests'>, axis: (each: Plan['tests'][number]) => string) => {
    const by = new Map<string, Set<string>>();
    for (const each of plan.tests) {
      by.set(target(each.cell), (by.get(target(each.cell)) ?? new Set()).add(axis(each)));
    }
    return [...by].map(([key, values]) => `${key} ${[...values].sort().join(',')}`).sort();
  };
  for (const axis of [
    (each: Plan['tests'][number]) => each.cell.state,
    (each: Plan['tests'][number]) => each.cell.tuple.displayMode ?? '',
    (each: Plan['tests'][number]) => each.viewport.id,
    (each: Plan['tests'][number]) => each.row.id,
  ]) {
    assert.deepEqual(axes(cut, axis), axes(full, axis));
  }
});

test("the high-contrast row's tests skip on every engine the full run launches, so its low weights stand", () => {
  const contrast = full.tests.filter((each) => each.row.id === 'high-contrast');
  assert.ok(contrast.length > 0);
  for (const each of contrast) {
    for (const engine of RUN_ENGINES.full) {
      assert.ok(
        (each.skip ?? each.engineSkips[engine]) !== undefined,
        `${each.cell.id} at ${each.viewport.id} runs high-contrast on ${engine}`,
      );
    }
  }
});
