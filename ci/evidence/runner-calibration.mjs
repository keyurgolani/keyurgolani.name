#!/usr/bin/env node
// The runner calibration evidence (.github/workflows/runner-calibration.yml, evidence only, never
// merged). Several jobs, each on its own hosted runner, run every perf cell. Each perf load reads
// the runner's speed first (calibrationMs, lib/perf/measure.ts) and keeps its long tasks
// (blockingTasks). This reads every job's summary.json and reports:
//
// - the calibration workload on each runner: the reference is their median, the value
//   timing.calibration.referenceMs takes, with measuredBy naming this run;
// - per target, tbtMs and idleTaskMs as each runner measured them and at the reference's speed,
//   and how far apart the runners read each: max over min of the job medians. Normalising earns
//   its place if the spread at the reference's speed is smaller than the raw one.
//
//   node ci/evidence/runner-calibration.mjs one <summary.json> <job> <out.json>
//   node ci/evidence/runner-calibration.mjs compare <dir of job files>
//
// Pure Node; it writes the job summary when GITHUB_STEP_SUMMARY is set.
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The median of `values`: the middle one, or the mean of the middle two; null for none. */
export function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const round = (value) => (value === null ? null : Math.round(value * 1000) / 1000);

/**
 * A load's tbtMs and idleTaskMs at the reference's speed, as lib/perf/samples.ts's atReference
 * reads them: each long task scaled before TBT's 50 ms cut, and the idle work scaled.
 */
export function atReference(load, referenceMs) {
  if (!(load.calibrationMs > 0)) return { tbtMs: null, idleTaskMs: null };
  const scale = referenceMs / load.calibrationMs;
  return {
    tbtMs: Array.isArray(load.blockingTasks)
      ? load.blockingTasks.reduce((total, ms) => total + Math.max(0, ms * scale - 50), 0)
      : null,
    idleTaskMs: Number.isFinite(load.idleTaskMs) ? load.idleTaskMs * scale : null,
  };
}

/** One job's perf loads, from its summary.json: per target, each load's readings. */
export function oneJob(summary, job) {
  const targets = [];
  for (const test of summary.tests ?? []) {
    const runs = test.perf?.sample?.runs;
    if (!Array.isArray(runs)) continue;
    targets.push({
      target: test.perf.target ?? test.target ?? test.title,
      outcome: test.outcome,
      loads: runs.map((run) => ({
        calibrationMs: run.calibrationMs ?? null,
        tbtMs: run.tbtMs ?? null,
        idleTaskMs: run.idleTaskMs ?? null,
        blockingTasks: run.blockingTasks ?? null,
      })),
    });
  }
  return { job, targets };
}

/** Max over min of `values` (the job medians), or null with fewer than two. */
export function spread(values) {
  const present = values.filter((value) => Number.isFinite(value) && value > 0);
  if (present.length < 2) return null;
  return round(Math.max(...present) / Math.min(...present));
}

/** Every job side by side: the reference, and per target the raw and normalised readings. */
export function compare(jobs) {
  const calibrations = jobs.flatMap((job) =>
    job.targets.flatMap((target) => target.loads.map((load) => load.calibrationMs)),
  );
  const referenceMs = round(median(calibrations));
  const runners = jobs.map((job) => ({
    job: job.job,
    calibrationMs: round(
      median(job.targets.flatMap((target) => target.loads.map((load) => load.calibrationMs))),
    ),
  }));
  const names = [...new Set(jobs.flatMap((job) => job.targets.map((target) => target.target)))];
  const targets = names.map((name) => {
    const per = jobs.map((job) => {
      const loads = job.targets.find((target) => target.target === name)?.loads ?? [];
      const scaled = loads.map((load) => atReference(load, referenceMs));
      return {
        job: job.job,
        rawTbt: round(median(loads.map((load) => load.tbtMs))),
        refTbt: round(median(scaled.map((load) => load.tbtMs))),
        rawIdle: round(median(loads.map((load) => load.idleTaskMs))),
        refIdle: round(median(scaled.map((load) => load.idleTaskMs))),
      };
    });
    return {
      target: name,
      per,
      tbtSpread: { raw: spread(per.map((p) => p.rawTbt)), ref: spread(per.map((p) => p.refTbt)) },
      idleSpread: {
        raw: spread(per.map((p) => p.rawIdle)),
        ref: spread(per.map((p) => p.refIdle)),
      },
    };
  });
  return { referenceMs, runners, targets };
}

/** The comparison as Markdown. */
export function markdown(result) {
  const lines = [
    '### Runner calibration',
    '',
    `Reference (the median calibration over every load of every job): **${result.referenceMs} ms**.`,
    '',
    '| Job | Calibration median, ms | Over the reference |',
    '| --- | --- | --- |',
    ...result.runners.map(
      (runner) =>
        `| ${runner.job} | ${runner.calibrationMs} | ${runner.calibrationMs && result.referenceMs ? round(runner.calibrationMs / result.referenceMs) : ''} |`,
    ),
    '',
    'Spread is max over min of the job medians: raw is as each runner measured, ref at the reference speed.',
    '',
    '| Target | tbtMs spread raw | tbtMs spread ref | idleTaskMs spread raw | idleTaskMs spread ref |',
    '| --- | --- | --- | --- | --- |',
    ...result.targets.map(
      (target) =>
        `| ${target.target} | ${target.tbtSpread.raw ?? ''} | ${target.tbtSpread.ref ?? ''} | ${target.idleSpread.raw ?? ''} | ${target.idleSpread.ref ?? ''} |`,
    ),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

const main = (argv) => {
  const [mode, ...args] = argv;
  if (mode === 'one') {
    const [summaryFile, job, out] = args;
    const summary = JSON.parse(readFileSync(summaryFile, 'utf8'));
    const result = oneJob(summary, job);
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`job ${job}: ${result.targets.length} perf target(s)`);
    return result.targets.length > 0 ? 0 : 1;
  }
  if (mode === 'compare') {
    const [dir] = args;
    const jobs = readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .sort()
      .map((file) => JSON.parse(readFileSync(path.join(dir, file), 'utf8')));
    const result = compare(jobs);
    const text = markdown(result);
    process.stdout.write(text);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    return jobs.length > 1 ? 0 : 1;
  }
  console.error(
    'usage: runner-calibration.mjs one <summary.json> <job> <out.json> | compare <dir>',
  );
  return 2;
};

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
