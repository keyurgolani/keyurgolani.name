// pnpm quality:merge -- <dir> [--shards <m>] [--mode <pr|full>] (#11, 11-4):
// the merged verdict of a sharded quality run. <dir> holds each shard's reports artifact,
// as download-artifact leaves them, one directory each; lib/shards.ts reads
// them and judges the run whole. The verdict goes to
// reports/quality/merged-verdict.json, the shards' summaries joined into one
// to reports/quality/summary.json, with the verdict and the timing trend as
// an unsharded run writes them, and under ci/run.mjs each failure is a
// failure record. It exits 1 on any failure, 2 on a usage error. A CI job
// calls it as `pnpm ci:quality-verdict "$DIR" --shards <m> --mode <mode>`:
// --mode fails a shard that ran another mode, and --shards one outside 1..m
// or missing. Reports it can't read fail the merge, which still writes its
// verdict and records. quality-pr-verdict adds --jobs <result>, the shard
// jobs' result from `needs`, so a shard job that failed, was cancelled, or
// was skipped fails the verdict too.
//
// A night's shards (lib/full-shards.ts) are judged against their slice, and
// the merge writes the night's rotation report to
// reports/quality/rotation.json and the job summary: which slice ran, of
// how many nights, and each cell's result tonight, when it last passed as
// far as this run can tell, and the nights the rotation gave it and gives
// it next. quality:release merges with `whole`, so a night's slice fails it.
//
// Point it only at a new, empty directory the shards' artifacts were
// downloaded into: it reads every quality/ directory under it.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentGate, reportError, reportsDir, writeFailureRecord } from '../../ci/lib/reports.mjs';
import { RECORD_VERSION } from './lib/failure-records';
import { rotationReport, type RotationReport } from './lib/full-shards';
import { timingTrend } from './lib/perf/timing';
import type { RunMode } from './cells';
import {
  joinSummaries,
  mergeShards,
  readShards,
  type MergedVerdict,
  type ShardReport,
} from './lib/shards';
import { RUN_MODES } from './plan';
import { SUMMARY_FILE } from './reporter';

export const MERGED_VERDICT = 'merged-verdict.json';
export const ROTATION_REPORT = 'rotation.json';

