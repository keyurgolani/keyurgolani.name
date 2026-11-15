// A release shard's verdict files (ci/release/shard-verdict.mjs): what the merged verdict reads of a
// shard, packed apart from its reports so the verdict downloads only them, and unpacked into the
// directories readShards (tests/quality/lib/shards.ts) reads, a plan the shards share written once.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const load = () => import('./shard-verdict.mjs').catch(() => null);
const CLI = fileURLToPath(new URL('./shard-verdict.mjs', import.meta.url));
const VERDICT_FILES = ['plan.json', 'summary.json', 'verdict.json'];

/** A shard's reports as a quality run leaves them: its verdict files, and what else it keeps. */
function writeReports(
  dir,
  { plan = '{"planned":{}}', summary = '{"tests":[]}', verdict = '{"ok":true}' } = {},
) {
  mkdirSync(path.join(dir, 'quality', 'results', 'a-test'), { recursive: true });
  mkdirSync(path.join(dir, 'failures'), { recursive: true });
  writeFileSync(path.join(dir, 'quality', 'plan.json'), plan);
  writeFileSync(path.join(dir, 'quality', 'summary.json'), summary);
  writeFileSync(path.join(dir, 'quality', 'verdict.json'), verdict);
  writeFileSync(path.join(dir, 'quality', 'results', 'a-test', 'shot.png'), Buffer.alloc(4096, 1));
  writeFileSync(path.join(dir, 'failures', 'unit-a.json'), '{}');
}

