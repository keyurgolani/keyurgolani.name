import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { judge, type MetaCase } from './meta/cases';
import { TIMING_GATE } from './lib/perf/timing';
import { OVER, RELEASE_CASES, releaseOutcome, WITHIN } from './meta/release-cases';
import {
  MATRIX_GATE,
  mergedMatrix,
  matrixVerdict,
  parseReleaseArgs,
  RELEASE_GATES,
  runMatrix,
} from './release';
import { SHARD_1, SHARD_2, writeShards } from './meta/shard-cases';

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

test("quality:release reads only the verdict its own run wrote, and only when the run's exit agrees with it", (t) => {
  t.mock.method(console, 'error', () => {});
  const reports = mkdtempSync(path.join(tmpdir(), 'quality-release-'));
  const verdictFile = path.join(reports, 'quality', 'verdict.json');
  const write = (ok: boolean) => {
    mkdirSync(path.dirname(verdictFile), { recursive: true });
    writeFileSync(
      verdictFile,
      JSON.stringify({
        ok,
        failures: ok ? [] : [{ rule: 'tests-failed', message: '1 test(s) failed' }],
        flaky: [],
        counts: {},
      }),
    );
  };
  /** A stand-in for the matrix's run: it writes a verdict, or none, and exits `status`. */
  const run = (status: number | null, writes: boolean | null, error?: string) => () => {
    if (writes !== null) write(writes);
    return { status, ...(error ? { error: new Error(error) } : {}) };
  };
  try {
    // A stale passing verdict from an earlier run never stands in for a run that wrote none.
    write(true);
    assert.equal(runMatrix(run(1, null), reports), null);
    assert.ok(!existsSync(verdictFile), 'the old verdict.json is deleted before the run');

    assert.equal(runMatrix(run(0, true), reports)?.ok, true);
    assert.equal(runMatrix(run(1, false), reports)?.ok, false);
    for (const [status, writes, error, why] of [
      [1, true, undefined, /exited 1, and its verdict\.json says it passed/],
      [0, false, undefined, /exited 0, and its verdict\.json says it failed/],
      [null, true, undefined, /was killed before it exited/],
      [null, true, 'spawn ENOENT', /didn't start or finish: spawn ENOENT/],
    ] as const) {
      const verdict = runMatrix(run(status, writes, error), reports)!;
      assert.equal(verdict.ok, false, String(why));
      const exit = verdict.failures.filter((failure) => failure.rule === 'matrix-exit');
      assert.equal(exit.length, 1, String(why));
      assert.match(exit[0]!.message, why);
    }
    assert.equal(matrixVerdict({ status: 1 }, reports)?.ok, false);
  } finally {
    rmSync(reports, { recursive: true, force: true });
  }
});

test("a sharded release's matrix is the whole plan's: a night's slice fails it, not-whole", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-release-slice-'));
  const reports = mkdtempSync(path.join(tmpdir(), 'quality-release-slice-reports-'));
  const saved = process.env.CI_REPORTS_DIR;
  process.env.CI_REPORTS_DIR = reports;
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  t.after(() => {
    if (saved === undefined) delete process.env.CI_REPORTS_DIR;
    else process.env.CI_REPORTS_DIR = saved;
    rmSync(root, { recursive: true, force: true });
    rmSync(reports, { recursive: true, force: true });
  });
  writeShards(root, [SHARD_1, SHARD_2]);
  assert.ok(mergedMatrix(root, 2).ok, 'the whole plan passes');
  // The same shards, as a night's slice of the plan.
  for (const dir of ['reports-quality-full-1', 'reports-quality-full-2']) {
    const file = path.join(root, dir, 'quality', 'plan.json');
    const plan = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const slice = {
      night: '2026-10-24',
      index: 3,
      nights: 14,
      fingerprint: '0123456789abcdef',
      cells: [],
      rotation: {},
    };
    writeFileSync(file, JSON.stringify({ ...plan, slice }));
  }
  const sliced = mergedMatrix(root, 2);
  assert.equal(sliced.ok, false);
  assert.deepEqual(
    sliced.failures.map((each) => each.rule),
    ['not-whole'],
  );
});