/** The rotation report as the job summary shows it: the slice, then tonight's cells, then the rest. */
export function rotationMarkdown(report: RotationReport): string {
  const lines = [
    `### quality-full, the night of ${report.night}`,
    '',
    `Night ${report.slice} of ${report.nights}, of the plan ${report.fingerprint}: a cycle, ${report.cycle.from} to ${report.cycle.to}, runs every cell once.`,
    '',
    '| Cell | Nights | Tonight | Last passed | Scheduled last | Scheduled next |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  const tonight = report.cells.filter((cell) => cell.tonight !== null);
  const rest = report.cells.filter((cell) => cell.tonight === null);
  for (const cell of [...tonight, ...rest]) {
    lines.push(
      `| \`${cell.cell}\` | ${cell.nights.join(', ')} | ${cell.tonight ?? ''} | ${cell.lastPassed ?? 'unknown'} | ${cell.scheduledLast} | ${cell.scheduledNext} |`,
    );
  }
  lines.push('', report.note, '');
  return lines.join('\n');
}

export interface MergeArgs {
  readonly dir: string;
  readonly expected?: number;
  /** The mode the shards must have run: full for the nightly and release runs, pr for a sharded PR run. */
  readonly mode?: RunMode;
  /** The shard jobs' result, as quality-pr-verdict's `needs` gives it: anything but success fails. */
  readonly jobs?: string;
}

export function parseMergeArgs(argv: readonly string[]): MergeArgs {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  const usage = `usage: pnpm quality:merge -- <shard reports dir> [--shards <m>] [--mode <${RUN_MODES.join('|')}>] [--jobs <result>]`;
  const take = (flag: string, valid: (value: string) => boolean): string | undefined => {
    const at = args.indexOf(flag);
    if (at === -1) return undefined;
    const value = args[at + 1];
    if (value === undefined || !valid(value)) throw new Error(usage);
    args.splice(at, 2);
    return value;
  };
  const shards = take('--shards', (value) => /^[1-9]\d*$/.test(value));
  const mode = take('--mode', (value) => (RUN_MODES as readonly string[]).includes(value));
  // An empty result, which `needs` never gives, is taken and fails the merge as shard-job.
  const jobs = take('--jobs', (value) => value === '' || /^[a-z_]+$/.test(value));
  if (args.length !== 1 || args[0]!.startsWith('-')) throw new Error(usage);
  return {
    dir: path.resolve(args[0]!),
    ...(shards === undefined ? {} : { expected: Number(shards) }),
    ...(mode === undefined ? {} : { mode: mode as RunMode }),
    ...(jobs === undefined ? {} : { jobs }),
  };
}

/** Judges the shards under `dir`, writes the merged verdict and its failure records, and prints it. */
export function mergeRun(
  dir: string,
  expected?: number,
  test = 'quality:full merged verdict',
  mode?: RunMode,
  jobs?: string,
  whole?: boolean,
) {
  let shards: ShardReport[] = [];
  let verdict: MergedVerdict;
  try {
    shards = readShards(dir);
    verdict = mergeShards(shards, { expected, mode, jobs, whole });
  } catch (error) {
    // Whatever the reports hold, the merge says so and fails, with its record.
    shards = [];
    verdict = {
      ok: false,
      failures: [
        {
          rule: 'merge-error',
          message: `The merge couldn't read the shards: ${(error as Error).message}`,
        },
      ],
      flaky: [],
      counts: {},
      shards: [],
    };
  }
  const quality = path.join(reportsDir(), 'quality');
  mkdirSync(quality, { recursive: true });
  writeFileSync(path.join(quality, MERGED_VERDICT), `${JSON.stringify(verdict, null, 2)}\n`);
  // The run's summary.json, every shard's tests in it, as an unsharded run
  // writes it: what a sharded release's timing gate reads (release.ts).
  const joined = joinSummaries(shards);
  if (joined) {
    writeFileSync(
      SUMMARY_FILE(),
      `${JSON.stringify({ ...joined, verdict, timing: timingTrend(joined) }, null, 2)}\n`,
    );
  }
  // A night's slice: which slice ran, and each cell's turn and result.
  const slice = shards.find((shard) => shard.plan?.slice)?.plan?.slice;
  if (slice) {
    const report = rotationReport(slice, joined?.tests ?? []);
    writeFileSync(path.join(quality, ROTATION_REPORT), `${JSON.stringify(report, null, 2)}\n`);
    const ran = report.cells.filter((cell) => cell.tonight !== null);
    console.log(
      `[quality] the night of ${report.night}: slice ${report.slice} of ${report.nights}, ${ran.length} cell(s): ${ran.filter((cell) => cell.tonight === 'passed').length} passed, ${ran.filter((cell) => cell.tonight === 'failed').length} failed`,
    );
    for (const cell of ran) console.log(`  ${cell.tonight}: ${cell.cell}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${rotationMarkdown(report)}`);
    }
  }
  const gate = currentGate();
  for (const { rule, message } of gate ? verdict.failures : []) {
    writeFailureRecord({
      ...gate!,
      schemaVersion: RECORD_VERSION,
      test,
      rule,
      actual: message,
    });
  }
  const counts = Object.entries(verdict.counts)
    .map(([key, value]) => `${key} ${value}`)
    .join(', ');
  console.log(`[quality] merged ${verdict.shards.length} shard(s): ${counts || 'nothing ran'}`);
  for (const title of verdict.flaky) console.log(`[quality] flaky (reported only): ${title}`);
  for (const { rule, message } of verdict.failures) {
    reportError(`${rule}: ${message}`, { title: `quality ${rule}` });
  }
  console.log(`[quality] merged verdict ${verdict.ok ? 'passed' : 'failed'}`);
  return verdict;
}

function main(argv: readonly string[]): number {
  let options: ReturnType<typeof parseMergeArgs>;
  try {
    options = parseMergeArgs(argv);
  } catch (error) {
    console.error(`[quality] ${(error as Error).message}`);
    return 2;
  }
  const test = `quality:${options.mode ?? 'full'} merged verdict`;
  return mergeRun(options.dir, options.expected, test, options.mode, options.jobs).ok ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
