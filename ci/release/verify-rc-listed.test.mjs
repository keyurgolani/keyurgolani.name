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
  flakyLines,
  GATE_NEEDS,
  notJudgedLines,
  otherJobsRed,
  QPR_ARTIFACT,
  QPR_JOBS,
  QPR_SUMMARY,
  qprJobsProof,
  qualityPrSummary,
  qualityPrUnlisted,
  SHARD_COUNTS,
  summaryMarkdown,
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
    // A held test's entries aren't judged: nothing it failed on says its records passed.
    [
      'a timeout before it wrote any record',
      { status: 'timedOut', failures: [], checks: [] },
      /it ended timedOut, not failed/,
    ],
    ['a failure before any record', { failures: [] }, /it failed with no failure record/],
    [
      'a skipped owed check, its record absent with it',
      { failures: [FOCUS], checks: ['status', 'keyboard', 'focus'] },
      /it didn't run its axe check\(s\)/,
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

/**
 * A quality-pr sentinel's owed checks at 1440, default, without the conditions the plan gives
 * only some cells: CELL_CHECKS, the default row's suites, and hover at a pointer viewport, as
 * requiredChecks('default', '1440x900', false) gives them.
 */
const SENTINEL = [
  'status',
  'emulation',
  'clock',
  'axe',
  'contrast',
  'keyboard',
  'focus',
  'occlusion',
  'overlays',
  'hover',
];
/** cellTest() as a sentinel: it owed and ran SENTINEL's checks. */
const sentinel = (failures, extra = {}) =>
  cellTest(failures, { checks: SENTINEL, owed: SENTINEL, ...extra });
/** A condition record a sentinel's push-run test never runs: reflow isn't among its owed checks. */
const REFLOW = { check: 'reflow', rule: 'overflow', target: '@320x568 #main > p:nth-child(3)' };
/** The green push run's input, its listed test passed, with `tests` as its summary's tests. */
const greenWith = (listed, tests) =>
  input({
    run: GREEN,
    jobList: jobs({}, { red: false }),
    artifacts: [artifact(GREEN)],
    listed,
    summary: { ...qprSummary('passed'), tests },
  });
/** The red push run's input, red on FOCUS and AXE alone, `extra` listed beside them. */
const redWith = (extra, test) =>
  input({ listed: [...LISTED, ...extra], summary: { ...qprSummary([FOCUS, AXE]), tests: [test] } });

test("an entry whose check its test didn't owe on the push run is not judged: a note, never 'take its entry out', while a missing or malformed owed list judges it as before", () => {
  // The red path: quality-pr red on FOCUS and AXE alone, the reflow entry beside them.
  const red = evaluateRc(redWith([entry(REFLOW)], sentinel([FOCUS, AXE])));
  assert.deepEqual(red.reasons, []);
  assert.equal(red.ok, true);
  assert.deepEqual(red.notJudged, [
    { entry: entry(REFLOW), why: "its test didn't owe its reflow check on this run" },
  ]);
  assert.deepEqual(notJudgedLines(red.notJudged), [
    `- not judged: ${CELL} at 1440x900, default, on chromium: reflow overflow on @320x568 #main > p:nth-child(3) (its test didn't owe its reflow check on this run; owner lane C, row 5)`,
  ]);
  // Owed, and gone: it's passed, and the tag is refused, as any listed record that no longer fails.
  const owed = [...SENTINEL, 'reflow'];
  assert.match(
    refusal(evaluateRc(redWith([entry(REFLOW)], sentinel([FOCUS, AXE], { owed, checks: owed })))),
    /reflow overflow on @320x568 #main > p:nth-child\(3\) no longer fails: take its entry out/,
  );
  // The green path: the listed test passed without owing reflow; the reflow entry alone is listed.
  const notOwed = evaluateRc(greenWith([entry(REFLOW)], [sentinel('passed')]));
  assert.deepEqual(notOwed.reasons, []);
  assert.equal(notOwed.ok, true);
  assert.deepEqual(
    notOwed.notJudged.map(({ entry: each }) => each.check),
    ['reflow'],
  );
  // A missing or malformed owed list, or a checks list that's missing or holds the check, keeps
  // today's judging: passed, so refused. Each row but the last two breaks one conjunct alone.
  const open = [];
  for (const [label, extra] of [
    ['no owed list', { owed: undefined }],
    ['an empty owed list', { owed: [] }],
    ['an owed list holding a number', { owed: ['status', 7] }],
    ['an owed list that is a string', { owed: 'status axe' }],
    ["the sentinel's owed list and a number", { owed: [...SENTINEL, 7] }],
    ["the sentinel's owed list and an empty name", { owed: [...SENTINEL, ''] }],
    ['an empty name alone', { owed: [''] }],
    ['status and an empty name', { owed: ['status', ''] }],
    ["the sentinel's owed list short of axe", { owed: SENTINEL.filter((each) => each !== 'axe') }],
    [
      "the sentinel's owed list short of clock",
      { owed: SENTINEL.filter((each) => each !== 'clock') },
    ],
    ['no checks list', { checks: undefined }],
    ['a checks list that is a string', { checks: SENTINEL.join(' ') }],
    [
      "the sentinel's owed list, reflow among the checks it ran",
      { checks: [...SENTINEL, 'reflow'] },
    ],
    [
      'an owed list of a name no check has, reflow ran',
      { owed: ['bogus'], checks: [...SENTINEL, 'reflow'] },
    ],
    [
      'an owed list of a lowercase name, reflow ran',
      { owed: ['REFLOW'], checks: [...SENTINEL, 'reflow'] },
    ],
  ]) {
    const verdict = evaluateRc(greenWith([entry(REFLOW)], [sentinel('passed', extra)]));
    if (verdict.ok || !/passed in ci run 202's quality-pr/.test(verdict.reasons.join(' | ')))
      open.push(`${label}: ${verdict.reasons.join(' | ') || 'accepted'}`);
  }
  assert.deepEqual(open, []);
});

test("only a condition entry can come out not judged: an entry of any other check, misspelt, the runner's, or a swept test's transparency, is judged on both paths as before row 64", () => {
  const NOT_CONDITIONS = [
    ['a check spelt with a capital', { check: 'Focus', rule: 'contrast', target: NAV }],
    ['a misspelt check', { check: 'focuss', rule: 'contrast', target: NAV }],
    ["the runner's", { check: 'runner', rule: 'settled', target: null }],
    ['motion on a default-row key', { check: 'motion', rule: 'frame-loop', target: null }],
    ['a check no test runs', { check: 'notice', rule: 'missing', target: NAV }],
  ];
  // A swept test (a pack change on a push runs swept cells): its owed and checks use
  // sweepCheck()'s names, its records the bare gate, a transparency record its element's path.
  const swept = ['default', 'forced-colors', 'reduced-motion', 'reduced-transparency'].flatMap(
    (row, at) =>
      [
        ...SENTINEL.slice(0, 5),
        'sweep-pack',
        ...(at === 0 ? ['sweep-isolation'] : []),
        ...{
          default: ['keyboard', 'focus'],
          'forced-colors': ['keyboard', 'focus'],
          'reduced-motion': ['motion'],
          'reduced-transparency': ['transparency'],
        }[row],
      ].map((check) => (row === 'default' ? check : `${row}:${check}`)),
  );
  assert.ok(swept.includes('reduced-transparency:transparency') && !swept.includes('transparency'));
  const TRANSPARENCY = { check: 'transparency', rule: 'opaque', target: 'nav.ag-capsule' };
  const open = [];
  for (const [label, failure, extra] of [
    ...NOT_CONDITIONS.map(([label, failure]) => [label, failure, {}]),
    ["a swept test's transparency", TRANSPARENCY, { owed: swept, checks: swept }],
  ]) {
    const green = evaluateRc(greenWith([entry(failure)], [sentinel('passed', extra)]));
    if (green.ok || !/passed in ci run 202's quality-pr/.test(green.reasons.join(' | ')))
      open.push(`green, ${label}: ${green.reasons.join(' | ') || 'accepted'}`);
    const red = evaluateRc(redWith([entry(failure)], sentinel([FOCUS, AXE], extra)));
    if (red.ok || !/no longer fails: take its entry out/.test(red.reasons.join(' | ')))
      open.push(`red, ${label}: ${red.reasons.join(' | ') || 'accepted'}`);
    if ((green.notJudged ?? []).length + (red.notJudged ?? []).length > 0)
      open.push(`${label}: not judged`);
  }
  assert.deepEqual(open, []);
  // The three conditions, on the same sentinel, are the ones not judged.
  const conditions = ['reflow', 'inventory', 'enhancement'].map((check) =>
    entry({ check, rule: 'r', target: '#main' }),
  );
  const notJudged = evaluateRc(greenWith(conditions, [sentinel('passed')]));
  assert.deepEqual(notJudged.reasons, []);
  assert.deepEqual(
    notJudged.notJudged.map(({ entry: each }) => each.check),
    ['reflow', 'inventory', 'enhancement'],
  );
});

test("rc-verify's job summary prints each entry not judged and each flaky entry under its heading, after the verdict's own lines", () => {
  const verdict = evaluateRc(greenWith([entry(REFLOW)], [sentinel('passed')]));
  const flaky = [
    {
      entry: { ...entry(AXE), flaky: true, seen: { commit: SHA, failed: '7', passed: '8' } },
      outcome: 'not run',
    },
  ];
  const text = summaryMarkdown({ ...verdict, flaky }, { tag: 'v1.0.0-rc.1', sha: SHA });
  assert.equal(
    text,
    [
      `### v1.0.0-rc.1: eligible\n\n${SHA} is on main, and ci run [202](${GREEN.html_url}) passed gate on it.\n`,
      `\nNot judged on this run, their check not owed there:\n\n${notJudgedLines(verdict.notJudged).join('\n')}\n`,
      `\nFlaky entries in the records list:\n\n${flakyLines(flaky).join('\n')}\n`,
    ].join(''),
  );
  assert.equal(notJudgedLines(verdict.notJudged).length, 1);
  // A refusal names each reason; with nothing not judged or flaky, no heading follows.
  const refused = summaryMarkdown(
    { ok: false, reasons: ['one', 'two'], notJudged: [], flaky: [] },
    { tag: 'v1.0.0-rc.1', sha: SHA },
  );
  assert.equal(refused, '### v1.0.0-rc.1: refused\n\n- one.\n- two.\n');
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
      'a verdict job that names no attempt',
      { jobList: jobs({ 'quality-pr-verdict': { run_attempt: undefined } }) },
      /quality-pr-verdict's job is attempt undefined, not the run's 1/,
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
  // A listing that failed is refused by its own error, not as an empty listing.
  const listing = refusal(
    evaluateRc(input({ artifacts: new Error('GET /artifacts answered HTTP 502') })),
  );
  assert.match(
    listing,
    /run 201's artifacts couldn't be listed: GET \/artifacts answered HTTP 502/,
  );
  assert.doesNotMatch(listing, /has 0 live/);
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
  // A green summary whose one test passed on another cell than the listed one's.
  const OTHER_CELL = qprSummary('passed', {
    tests: [cellTest('passed', { cell: 'another cell' })],
  });
  assert.deepEqual(evaluateRc(input({ ...green, summary: OTHER_CELL })).reasons, []);
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
    // The shape guard's own class: a summary whose cell tests can't be found holds none to judge.
    ['no tests', qprSummary('passed', { tests: [] }), /holds no cell test/],
    [
      'kind dropped from every test',
      {
        ...qprSummary('passed'),
        tests: qprSummary('passed').tests.map(({ kind, ...rest }) => ({ ...rest, type: kind })),
      },
      /holds no cell test/,
    ],
    // On a passing test of another cell, so no listed entry runs and nothing else refuses.
    [
      'a verdict not ok with no failures',
      { ...OTHER_CELL, verdict: { ok: false, failures: [] } },
      /its verdict failed, though gate passed/,
    ],
    [
      'a verdict ok with a failure',
      { ...OTHER_CELL, verdict: { ok: true, failures: [{ rule: 'tests-failed' }] } },
      /its verdict failed, though gate passed/,
    ],
    // A green verdict over a failed test contradicts itself: a held test's entries aren't
    // judged, so nothing else would refuse it.
    [
      'a failed test before any record, under a green verdict',
      { ...qprSummary('passed'), tests: [cellTest([], { status: 'timedOut', checks: [] })] },
      /holds a failed test, though gate passed/,
    ],
    [
      'a failed test on its listed records, under a green verdict',
      { ...qprSummary('passed'), tests: [cellTest([FOCUS, AXE])] },
      /holds a failed test, though gate passed/,
    ],
    ...['cell', 'viewport', 'row', 'engine'].flatMap((field) => [
      [
        `a cell test with no ${field}`,
        { ...qprSummary('passed'), tests: [cellTest('passed', { [field]: undefined })] },
        /don't name their cell, viewport, row, engine/,
      ],
      [
        `a cell test whose ${field} is empty`,
        { ...qprSummary('passed'), tests: [cellTest('passed', { [field]: '' })] },
        /don't name their cell, viewport, row, engine/,
      ],
    ]),
  ]) {
    const verdict = evaluateRc(input({ ...green, summary }));
    const reason = verdict.reasons.join(' | ');
    if (verdict.ok || !/can't be held to the records list/.test(reason) || !why.test(reason))
      open.push(`${label}: ${reason || 'accepted'}`);
  }
  assert.deepEqual(open, []);
  // A green run counts only on its first attempt while the list names any entry, its verdict
  // job's attempt with it.
  const second = { ...GREEN, run_attempt: 2 };
  assert.match(
    refusal(
      evaluateRc(
        input({
          run: second,
          jobList: jobs({ 'quality-pr-verdict': { run_attempt: 2 } }, { red: false }),
          artifacts: [artifact(second)],
          summary: OTHER_CELL,
        }),
      ),
    ),
    /can't be held to the records list: run 202 is attempt 2, and only a first attempt counts/,
  );
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
      'a failing test with fewer errors than its soft count',
      {
        ...qprSummary([FOCUS, AXE]),
        tests: [cellTest([FOCUS, AXE], { errors: ["Slice 2's suites"], softFailures: 2 })],
      },
      /ended with 1 error\(s\), not the 2 soft expectation\(s\)/,
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
        // Its matrix is the shard key alone: a second key, or include or exclude, would run each
        // shard more than once, and otherJobsRed would refuse every red run.
        assert.deepEqual(Object.keys(ci.jobs[need].strategy.matrix), ['shard'], need);
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
  // The summary predates the reporter's failures, soft count and owed checks: its failing tests
  // are given them from the shard's own records, and from the fixture's errors and checks.
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
  // The counts it's judged at are evaluateRc's argument: at browser 3, the run's two browser
  // shards are refused.
  assert.match(
    refusal(evaluateRc(realInput(browserGreen, { ...RUN_COUNTS, browser: 3 }))),
    /not its shards of 3/,
  );
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
/** An extra field of id `id` holding `data`. */
const extraField = (id, data) => {
  const head = Buffer.alloc(4);
  head.writeUInt16LE(id, 0);
  head.writeUInt16LE(data.length, 2);
  return Buffer.concat([head, data]);
};
/** An Info-ZIP Unicode Path field: version 1, the CRC-32 of the entry's raw name, then `path`. */
const unicodePath = (rawName, path) => {
  const data = Buffer.alloc(5);
  data.writeUInt8(1, 0);
  data.writeUInt32LE(crc32(Buffer.from(rawName)), 1);
  return extraField(0x7075, Buffer.concat([data, Buffer.from(path)]));
};
/** `zip` with `fields` as the extra of its central entry at `index` (0-based). */
function withCentralExtra(zip, index, fields) {
  const extra = Buffer.concat(fields);
  let at = zip.readUInt32LE(zip.length - 22 + 16);
  for (let n = 0; n < index; n += 1)
    at += 46 + zip.readUInt16LE(at + 28) + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  const nameEnd = at + 46 + zip.readUInt16LE(at + 28);
  const copy = Buffer.concat([zip.subarray(0, nameEnd), extra, zip.subarray(nameEnd)]);
  copy.writeUInt16LE(extra.length, at + 30);
  const end = copy.length - 22;
  copy.writeUInt32LE(copy.readUInt32LE(end + 12) + extra.length, end + 12);
  return copy;
}
/** `zip` with `fields` as the extra of its last local header, the directory moved past them. */
function withLastLocalExtra(zip, fields) {
  const extra = Buffer.concat(fields);
  const end = zip.length - 22;
  const start = zip.readUInt32LE(end + 16);
  // The last central entry's local offset.
  let at = start;
  let local = 0;
  for (let n = 0; n < zip.readUInt16LE(end + 10); n += 1) {
    local = zip.readUInt32LE(at + 42);
    at += 46 + zip.readUInt16LE(at + 28) + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  const nameEnd = local + 30 + zip.readUInt16LE(local + 26);
  const copy = Buffer.concat([zip.subarray(0, nameEnd), extra, zip.subarray(nameEnd)]);
  copy.writeUInt16LE(extra.length, local + 28);
  copy.writeUInt32LE(start + extra.length, copy.length - 22 + 16);
  return copy;
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
      'a directory that ends short of its end record',
      (() => {
        // The directory, then a second copy of its entry before the end record, which other
        // readers find there by the end record less its size.
        const one = zipOf({ [QPR_SUMMARY]: summary });
        const end = one.length - 22;
        const start = one.readUInt32LE(end + 16);
        const size = one.readUInt32LE(end + 12);
        return Buffer.concat([
          one.subarray(0, end),
          one.subarray(start, start + size),
          one.subarray(end),
        ]);
      })(),
      /doesn't end at the end record/,
    ],
    [
      'a ZIP64 locator before the end record',
      (() => {
        const one = zipOf({ [QPR_SUMMARY]: summary });
        const end = one.length - 22;
        const locator = Buffer.alloc(20);
        locator.writeUInt32LE(0x07064b50, 0);
        // Inside the last central entry's comment, so the walk still ends at the end record.
        const start = one.readUInt32LE(end + 16);
        const copy = Buffer.concat([one.subarray(0, end), locator, one.subarray(end)]);
        copy.writeUInt16LE(20, start + 32);
        copy.writeUInt32LE(one.readUInt32LE(end + 12) + 20, end + 20 + 12);
        return copy;
      })(),
      /a ZIP64 archive, by its locator/,
    ],
    [
      'a central directory past its end record',
      (() => {
        const copy = zipOf({ [QPR_SUMMARY]: summary });
        copy.writeUInt32LE(copy.readUInt32LE(copy.length - 22 + 12) + 1, copy.length - 22 + 12);
        return copy;
      })(),
      /the central directory runs past its end record/,
    ],
    [
      'a name holding a NUL',
      zipOf({ [`${QPR_SUMMARY}\u0000`]: summary, [QPR_SUMMARY]: summary }),
      /central entry 1's name holds a NUL or a backslash/,
    ],
    [
      'a name holding a backslash',
      zipOf({ 'quality\\summary.json': summary, [QPR_SUMMARY]: summary }),
      /central entry 1's name holds a NUL or a backslash/,
    ],
    [
      'a Unicode Path field naming another file',
      // decoy.json, after the summary, whose version-1 0x7075 field, over its raw name's CRC-32 as
      // Info-ZIP writes it, other readers take as quality/summary.json.
      withCentralExtra(zipOf({ [QPR_SUMMARY]: summary, 'decoy.json': summary }), 1, [
        unicodePath('decoy.json', QPR_SUMMARY),
      ]),
      /central entry 2 carries a Unicode Path field/,
    ],
    [
      'a Unicode Path field second, after a timestamp',
      withCentralExtra(zipOf({ [QPR_SUMMARY]: summary, 'decoy.json': summary }), 1, [
        extraField(0x5455, Buffer.from([1, 0, 0, 0, 0])),
        unicodePath('decoy.json', QPR_SUMMARY),
      ]),
      /central entry 2 carries a Unicode Path field/,
    ],
    [
      'an extra field too short for its own header',
      withCentralExtra(zipOf({ [QPR_SUMMARY]: summary, 'decoy.json': summary }), 1, [
        Buffer.from([0x55, 0x54]),
      ]),
      /central entry 2's extra field is malformed/,
    ],
    [
      'a decoy whose local header names the summary',
      zipOf(
        { [QPR_SUMMARY]: summary, 'decoy.jsonX': summary },
        { names: { 'decoy.jsonX': QPR_SUMMARY.padEnd('decoy.jsonX'.length, 'X') } },
      ),
      /decoy\.jsonX's local header names another file/,
    ],
    [
      'a decoy whose local header carries a Unicode Path field',
      withLastLocalExtra(zipOf({ [QPR_SUMMARY]: summary, 'decoy.json': summary }), [
        unicodePath('decoy.json', QPR_SUMMARY),
      ]),
      /decoy\.json's local header carries a Unicode Path field/,
    ],
    [
      'a local header of another method than its central entry',
      (() => {
        const stored = zipOf({ [QPR_SUMMARY]: summary, 'other.json': summary }, { method: 0 });
        // The other entry's local header says deflate; its central entry says stored.
        const second = stored.readUInt32LE(
          stored.readUInt32LE(stored.length - 22 + 16) + 46 + QPR_SUMMARY.length + 42,
        );
        stored.writeUInt16LE(8, second + 8);
        return stored;
      })(),
      /other\.json's local header names another compression method/,
    ],
    ...[
      '/quality/summary.json',
      './quality/summary.json',
      'quality//summary.json',
      'quality/../quality/summary.json',
    ].map((path) => [
      `a name that isn't a plain relative path: ${path}`,
      zipOf({ [QPR_SUMMARY]: summary, [path]: summary }),
      /central entry 2's name isn't a plain relative path/,
    ]),
    [
      'data that runs into the central directory',
      (() => {
        const stored = zipOf({ [QPR_SUMMARY]: summary }, { method: 0 });
        return centralAt(stored, 20, summary.length + 10);
      })(),
      /data runs into the central directory/,
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

test("rc-verify's artifact read: a listing that fails is kept as its own error, for the refusal to name", async () => {
  const failed = await qualityPrSummary('/repos/o/r', RED, SHA, jobs(), {
    get: async () => {
      throw new Error('GET /repos/o/r/actions/runs/201/artifacts answered HTTP 502');
    },
    getBytes: async () => assert.fail('no download without a listing'),
  });
  assert.ok(failed.artifacts instanceof Error);
  assert.equal(failed.summary, failed.artifacts);
  const reason = refusal(
    evaluateRc(input({ artifacts: failed.artifacts, summary: failed.summary })),
  );
  assert.match(reason, /run 201's artifacts couldn't be listed: GET .* answered HTTP 502/);
  // A listing that reads is bound and downloaded as before.
  const zip = readFileSync(fixture('reports-quality-pr-verdict-42161399250.zip'));
  const real = JSON.parse(readFileSync(fixture('ci-jobs-run-42161399250.json'), 'utf8')).jobs;
  const run = { ...RED, id: 42161399250 };
  const read = await qualityPrSummary('/repos/o/r', run, SHA, real, {
    get: async () => ({
      artifacts: [
        artifact(run, { workflow_run: { id: run.id, head_sha: SHA, head_branch: 'main' } }),
      ],
    }),
    getBytes: async () => zip,
  });
  assert.equal(read.artifacts.length, 1);
  assert.equal(read.summary.tests.length, 143);
});

test("docs/releasing.md's dry run runs both of rc-verify's checks and tags on the words verify-rc.mjs prints", () => {
  const doc = readFileSync(new URL('../../docs/releasing.md', import.meta.url), 'utf8');
  const source = readFileSync(new URL('./verify-rc.mjs', import.meta.url), 'utf8');
  const dry = doc.slice(doc.indexOf('dry-run `rc-verify`'), doc.indexOf('## Promotion'));
  assert.ok(dry.length > 0);
  // Both of the rc-verify job's steps, on the checkout's own commit.
  assert.match(dry, /TAG=v1\.0\.0-rc\.1 node ci\/release\/verify-scope\.mjs &&/);
  assert.match(dry, /SHA="\$\(git rev-parse HEAD\)"[^`]*node ci\/release\/verify-rc\.mjs/);
  assert.match(dry, /`contents: read` and `actions: read`/);
  // The words it tags on are the summary's own.
  const [, listed, green] = /prints `([^`]+)` \(or, on a green run, `([^`]+)`\)/.exec(dry);
  assert.ok(source.includes(`? \`### \${tag}: ${listed}\\n\\n`), listed);
  assert.ok(source.includes(`: \`### \${tag}: ${green}\\n\\n`), green);
});
