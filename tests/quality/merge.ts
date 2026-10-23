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
// verdict and records.
//
// Point it only at a new, empty directory the shards' artifacts were
// downloaded into: it reads every quality/ directory under it.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentGate, reportError, reportsDir, writeFailureRecord } from '../../ci/lib/reports.mjs';
import { RECORD_VERSION } from './lib/failure-records';
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

export interface MergeArgs {
  readonly dir: string;
  readonly expected?: number;
  /** The mode the shards must have run: full for the nightly and release runs, pr for a sharded PR run. */
  readonly mode?: RunMode;
}

export function parseMergeArgs(argv: readonly string[]): MergeArgs {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  const usage = `usage: pnpm quality:merge -- <shard reports dir> [--shards <m>] [--mode <${RUN_MODES.join('|')}>]`;
  const take = (flag: string, valid: (value: string) => boolean): string | undefined => {
    const at = args.indexOf(flag);
    if (at === -1) return undefined;
    const value = args[at + 1];
    if (!value || !valid(value)) throw new Error(usage);
    args.splice(at, 2);
    return value;
  };
  const shards = take('--shards', (value) => /^[1-9]\d*$/.test(value));
  const mode = take('--mode', (value) => (RUN_MODES as readonly string[]).includes(value));
  if (args.length !== 1 || args[0]!.startsWith('-')) throw new Error(usage);
  return {
    dir: path.resolve(args[0]!),
    ...(shards === undefined ? {} : { expected: Number(shards) }),
    ...(mode === undefined ? {} : { mode: mode as RunMode }),
  };
}

/** Judges the shards under `dir`, writes the merged verdict and its failure records, and prints it. */
export function mergeRun(
  dir: string,
  expected?: number,
  test = 'quality:full merged verdict',
  mode?: RunMode,
) {
  let shards: ShardReport[] = [];
  let verdict: MergedVerdict;
  try {
    shards = readShards(dir);
    verdict = mergeShards(shards, { expected, mode });
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
  return mergeRun(options.dir, options.expected, undefined, options.mode).ok ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
