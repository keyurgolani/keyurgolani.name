import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { MERGED_VERDICT, mergeRun, parseMergeArgs } from './merge';
import { mergeShards, readShards } from './lib/shards';
import { OVER, releaseOutcome, WITHIN } from './meta/release-cases';
import {
  PERF_PLAN,
  PR_SHARDS,
  SHARD_1,
  SHARD_2,
  SHARD_CASES,
  writeShards,
  type ShardInput,
} from './meta/shard-cases';
import { judgeRelease, RELEASE_GATES } from './release';
import type { Summary } from './reporter';

// pnpm quality:merge (#11, 11-4): a sharded quality:full run judged whole.
// The rules themselves are quality:meta's merged-verdict cases.

test('quality:merge takes one directory, an optional shard count, and an optional mode', () => {
  assert.deepEqual(parseMergeArgs(['--', 'shards']), { dir: path.resolve('shards') });
  assert.deepEqual(parseMergeArgs(['shards', '--shards', '4']), {
    dir: path.resolve('shards'),
    expected: 4,
  });
  assert.deepEqual(parseMergeArgs(['shards', '--shards', '6', '--mode', 'full']), {
    dir: path.resolve('shards'),
    expected: 6,
    mode: 'full',
  });
  assert.deepEqual(parseMergeArgs(['--mode', 'pr', 'shards']), {
    dir: path.resolve('shards'),
    mode: 'pr',
  });
  for (const bad of [
    [],
    ['a', 'b'],
    ['--shards', '4'],
    ['a', '--shards', '0'],
    ['--grep'],
    ['a', '--mode', 'nightly'],
    ['a', '--mode'],
  ]) {
    assert.throws(() => parseMergeArgs(bad), /usage: pnpm quality:merge/, bad.join(' '));
  }
});

test("a shard's verdict.json that isn't what run.ts writes fails the merge with its verdict and records, never a throw", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-merge-bad-'));
  const reports = mkdtempSync(path.join(tmpdir(), 'quality-merge-bad-reports-'));
  const saved = { ...process.env };
  Object.assign(process.env, {
    CI_REPORTS_DIR: reports,
    CI_GATE: 'quality-verdict',
    CI_REPRO: 'pnpm ci:quality-verdict',
  });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  try {
    for (const raw of ['{"shard":"2/2"}', '[]', '"a verdict"', '{"ok":true,"failures":"none"}']) {
      rmSync(path.join(reports, 'failures'), { recursive: true, force: true });
      writeShards(root, [SHARD_1, { ...SHARD_2, rawVerdict: raw }]);
      const verdict = mergeRun(root, 2, undefined, 'full');
      assert.equal(verdict.ok, false, raw);
      const written = JSON.parse(
        readFileSync(path.join(reports, 'quality', MERGED_VERDICT), 'utf8'),
      ) as { failures: { rule: string }[] };
      assert.ok(
        written.failures.some((failure) => failure.rule === 'shard-unreadable'),
        raw,
      );
      const records = readdirSync(path.join(reports, 'failures')).map(
        (file) =>
          JSON.parse(readFileSync(path.join(reports, 'failures', file), 'utf8')) as {
            gate: string;
            rule: string;
          },
      );
      assert.ok(
        records.some(
          (record) => record.gate === 'quality-verdict' && record.rule === 'shard-unreadable',
        ),
        raw,
      );
    }
  } finally {
    for (const key of ['CI_REPORTS_DIR', 'CI_GATE', 'CI_REPRO']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(reports, { recursive: true, force: true });
  }
});

