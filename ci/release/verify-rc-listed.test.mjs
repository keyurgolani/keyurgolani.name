// rc-verify's named-records path (verify-rc.mjs): a candidate whose push run on main is red
// counts only on its first attempt, when quality-pr is its one red (its jobs show the quality
// runs' own red, and every other gate job succeeded), the summary it reads is the one artifact
// that attempt's verdict made, and quality-pr's every failure record is one the candidate's
// records list names, by rc-quality's own matcher (release-records.mjs). A green run with a
// non-empty list is held to its summary too. The summary arrives as an artifact zip (zip.mjs),
// read as untrusted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { deflateRawSync } from 'node:zlib';
import { parse } from 'yaml';
import { failureOf, judgeListed, listEntry, testFailures } from './release-records.mjs';
import {
  BROWSER_SHARDS,
  bindArtifact,
  clean,
  commandText,
  downloadProblem,
  evaluateRc,
  GATE_NEEDS,
  otherJobsRed,
  QPR_ARTIFACT,
  QPR_JOBS,
  QPR_SUMMARY,
  qprJobsProof,
  qualityPrUnlisted,
  SHARD_COUNTS,
  summaryProblem,
} from './verify-rc.mjs';
import { crc32, zipEntry } from './zip.mjs';

const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const SHA = '1'.repeat(40);
const compare = JSON.parse(readFileSync(fixture('compare-ahead.json'), 'utf8'));
const CELL =
  'composition:horizontal-cinema complete / horizontal-cinema/platform-neutral/warm-parchment/humanist-ui/system';
const NAV = 'html > body:nth-child(2) > header:nth-child(2) > nav:nth-child(2) > a:nth-child(1)';

/** The red push run on the commit, on its first attempt. */
const RED = {
  id: 201,
  path: '.github/workflows/ci.yml',
  event: 'push',
  head_branch: 'main',
  head_sha: SHA,
  status: 'completed',
  conclusion: 'failure',
  run_attempt: 1,
  html_url: 'https://github.com/o/r/actions/runs/201',
};
const GREEN = { ...RED, id: 202, conclusion: 'success' };
const VERDICT_WINDOW = { started_at: '2026-11-06T05:24:29Z', completed_at: '2026-11-06T05:25:09Z' };
/** Each matrix job's shard count, as this commit's ci.yml runs them, and quality-pr's two here. */
const MATRIX = { ...SHARD_COUNTS, 'quality-pr': 2 };
/** The browser shards' names at this commit's count. */
const BROWSER = Array.from(
  { length: BROWSER_SHARDS },
  (_, at) => `browser (${at + 1}/${BROWSER_SHARDS})`,
);
const ok = (name) => ({ name, conclusion: 'success' });
/** A quality-pr shard's job, as GitHub lists it: red only on its own ci:quality-pr step when `red`. */
const shardJob = (k, n, red) => ({
  name: `quality-pr (${k}/${n})`,
  conclusion: red ? 'failure' : 'success',
  steps: [
    ok('Set up job'),
    ok('Install'),
    { name: 'pnpm store cache hit', conclusion: 'skipped' },
    { name: `pnpm ci:quality-pr --shard=${k}/${n}`, conclusion: red ? 'failure' : 'success' },
    ok('Scrub reports'),
    ok('Failure summary'),
    ok('Upload reports'),
    ok('Complete job'),
  ],
});
/** quality-pr-verdict's job: red only on its own ci:quality-pr-verdict step when `red`. */
const verdictJob = (red) => ({
  name: 'quality-pr-verdict',
  conclusion: red ? 'failure' : 'success',
  run_attempt: 1,
  ...VERDICT_WINDOW,
  steps: [
    ok('Set up job'),
    ok('Install'),
    ok("Download the shards' reports"),
    { name: 'pnpm ci:quality-pr-verdict', conclusion: red ? 'failure' : 'success' },
    ok('Failure summary'),
    ok('Upload reports'),
  ],
});
/** Every job gate needs, the latest attempt's: green but quality-pr's second shard, its verdict, and gate. */
function jobs(change = {}, { red = true } = {}) {
  const all = GATE_NEEDS.flatMap((need) => {
    if (need === 'quality-pr') return [shardJob(1, 2, false), shardJob(2, 2, red)];
    if (need === 'quality-pr-verdict') return [verdictJob(red)];
    return MATRIX[need]
      ? Array.from({ length: MATRIX[need] }, (_, at) => ok(`${need} (${at + 1}/${MATRIX[need]})`))
      : [ok(need)];
  });
  return [
    ...all.map((job) => (change[job.name] ? { ...job, ...change[job.name] } : job)),
    { name: 'gate', conclusion: red ? 'failure' : 'success' },
  ];
}
/** The one live verdict artifact `run`'s verdict job made. */
const artifact = (run = RED, extra = {}) => ({
  id: 13479508953,
  name: QPR_ARTIFACT,
  expired: false,
  created_at: '2026-11-06T05:25:05Z',
  size_in_bytes: 25915,
  digest: 'sha256:d1d2b4d82bcb2b3e932e488e2aec1bab2c3fafe22be86d78652f6e4a924975c5',
  workflow_run: { id: run.id, head_sha: SHA, head_branch: 'main' },
  ...extra,
});

/**
 * quality-pr's cell test of HC at 1440, failing on `failures` (or passing), as the reporter writes
 * it: a failed test's soft expectations, one an error, and the checks it owed among those it ran.
 */
