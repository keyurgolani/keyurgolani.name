import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { judge, type MetaCase } from './meta/cases';
import { TIMING_GATE } from './lib/perf/timing';
import { OVER, RELEASE_CASES, releaseOutcome, WITHIN } from './meta/release-cases';
import { MATRIX_GATE, parseReleaseArgs, RELEASE_GATES } from './release';

// pnpm quality:release (#11, 11-4): the full matrix and the release gates
// #12's RC pipeline runs. What it decides is quality:meta's release cases.

test('quality:release runs the matrix whole, or judges a sharded run named by its directory and shard count', () => {
  assert.deepEqual(parseReleaseArgs([]), {});
  assert.deepEqual(parseReleaseArgs(['--']), {});
  assert.deepEqual(parseReleaseArgs(['--', '--merged', 'shards', '--shards', '6']), {
    merged: path.resolve('shards'),
    shards: 6,
  });
  for (const bad of [
    ['--merged', 'shards'],
    ['--merged', '--shards', '6'],
    ['--merged', 'shards', '--shards', '0'],
    ['--shard=1/2'],
  ]) {
    assert.throws(() => parseReleaseArgs(bad), /usage: pnpm quality:release/, bad.join(' '));
  }
});

test('the matrix is the first release gate, and the release script runs the full matrix', () => {
  assert.equal(RELEASE_GATES[0], MATRIX_GATE);
  const { scripts } = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> };
  assert.equal(scripts['quality:release'], 'tsx tests/quality/release.ts');
  assert.equal(
    scripts['ci:quality-release'],
    'node ci/run.mjs quality-release -- pnpm quality:release',
  );
  // The matrix it runs whole is the nightly one: quality:full against the reference variant's worktree.
  assert.match(
    readFileSync(new URL('./release.ts', import.meta.url), 'utf8'),
    /'full', '--', EXTERNAL_VARIANT_FLAG/,
  );
});

test("a release fails on a timing breach: 11-3's timing gate follows the matrix in RELEASE_GATES", async () => {
  assert.deepEqual(RELEASE_GATES, [MATRIX_GATE, TIMING_GATE]);
  const passed = { ok: true, failures: [], flaky: [], counts: {} };
  const within = await releaseOutcome(passed, RELEASE_GATES, WITHIN);
  assert.deepEqual(within, { passed: true, findings: [] });
  const over = await releaseOutcome(passed, RELEASE_GATES, OVER);
  assert.equal(over.passed, false);
  assert.ok(over.findings.length > 0);
  for (const finding of over.findings) assert.match(finding, /^timing timing-over: /);
  // Without the timing gate, the same breach would pass.
  assert.equal((await releaseOutcome(passed, [MATRIX_GATE], OVER)).passed, true);
});

test('each release case goes the way it should', async () => {
  for (const metaCase of RELEASE_CASES as readonly MetaCase[]) {
    assert.equal(judge(metaCase, await metaCase.run()), null, metaCase.id);
  }
});
