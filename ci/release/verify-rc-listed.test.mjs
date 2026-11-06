// rc-verify's named-records path (verify-rc.mjs): a candidate whose push run on main is red
// counts only when quality-pr is its one red and quality-pr's every failure record is one the
// candidate's records list names, by rc-quality's own matcher (release-records.mjs). The push
// run's quality-pr summary arrives as an artifact zip (zip.mjs), read as untrusted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { parse } from 'yaml';
import { listEntry, testFailures } from './release-records.mjs';
import {
  evaluateRc,
  GATE_NEEDS,
  otherJobsRed,
  QPR_JOBS,
  QPR_SUMMARY,
  qualityPrUnlisted,
} from './verify-rc.mjs';
import { crc32, zipEntry } from './zip.mjs';

const SHA = '1'.repeat(40);
const compare = JSON.parse(
  readFileSync(new URL('./fixtures/compare-ahead.json', import.meta.url), 'utf8'),
);
const CELL =
  'composition:horizontal-cinema complete / horizontal-cinema/platform-neutral/warm-parchment/humanist-ui/system';
const NAV = 'html > body:nth-child(2) > header:nth-child(2) > nav:nth-child(2) > a:nth-child(1)';

/** The red push run on the commit. */
const RED = {
  id: 201,
  path: '.github/workflows/ci.yml',
  event: 'push',
  head_branch: 'main',
  head_sha: SHA,
  status: 'completed',
  conclusion: 'failure',
  html_url: 'https://github.com/o/r/actions/runs/201',
};
const MATRIX = { unit: 3, browser: 2, variants: 4, 'quality-pr': 2 };
/** Every job gate needs, green, but quality-pr's second shard, its verdict, and gate itself. */
function jobs(change = {}) {
  const all = GATE_NEEDS.flatMap((need) =>
    MATRIX[need]
      ? Array.from({ length: MATRIX[need] }, (_, at) => ({
          name: `${need} (${at + 1}/${MATRIX[need]})`,
          conclusion: 'success',
        }))
      : [{ name: need, conclusion: 'success' }],
  ).map((job) =>
    job.name === 'quality-pr (2/2)' || job.name === 'quality-pr-verdict'
      ? { ...job, conclusion: 'failure' }
      : job,
  );
  return [
    ...all.map((job) => (change[job.name] ? { ...job, ...change[job.name] } : job)),
    { name: 'gate', conclusion: 'failure' },
  ];
}