const cellTest = (failures, extra = {}) => ({
  title: `${CELL} › 1440x900 default › horizontal-cinema complete at 1440x900, default`,
  kind: 'cell',
  cell: CELL,
  viewport: '1440x900',
  row: 'default',
  engine: 'chromium',
  outcome: failures === 'passed' ? 'expected' : 'unexpected',
  status: failures === 'passed' ? 'passed' : 'failed',
  checks: ['status', 'axe', 'keyboard', 'focus'],
  owed: ['status', 'axe', 'keyboard', 'focus'],
  failures: failures === 'passed' ? [] : failures,
  errors: failures === 'passed' ? [] : ['axe, WCAG 2.2 AA', "Slice 2's suites"],
  softFailures: failures === 'passed' ? 0 : 2,
  ...extra,
});
const FOCUS = { check: 'focus', rule: 'contrast', target: NAV };
const AXE = { check: 'axe', rule: 'color-contrast', target: '#main > p:nth-child(3)' };
/** The merged quality-pr summary: red on shard-job beside tests-failed when a test fails, as the merge writes it. */
const qprSummary = (failures, extra = {}) => ({
  schemaVersion: 1,
  mode: 'pr',
  shard: null,
  tests: [cellTest(failures), { title: 'harness', kind: undefined, outcome: 'expected' }],
  errors: [],
  verdict: {
    ok: failures === 'passed',
    failures:
      failures === 'passed'
        ? []
        : [
            { rule: 'shard-job', message: 'The shard jobs ended failure, not success.' },
            { rule: 'tests-failed', message: '1 test(s) failed' },
          ],
  },
  ...extra,
});
const entry = (failure) => ({
  cell: CELL,
  viewport: '1440x900',
  row: 'default',
  engine: 'chromium',
  ...failure,
  owner: 'lane C',
  routed: 'row 5',
});
const LISTED = [entry(FOCUS), entry(AXE)];

const input = ({
  summary = qprSummary([FOCUS, AXE]),
  listed = LISTED,
  jobList = jobs(),
  run = RED,
  artifacts = [artifact(run)],
} = {}) => ({
  tag: 'v1.0.0-rc.1',
  sha: SHA,
  compare,
  runs: [run],
  jobsByRun: { [run.id]: jobList },
  quality: { listed, summaries: { [run.id]: summary }, artifacts: { [run.id]: artifacts } },
});
const refusal = (verdict) => {
  assert.equal(verdict.ok, false);
  return verdict.reasons.join(' | ');
};

test("a red push run whose one red is quality-pr's, on listed records alone, is accepted, shard-job and all", () => {
  const verdict = evaluateRc(input());
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.run.id, 201);
  assert.equal(verdict.listed, true);
});

test('an unlisted quality-pr failure blocks the tag, naming it with its ready-to-paste entry', () => {
  const reason = refusal(evaluateRc(input({ listed: [entry(FOCUS)] })));
  const printed = listEntry(testFailures(cellTest([AXE]))[0]);
  assert.match(reason, /no red one is red on listed records alone/);
  assert.ok(
    reason.includes(
      `axe color-contrast failed, and the records list doesn't name it. To list it: ${printed}`,
    ),
    reason,
  );
  // An empty list, as a final release's is, leaves only the green run.
  assert.equal(evaluateRc(input({ listed: [] })).ok, false);
});

test('a listed record that now passes blocks the tag', () => {
  // The test passed: both its entries are stale.
  assert.match(
    refusal(evaluateRc(input({ summary: qprSummary('passed') }))),
    /on html > body.* no longer fails: take its entry out/,
  );
  // It still fails, but no longer on the axe record.
  assert.match(
    refusal(evaluateRc(input({ summary: qprSummary([FOCUS]) }))),
    /axe color-contrast on #main > p:nth-child\(3\) no longer fails/,
  );
});

test("a record of the primitives page or the landscape pass keys apart from the cell page's: it's unlisted, and the cell page's entry passed", () => {
  const own = { surface: 'horizontal-cinema', viewport: '1440x900' };
  const record = {
    check: 'focus',
    rule: 'contrast',
    surface: 'horizontal-cinema',
    viewport: '1440x900',
    element: { selector: NAV },
  };
  assert.deepEqual(failureOf(record, own), FOCUS);
  const primitives = failureOf({ ...record, surface: 'primitives' }, own);
  const landscape = failureOf({ ...record, viewport: '900x1440' }, own);
  assert.equal(primitives.target, `primitives >> ${NAV}`);
  assert.equal(landscape.target, `@900x1440 ${NAV}`);
  for (const moved of [primitives, landscape]) {
    const reason = refusal(evaluateRc(input({ summary: qprSummary([moved, AXE]) })));
    assert.ok(
      reason.includes(`focus contrast failed, and the records list doesn't name it. To list it: `),
      reason,
    );
    assert.match(reason, /focus contrast on html > body.* no longer fails: take its entry out/);
  }
  // The same element failing on both pages is two records, each its own entry.
  const both = qprSummary([FOCUS, primitives, AXE]);
  assert.deepEqual(
    evaluateRc(input({ summary: both, listed: [...LISTED, entry(primitives)] })).reasons,
    [],
  );
});