test('every shard directory download-artifact leaves is read, however deep, and nothing else', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-merge-'));
  try {
    for (const dir of ['reports-quality-full-1/quality', 'nested/reports-quality-full-2/quality']) {
      mkdirSync(path.join(root, dir), { recursive: true });
      writeFileSync(path.join(root, dir, 'verdict.json'), '{"shard":"1/2"}');
    }
    mkdirSync(path.join(root, 'reports-links', 'failures'), { recursive: true });
    assert.deepEqual(
      readShards(root).map((shard) => shard.dir),
      ['nested/reports-quality-full-2', 'reports-quality-full-1'],
    );
    assert.deepEqual(readShards(path.join(root, 'none')), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the merged verdict is written to the reports, and fails a run with no shard', (t) => {
  const reports = mkdtempSync(path.join(tmpdir(), 'quality-merge-reports-'));
  const empty = mkdtempSync(path.join(tmpdir(), 'quality-merge-empty-'));
  const previous = process.env.CI_REPORTS_DIR;
  process.env.CI_REPORTS_DIR = reports;
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  try {
    const verdict = mergeRun(empty, 2);
    assert.equal(verdict.ok, false);
    const written = JSON.parse(
      readFileSync(path.join(reports, 'quality', MERGED_VERDICT), 'utf8'),
    ) as { ok: boolean; failures: { rule: string }[] };
    assert.deepEqual(
      written.failures.map(({ rule }) => rule),
      ['no-shards'],
    );
  } finally {
    if (previous === undefined) delete process.env.CI_REPORTS_DIR;
    else process.env.CI_REPORTS_DIR = previous;
    rmSync(reports, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

test('each merged-verdict case goes the way it should', async () => {
  const { judge } = await import('./meta/cases');
  for (const metaCase of SHARD_CASES) {
    assert.equal(judge(metaCase, await metaCase.run()), null, metaCase.id);
  }
});

type Joined = Summary & { verdict: { ok: boolean }; timing: { tests: unknown[] } };

/** `shards` written to a new directory, merged by quality:merge into reports of their own; `check` reads them. */
async function withMerged(
  t: TestContext,
  shards: readonly ShardInput[],
  check: (run: {
    verdict: ReturnType<typeof mergeRun>;
    summary: Joined;
    reports: string;
  }) => unknown,
) {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-merge-shards-'));
  const reports = mkdtempSync(path.join(tmpdir(), 'quality-merge-reports-'));
  const previous = process.env.CI_REPORTS_DIR;
  const attempt = process.env.GITHUB_RUN_ATTEMPT;
  process.env.CI_REPORTS_DIR = reports;
  // A workflow's first attempt, whatever this job's is: the timing gate fails a rerun.
  process.env.GITHUB_RUN_ATTEMPT = '1';
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  try {
    writeShards(root, shards);
    const verdict = mergeRun(root, 2);
    const summary = JSON.parse(
      readFileSync(path.join(reports, 'quality', 'summary.json'), 'utf8'),
    ) as Joined;
    await check({ verdict, summary, reports });
  } finally {
    if (previous === undefined) delete process.env.CI_REPORTS_DIR;
    else process.env.CI_REPORTS_DIR = previous;
    if (attempt === undefined) delete process.env.GITHUB_RUN_ATTEMPT;
    else process.env.GITHUB_RUN_ATTEMPT = attempt;
    t.mock.restoreAll();
    rmSync(root, { recursive: true, force: true });
    rmSync(reports, { recursive: true, force: true });
  }
}

/** Two shards of a run with the fallback composition's perf cell, its test in shard 2 with `perf`'s timing. */
const perfShards = (perf: Pick<Summary, 'tests'>): ShardInput[] => [
  { ...SHARD_1, plan: PERF_PLAN },
  { ...SHARD_2, plan: PERF_PLAN, tests: [...SHARD_2.tests, ...perf.tests] },
];

test("quality:merge writes the shards' joined summary.json: every shard's tests, no shard, the merged verdict", async (t) => {
  await withMerged(t, perfShards(WITHIN), ({ verdict, summary }) => {
    assert.equal(verdict.ok, true, JSON.stringify(verdict.failures));
    assert.equal(summary.shard, null);
    assert.deepEqual(
      summary.tests.map((test) => test.title),
      [...SHARD_1.tests, ...SHARD_2.tests, ...WITHIN.tests].map((test) => test.title),
    );
    assert.equal(summary.verdict.ok, true);
    assert.equal(summary.timing.tests.length, 1, "the trend reads shard 2's perf test");
  });
});

test('a sharded release fails on a timing breach in any shard, through the joined summary.json', async (t) => {
  for (const [perf, passes] of [
    [WITHIN, true],
    [OVER, false],
  ] as const) {
    // The timing gate reads the reports quality:merge wrote, as quality:release -- --merged does.
    await withMerged(t, perfShards(perf), async ({ verdict, reports }) => {
      const release = await judgeRelease(verdict, RELEASE_GATES, reports);
      assert.equal(release.ok, passes, JSON.stringify(release.gates));
      const timing = release.gates.find((gate) => gate.id === 'timing')!;
      assert.deepEqual(
        timing.failures.map((failure) => failure.rule),
        passes ? [] : ['timing-over'],
      );
    });
  }
  // The same breach in an unsharded release's summary.json fails it the same way.
  const passed = { ok: true, failures: [], flaky: [], counts: {} };
  assert.equal((await releaseOutcome(passed, RELEASE_GATES, OVER)).passed, false);
});

test('perf-coverage is judged once, on the joined summary, never carried from a shard', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-merge-perf-'));
  try {
    const stray = { ...WITHIN.tests[0]!, cell: 'composition:fallback nowhere' };
    const message = `${stray.title} ran, and no perf cell is ${stray.cell}.`;
    writeShards(root, [
      // Shard 1 saw the stray and failed it; the joined summary shows it again.
      {
        ...SHARD_1,
        plan: PERF_PLAN,
        tests: [...SHARD_1.tests, stray],
        verdict: { ok: false, failures: [{ rule: 'perf-coverage', message }] },
      },
      { ...SHARD_2, plan: PERF_PLAN, tests: [...SHARD_2.tests, ...WITHIN.tests] },
    ]);
    const verdict = mergeShards(readShards(root), { expected: 2 });
    assert.deepEqual(
      verdict.failures.filter((failure) => failure.rule === 'perf-coverage'),
      [{ rule: 'perf-coverage', message }],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("quality-pr's verdict fails a cancelled shard whose artifact is missing as both shard-job and missing-shard", () => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-merge-pr-'));
  try {
    // Shard 3 was cancelled before its upload: only shards 1 and 2 are here.
    writeShards(root, PR_SHARDS.slice(0, 2));
    const verdict = mergeShards(readShards(root), { expected: 3, mode: 'pr', jobs: 'cancelled' });
    assert.equal(verdict.ok, false);
    const rules = new Set(verdict.failures.map(({ rule }) => rule));
    assert.ok(rules.has('shard-job'), JSON.stringify(verdict.failures));
    assert.ok(rules.has('missing-shard'), JSON.stringify(verdict.failures));
    assert.ok(
      verdict.failures.some(
        ({ message }) => message === 'Shard 3/3 left no report, so its tests are unaccounted for.',
      ),
    );
    // The same three shards, every job a success, pass.
    rmSync(root, { recursive: true, force: true });
    writeShards(root, PR_SHARDS);
    const whole = mergeShards(readShards(root), { expected: 3, mode: 'pr', jobs: 'success' });
    assert.equal(whole.ok, true, JSON.stringify(whole.failures));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("quality-pr's verdict holds the shards to the count quality-pr-plan emitted: one dropped or one extra fails it", () => {
  const root = mkdtempSync(path.join(tmpdir(), 'quality-merge-count-'));
  try {
    writeShards(root, PR_SHARDS);
    const shards = readShards(root);
    const count = PR_SHARDS.length;
    const merged = (expected: number) =>
      mergeShards(shards, { expected, mode: 'pr', jobs: 'success' });
    assert.equal(merged(count).ok, true, JSON.stringify(merged(count).failures));
    // An extra shard's report disagrees with the count; a dropped one leaves no report.
    for (const [expected, rule] of [
      [count - 1, 'shard-mismatch'],
      [count + 1, 'missing-shard'],
    ] as const) {
      const verdict = merged(expected);
      assert.equal(verdict.ok, false, `${count} shards against an emitted ${expected}`);
      assert.ok(
        verdict.failures.some((each) => each.rule === rule),
        JSON.stringify(verdict.failures),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("quality:merge takes the mode and the shard jobs' result, as quality-pr-verdict passes them", () => {
  assert.deepEqual(
    parseMergeArgs(['--', 'shards', '--shards', '3', '--mode', 'pr', '--jobs', 'failure']),
    {
      dir: path.resolve('shards'),
      expected: 3,
      mode: 'pr',
      jobs: 'failure',
    },
  );
  // needs never gives an empty result; taken, it fails the merge as shard-job.
  assert.equal(parseMergeArgs(['shards', '--jobs', '']).jobs, '');
  assert.equal(
    mergeShards([], { jobs: '' }).failures.some(({ rule }) => rule === 'shard-job'),
    true,
  );
  for (const bad of [
    ['shards', '--mode', 'nightly'],
    ['shards', '--jobs'],
    ['shards', '--jobs', 'Bad Result'],
  ]) {
    assert.throws(() => parseMergeArgs(bad), /usage: pnpm quality:merge/, bad.join(' '));
  }
});
