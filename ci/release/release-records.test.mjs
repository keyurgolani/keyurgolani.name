// The records list's flaky entries (release-records.mjs): one seen failing and passing on one
// commit, both runs named, may pass where its test runs; when its test fails, it fails on exactly
// its record. A strict entry still has to fail. At most MAX_FLAKY entries are flaky. Until RC2's
// evidence check reads the runs, a list takes no flaky entry at all (FLAKY_HELD): the matcher's
// flaky rules below stand for then.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLAKY_HELD,
  isFlaky,
  judgeListed,
  MAX_FLAKY,
  recordsProblems,
} from './release-records.mjs';

const CANDIDATE = { release: '1.0.0-rc.1', scope: 'default-packs' };
const CELL =
  'composition:horizontal-cinema complete / horizontal-cinema/platform-neutral/warm-parchment/humanist-ui/system';
// Obviously synthetic: two runs on one commit, neither a real run's id.
const SEEN = {
  commit: 'a'.repeat(40),
  failed: '100000001',
  passed: '100000002',
};
/** recordsProblems() without RC1's flaky hold, for the shape and cap rules RC2 keeps. */
const shapeProblems = (records, scope) =>
  recordsProblems(records, scope).filter((each) => !each.endsWith(FLAKY_HELD));
const strict = (target, viewport = '1440x900') => ({
  cell: CELL,
  viewport,
  row: 'default',
  engine: 'chromium',
  check: 'focus',
  rule: 'contrast',
  target,
  owner: 'lane C',
  routed: 'row 5',
});
const flaky = (target, viewport = '1440x900') => ({
  ...strict(target, viewport),
  flaky: true,
  seen: SEEN,
});
/**
 * A summary cell test at `viewport`, failing on records at `targets`, or passing, as the reporter
 * writes one: a failed test's one soft expectation an error and counted, its owed checks run.
 */
const cellTest = (targets, viewport = '1440x900') => ({
  title: `${CELL} › ${viewport} default`,
  kind: 'cell',
  cell: CELL,
  viewport,
  row: 'default',
  engine: 'chromium',
  outcome: targets === 'passed' ? 'expected' : 'unexpected',
  status: targets === 'passed' ? 'passed' : 'failed',
  checks: ['status', 'focus'],
  owed: ['status', 'focus'],
  errors: targets === 'passed' ? [] : ["Slice 2's suites"],
  softFailures: targets === 'passed' ? 0 : 1,
  failures:
    targets === 'passed'
      ? []
      : targets.map((target) => ({ check: 'focus', rule: 'contrast', target })),
});

test('a flaky entry names the commit it was seen on and both runs, its failing and its passing one, or it is refused', () => {
  assert.deepEqual(shapeProblems([flaky('#a')], CANDIDATE), []);
  assert.equal(isFlaky(flaky('#a')), true);
  assert.equal(isFlaky(strict('#a')), false);
  const bare = { ...flaky('#a') };
  delete bare.seen;
  for (const [label, entry, problem] of [
    [
      'no seen',
      bare,
      'entry 1: a flaky entry needs "seen": {"commit": <sha>, "failed": <run id>, "passed": <run id>}',
    ],
    [
      'no passing run',
      { ...bare, seen: { commit: SEEN.commit, failed: SEEN.failed } },
      'entry 1: seen.passed is undefined, not a run id',
    ],
    [
      'no failing run',
      { ...bare, seen: { commit: SEEN.commit, passed: SEEN.passed } },
      'entry 1: seen.failed is undefined, not a run id',
    ],
    [
      'one run twice',
      { ...bare, seen: { ...SEEN, passed: SEEN.failed } },
      'entry 1: seen.failed and seen.passed are one run; a flaky entry needs two',
    ],
    [
      'a short commit',
      { ...bare, seen: { ...SEEN, commit: '1dc6bf162' } },
      'entry 1: seen.commit is "1dc6bf162", not a full commit sha',
    ],
    [
      'a run id as a number',
      { ...bare, seen: { ...SEEN, failed: 42161399250 } },
      'entry 1: seen.failed is 42161399250, not a run id',
    ],
    [
      'another seen field',
      { ...bare, seen: { ...SEEN, job: '1' } },
      'entry 1: seen.job is not a field',
    ],
    [
      'flaky not true',
      { ...flaky('#a'), flaky: 'yes' },
      'entry 1: flaky is "yes"; a flaky entry says "flaky": true',
    ],
    [
      'seen on a strict entry',
      { ...strict('#a'), seen: SEEN },
      'entry 1: flaky is undefined; a flaky entry says "flaky": true',
    ],
  ]) {
    assert.deepEqual(shapeProblems([entry], CANDIDATE), [problem], label);
  }
  // Its owner and routed row are held as a strict entry's are.
  assert.deepEqual(shapeProblems([{ ...flaky('#a'), owner: '' }], CANDIDATE), [
    'entry 1: owner is "", not a lane or person',
  ]);
});

