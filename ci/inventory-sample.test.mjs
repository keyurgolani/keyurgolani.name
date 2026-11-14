import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sampleOutputs, sampleProblems } from './inventory-sample.mjs';

const tag = (n) => `@test-${String(n).padStart(12, '0')}`;
const job = (label, tags) => ({ label, tests: tags.length, grep: `(${tags.join('|')})` });

test("a sample's jobs become one matrix, and the whole run's three shard lists go empty", () => {
  const sample = { jobs: [job('sample-f1', [tag(1), tag(2)]), job('sample-t1', [tag(3)])] };
  assert.deepEqual(sampleProblems(sample), []);
  const lines = sampleOutputs(sample).trim().split('\n');
  assert.deepEqual(JSON.parse(lines[0].slice('matrix='.length)), {
    include: sample.jobs.map(({ label, grep }) => ({ label, grep })),
  });
  assert.deepEqual(lines.slice(1), ['shards1=[]', 'shards2=[]', 'shards3=[]']);
});

test('a sample with no jobs, over 12 jobs, a repeated or unnamed label, a grep of anything but @test tags, or a wrong count is refused', () => {
  assert.deepEqual(sampleProblems({ jobs: [] }), ['the sample names no jobs']);
  const many = { jobs: Array.from({ length: 13 }, (_, at) => job(`sample-j${at}`, [tag(at)])) };
  assert.match(sampleProblems(many)[0], /13 jobs, more than the 12/);
  assert.match(
    sampleProblems({ jobs: [job('sample-a', [tag(1)]), job('sample-a', [tag(2)])] })[0],
    /repeats/,
  );
  assert.match(sampleProblems({ jobs: [job('other', [tag(1)])] })[0], /isn't sample-<name>/);
  assert.match(
    sampleProblems({ jobs: [{ label: 'sample-a', tests: 1, grep: '(.*)' }] })[0],
    /@test tags/,
  );
  assert.match(
    sampleProblems({ jobs: [{ ...job('sample-a', [tag(1)]), tests: 2 }] })[0],
    /says 2 tests/,
  );
});

test('the checked-in sample is one the workflow runs: at most 12 jobs of @test tags, each named once', () => {
  const sample = JSON.parse(
    readFileSync(new URL('../quality/inventory/sample.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(sampleProblems(sample), []);
  const tags = sample.jobs.flatMap((each) => each.grep.slice(1, -1).split('|'));
  assert.equal(new Set(tags).size, tags.length, 'no test runs twice');
});