/** quality-pr's cell test of HC at 1440, failing on `failures` (or passing). */
const cellTest = (failures) => ({
  title: `${CELL} › 1440x900 default › horizontal-cinema complete at 1440x900, default`,
  kind: 'cell',
  cell: CELL,
  viewport: '1440x900',
  row: 'default',
  engine: 'chromium',
  outcome: failures === 'passed' ? 'expected' : 'unexpected',
  failures: failures === 'passed' ? [] : failures,
});
const FOCUS = { check: 'focus', rule: 'contrast', target: NAV };
const AXE = { check: 'axe', rule: 'color-contrast', target: '#main > p:nth-child(3)' };
/** The merged quality-pr summary, its verdict red on tests-failed alone when a test fails. */
const qprSummary = (failures, extra = {}) => ({
  schemaVersion: 1,
  mode: 'pr',
  shard: null,
  tests: [cellTest(failures), { title: 'harness', kind: undefined, outcome: 'expected' }],
  errors: [],
  verdict: {
    ok: failures === 'passed',
    failures: failures === 'passed' ? [] : [{ rule: 'tests-failed', message: '1 test(s) failed' }],
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

const input = ({ summary = qprSummary([FOCUS, AXE]), listed = LISTED, jobList = jobs() } = {}) => ({
  tag: 'v1.0.0-rc.1',
  sha: SHA,
  compare,
  runs: [RED],
  jobsByRun: { 201: jobList },
  quality: { listed, summaries: { 201: summary } },
});

test("a red push run whose one red is quality-pr's, on listed records alone, is accepted", () => {
  const verdict = evaluateRc(input());
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.run.id, 201);
  assert.equal(verdict.listed, true);
});

test('an unlisted quality-pr failure blocks the tag, naming it with its ready-to-paste entry', () => {
  const verdict = evaluateRc(input({ listed: [entry(FOCUS)] }));
  assert.equal(verdict.ok, false);
  const printed = listEntry(testFailures(cellTest([AXE]))[0]);
  assert.match(verdict.reasons[0], /no red one is red on listed records alone/);
  assert.ok(
    verdict.reasons[0].includes(
      `axe color-contrast failed, and the records list doesn't name it. To list it: ${printed}`,
    ),
    verdict.reasons[0],
  );
  // An empty list, as a final release's is, leaves only the green run.
  assert.equal(evaluateRc(input({ listed: [] })).ok, false);
});

test('a listed record that now passes blocks the tag', () => {
  // The test passed: both its entries are stale.
  let verdict = evaluateRc(input({ summary: qprSummary('passed') }));
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /on html > body.* no longer fails: take its entry out/);
  // It still fails, but no longer on the axe record.
  verdict = evaluateRc(input({ summary: qprSummary([FOCUS]) }));
  assert.equal(verdict.ok, false);
  assert.match(
    verdict.reasons[0],
    /axe color-contrast on #main > p:nth-child\(3\) no longer fails/,
  );
});

test('any other job gate needs that is not green blocks the tag, whatever the list says', () => {
  for (const [name, change] of [
    ['unit (2/3)', { conclusion: 'failure' }],
    ['docs', { conclusion: 'cancelled' }],
    ['quality-pr-plan', { conclusion: 'failure' }],
    ['image', { conclusion: 'skipped' }],
  ]) {
    const verdict = evaluateRc(input({ jobList: jobs({ [name]: change }) }));
    assert.equal(verdict.ok, false, name);
    assert.ok(
      verdict.reasons[0].includes(`${name} ended ${change.conclusion}`),
      verdict.reasons[0],
    );
  }
  // A job missing, or a matrix job short a shard, is no better.
  const missing = jobs().filter((job) => job.name !== 'trace');
  assert.match(evaluateRc(input({ jobList: missing })).reasons[0], /trace didn't run/);
  const short = jobs().filter((job) => job.name !== 'variants (4/4)');
  assert.match(evaluateRc(input({ jobList: short })).reasons[0], /variants ran 3 of its 4 shards/);
  assert.deepEqual(otherJobsRed(jobs()), []);
});

test("quality-pr's summary is untrusted: anything missing, malformed, or beyond a listed cell failure blocks the tag", () => {
  for (const [label, summary, why] of [
    ['an Error', new Error('HTTP 410'), /summary couldn't be read: HTTP 410/],
    ['nothing', undefined, /summary couldn't be read: not fetched/],
    ['no tests', { verdict: { failures: [] } }, /has no tests/],
    ['no verdict', { tests: [] }, /has no verdict/],
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
      'a red verdict with nothing failing',
      qprSummary('passed', { verdict: { ok: false, failures: [] } }),
      /no listed failure/,
    ],
  ]) {
    const listed = label === 'a red verdict with nothing failing' ? [] : LISTED;
    const base = input({ listed });
    const verdict = evaluateRc({ ...base, quality: { listed, summaries: { 201: summary } } });
    assert.equal(verdict.ok, false, label);
    assert.match(verdict.reasons[0], why, label);
  }
  // With no list read at all, a red run never counts.
  const none = evaluateRc({ ...input(), quality: undefined });
  assert.match(none.reasons[0], /no records list was read/);
  assert.deepEqual(qualityPrUnlisted(qprSummary([FOCUS, AXE]), LISTED), []);
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
});

/** A zip of `files` ({ name: Buffer }), each deflated or stored, as upload-artifact writes one. */
function zipOf(files, { method = 8 } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const packed = method === 8 ? deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test("the artifact's summary is read out of its zip, and a malformed, oversized, or tampered zip is refused", () => {
  const summary = Buffer.from(JSON.stringify(qprSummary([FOCUS, AXE])));
  const zip = zipOf({ 'quality/merged-verdict.json': Buffer.from('{}'), [QPR_SUMMARY]: summary });
  assert.deepEqual(zipEntry(zip, QPR_SUMMARY), summary);
  assert.deepEqual(
    zipEntry(zipOf({ [QPR_SUMMARY]: summary }, { method: 0 }), QPR_SUMMARY),
    summary,
  );
  assert.equal(zipEntry(zip, 'quality/other.json'), null);
  assert.throws(
    () => zipEntry(Buffer.from('not a zip'), QPR_SUMMARY),
    /no end-of-central-directory/,
  );
  assert.throws(() => zipEntry(zip, QPR_SUMMARY, { maxBytes: 10 }), /over 10/);
  assert.throws(() => zipEntry(zip.subarray(0, zip.length - 30), QPR_SUMMARY), /malformed/);
  const tampered = Buffer.from(zipOf({ [QPR_SUMMARY]: summary }, { method: 0 }));
  tampered[60] ^= 0xff;
  assert.throws(() => zipEntry(tampered, QPR_SUMMARY), /CRC-32 doesn't match/);
  assert.throws(
    () => zipEntry(zipOf({ [QPR_SUMMARY]: summary }, { method: 12 }), QPR_SUMMARY),
    /compression method 12/,
  );
});
