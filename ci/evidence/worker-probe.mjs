#!/usr/bin/env node
// The worker probe's report (.github/workflows/worker-probe.yml, evidence only, row 151's lever
// (a)): one fixed release-plan shard run at SHARD_WORKERS 1 and 2 in the same image, each run's
// wall time, its tests' time and per-test pace, and any flake (retries are 0, so a flake is a test
// whose outcome differs between the two runs, or one that didn't end as expected).
//
//   node ci/evidence/worker-probe.mjs one <playwright.json> <workers> <wall seconds> <out.json>
//   node ci/evidence/worker-probe.mjs compare <probe-1.json> <probe-2.json>
//
// Pure Node; it writes the job summary when GITHUB_STEP_SUMMARY is set.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every test of a Playwright JSON report, flattened: its key, project, outcome, and time. */
export function testsOf(report) {
  const out = [];
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      for (const each of spec.tests ?? []) {
        const results = each.results ?? [];
        out.push({
          key: `${each.projectName} › ${[...titles, spec.title].join(' › ')}`,
          outcome: each.status,
          retries: Math.max(0, results.length - 1),
          seconds: results.reduce((sum, result) => sum + (result.duration ?? 0), 0) / 1000,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
  };
  for (const suite of report.suites ?? []) walk(suite, [suite.title]);
  return out;
}

/** One run's figures. */
export function summarize(report, workers, wallSeconds) {
  const tests = testsOf(report);
  const ran = tests.filter((each) => each.outcome !== 'skipped');
  const seconds = ran.reduce((sum, each) => sum + each.seconds, 0);
  const count = (outcome) => tests.filter((each) => each.outcome === outcome).length;
  return {
    workers,
    wallSeconds,
    tests: tests.length,
    ran: ran.length,
    testSeconds: Math.round(seconds),
    perTestSeconds: ran.length === 0 ? 0 : Number((seconds / ran.length).toFixed(2)),
    // Wall time per test that ran: what the shard costs a test at this many workers.
    wallPerTest: ran.length === 0 ? 0 : Number((wallSeconds / ran.length).toFixed(2)),
    expected: count('expected'),
    unexpected: count('unexpected'),
    flaky: count('flaky'),
    skipped: count('skipped'),
    retried: tests.filter((each) => each.retries > 0).length,
    outcomes: Object.fromEntries(tests.map((each) => [each.key, each.outcome])),
  };
}

/** The two runs side by side, and every test whose outcome differs between them. */
export function compare(a, b) {
  const keys = [...new Set([...Object.keys(a.outcomes), ...Object.keys(b.outcomes)])].sort();
  const differ = keys.filter((key) => a.outcomes[key] !== b.outcomes[key]);
  const row = (run) =>
    `| ${run.workers} | ${run.wallSeconds} | ${run.ran} | ${run.testSeconds} | ${run.perTestSeconds} | ${run.wallPerTest} | ${run.unexpected} | ${run.flaky} | ${run.retried} |`;
  return {
    differ,
    lines: [
      '### Worker probe',
      '',
      '| workers | wall s | tests run | test s | s a test | wall s a test | unexpected | flaky | retried |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      row(a),
      row(b),
      '',
      `Wall ratio (1 over 2): ${(a.wallSeconds / b.wallSeconds).toFixed(3)}; per-test time ratio (2 over 1): ${(b.perTestSeconds / a.perTestSeconds).toFixed(3)}.`,
      differ.length === 0
        ? 'Every test ended the same in both runs.'
        : `${differ.length} test(s) ended differently: ${differ
            .slice(0, 20)
            .map(
              (key) =>
                `${key} (${a.outcomes[key] ?? 'absent'} at ${a.workers}, ${b.outcomes[key] ?? 'absent'} at ${b.workers})`,
            )
            .join('; ')}`,
    ],
  };
}

function main(argv) {
  const [mode, ...args] = argv;
  const summary = (lines) => {
    console.log(lines.join('\n'));
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
  };
  if (mode === 'one' && args.length === 4) {
    const [json, workers, wall, out] = args;
    const run = summarize(JSON.parse(readFileSync(json, 'utf8')), Number(workers), Number(wall));
    writeFileSync(out, `${JSON.stringify(run, null, 2)}\n`);
    const { outcomes: _outcomes, ...figures } = run;
    void _outcomes;
    summary([
      `### Worker probe at ${workers} worker(s)`,
      '',
      '```',
      JSON.stringify(figures, null, 2),
      '```',
    ]);
    return 0;
  }
  if (mode === 'compare' && args.length === 2) {
    const [a, b] = args.map((file) => JSON.parse(readFileSync(file, 'utf8')));
    const [one, two] = a.workers <= b.workers ? [a, b] : [b, a];
    summary(compare(one, two).lines);
    return 0;
  }
  console.error('usage: worker-probe.mjs one <json> <workers> <wall> <out> | compare <a> <b>');
  return 2;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