test('a flaky entry whose test passes is accepted, and reported as passed', () => {
  const judged = judgeListed([cellTest('passed')], [flaky('#a')]);
  assert.deepEqual(judged.passed, []);
  assert.deepEqual(judged.unlisted, []);
  assert.deepEqual(
    judged.flaky.map(({ outcome }) => outcome),
    ['passed'],
  );
  // Failing on its record, it's reported as failed; with its test not run, as not run.
  assert.deepEqual(
    judgeListed([cellTest(['#a'])], [flaky('#a')]).flaky.map(({ outcome }) => outcome),
    ['failed'],
  );
  assert.deepEqual(
    judgeListed([], [flaky('#a')]).flaky.map(({ outcome }) => outcome),
    ['not run'],
  );
  // Its test held (unrecorded), it's not judged; its record failed all the same, it's failed.
  for (const held of [
    { ...cellTest(['#c']), status: 'timedOut' },
    { ...cellTest([]), errors: ["Slice 2's suites"] },
  ]) {
    assert.deepEqual(
      judgeListed([held], [flaky('#a')]).flaky.map(({ outcome }) => outcome),
      ['not judged'],
    );
  }
  assert.deepEqual(
    judgeListed([{ ...cellTest(['#a']), status: 'timedOut' }], [flaky('#a')]).flaky.map(
      ({ outcome }) => outcome,
    ),
    ['failed'],
  );
});

test('a strict entry whose test passes still blocks, beside a flaky one', () => {
  const judged = judgeListed([cellTest('passed')], [strict('#b'), flaky('#a')]);
  assert.deepEqual(judged.passed, [strict('#b')]);
  assert.deepEqual(
    judged.flaky.map(({ outcome }) => outcome),
    ['passed'],
  );
});

test("a flaky entry's failing test must fail on exactly its record: any other record in it blocks", () => {
  const judged = judgeListed([cellTest(['#a', '#c'])], [flaky('#a')]);
  assert.deepEqual(
    judged.unlisted.map(({ failure }) => failure.target),
    ['#c'],
  );
  assert.deepEqual(
    judgeListed([cellTest(['#c'])], [flaky('#a')]).unlisted.map(({ failure }) => failure.target),
    ['#c'],
  );
});

test(`at most ${MAX_FLAKY} flaky entries: a sixth is refused, and a final release takes none`, () => {
  const five = Array.from({ length: MAX_FLAKY }, (_, at) => flaky(`#f${at}`));
  assert.equal(MAX_FLAKY, 5);
  assert.deepEqual(shapeProblems([...five, strict('#s1'), strict('#s2')], CANDIDATE), []);
  assert.deepEqual(shapeProblems([...five, flaky('#f5')], CANDIDATE), [
    "6 flaky entries, over the 5 a list holds without the coordinator's word",
  ]);
  assert.deepEqual(shapeProblems([flaky('#a')], { release: '1.0.0', scope: 'full' }), [
    '1.0.0 is a final release: its records list must be empty',
  ]);
});

test("RC1 holds every flaky entry back: until RC2's evidence check reads its runs, a list takes strict entries alone", () => {
  assert.deepEqual(recordsProblems([flaky('#a')], CANDIDATE), [`entry 1: ${FLAKY_HELD}`]);
  assert.deepEqual(recordsProblems([strict('#a')], CANDIDATE), []);
  assert.match(FLAKY_HELD, /RC2's evidence check/);
});
