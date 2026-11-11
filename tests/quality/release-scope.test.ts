import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CELL_CHECKS as RELEASE_CELL_CHECKS,
  CONDITION_CHECKS,
  failureOf,
} from '../../ci/release/release-records.mjs';
import { planCells, type Plan } from './cells';
import type { CellFailure } from './lib/failure-records';
import { RUN_ENGINES, VIEWPORTS } from './lib/matrix';
import { loadRegistrations } from './lib/registration';
import {
  loadReleaseScope,
  OWNER_PLACEHOLDER,
  recordKey,
  recordsProblems,
  ROUTED_PLACEHOLDER,
  SCOPE_ENV,
  releaseScopeFor,
  runReleaseScope,
  scopePlan,
  scopeProblems,
  type ListedRecord,
} from './lib/release-scope';
import { mergeShards, readShards } from './lib/shards';
import { mergeRun } from './merge';
import { judge, type VerdictInput } from './lib/verdict';
import { CELL_CHECKS, requiredChecks } from './lib/checks';
import { PREFERENCE_MODES } from './lib/vocabulary';
import type { SummaryFailure, SummaryTest } from './reporter';
import { ALSO_RUNS, CELL, cellTest, HELD, PLAN, PROBE, RUNS, summary } from './meta/runner-cases';
import { SHARD_1, SHARD_2, writeShards } from './meta/shard-cases';
import { checkoutMeta, withTierPacks } from './plan-fixtures';

// A release candidate's quality scope and records list (lib/release-scope.ts, the matcher in
// ci/release/release-records.mjs): the file's rules, the scope's cut of the full plan, and the gate
// the verdict holds a release run to with it, one failure record (one rule on one element) at a time.

const SCOPE_FILE = 'quality/release/scope.json';
const CANDIDATE = { release: '1.0.0-rc.1', scope: 'default-packs' } as const;

const NAV = 'html > body:nth-child(2) > header:nth-child(2) > nav:nth-child(2) > a:nth-child(1)';
const LEDE = '#main > p:nth-child(3)';

/** A focus-contrast failure on the nav link of RUNS's cell, as run-cell attaches it, with `measured`. */
const focusFailure = (measured: string, selector = NAV, rule = 'contrast'): CellFailure => ({
  check: 'focus',
  rule,
  surface: 'fallback',
  composition: true,
  route: '/',
  viewport: '1440x900',
  inputMode: 'keyboard',
  preferenceMode: 'default',
  element: { semanticRole: 'link', accessibleName: 'Writing', selector },
  expected: '3:1',
  actual: measured,
  threshold: 185,
});
/** RUNS's test's own surface and viewport, as the reporter keys its records under them. */
const OWN = { surface: 'fallback', viewport: '1440x900' };
/** The two failures RUNS's test fails on: the nav link's focus ring, and the lede's axe contrast. */
const FAILURES: readonly SummaryFailure[] = [
  failureOf(focusFailure('0 of 486 changed pixels reach 3:1'), OWN),
  { check: 'axe', rule: 'color-contrast', target: LEDE },
];

/** A filled entry for each of RUNS's failures: the fallback cell at 1440x900, default, on Chromium. */
const entry = (failure: SummaryFailure): ListedRecord => ({
  cell: CELL,
  viewport: RUNS.viewport.id,
  row: RUNS.row.id,
  engine: 'chromium',
  ...failure,
  owner: 'lane C',
  routed: 'row 5',
});
const LISTED = FAILURES.map(entry);

/**
 * A failed cell test as the reporter writes one: its soft expectations each an error and counted
 * (softFailures), and the checks it owed among those it ran.
 */
const FAILED = {
  outcome: 'unexpected',
  status: 'failed',
  expectedStatus: 'passed',
  errors: ['axe, WCAG 2.2 AA', "Slice 2's suites"],
  softFailures: 2,
  owed: requiredChecks('default', '1440x900'),
} as const;