test("a shard's verdict files pack into one small artifact: its quality plan, summary and verdict gzipped, and nothing else of its reports", async (t) => {
  const mod = await load();
  assert.ok(mod, "ci/release/shard-verdict.mjs packs and unpacks a shard's verdict files");
  const root = mkdtempSync(path.join(tmpdir(), 'shard-verdict-pack-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const reports = path.join(root, 'reports');
  writeReports(reports, { plan: JSON.stringify({ planned: { a: 1 } }) });
  const out = path.join(root, 'verdict');
  mod.packShard(reports, out);
  assert.deepEqual(readdirSync(out), ['quality']);
  assert.deepEqual(
    readdirSync(path.join(out, 'quality')).sort(),
    VERDICT_FILES.map((name) => `${name}.gz`),
  );
  for (const name of VERDICT_FILES) {
    assert.deepEqual(
      gunzipSync(readFileSync(path.join(out, 'quality', `${name}.gz`))),
      readFileSync(path.join(reports, 'quality', name)),
      name,
    );
  }
  // A shard that wrote no verdict files packs nothing, and the merge counts it missing.
  const empty = path.join(root, 'empty');
  mkdirSync(empty);
  mod.packShard(empty, path.join(root, 'packed-empty'));
  assert.deepEqual(readdirSync(path.join(root, 'packed-empty', 'quality')), []);
});

test("611 shards' packed verdict files unpack into the directories the merge reads, each a shard's own, every plan they share written once and linked into each", async (t) => {
  const mod = await load();
  assert.ok(mod, "ci/release/shard-verdict.mjs packs and unpacks a shard's verdict files");
  const root = mkdtempSync(path.join(tmpdir(), 'shard-verdict-611-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // One release's plan, the same in every shard, and shard 7's written apart, as a stale one would be.
  const plan = JSON.stringify({ planned: { tests: 'x'.repeat(256 * 1024) } });
  const apart = JSON.stringify({ planned: { tests: 'y'.repeat(256 * 1024) } });
  const downloaded = path.join(root, 'verdicts');
  for (let shard = 1; shard <= 611; shard++) {
    const reports = path.join(root, 'reports', String(shard));
    writeReports(reports, {
      plan: shard === 7 ? apart : plan,
      summary: JSON.stringify({ shard, tests: [] }),
    });
    mod.packShard(reports, path.join(downloaded, `verdict-quality-release-${shard}`));
  }
  const shards = path.join(root, 'quality-shards');
  mod.unpackShards(downloaded, shards);
  const dirs = readdirSync(shards).filter((name) => name.startsWith('verdict-quality-release-'));
  assert.equal(dirs.length, 611);
  const inodes = new Set();
  for (const dir of dirs) {
    const quality = path.join(shards, dir, 'quality');
    assert.deepEqual(readdirSync(quality).sort(), VERDICT_FILES, dir);
    const shard = Number(dir.split('-').at(-1));
    assert.equal(readFileSync(path.join(quality, 'plan.json'), 'utf8'), shard === 7 ? apart : plan);
    assert.equal(JSON.parse(readFileSync(path.join(quality, 'summary.json'), 'utf8')).shard, shard);
    inodes.add(statSync(path.join(quality, 'plan.json')).ino);
  }
  // Two plans on disk, the shared one linked into all 610 of its shards: one plan's bytes, not 611.
  assert.equal(inodes.size, 2);
  const shared = statSync(path.join(shards, 'verdict-quality-release-1', 'quality', 'plan.json'));
  assert.ok(shared.nlink >= 610, `the shared plan has ${shared.nlink} links`);
});

test('a packed file that is not gzip fails the unpack, naming its shard and file', async (t) => {
  const mod = await load();
  assert.ok(mod, "ci/release/shard-verdict.mjs packs and unpacks a shard's verdict files");
  const root = mkdtempSync(path.join(tmpdir(), 'shard-verdict-bad-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const quality = path.join(root, 'verdicts', 'verdict-quality-release-3', 'quality');
  mkdirSync(quality, { recursive: true });
  writeFileSync(path.join(quality, 'summary.json.gz'), 'not gzip');
  assert.throws(
    () => mod.unpackShards(path.join(root, 'verdicts'), path.join(root, 'quality-shards')),
    /verdict-quality-release-3\/quality\/summary\.json\.gz/,
  );
});

/** A shard's summary as the reporter writes it: its tests' outcomes, and its run errors. */
const summaryOf = (tests, errors = []) =>
  JSON.stringify({ status: 'passed', shard: '1/2', tests, errors, projects: [] });
const passed = { title: 'a', outcome: 'expected', status: 'passed' };

test('a shard packs as clean only when its verdict passed and it holds no failed or flaky test, run error or failure record, and says so to the workflow', async (t) => {
  const mod = await load();
  assert.ok(mod, "ci/release/shard-verdict.mjs packs and unpacks a shard's verdict files");
  const root = mkdtempSync(path.join(tmpdir(), 'shard-verdict-clean-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cases = [
    ['clean', { summary: summaryOf([passed]) }, true],
    [
      'a failed test',
      { summary: summaryOf([passed, { ...passed, outcome: 'unexpected', status: 'failed' }]) },
      false,
    ],
    ['a flaky test', { summary: summaryOf([{ ...passed, outcome: 'flaky' }]) }, false],
    ['a run error', { summary: summaryOf([passed], ['the run stopped']) }, false],
    ['a failing verdict', { summary: summaryOf([passed]), verdict: '{"ok":false}' }, false],
  ];
  for (const [name, files, clean] of cases) {
    const reports = path.join(root, name);
    writeReports(reports, files);
    // writeReports leaves a failure record; only the case that holds one keeps it.
    rmSync(path.join(reports, 'failures'), { recursive: true, force: true });
    assert.equal(mod.packShard(reports, path.join(root, `${name}-out`)).clean, clean, name);
  }
  const recorded = path.join(root, 'a failure record');
  writeReports(recorded, { summary: summaryOf([passed]) });
  assert.equal(mod.packShard(recorded, path.join(root, 'recorded-out')).clean, false);
  const unpacked = path.join(root, 'no verdict');
  mkdirSync(path.join(unpacked, 'quality'), { recursive: true });
  writeFileSync(path.join(unpacked, 'quality', 'summary.json'), summaryOf([passed]));
  assert.equal(mod.packShard(unpacked, path.join(root, 'none-out')).clean, false);
  // The workflow reads it as the pack step's `clean` output, only ever true for a clean shard.
  for (const [reports, want] of [
    [path.join(root, 'clean'), 'true'],
    [recorded, 'false'],
  ]) {
    const output = path.join(root, `output-${want}`);
    writeFileSync(output, '');
    const run = spawnSync(
      process.execPath,
      [CLI, 'pack', reports, path.join(root, `cli-${want}`)],
      {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: output },
      },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(output, 'utf8'), `clean=${want}\n`);
  }
});

test("a shard's perf readings pack beside its verdict files, each perf.json gzipped at its own path, and unpack where its reports held them", async (t) => {
  const mod = await load();
  assert.ok(mod, "ci/release/shard-verdict.mjs packs and unpacks a shard's verdict files");
  const root = mkdtempSync(path.join(tmpdir(), 'shard-verdict-perf-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const reports = path.join(root, 'reports');
  writeReports(reports, { summary: summaryOf([passed]) });
  const perf = path.join(
    reports,
    'quality',
    'results',
    'perf-kinetic-cosmos-chromium',
    'perf.json',
  );
  mkdirSync(path.dirname(perf), { recursive: true });
  writeFileSync(perf, JSON.stringify({ cell: 'kinetic-cosmos', sample: [{ idleTaskMs: 20 }] }));
  const out = path.join(root, 'verdicts', 'verdict-quality-release-1');
  mod.packShard(reports, out);
  const packed = path.join(
    out,
    'quality',
    'results',
    'perf-kinetic-cosmos-chromium',
    'perf.json.gz',
  );
  assert.deepEqual(gunzipSync(readFileSync(packed)), readFileSync(perf));
  // A screenshot beside it stays in the reports.
  assert.deepEqual(readdirSync(path.join(out, 'quality', 'results')), [
    'perf-kinetic-cosmos-chromium',
  ]);
  mod.unpackShards(path.join(root, 'verdicts'), path.join(root, 'shards'), { expected: 1 });
  assert.deepEqual(
    readFileSync(
      path.join(
        root,
        'shards',
        'verdict-quality-release-1',
        'quality',
        'results',
        'perf-kinetic-cosmos-chromium',
        'perf.json',
      ),
    ),
    readFileSync(perf),
  );
});

test("an unpack that finds fewer verdicts than the run planned shards fails by name: the listing's 1,000 cap, how many of how many, and which shards", async (t) => {
  const mod = await load();
  assert.ok(mod, "ci/release/shard-verdict.mjs packs and unpacks a shard's verdict files");
  const root = mkdtempSync(path.join(tmpdir(), 'shard-verdict-cap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const downloaded = path.join(root, 'verdicts');
  for (let shard = 1; shard <= 611; shard++) {
    if (shard === 307 || shard === 412) continue;
    const reports = path.join(root, 'reports', String(shard));
    writeReports(reports, { summary: JSON.stringify({ shard, tests: [] }) });
    mod.packShard(reports, path.join(downloaded, `verdict-quality-release-${shard}`));
  }
  assert.throws(
    () => mod.unpackShards(downloaded, path.join(root, 'short'), { expected: 611 }),
    (error) =>
      /the artifact listing hit the 1,000 cap/.test(error.message) &&
      /609 verdicts of 611/.test(error.message) &&
      /missing 307, 412/.test(error.message),
  );
  // The CLI takes the planned count with --expected, and exits 1 with that message.
  const run = spawnSync(
    process.execPath,
    [CLI, 'unpack', downloaded, path.join(root, 'cli'), '--expected', '611'],
    { encoding: 'utf8' },
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /609 verdicts of 611/);
  // Every planned shard's verdict there: no complaint.
  assert.deepEqual(
    mod.unpackShards(downloaded, path.join(root, 'enough'), { expected: 609 }).shards,
    609,
  );
});