test('a listed test that also failed on anything no record names blocks the tag: egress, a teardown error, a timeout, a check it owed and skipped', () => {
  const SOFT = ['axe, WCAG 2.2 AA', "Slice 2's suites"];
  const rows = [
    // First, each row whose rule is the only guard against it.
    [
      "a server-egress error from the worker's late check, which attaches no record",
      { errors: [...SOFT, 'The app server requested 1 URL(s) outside the app'] },
      /ended with 3 error\(s\), not the 2 soft expectation\(s\) behind its records/,
    ],
    [
      'a teardown timeout: failed, with one error past its soft count',
      {
        errors: [...SOFT, 'Test timeout of 600000ms exceeded while tearing down "context".'],
      },
      /ended with 3 error\(s\), not the 2 soft expectation\(s\) behind its records/,
    ],
    [
      'a blocked request, as its own runner record',
      {
        failures: [FOCUS, AXE, { check: 'runner', rule: 'browser-egress', target: null }],
        errors: [...SOFT, 'The page requested 1 URL(s) outside the app'],
      },
      /it hit browser-egress, which no records list may name/,
    ],
    [
      "a server-egress record, the test's own serverEgress fixture's",
      {
        failures: [FOCUS, AXE, { check: 'runner', rule: 'server-egress', target: null }],
        errors: [...SOFT, 'The server tried to reach 1 host(s) outside the app: x.test'],
      },
      /it hit server-egress, which no records list may name/,
    ],
    ['a timeout', { status: 'timedOut' }, /it ended timedOut, not failed/],
    [
      'an owed check it never ran',
      { checks: ['status', 'axe', 'focus'] },
      /it didn't run its keyboard check\(s\)/,
    ],
    [
      'no count of its soft expectations',
      { softFailures: undefined },
      /no count of runCell's soft expectations/,
    ],
  ];
  // Every row's outcome, asserted once, so a mutant's log shows each row it opens.
  const open = rows.flatMap(([label, extra, why]) => {
    const summary = { ...qprSummary([FOCUS, AXE]), tests: [cellTest([FOCUS, AXE], extra)] };
    const verdict = evaluateRc(input({ summary }));
    const reason = verdict.reasons.join(' | ');
    // Its records still failed: neither entry reads as passed.
    return verdict.ok || !why.test(reason) || /take its entry out/.test(reason)
      ? [`${label}: ${reason || 'accepted'}`]
      : [];
  });
  assert.deepEqual(open, []);
});

