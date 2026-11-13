// The inventory's resume (ci/inventory-resume.mjs, quality/inventory/resume.json): a fresh run of
// the shards an earlier inventory run of the same plan never finished, a shard too long for one job
// split by its projects, so the two runs' shards are the plan once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as resume from './inventory-resume.mjs';

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, at) => from + at);

test('a resume runs its shards in its order, a split shard as one job a part under its own number', () => {
  const matrix = resume.resumeMatrix(
    { of: 10, shards: [7, 2, 9], split: { 2: [['chromium a', 'chromium b'], ['chromium c']] } },
    10,
  );
  assert.deepEqual(matrix, {
    include: [
      { shard: 7, label: '7', projects: '', repro: 'pnpm ci:quality-full --shard=7/10' },
      {
        shard: 2,
        label: '2-1',
        projects: 'chromium a,chromium b',
        repro: "pnpm ci:quality-full --shard=2/10 '--project=chromium a' '--project=chromium b'",
      },
      {
        shard: 2,
        label: '2-2',
        projects: 'chromium c',
        repro: "pnpm ci:quality-full --shard=2/10 '--project=chromium c'",
      },
      { shard: 9, label: '9', projects: '', repro: 'pnpm ci:quality-full --shard=9/10' },
    ],
  });
});

test("a resume of another plan's shards, or one that isn't a partition of named projects, is refused", () => {
  const refused = (file, count = 10) => assert.throws(() => resume.resumeMatrix(file, count));
  assert.throws(
    () => resume.resumeMatrix({ of: 9, shards: [1] }, 10),
    /a plan of 9 shards, and this plan has 10: its numbers no longer name the same tests/,
  );
  refused(null);
  refused([]);
  refused({ of: 10, shards: [] });
  refused({ of: 10, shards: [0] });
  refused({ of: 10, shards: [11] });
  refused({ of: 10, shards: [1.5] });
  refused({ of: 10, shards: ['3'] });
  refused({ of: 10, shards: [3, 3] });
  refused({ of: 10, shards: [3], split: { 4: [['chromium a'], ['chromium b']] } });
  refused({ of: 10, shards: [3], split: { 3: [['chromium a']] } });
  refused({ of: 10, shards: [3], split: { 3: [['chromium a'], []] } });
  refused({ of: 10, shards: [3], split: { 3: [['chromium a'], ['chromium a']] } });
  refused({ of: 10, shards: [3], split: { 3: [['chromium a'], ['chromium b,chromium c']] } });
  refused({ of: 10, shards: [3], split: { 3: [['chromium a'], [' chromium b']] } });
  refused({ of: 10, shards: [3], split: [] });
});

test('the checked-in resume is the 128 shards of run 43166869592 that never finished, shard 309 in two parts of three projects', () => {
  const file = JSON.parse(
    readFileSync(new URL('../quality/inventory/resume.json', import.meta.url), 'utf8'),
  );
  assert.equal(file.of, 614);
  const remaining = [184, ...range(186, 231), 309, ...range(373, 423), 585, ...range(587, 614)];
  assert.deepEqual(
    [...file.shards].sort((a, b) => a - b),
    remaining,
  );
  assert.equal(file.shards.length, 128);
  assert.deepEqual(Object.keys(file.split), ['309']);
  // Shard 309's six cell servers, as its log listed its groups: three to a part.
  assert.deepEqual(file.split['309'].flat().sort(), [
    'chromium 125becc693',
    'chromium 39f5a248fb',
    'chromium 694c4b2a40',
    'chromium 98cc0a2055',
    'chromium c7c5a88854',
    'chromium f706d7c5a8',
  ]);
  assert.deepEqual(
    file.split['309'].map((part) => part.length),
    [3, 3],
  );
  const matrix = resume.resumeMatrix(file, 614);
  assert.equal(matrix.include.length, 129);
  assert.deepEqual(
    matrix.include.filter((entry) => entry.shard === 309).map((entry) => entry.label),
    ['309-1', '309-2'],
  );
  assert.equal(new Set(matrix.include.map((entry) => entry.label)).size, 129);
});

test('with no resume file the step writes nothing and the run is the whole inventory; with one, the matrix and empty whole-run lists', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'inventory-resume-'));
  const script = new URL('./inventory-resume.mjs', import.meta.url).pathname;
  const none = spawnSync(process.execPath, [script, path.join(dir, 'resume.json'), '614'], {
    encoding: 'utf8',
  });
  assert.equal(none.status, 0);
  assert.equal(none.stdout, '');
  assert.match(none.stderr, /the run is the whole inventory/);
  const file = path.join(dir, 'resume.json');
  writeFileSync(file, JSON.stringify({ of: 614, shards: [5, 6] }));
  const some = spawnSync(process.execPath, [script, file, '614'], { encoding: 'utf8' });
  assert.equal(some.status, 0);
  assert.deepEqual(some.stdout.trim().split('\n'), [
    `matrix=${JSON.stringify(resume.resumeMatrix({ of: 614, shards: [5, 6] }, 614))}`,
    'shards1=[]',
    'shards2=[]',
    'shards3=[]',
  ]);
  assert.match(some.stderr, /resumes 2 job\(s\) of the plan's 614 shards/);
  const other = spawnSync(process.execPath, [script, file, '615'], { encoding: 'utf8' });
  assert.equal(other.status, 1);
  assert.equal(other.stdout, '');
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 2);
});
