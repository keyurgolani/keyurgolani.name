// pnpm quality:merge -- <dir> [--shards <m>] (#11, 11-4): the merged verdict
// of a sharded quality:full run. <dir> holds each shard's reports artifact,
// as download-artifact leaves them, one directory each; lib/shards.ts reads
// them and judges the run whole. The verdict goes to
// reports/quality/merged-verdict.json, and under ci/run.mjs each failure is a
// failure record. It exits 1 on any failure, 2 on a usage error.
//
// Point it only at a new, empty directory the shards' artifacts were
// downloaded into: it reads every quality/ directory under it.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentGate, reportError, reportsDir, writeFailureRecord } from '../../ci/lib/reports.mjs';
import { RECORD_VERSION } from './lib/failure-records';
import { mergeShards, readShards, type MergedVerdict } from './lib/shards';

export const MERGED_VERDICT = 'merged-verdict.json';

export function parseMergeArgs(argv: readonly string[]): { dir: string; expected?: number } {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  const usage = 'usage: pnpm quality:merge -- <shard reports dir> [--shards <m>]';
  const at = args.indexOf('--shards');
  let expected: number | undefined;
  if (at !== -1) {
    const value = args[at + 1];
    if (!value || !/^[1-9]\d*$/.test(value)) throw new Error(usage);
    expected = Number(value);
    args.splice(at, 2);
  }
  if (args.length !== 1 || args[0]!.startsWith('-')) throw new Error(usage);
  return { dir: path.resolve(args[0]!), ...(expected === undefined ? {} : { expected }) };
}

/** Judges the shards under `dir`, writes the merged verdict and its failure records, and prints it. */
export function mergeRun(dir: string, expected?: number, test = 'quality:full merged verdict') {
  const verdict: MergedVerdict = mergeShards(readShards(dir), { expected });
  const quality = path.join(reportsDir(), 'quality');
  mkdirSync(quality, { recursive: true });
  writeFileSync(path.join(quality, MERGED_VERDICT), `${JSON.stringify(verdict, null, 2)}\n`);
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
  return mergeRun(options.dir, options.expected).ok ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