test('any other job gate needs that is not green blocks the tag, whatever the list says, browser included', () => {
  for (const [name, change] of [
    [BROWSER[0], { conclusion: 'failure' }],
    [BROWSER.at(-1), { conclusion: 'cancelled' }],
    ['unit (2/3)', { conclusion: 'failure' }],
    ['docs', { conclusion: 'cancelled' }],
    ['quality-pr-plan', { conclusion: 'failure' }],
    ['image', { conclusion: 'skipped' }],
  ]) {
    const reason = refusal(evaluateRc(input({ jobList: jobs({ [name]: change }) })));
    assert.ok(reason.includes(`${name} ended ${change.conclusion}`), reason);
  }
  // A job missing, or a matrix job short a shard, is no better.
  const missing = jobs().filter((job) => job.name !== 'trace');
  assert.match(refusal(evaluateRc(input({ jobList: missing }))), /trace didn't run/);
  const short = jobs().filter((job) => job.name !== 'variants (4/4)');
  assert.match(
    refusal(evaluateRc(input({ jobList: short }))),
    /variants ran shards 1, 2, 3 of 1\.\.4, not each once/,
  );
  assert.deepEqual(otherJobsRed(jobs()), []);
});

test("shard-job counts only beside tests-failed, and only when quality-pr's jobs show a shard failed on its own cell tests", () => {
  assert.deepEqual(qprJobsProof(jobs()).reasons, []);
  for (const [label, jobList, why] of [
    [
      'a shard red on its install',
      jobs({
        'quality-pr (2/2)': {
          steps: shardJob(2, 2, true).steps.map((each) =>
            each.name === 'Install' ? { ...each, conclusion: 'failure' } : each,
          ),
        },
      }),
      /quality-pr \(2\/2\) failed on Install, pnpm ci:quality-pr --shard=2\/2, not on pnpm ci:quality-pr --shard=2\/2 alone/,
    ],
    [
      'a shard whose reports never uploaded',
      jobs({
        'quality-pr (2/2)': {
          steps: shardJob(2, 2, true).steps.map((each) =>
            each.name === 'Upload reports' ? { ...each, conclusion: 'skipped' } : each,
          ),
        },
      }),
      /quality-pr \(2\/2\)'s Upload reports step didn't succeed/,
    ],
    [
      'a cancelled shard',
      jobs({ 'quality-pr (1/2)': { conclusion: 'cancelled' } }),
      /quality-pr \(1\/2\) ended cancelled/,
    ],
    [
      'a missing shard',
      jobs().filter((job) => job.name !== 'quality-pr (1/2)'),
      /quality-pr ran shards 2 of 1\.\.2, not each once/,
    ],
    [
      'a verdict red on its download',
      jobs({
        'quality-pr-verdict': {
          steps: verdictJob(true).steps.map((each) =>
            each.name === "Download the shards' reports"
              ? { ...each, conclusion: 'failure' }
              : each,
          ),
        },
      }),
      /quality-pr-verdict failed on Download the shards' reports, pnpm ci:quality-pr-verdict/,
    ],
  ]) {
    const reason = refusal(evaluateRc(input({ jobList })));
    assert.match(reason, why, label);
    assert.match(reason, /shard-job, and its jobs don't show/, label);
  }
  // The verdict job itself: exactly one, red only on its own step, or the proof refuses.
  for (const [label, jobList, why] of [
    ['two verdict jobs', [...jobs(), verdictJob(true)], /quality-pr-verdict ran 2 times, not once/],
    [
      'no verdict job',
      jobs().filter((job) => job.name !== 'quality-pr-verdict'),
      /quality-pr-verdict ran 0 times, not once/,
    ],
    [
      'a cancelled verdict',
      jobs({ 'quality-pr-verdict': { conclusion: 'cancelled' } }),
      /quality-pr-verdict ended cancelled/,
    ],
  ]) {
    assert.match(qprJobsProof(jobList).reasons.join(' | '), why, label);
    assert.match(refusal(evaluateRc(input({ jobList }))), why, label);
  }
  // tests-failed alone needs no proof; shard-job alone is never the quality runs' own.
  assert.deepEqual(
    qualityPrUnlisted(
      { ...qprSummary([FOCUS, AXE]), verdict: { failures: [{ rule: 'tests-failed' }] } },
      LISTED,
    ),
    [],
  );
  assert.match(
    qualityPrUnlisted(
      { ...qprSummary([FOCUS, AXE]), verdict: { failures: [{ rule: 'shard-job' }] } },
      LISTED,
      { jobsProven: true },
    ).join(),
    /shard-job, and its jobs don't show/,
  );
});

test("quality-pr's and every matrix job's shards are exactly 1..n, each once, written as plain counts: the jobs alone refuse any other set", () => {
  const qpr = (names) => [
    ...jobs().filter((job) => !job.name.startsWith('quality-pr (')),
    ...names.map(([k, n]) => shardJob(k, n, false)),
  ];
  const open = [];
  for (const [label, names, why] of [
    [
      'a k past n',
      [
        ['1', '2'],
        ['3', '2'],
      ],
      /quality-pr ran shards 1, 3 of 1\.\.2, not each once/,
    ],
    [
      'a k of 0',
      [
        ['0', '2'],
        ['1', '2'],
      ],
      /quality-pr ran shards 0, 1 of 1\.\.2, not each once/,
    ],
    [
      'a k twice',
      [
        ['1', '3'],
        ['2', '3'],
        ['2', '3'],
      ],
      /quality-pr ran shards 1, 2, 2 of 1\.\.3, not each once/,
    ],
    [
      'a leading zero',
      [
        ['02', '2'],
        ['2', '2'],
      ],
      /quality-pr ran shards 02, 2 of 1\.\.2, not each once/,
    ],
    [
      'an n with a leading zero',
      [
        ['1', '02'],
        ['2', '02'],
      ],
      /don't agree on their count/,
    ],
    [
      'two counts',
      [
        ['1', '2'],
        ['2', '3'],
      ],
      /don't agree on their count/,
    ],
  ]) {
    // A summary that holds no shard-mismatch: the jobs alone must refuse.
    const reasons = qprJobsProof(qpr(names)).reasons.join(' | ');
    if (!why.test(reasons)) open.push(`${label}: ${reasons || 'accepted'}`);
  }
  for (const [label, names, why] of [
    [
      'browser with a leading zero',
      ['browser (01/2)', 'browser (2/2)'],
      /browser ran shards 01, 2 of 1\.\.2, not each once/,
    ],
    [
      'browser of n 02',
      ['browser (1/2)', 'browser (2/02)'],
      /browser \(2\/02\), not its shards of 2/,
    ],
  ]) {
    const list = [...jobs().filter((job) => !job.name.startsWith('browser (')), ...names.map(ok)];
    const reasons = otherJobsRed(list, { ...SHARD_COUNTS, browser: 2 }).join(' | ');
    if (!why.test(reasons)) open.push(`${label}: ${reasons || 'accepted'}`);
  }
  // Every row's outcome, asserted once.
  assert.deepEqual(open, []);
  assert.deepEqual(qprJobsProof(jobs()).reasons, []);
});

test("the summary is the one artifact this attempt made: a re-run, two artifacts, another run's, or one made outside the verdict job refuses the tag", () => {
  for (const [label, change, why] of [
    [
      'a second attempt',
      { run: { ...RED, run_attempt: 2 } },
      /attempt 2, and only a first attempt counts/,
    ],
    [
      'two live artifacts',
      { artifacts: [artifact(), artifact(RED, { id: 13479508954 })] },
      /has 2 live/,
    ],
    ['none', { artifacts: [] }, /has 0 live/],
    ['an expired one', { artifacts: [artifact(RED, { expired: true })] }, /has 0 live/],
    [
      "another run's",
      {
        artifacts: [
          artifact(RED, { workflow_run: { id: 999, head_sha: SHA, head_branch: 'main' } }),
        ],
      },
      /another run's, or not main's/,
    ],
    [
      'another commit',
      {
        artifacts: [
          artifact(RED, {
            workflow_run: { id: 201, head_sha: '2'.repeat(40), head_branch: 'main' },
          }),
        ],
      },
      /another run's, or not main's/,
    ],
    [
      'made before the verdict job ran',
      { artifacts: [artifact(RED, { created_at: '2026-11-06T05:00:00Z' })] },
      /wasn't made while this attempt's quality-pr-verdict ran/,
    ],
    [
      'made after the verdict job ended',
      { artifacts: [artifact(RED, { created_at: '2026-11-06T05:40:00Z' })] },
      /wasn't made while this attempt's quality-pr-verdict ran/,
    ],
    [
      'another branch',
      {
        artifacts: [
          artifact(RED, { workflow_run: { id: 201, head_sha: SHA, head_branch: 'next' } }),
        ],
      },
      /another run's, or not main's/,
    ],
    [
      "a verdict job of another attempt than the run's",
      { jobList: jobs({ 'quality-pr-verdict': { run_attempt: 2 } }) },
      /quality-pr-verdict's job is attempt 2, not the run's 1/,
    ],
    ['no size', { artifacts: [artifact(RED, { size_in_bytes: 0 })] }, /names no size/],
    [
      'an id past safe integers',
      { artifacts: [artifact(RED, { id: 2 ** 60 })] },
      /not an artifact id/,
    ],
  ]) {
    const options = change.run ? { run: change.run, artifacts: [artifact(change.run)] } : change;
    assert.match(refusal(evaluateRc(input(options))), why, label);
  }
  assert.deepEqual(bindArtifact([artifact()], RED, SHA, verdictJob(true)).reason, null);
  // The download is held to its size and its digest.
  const zip = readFileSync(fixture('reports-quality-pr-verdict-42161399250.zip'));
  assert.equal(downloadProblem(zip, artifact()), null);
  assert.match(
    downloadProblem(zip.subarray(1), artifact()),
    /downloaded 25914 bytes, not its 25915/,
  );
  assert.match(
    downloadProblem(zip, artifact(RED, { digest: `sha256:${'0'.repeat(64)}` })),
    /doesn't match its digest/,
  );
});

test('a green run with entries listed is held to its summary: a strict entry whose test passed there refuses the tag', () => {
  const green = { run: GREEN, jobList: jobs({}, { red: false }), artifacts: [artifact(GREEN)] };
  // Its summary: the listed test passed in quality-pr.
  const passed = evaluateRc(input({ ...green, summary: qprSummary('passed') }));
  assert.match(refusal(passed), /passed in ci run 202's quality-pr, so it's no failing record/);
  // A green run whose summary can't be bound or read refuses too, while the list names any entry.
  assert.match(
    refusal(evaluateRc(input({ ...green, artifacts: [], summary: qprSummary('passed') }))),
    /can't be held to the records list: run 202 has 0 live/,
  );
  // A summary that can't be held to the list, or whose verdict failed, refuses on a green run too.
  const open = [];
  for (const [label, summary, why] of [
    ['an empty object', {}, /has no tests/],
    ['tests null', { tests: null }, /has no tests/],
    ['a string', 'x', /is no object/],
    ['null', null, /is no object/],
    ['a number', 42, /is no object/],
    ['a list', [], /is no object/],
    ['another schema', qprSummary('passed', { schemaVersion: 2 }), /schemaVersion 2, not 1/],
    [
      'a cell test whose cell field is renamed',
      {
        ...qprSummary('passed'),
        tests: [{ ...cellTest('passed', { cell: undefined }), cellId: CELL }],
      },
      /1 cell test\(s\) of quality-pr's summary don't name their cell, viewport, row, engine/,
    ],
    ['a red verdict', qprSummary([FOCUS, AXE]), /its verdict failed, though gate passed/],
  ]) {
    const verdict = evaluateRc(input({ ...green, summary }));
    const reason = verdict.reasons.join(' | ');
    if (verdict.ok || !/can't be held to the records list/.test(reason) || !why.test(reason))
      open.push(`${label}: ${reason || 'accepted'}`);
  }
  assert.deepEqual(open, []);
  // With an empty list, the green run counts as it always did, unread.
  const empty = evaluateRc(input({ ...green, listed: [], artifacts: [], summary: undefined }));
  assert.equal(empty.ok, true);
  assert.equal(empty.run.id, 202);
});

test("quality-pr's summary is untrusted: anything missing, malformed, or beyond a listed cell failure blocks the tag", () => {
  const open = [];
  for (const [label, summary, why] of [
    ['an Error', new Error('HTTP 410'), /summary couldn't be read: HTTP 410/],
    ['nothing', undefined, /summary couldn't be read: not fetched/],
    ['no tests', { verdict: { failures: [] } }, /has no tests/],
    ['no verdict', { tests: [] }, /has no verdict/],
    ['another schema', qprSummary([FOCUS, AXE], { schemaVersion: 2 }), /schemaVersion 2, not 1/],
    [
      'no schema',
      qprSummary([FOCUS, AXE], { schemaVersion: undefined }),
      /schemaVersion undefined/,
    ],
    [
      'a cell test with no engine',
      { ...qprSummary([FOCUS, AXE]), tests: [cellTest([FOCUS, AXE], { engine: 7 })] },
      /don't name their cell, viewport, row, engine/,
    ],
    [
      'another verdict rule',
      qprSummary([FOCUS, AXE], {
        verdict: { ok: false, failures: [{ rule: 'plan-coverage', message: 'x' }] },
      }),
      /failed plan-coverage, which no records list can name/,
    ],
    [
      'a harness test failing',
      {
        ...qprSummary([FOCUS, AXE]),
        tests: [cellTest([FOCUS, AXE]), { title: 'h', outcome: 'unexpected' }],
      },
      /h failed, and it isn't a cell test/,
    ],
    ['a failing test with no record', qprSummary([]), /failed with no failure record/],
    [
      'a failing test with no errors list',
      { ...qprSummary([FOCUS, AXE]), tests: [cellTest([FOCUS, AXE], { errors: undefined })] },
      /it lists no errors/,
    ],
    [
      'a failing test whose errors are no list',
      { ...qprSummary([FOCUS, AXE]), tests: [cellTest([FOCUS, AXE], { errors: 'x, y' })] },
      /it lists no errors/,
    ],
    [
      'a failing test counting no soft expectation',
      {
        ...qprSummary([FOCUS, AXE]),
        tests: [cellTest([FOCUS, AXE], { errors: [], softFailures: 0 })],
      },
      /counts no failed soft expectation/,
    ],
    [
      'a failing test owing nothing',
      { ...qprSummary([FOCUS, AXE]), tests: [cellTest([FOCUS, AXE], { owed: [] })] },
      /names no checks it owed/,
    ],
    [
      'a failing test with no owed list',
      { ...qprSummary([FOCUS, AXE]), tests: [cellTest([FOCUS, AXE], { owed: undefined })] },
      /names no checks it owed/,
    ],
    [
      'a failing test owing a check that is no name',
      { ...qprSummary([FOCUS, AXE]), tests: [cellTest([FOCUS, AXE], { owed: ['status', 7] })] },
      /names no checks it owed/,
    ],
    [
      'a record whose check is no string',
      qprSummary([{ ...FOCUS, check: 7 }]),
      /a failure record of it is malformed/,
    ],
    [
      'a record whose key repeats',
      qprSummary([FOCUS, FOCUS, AXE]),
      /failed more than once under one key/,
    ],
    [
      'a red verdict with nothing failing',
      qprSummary('passed', { verdict: { ok: false, failures: [] } }),
      /no listed failure/,
    ],
  ]) {
    const listed = label === 'a red verdict with nothing failing' ? [] : LISTED;
    const base = input({ listed });
    const verdict = evaluateRc({
      ...base,
      quality: { ...base.quality, summaries: { 201: summary } },
    });
    const reason = verdict.reasons.join(' | ');
    if (verdict.ok || !why.test(reason)) open.push(`${label}: ${reason || 'accepted'}`);
  }
  // Every row's outcome, asserted once, so a mutant's log shows each row it opens.
  assert.deepEqual(open, []);
  // With no list read at all, a red run never counts.
  assert.match(refusal(evaluateRc({ ...input(), quality: undefined })), /no records list was read/);
  assert.deepEqual(qualityPrUnlisted(qprSummary([FOCUS, AXE]), LISTED, { jobsProven: true }), []);
});

test('artifact text reaches the log and the summary with no control character, and a workflow command escaped', () => {
  const hostile = 'a\r\n::warning file=x::owned\u0007 50% done';
  assert.equal(clean(hostile), 'a  ::warning file=x::owned  50% done');
  assert.equal(commandText('50% a\r\nb'), '50%25 a%0D%0Ab');
  const summary = {
    ...qprSummary([FOCUS, AXE]),
    tests: [cellTest([FOCUS, AXE]), { title: hostile, outcome: 'unexpected', kind: 'harness' }],
  };
  const reason = refusal(evaluateRc(input({ summary })));
  assert.doesNotMatch(reason, /[\r\n\u0007]/);
  assert.match(reason, /a {2}::warning file=x::owned {2}50% done failed, and it isn't a cell test/);
});

test("the browser shard count is exact: each of 1..N once, succeeded, of N's count alone", () => {
  const ok = (name) => ({ name, conclusion: 'success' });
  const browser = (names) => [
    ...jobs().filter((job) => !job.name.startsWith('browser (')),
    ...names.map((name) => (typeof name === 'string' ? ok(name) : name)),
  ];
  const three = { ...SHARD_COUNTS, browser: 3 };
  const red = (names, counts = three) =>
    otherJobsRed(browser(names), counts).filter((each) => each.startsWith('browser'));
  // All three green, with three counted: accepted.
  assert.deepEqual(red(['browser (1/3)', 'browser (2/3)', 'browser (3/3)']), []);
  // Two of three green: refused.
  assert.match(red(['browser (1/3)', 'browser (2/3)']).join(), /ran shards 1, 2 of 1\.\.3/);
  // A /2 run when three are counted: refused.
  assert.match(red(['browser (1/2)', 'browser (2/2)']).join(), /not its shards of 3/);
  // /2 and /3 names mixed: refused.
  assert.match(
    red(['browser (1/3)', 'browser (2/2)', 'browser (3/3)']).join(),
    /browser \(2\/2\), not its shards of 3/,
  );
  // A cancelled or skipped shard, or one twice: refused.
  assert.match(
    red([
      'browser (1/3)',
      { name: 'browser (2/3)', conclusion: 'cancelled' },
      'browser (3/3)',
    ]).join(),
    /browser \(2\/3\) ended cancelled/,
  );
  assert.match(
    red([
      'browser (1/3)',
      { name: 'browser (2/3)', conclusion: 'skipped' },
      'browser (3/3)',
    ]).join(),
    /browser \(2\/3\) ended skipped/,
  );
  assert.match(
    red(['browser (1/3)', 'browser (2/3)', 'browser (2/3)', 'browser (3/3)']).join(),
    /not each once/,
  );
  // With this commit's count, ci.yml's: its shards, all green.
  assert.deepEqual(red(BROWSER, SHARD_COUNTS), []);
});

test("SHARD_COUNTS is ci.yml's: each matrix job gate needs but quality-pr's runs shards 1..N, named (k/N)", () => {
  const ci = parse(
    readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  );
  const matrixed = Object.fromEntries(
    ci.jobs.gate.needs
      .filter((need) => !QPR_JOBS.has(need) && ci.jobs[need].strategy?.matrix?.shard)
      .map((need) => {
        const shards = ci.jobs[need].strategy.matrix.shard;
        assert.deepEqual(
          shards,
          Array.from({ length: shards.length }, (_, at) => at + 1),
          need,
        );
        assert.equal(ci.jobs[need].name, `${need} (\${{ matrix.shard }}/${shards.length})`, need);
        return [need, shards.length];
      }),
  );
  assert.deepEqual(SHARD_COUNTS, matrixed);
  assert.equal(SHARD_COUNTS.browser, BROWSER_SHARDS);
  // No other job gate needs has a matrix of any kind: otherJobsRed would refuse its legs.
  assert.deepEqual(
    ci.jobs.gate.needs.filter(
      (need) => !QPR_JOBS.has(need) && !(need in SHARD_COUNTS) && ci.jobs[need].strategy?.matrix,
    ),
    [],
  );
});

test("GATE_NEEDS is ci.yml's gate's needs, quality-pr's two jobs among them, and each job's name is the need's", () => {
  const ci = parse(
    readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
  );
  assert.deepEqual(GATE_NEEDS, ci.jobs.gate.needs);
  for (const need of QPR_JOBS) assert.ok(GATE_NEEDS.includes(need));
  for (const need of GATE_NEEDS) {
    const name = ci.jobs[need].name ?? need;
    assert.ok(name === need || name.startsWith(`${need} (`), `${need}: ${name}`);
  }
  // ci.yml's gate itself stays strict: its own check is untouched.
  assert.equal(ci.jobs.gate.steps.at(-1).run, 'node ci/gate.mjs');
  // The step names qprJobsProof() reads are ci.yml's own.
  const shard = ci.jobs['quality-pr'].steps.map((each) => each.name);
  for (const name of ['Scrub reports', 'Failure summary', 'Upload reports'])
    assert.ok(shard.includes(name), name);
  assert.ok(
    shard.includes(
      'pnpm ci:quality-pr --shard=${{ matrix.shard }}/${{ needs.quality-pr-plan.outputs.count }}',
    ),
  );
  const verdict = ci.jobs['quality-pr-verdict'].steps.map((each) => each.name);
  for (const name of ['pnpm ci:quality-pr-verdict', 'Upload reports'])
    assert.ok(verdict.includes(name), name);
});

test("main's real red push run, 42161399250: its jobs prove quality-pr's red, its artifact reads, and it's refused while browser was cancelled", () => {
  const real = JSON.parse(readFileSync(fixture('ci-jobs-run-42161399250.json'), 'utf8')).jobs;
  const zip = readFileSync(fixture('reports-quality-pr-verdict-42161399250.zip'));
  const summary = JSON.parse(zipEntry(zip, QPR_SUMMARY).toString('utf8'));
  const records = JSON.parse(readFileSync(fixture('hc-records-42161399250.json'), 'utf8')).records;
  assert.deepEqual(
    summary.verdict.failures.map((each) => each.rule),
    ['shard-job', 'tests-failed'],
  );
  // The summary predates the reporter's failures, soft count and owed checks: given them from
  // the shard's own records, as a reporter of this commit writes them.
  const tests = summary.tests.map((each) =>
    each.outcome === 'unexpected'
      ? {
          ...each,
          failures: records[each.viewport].map(([check, rule, target]) => ({
            check,
            rule,
            target,
          })),
          softFailures: each.errors.length,
          owed: each.checks,
        }
      : each,
  );
  const listed = Object.entries(records).flatMap(([viewport, keys]) =>
    keys.map(([check, rule, target]) => ({
      cell: CELL,
      viewport,
      row: 'default',
      engine: 'chromium',
      check,
      rule,
      target,
      owner: 'lane C',
      routed: 'row 5',
    })),
  );
  const run = {
    ...RED,
    id: 42161399250,
    head_sha: '1dc6bf1624fc7ee31b565417c2ddb8b34738ef7f',
  };
  // The shard counts of the ci.yml that ran it, whatever this commit's are.
  const RUN_COUNTS = { unit: 3, browser: 2, variants: 4 };
  const realInput = (jobList, counts = RUN_COUNTS) => ({
    counts,
    tag: 'v1.0.0-rc.1',
    sha: run.head_sha,
    compare: { status: 'identical', merge_base_commit: { sha: run.head_sha } },
    runs: [run],
    jobsByRun: { [run.id]: jobList },
    quality: {
      listed,
      summaries: { [run.id]: { ...summary, tests } },
      artifacts: {
        [run.id]: [
          artifact(run, {
            workflow_run: { id: run.id, head_sha: run.head_sha, head_branch: 'main' },
          }),
        ],
      },
    },
  });
  assert.deepEqual(qprJobsProof(real).reasons, []);
  assert.equal(judgeListed(tests, listed).covered.length, 3);
  // As it ran, browser's shards were cancelled: refused, by them.
  assert.match(refusal(evaluateRc(realInput(real))), /browser \(1\/2\) ended cancelled/);
  // Had browser passed, quality-pr's red on HC's listed records is accepted.
  const browserGreen = real.map((each) =>
    each.name.startsWith('browser (') ? { ...each, conclusion: 'success' } : each,
  );
  const accepted = evaluateRc(realInput(browserGreen));
  assert.deepEqual(accepted.reasons, []);
  assert.equal(accepted.ok, true);
  // At this commit's counts, it counts only while they're the run's own.
  assert.equal(
    evaluateRc(realInput(browserGreen, SHARD_COUNTS)).ok,
    isDeepStrictEqual(SHARD_COUNTS, RUN_COUNTS),
  );
  // Every cell test of the real summary has the shape both paths hold it to.
  assert.equal(summaryProblem(summary), null);
  assert.equal(summary.tests.filter((each) => each.kind === 'cell').length > 100, true);
});

/** A zip of `files` ({ name: Buffer }), each deflated or stored, its local header as `local` says. */
function zipOf(files, { method = 8, bit3 = false, flags = 0, eocd = {}, names = {} } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const packed = method === 8 ? deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name);
    // The local header's own name, when `names` gives it another.
    const localName = Buffer.from(names[name] ?? name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags | (bit3 ? 0x8 : 0), 6);
    local.writeUInt16LE(method, 8);
    if (!bit3) {
      local.writeUInt32LE(crc32(data), 14);
      local.writeUInt32LE(packed.length, 18);
      local.writeUInt32LE(data.length, 22);
    }
    local.writeUInt16LE(localName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(flags | (bit3 ? 0x8 : 0), 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, localName, packed);
    centrals.push(central, nameBytes);
    offset += 30 + localName.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(eocd.disk ?? 0, 4);
  end.writeUInt16LE(eocd.diskCount ?? eocd.count ?? Object.keys(files).length, 8);
  end.writeUInt16LE(eocd.count ?? Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
/** `zip` with its first central entry's 32-bit field at `at` (from the entry's start) set to `value`. */
function centralAt(zip, at, value) {
  const copy = Buffer.from(zip);
  const start = copy.readUInt32LE(copy.length - 22 + 16);
  copy.writeUInt32LE(value, start + at);
  return copy;
}

test("the artifact's summary is read out of its zip, and a malformed, oversized, or tampered zip is refused", () => {
  const summary = Buffer.from(JSON.stringify(qprSummary([FOCUS, AXE])));
  const zip = zipOf({ 'quality/merged-verdict.json': Buffer.from('{}'), [QPR_SUMMARY]: summary });
  assert.deepEqual(zipEntry(zip, QPR_SUMMARY), summary);
  assert.deepEqual(
    zipEntry(zipOf({ [QPR_SUMMARY]: summary }, { method: 0 }), QPR_SUMMARY),
    summary,
  );
  // upload-artifact's entries set bit 3 and leave the local sizes and CRC zero: read from the directory.
  assert.deepEqual(
    zipEntry(zipOf({ [QPR_SUMMARY]: summary }, { bit3: true }), QPR_SUMMARY),
    summary,
  );
  assert.equal(zipEntry(zip, 'quality/other.json'), null);
  for (const [label, bad, why] of [
    ['not a zip', Buffer.from('not a zip'), /no end-of-central-directory/],
    ['over the bound', zip, /over 10/, { maxBytes: 10 }],
    ['cut short', zip.subarray(0, zip.length - 30), /malformed/],
    [
      'a CRC tamper',
      (() => {
        const copy = Buffer.from(zipOf({ [QPR_SUMMARY]: summary }, { method: 0 }));
        copy[60] ^= 0xff;
        return copy;
      })(),
      /CRC-32 doesn't match/,
    ],
    ['another method', zipOf({ [QPR_SUMMARY]: summary }, { method: 12 }), /compression method 12/],
    [
      'a duplicate name',
      (() => {
        // Two entries named alike: build with distinct names, then rename the first.
        const two = zipOf({ 'quality/summary.jsoX': summary, [QPR_SUMMARY]: summary });
        const at = two.indexOf(
          Buffer.from('quality/summary.jsoX'),
          two.readUInt32LE(two.length - 22 + 16),
        );
        two.write(QPR_SUMMARY, at);
        return two;
      })(),
      /is in the archive twice/,
    ],
    [
      'a lying uncompressed size',
      centralAt(zipOf({ [QPR_SUMMARY]: summary }), 24, summary.length - 1),
      /inflates to/,
    ],
    [
      'a declared size past the bound',
      centralAt(zipOf({ [QPR_SUMMARY]: summary }), 24, 2 ** 31),
      /over 67108864/,
    ],
    ['the encrypted flag', zipOf({ [QPR_SUMMARY]: summary }, { flags: 1 }), /is encrypted/],
    ['ZIP64 sizes', centralAt(zipOf({ [QPR_SUMMARY]: summary }), 20, 0xffffffff), /ZIP64 entry/],
    ['multi-disk', zipOf({ [QPR_SUMMARY]: summary }, { eocd: { disk: 1 } }), /multi-disk/],
    [
      'a bad local signature',
      centralAt(zipOf({ [QPR_SUMMARY]: summary }), 42, 7),
      /local header has no signature/,
    ],
    [
      'a local header that names another file than its central entry',
      zipOf({ [QPR_SUMMARY]: summary }, { names: { [QPR_SUMMARY]: 'quality/summary.jsoX' } }),
      /local header names another file/,
    ],
    [
      'a same-name pair, the end record counting one',
      (() => {
        const two = zipOf(
          { 'quality/summary.jsoX': summary, [QPR_SUMMARY]: summary },
          { eocd: { count: 1 } },
        );
        const at = two.indexOf(
          Buffer.from('quality/summary.jsoX'),
          two.readUInt32LE(two.length - 22 + 16),
        );
        two.write(QPR_SUMMARY, at);
        return two;
      })(),
      /doesn't end at its stated size/,
    ],
    [
      "an end record whose two counts don't agree",
      zipOf(
        { [QPR_SUMMARY]: summary, 'quality/other.json': summary },
        { eocd: { count: 1, diskCount: 2 } },
      ),
      /two entry counts don't agree/,
    ],
    [
      'a central directory longer than its stated size',
      (() => {
        const copy = zipOf({ [QPR_SUMMARY]: summary });
        copy.writeUInt32LE(copy.readUInt32LE(copy.length - 22 + 12) - 1, copy.length - 22 + 12);
        return copy;
      })(),
      /doesn't end at its stated size/,
    ],
    [
      'data past the end',
      centralAt(zipOf({ [QPR_SUMMARY]: summary }), 20, 10_000_000),
      /data runs past the end/,
    ],
  ]) {
    const options = label === 'over the bound' ? { maxBytes: 10 } : undefined;
    assert.throws(() => zipEntry(bad, QPR_SUMMARY, options), why, label);
  }
  // An archive that inflates one byte past the bound stops at it: the zip bomb's bound, zlib's
  // own cut-off. Any looser bound inflates it whole, and then it's refused as "inflates to".
  const bomb = zipOf({ [QPR_SUMMARY]: Buffer.alloc(2049) });
  assert.throws(
    () => zipEntry(centralAt(bomb, 24, 1024), QPR_SUMMARY, { maxBytes: 2048 }),
    /doesn't inflate/,
  );
  // The real artifact, from main's push run 42161399250: bit 3 set on every entry.
  const real = readFileSync(fixture('reports-quality-pr-verdict-42161399250.zip'));
  const read = JSON.parse(zipEntry(real, QPR_SUMMARY).toString('utf8'));
  assert.equal(read.tests.length, 143);
  assert.equal(read.tests.filter((each) => each.outcome === 'unexpected').length, 3);
});