/** A release run's verdict on PLAN: RUNS's test passes, or fails on `failures`; the rest pass. */
function verdict(failures: readonly SummaryFailure[] | 'passed', listed: VerdictInput['listed']) {
  return judge({
    plan: PLAN,
    engines: ['chromium'],
    summary: summary([
      cellTest(RUNS, failures === 'passed' ? {} : { ...FAILED, failures }),
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

test("the checked-in scope is RC2 on its default packs, its records list 648 keys, each a valid entry routed to a row on a platform-neutral cell, main's Spatial Bento root-text record still among them, and it loads, and its timingReported lists mission-control's and raw-grid's tbtMs under row 141", () => {
  const loaded = loadReleaseScope({ [SCOPE_ENV]: SCOPE_FILE })!;
  assert.equal(loaded.scope.release, '1.0.0-rc.2');
  assert.equal(loaded.scope.scope, 'default-packs');
  // rc.2 reports these timings instead of gating them: the two its preflights read over that rc.1's
  // release run (42540152468) read under, where an A/B of rc.1's code found them no slower (the
  // coordinator's ruling, 2026-11-10), routed to row 141, which blocks v1.0.0.
  assert.deepEqual(
    (loaded.scope.timingReported ?? []).map(
      ({ target, metric, row }) => `${target} ${metric} ${row}`,
    ),
    ['composition:mission-control tbtMs row 141', 'composition:raw-grid tbtMs row 141'],
  );
  // Preflight 1's list for the candidate (run 42489261932, 89 shards): the keys that still fail on
  // it, less those rows 108 and 116 fixed, plus row 129's four from rc.1's release run (42540152468,
  // shards 39, 48, 82 and 84); every one a valid entry, each key once.
  assert.equal(loaded.records.length, 648);
  assert.deepEqual(recordsProblems(loaded.records, loaded.scope), []);
  assert.equal(new Set(loaded.records.map(recordKey)).size, loaded.records.length);
  for (const each of loaded.records) assert.match(each.routed, /^row [1-9]\d*[a-z]?$/, each.cell);
  // Each on a cell of RC1's plan, its default pack: an entry on a pack the plan doesn't run is
  // listed-unplanned in the release run's verdict, which fails it.
  for (const each of loaded.records) {
    const pack = each.cell.split(' ').at(-1)?.split('/')[1];
    assert.equal(pack, 'platform-neutral', `${each.cell} is on the platform-neutral pack`);
  }
  // Main's one entry before preflight 1, the one cell RC1's plan has that shows row 50's record
  // (push 3 r4, item 2), still listed.
  assert.ok(
    loaded.records.some(
      (each) =>
        each.cell ===
          'composition:spatial-bento complete / spatial-bento/platform-neutral/warm-parchment/humanist-ui/system' &&
        each.viewport === '1440x900' &&
        each.row === 'default' &&
        each.engine === 'chromium' &&
        each.check === 'reflow' &&
        each.rule === 'root-text' &&
        each.target === '@1024x768 html' &&
        each.owner === 'lane E' &&
        each.routed === 'row 75',
    ),
    "Spatial Bento's root-text record on the platform-neutral pack, row 75",
  );
  // No scope env, no scope: quality:full plans the whole matrix as before.
  assert.equal(loadReleaseScope({}), null);
});

test('an empty records list with a clean matrix passes the gate', () => {
  const clean = verdict('passed', []);
  assert.deepEqual(clean.failures, []);
  assert.equal(clean.ok, true);
});

test("a failure record outside the records list fails the gate, printing a ready-to-paste entry the list refuses until it's filled", () => {
  const failed = verdict(FAILURES, []);
  assert.equal(failed.ok, false);
  assert.deepEqual(rules(failed.failures), [
    'tests-failed',
    'unlisted-failure',
    'unlisted-failure',
  ]);
  const printed = failed.failures
    .filter((each) => each.rule === 'unlisted-failure')
    .map((each) => JSON.parse(each.message.slice(each.message.indexOf('{'))) as ListedRecord);
  assert.deepEqual(
    printed,
    LISTED.map((each) => ({ ...each, owner: OWNER_PLACEHOLDER, routed: ROUTED_PLACEHOLDER })),
  );
  assert.match(
    failed.failures.find((each) => each.rule === 'unlisted-failure')!.message,
    new RegExp(
      `^${cellTest(RUNS).title}: focus contrast on html > body.* failed, and the records list doesn't name it\\. To list it, fill in its owner and routed row: \\{`,
    ),
  );
  // Pasted as printed, each is refused by its owner and routed row alone.
  assert.deepEqual(recordsProblems(printed, CANDIDATE), [
    `entry 1: owner is ${JSON.stringify(OWNER_PLACEHOLDER)}, not a lane or person`,
    `entry 1: routed is ${JSON.stringify(ROUTED_PLACEHOLDER)}, not "row <n>"`,
    `entry 2: owner is ${JSON.stringify(OWNER_PLACEHOLDER)}, not a lane or person`,
    `entry 2: routed is ${JSON.stringify(ROUTED_PLACEHOLDER)}, not "row <n>"`,
  ]);
  // Filled, they list the failures, and the gate passes.
  const filled = printed.map((each) => ({ ...each, owner: 'lane C', routed: 'row 5' }));
  assert.deepEqual(recordsProblems(filled, CANDIDATE), []);
  assert.deepEqual(verdict(FAILURES, filled).failures, []);
  // One record of the two listed: the other fails the gate, by itself.
  const half = verdict(FAILURES, [LISTED[0]!]);
  assert.deepEqual(rules(half.failures), ['tests-failed', 'unlisted-failure']);
  assert.match(half.failures[1]!.message, /axe color-contrast on #main > p:nth-child\(3\) failed/);
  // A failing test with no record can't be listed: it fails whatever the list says, and it's
  // held, so its entries read as neither failing nor passed.
  assert.deepEqual(rules(verdict([], LISTED).failures), ['tests-failed', 'unlisted-failure']);
  // A run with no scope file has no list: the failure fails as tests-failed, as before.
  assert.deepEqual(rules(verdict(FAILURES, undefined).failures), ['tests-failed']);
});

/** A release run's verdict on PLAN with RUNS's test failing on FAILURES and `extra` besides. */
function failingWith(extra: Partial<SummaryTest>, listed: VerdictInput['listed'] = LISTED) {
  return judge({
    plan: PLAN,
    engines: ['chromium'],
    summary: summary([
      cellTest(RUNS, { ...FAILED, failures: FAILURES, ...extra }),
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
    listed,
  });
}

test('a listed test fails the gate when anything no record names failed too: a blocked request, a server-egress error, a timeout, a check it owed and skipped', () => {
  // Its listed records alone: covered.
  assert.deepEqual(failingWith({}).failures, []);
  const rows = [
    // First, each row whose rule is the only guard against it.
    [
      "a server-egress error from the worker's late check, which attaches no record",
      { errors: [...FAILED.errors, 'The app server requested 1 URL(s) outside the app'] },
      /ended with 3 error\(s\), not the 2 soft expectation\(s\)/,
    ],
    [
      'a teardown timeout: failed, with one error past its soft count',
      {
        errors: [
          ...FAILED.errors,
          'Test timeout of 600000ms exceeded while tearing down "context".',
        ],
      },
      /ended with 3 error\(s\), not the 2 soft expectation\(s\)/,
    ],
    [
      "a blocked request: the egress fixture's own record, and its error",
      {
        failures: [...FAILURES, { check: 'runner', rule: 'browser-egress', target: null }],
        errors: [...FAILED.errors, 'The page requested 1 URL(s) outside the app'],
      },
      /it hit browser-egress, which no records list may name/,
    ],
    [
      "a server-egress record, the test's own serverEgress fixture's, and its error",
      {
        failures: [...FAILURES, { check: 'runner', rule: 'server-egress', target: null }],
        errors: [...FAILED.errors, 'The server tried to reach 1 host(s) outside the app'],
      },
      /it hit server-egress, which no records list may name/,
    ],
    [
      "status timedOut, the status rule alone (Playwright gives it only when a timeout is the test's first failure)",
      { status: 'timedOut' },
      /it ended timedOut/,
    ],
    // A held test's entries aren't judged: nothing it failed on says its records passed.
    [
      'a timeout before it wrote any record',
      { status: 'timedOut', failures: [], checks: [] },
      /it ended timedOut, not failed/,
    ],
    ['a failure before any record', { failures: [] }, /it failed with no failure record/],
    [
      'a skipped owed check, its record absent with it',
      { failures: [FAILURES[0]!], checks: FAILED.owed.filter((check) => check !== 'axe') },
      /it didn't run its axe check\(s\)/,
    ],
    [
      'fewer errors than its soft count',
      { errors: [FAILED.errors[0]] },
      /ended with 1 error\(s\), not the 2 soft expectation\(s\)/,
    ],
    [
      'an owed check it never ran',
      { checks: FAILED.owed.filter((check) => check !== 'keyboard') },
      /it didn't run its keyboard check\(s\)/,
    ],
  ] as const;
  // Every row's outcome, asserted once, so a mutant's log shows each row it opens.
  const open = rows.flatMap(([label, extra, why]) => {
    const failed = failingWith(extra as Partial<SummaryTest>);
    const blocked =
      rules(failed.failures).includes('tests-failed') &&
      failed.failures.some((each) => each.rule === 'unlisted-failure' && why.test(each.message));
    // Its records still failed: neither entry reads as listed-passed.
    const passed = failed.failures.some((each) => each.rule === 'listed-passed');
    return blocked && !passed
      ? []
      : [`${label}: ${failed.failures.map((each) => `${each.rule} ${each.message}`).join(' | ')}`];
  });
  assert.deepEqual(open, []);
  // An egress record with nothing else wrong blocks by itself, and no entry can name it.
  const egress = failingWith({
    failures: [...FAILURES, { check: 'runner', rule: 'browser-egress', target: null }],
  });
  assert.ok(egress.failures.some((each) => /it hit browser-egress/.test(each.message)));
  assert.match(
    recordsProblems(
      [{ ...LISTED[0]!, check: 'runner', rule: 'browser-egress', target: '#x' }],
      CANDIDATE,
    ).join(),
    /browser-egress is egress, which no records list may name/,
  );
  // A covered test owes the plan's checks as a passed test does, whatever it says it owed.
  const short = requiredChecks('default', '1440x900').filter((check) => check !== 'focus');
  const unchecked = failingWith({ checks: short, owed: short });
  assert.deepEqual(rules(unchecked.failures), ['unchecked-cell']);
  assert.match(
    unchecked.failures[0]!.message,
    /failed on its listed records without its focus check/,
  );
});

test("a record's key is its cell, rule and target from its own fields: a new measurement still matches, and another target or rule doesn't", () => {
  const listed = [entry(failureOf(focusFailure('0 of 486 changed pixels reach 3:1'), OWN))];
  // The next run measures the same failure differently: it's still the listed record.
  const remeasured = failureOf(
    { ...focusFailure('1 of 12279 changed pixels reach 3:1'), threshold: 2880 },
    OWN,
  );
  assert.equal(recordKey(entry(remeasured)), recordKey(listed[0]!));
  assert.deepEqual(verdict([remeasured], listed).failures, []);
  // Another element, or another rule on the same one, is a record of its own.
  for (const other of [
    failureOf(focusFailure('0 of 486 changed pixels reach 3:1', `${NAV} + a`), OWN),
    failureOf(focusFailure('0 of 486 changed pixels reach 3:1', NAV, 'perimeter'), OWN),
  ]) {
    assert.notEqual(recordKey(entry(other)), recordKey(listed[0]!));
    assert.deepEqual(rules(verdict([other], listed).failures), [
      'listed-passed',
      'tests-failed',
      'unlisted-failure',
    ]);
  }
  // An element with no page selector (in a frame or a shadow root) is named by its role, name
  // and slot; a record with no element at all, by its cell, check and rule.
  const framed = {
    ...focusFailure('x'),
    element: { semanticRole: 'link', accessibleName: 'Writing', uiSlot: 'nav-link' },
  };
  assert.equal(failureOf(framed, OWN).target, 'aria:link|Writing|nav-link');
  assert.equal(failureOf({ ...focusFailure('x'), element: undefined }, OWN).target, null);
});

test("a record of another page or viewport than its test's own keys apart: the primitives page and the landscape pass never match the cell page's entry", () => {
  const own = focusFailure('0 of 486 changed pixels reach 3:1');
  // The primitives page an appearance cell also audits, and the landscape occlusion pass.
  const primitives = {
    ...own,
    surface: 'primitives',
    composition: false,
    route: '/_fixtures/appearance',
  };
  const landscape = { ...own, check: 'occlusion', rule: 'obscured', viewport: '900x1440' };
  assert.equal(failureOf(primitives, OWN).target, `primitives >> ${NAV}`);
  assert.equal(failureOf(landscape, OWN).target, `@900x1440 ${NAV}`);
  assert.equal(
    failureOf({ ...primitives, viewport: '900x1440' }, OWN).target,
    `@900x1440 primitives >> ${NAV}`,
  );
  // The cell page's record is listed; it's fixed, and the same element fails on the other page or
  // in the other pass: unlisted, and the listed entry passed.
  const listed = [entry(failureOf(own, OWN)), LISTED[1]!];
  for (const [label, moved] of [
    ['the primitives page', primitives],
    ['the landscape pass', { ...own, viewport: '900x1440' }],
  ] as const) {
    const failed = verdict([failureOf(moved, OWN), FAILURES[1]!], listed);
    assert.deepEqual(
      rules(failed.failures),
      ['listed-passed', 'tests-failed', 'unlisted-failure'],
      label,
    );
  }
  // Both pages failing on one selector are two records, so each can be listed.
  const both = [failureOf(own, OWN), failureOf(primitives, OWN), FAILURES[1]!];
  assert.deepEqual(rules(verdict(both, listed).failures), ['tests-failed', 'unlisted-failure']);
  assert.deepEqual(verdict(both, [...listed, entry(failureOf(primitives, OWN))]).failures, []);
});

test("rc-quality judges a listed record whose check its test didn't owe as passed: full mode owes every condition, so only rc-verify holds it", () => {
  const reflow = { check: 'reflow', rule: 'overflow', target: `@320x568 ${LEDE}` };
  const owed = FAILED.owed.filter((check) => check !== 'reflow');
  const failed = judge({
    plan: PLAN,
    engines: ['chromium'],
    summary: summary([
      cellTest(RUNS, { ...FAILED, failures: FAILURES, owed, checks: owed }),
      cellTest(ALSO_RUNS),
      PROBE,
    ]),
    missingBrowsers: [],
    canary: { before: [HELD], after: [] },
    listed: [...LISTED, entry(reflow)],
  });
  assert.ok(
    failed.failures.some(
      (each) => each.rule === 'listed-passed' && /reflow overflow/.test(each.message),
    ),
    failed.failures.map((each) => `${each.rule} ${each.message}`).join(' | '),
  );
});

test("rc-verify's not-judged names are the harness's: CELL_CHECKS as checks.ts has them, owed everywhere, and the conditions requiredChecks() gives a default test only with its cell's conditions", () => {
  assert.deepEqual(RELEASE_CELL_CHECKS, [...CELL_CHECKS]);
  const first = VIEWPORTS[0]!.id;
  const withConditions = requiredChecks('default', first, true);
  const without = requiredChecks('default', first, false);
  assert.deepEqual(
    withConditions.filter((check) => !without.includes(check)),
    CONDITION_CHECKS,
  );
  // Every row and viewport owes CELL_CHECKS, so an owed list short of one is malformed.
  assert.equal(PREFERENCE_MODES.length, 8);
  for (const row of PREFERENCE_MODES)
    for (const { id } of VIEWPORTS) {
      const owed = requiredChecks(row, id);
      assert.ok(
        RELEASE_CELL_CHECKS.every((check) => owed.includes(check)),
        `${row} ${id}`,
      );
    }
  // verify-rc-listed.test.mjs's SENTINEL is a real sentinel's owed list: a default test at 1440 with
  // no conditions, as requiredChecks() gives it.
  const listed = readFileSync(
    path.join(import.meta.dirname, '../../ci/release/verify-rc-listed.test.mjs'),
    'utf8',
  );
  const literal = /const SENTINEL = \[([^\]]*)\];/.exec(listed);
  assert.ok(literal, 'verify-rc-listed.test.mjs declares SENTINEL');
  assert.deepEqual(
    [...(literal[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]),
    requiredChecks('default', '1440x900', false),
  );
  const swept = requiredChecks('default', first, true, true);
  assert.ok(RELEASE_CELL_CHECKS.every((check) => swept.includes(check)));
});

test('a listed record that no longer fails fails the gate, since a fixed record leaves the list', () => {
  const passed = verdict('passed', LISTED);
  assert.equal(passed.ok, false);
  assert.deepEqual(rules(passed.failures), ['listed-passed', 'listed-passed']);
  assert.match(
    passed.failures[0]!.message,
    /no longer fails, and the records list names it: take its entry out/,
  );
  // The test still fails on the other record: the fixed one's entry goes all the same.
  assert.deepEqual(rules(verdict([FAILURES[1]!], LISTED).failures), ['listed-passed']);
  // A listed entry the whole run doesn't plan fails too, so a stale entry can't linger.
  const stale = verdict('passed', [{ ...LISTED[0]!, viewport: '1280x800' }]);
  assert.deepEqual(rules(stale.failures), ['listed-unplanned']);
});

test("the merge judges a release's shards against the list, as a single run's verdict does", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-release-merge-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const merged = (
    failures: readonly SummaryFailure[] | 'passed',
    listed: readonly ListedRecord[],
  ) => {
    const dir = mkdtempSync(path.join(root, 'run-'));
    // Shard 1 judged itself against the list, as rc-quality's shards do.
    const own = verdict(failures, listed);
    writeShards(dir, [
      {
        ...SHARD_1,
        tests: [cellTest(RUNS, failures === 'passed' ? {} : { ...FAILED, failures }), PROBE],
        verdict: { ...SHARD_1.verdict, ok: own.ok, failures: own.failures },
      },
      SHARD_2,
    ]);
    return mergeShards(readShards(dir), { expected: 2, mode: 'full', whole: true, listed });
  };
  assert.deepEqual(merged('passed', []).failures, []);
  assert.deepEqual(merged(FAILURES, LISTED).failures, []);
  assert.deepEqual(rules(merged(FAILURES, []).failures), [
    'tests-failed',
    'unlisted-failure',
    'unlisted-failure',
  ]);
  assert.deepEqual(rules(merged('passed', LISTED).failures), ['listed-passed', 'listed-passed']);
  // A list handed to any merge but a full run's, judged whole, is refused, and the run judged
  // strictly, as the everyday gate judges it.
  const dir = mkdtempSync(path.join(root, 'pr-'));
  writeShards(dir, [
    { ...SHARD_1, tests: [cellTest(RUNS, { ...FAILED, failures: FAILURES }), PROBE] },
    SHARD_2,
  ]);
  for (const options of [
    { mode: 'pr' },
    { mode: 'full' },
    { mode: 'full', whole: false },
  ] as const) {
    const strict = mergeShards(readShards(dir), { expected: 2, ...options, listed: LISTED });
    assert.ok(rules(strict.failures).includes('release-scope'), JSON.stringify(options));
    assert.ok(rules(strict.failures).includes('tests-failed'), JSON.stringify(options));
  }
});

test('only quality:full judged whole takes a release scope: a PR run, a night, or a merge of either refuses one, by rule', (t) => {
  const named = { [SCOPE_ENV]: SCOPE_FILE };
  assert.equal(releaseScopeFor('full', true, named)?.scope.release, '1.0.0-rc.2');
  assert.equal(releaseScopeFor('pr', false, {}), null);
  assert.throws(
    () => releaseScopeFor('pr', true, named),
    /a release scope is quality:full's, and this run is quality:pr/,
  );
  assert.throws(() => releaseScopeFor('full', false, named), /judges the whole plan/);
  // mergeRun, with the env naming one, on a PR merge: release-scope, and judged with no list.
  const reports = mkdtempSync(path.join(tmpdir(), 'quality-release-mergerun-'));
  const shards = mkdtempSync(path.join(tmpdir(), 'quality-release-mergerun-shards-'));
  t.after(() => {
    rmSync(reports, { recursive: true, force: true });
    rmSync(shards, { recursive: true, force: true });
  });
  writeShards(shards, [SHARD_1, SHARD_2]);
  const saved = { reports: process.env.CI_REPORTS_DIR, scope: process.env[SCOPE_ENV] };
  process.env.CI_REPORTS_DIR = reports;
  process.env[SCOPE_ENV] = SCOPE_FILE;
  try {
    const verdict = mergeRun(shards, 2, 'quality-pr merged verdict', 'pr', 'success');
    assert.equal(verdict.ok, false);
    // mergeRun's own refusal, not mergeShards' (which no list reaches here).
    assert.deepEqual(verdict.failures[0], {
      rule: 'release-scope',
      message: "a release scope is quality:full's, and this run is quality:pr",
    });
  } finally {
    for (const [key, value] of [
      ['CI_REPORTS_DIR', saved.reports],
      [SCOPE_ENV, saved.scope],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("mergeRun hands a whole full run's merge its scope's records list: the listed failures pass, an unlisted one fails", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-release-handoff-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scopeDir = path.join(root, 'release');
  const shards = path.join(root, 'shards');
  const reports = path.join(root, 'reports');
  for (const dir of [scopeDir, shards, reports]) mkdirSync(dir);
  writeFileSync(
    path.join(scopeDir, 'scope.json'),
    JSON.stringify({ ...CANDIDATE, unswept: 'the other packs', records: 'records.json' }),
  );
  const own = verdict(FAILURES, LISTED);
  writeShards(shards, [
    {
      ...SHARD_1,
      tests: [cellTest(RUNS, { ...FAILED, failures: FAILURES }), PROBE],
      verdict: { ...SHARD_1.verdict, ok: own.ok, failures: own.failures },
    },
    SHARD_2,
  ]);
  const saved = { reports: process.env.CI_REPORTS_DIR, scope: process.env[SCOPE_ENV] };
  process.env.CI_REPORTS_DIR = reports;
  process.env[SCOPE_ENV] = path.join(scopeDir, 'scope.json');
  const merge = (listed: readonly ListedRecord[]) => {
    writeFileSync(path.join(scopeDir, 'records.json'), JSON.stringify(listed));
    return mergeRun(shards, 2, 'quality:release merged verdict', 'full', 'success', true);
  };
  try {
    assert.deepEqual(merge(LISTED).failures, []);
    const half = merge([LISTED[0]!]);
    assert.equal(half.ok, false);
    assert.deepEqual(rules(half.failures), ['tests-failed', 'unlisted-failure']);
    assert.match(
      half.failures[1]!.message,
      /axe color-contrast on #main > p:nth-child\(3\) failed/,
    );
  } finally {
    for (const [key, value] of [
      ['CI_REPORTS_DIR', saved.reports],
      [SCOPE_ENV, saved.scope],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("run.ts's scope: a whole full run takes the one its env names; a PR run or a night's slice is refused by rule, with none", () => {
  const named = { [SCOPE_ENV]: SCOPE_FILE };
  assert.deepEqual(runReleaseScope('pr', null, {}), { scope: null, refused: null });
  const whole = runReleaseScope('full', null, named);
  assert.equal(whole.refused, null);
  assert.equal(whole.scope?.scope.release, '1.0.0-rc.2');
  assert.deepEqual(runReleaseScope('pr', null, named), {
    scope: null,
    refused: {
      rule: 'release-scope',
      message: "a release scope is quality:full's, and this run is quality:pr",
    },
  });
  assert.deepEqual(runReleaseScope('full', '2026-11-06', named), {
    scope: null,
    refused: {
      rule: 'release-scope',
      message: "a release scope judges the whole plan, and this run isn't the whole plan",
    },
  });
});

test('a records entry names its cell, viewport, row, engine, check, rule and target, an owner, and a routed row: a blank or placeholder owner or row is refused', () => {
  const good = LISTED[0]!;
  assert.deepEqual(recordsProblems([good], CANDIDATE), []);
  assert.deepEqual(recordsProblems([{ ...good, note: 'nav link ring' }], CANDIDATE), []);
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
    ['check', ' ', 'check is missing'],
    ['rule', undefined, 'rule is missing'],
    ['target', '', 'target is "", not a selector'],
    ['target', undefined, 'target is undefined, not a selector'],
    [
      'target',
      null,
      "target is null; a record with no element (a runner record, or an axe node in a frame or a shadow root) shares its key with every other of its rule in the test until RC2's per-element key, so RC1's list names elements only",
    ],
    ['target', ` ${NAV}`, 'target has space at its start or end, which no record has'],
    ['cell', `${CELL} `, 'cell has space at its start or end, which no record has'],
    ['owner', 'tbd', 'owner is "tbd", not a lane or person'],
    ['owner', 'Unknown', 'owner is "Unknown", not a lane or person'],
    ['owner', 'NOBODY', 'owner is "NOBODY", not a lane or person'],
    ['owner', 'owner', 'owner is "owner", not a lane or person'],
    ['owner', 'TBA', 'owner is "TBA", not a lane or person'],
    ['owner', 'none', 'owner is "none", not a lane or person'],
    ['owner', 'Unowned', 'owner is "Unowned", not a lane or person'],
    ['owner', 'TBD ', 'owner is "TBD ", not a lane or person'],
    ['note', 'x'.repeat(301), 'note is not text of at most 300 characters'],
    ['measured', '155 element(s)', 'measured is not a field'],
  ] as const) {
    const each = { ...good, [field]: value };
    if (value === undefined) delete (each as Record<string, unknown>)[field];
    assert.deepEqual(
      recordsProblems([each], CANDIDATE),
      [`entry 1: ${problem}`],
      `${field} ${String(value)}`,
    );
  }
  assert.deepEqual(recordsProblems([{ ...good, routed: 'row 22b' }], CANDIDATE), []);
  assert.deepEqual(recordsProblems([good, { ...good, note: 'again' }], CANDIDATE), [
    'entry 2: listed twice',
  ]);
  assert.deepEqual(recordsProblems({}, CANDIDATE), ['the records list is not an array']);
});

test('a final release keeps the full matrix: scope full and an empty records list', () => {
  assert.deepEqual(recordsProblems([], { release: '1.0.0', scope: 'full' }), []);
  assert.deepEqual(recordsProblems([], { release: '1.0.0', scope: 'default-packs' }), [
    '1.0.0 is a final release: its scope must be full',
  ]);
  assert.deepEqual(recordsProblems(LISTED, { release: '1.0.0', scope: 'full' }), [
    '1.0.0 is a final release: its records list must be empty',
  ]);
});

test("a candidate's scope file may list timings reported, not gated, each a target's metric with its row and reason, and a final's may list none", () => {
  const good = {
    release: '1.0.0-rc.2',
    scope: 'default-packs',
    unswept: 'the other packs',
    records: 'records.json',
  };
  const entry = {
    target: 'composition:flux',
    metric: 'tbtMs',
    row: 'row 135',
    reason: 'over at rc.1 too',
  };
  assert.deepEqual(scopeProblems({ ...good, timingReported: [] }), []);
  assert.deepEqual(scopeProblems({ ...good, timingReported: [entry] }), []);
  assert.deepEqual(
    scopeProblems({
      ...good,
      timingReported: [entry, { ...entry, target: 'surface:demo-studio' }],
    }),
    [],
  );
  assert.deepEqual(scopeProblems({ ...good, timingReported: {} }), [
    'timingReported is not a list',
  ]);
  assert.deepEqual(scopeProblems({ ...good, timingReported: [{ ...entry, target: 'flux' }] }), [
    'timingReported entry 1: target is "flux", not composition:<id> or surface:<id>',
  ]);
  assert.deepEqual(scopeProblems({ ...good, timingReported: [{ ...entry, metric: 'tbt' }] }), [
    'timingReported entry 1: metric is "tbt", not one of lcpMs, cls, tbtMs, idleTaskMs, heapMiB, growthMiB',
  ]);
  assert.deepEqual(scopeProblems({ ...good, timingReported: [{ ...entry, row: '' }] }), [
    'timingReported entry 1: row is "", not "row <n>"',
  ]);
  assert.deepEqual(scopeProblems({ ...good, timingReported: [{ ...entry, row: '135' }] }), [
    'timingReported entry 1: row is "135", not "row <n>"',
  ]);
  assert.deepEqual(scopeProblems({ ...good, timingReported: [{ ...entry, reason: ' ' }] }), [
    'timingReported entry 1: reason must say, in words, why the timing is reported',
  ]);
  assert.deepEqual(scopeProblems({ ...good, timingReported: [{ ...entry, owner: 'E' }] }), [
    'timingReported entry 1: owner is not a field',
  ]);
  assert.deepEqual(scopeProblems({ ...good, timingReported: [entry, entry] }), [
    'timingReported entry 2: composition:flux tbtMs is listed twice',
  ]);
  assert.deepEqual(
    scopeProblems({
      ...good,
      release: '1.0.0',
      scope: 'full',
      unswept: '',
      timingReported: [entry],
    }),
    ['timingReported must be empty for a final release (1.0.0): a final gates every timing'],
  );
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
  assert.deepEqual(scopeProblems({ ...good, records: '' }), ['records is "", not "records.json"']);
  assert.deepEqual(scopeProblems({ ...good, records: '../records.json' }), [
    'records is "../records.json", not "records.json"',
  ]);
  assert.deepEqual(scopeProblems({ ...good, owner: 'x' }), ['owner is not a field']);
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-release-scope-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'scope.json'), JSON.stringify(good));
  writeFileSync(path.join(dir, 'records.json'), JSON.stringify([{ ...LISTED[0], owner: '' }]));
  assert.throws(
    () => loadReleaseScope({ [SCOPE_ENV]: path.join(dir, 'scope.json') }),
    /records\.json: entry 1: owner is "", not a lane or person$/,
  );
  // An entry on an engine no release run launches names a test no run has.
  writeFileSync(
    path.join(dir, 'records.json'),
    JSON.stringify([{ ...LISTED[0], engine: 'firefox' }]),
  );
  assert.throws(
    () => loadReleaseScope({ [SCOPE_ENV]: path.join(dir, 'scope.json') }),
    /records\.json: entry 1: engine is "firefox", not one of chromium$/,
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
