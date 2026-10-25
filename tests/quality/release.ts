// pnpm quality:release [-- --merged <dir> --shards <m>] (#11, 11-4): the
// quality gate #12's release-candidate pipeline runs on every RC, as
// `pnpm ci:quality-release`. It runs the complete matrix, then each release
// gate over its verdict, and passes only when the matrix and every gate do.
//
// - By default it runs quality:full whole, unsharded, against a worktree
//   with the reference variant installed from its tarball, as the nightly
//   run does (run.ts full --external-variant).
// - With --merged <dir>, it judges a sharded run instead: <dir> holds each
//   shard's reports artifact, which `pnpm quality:merge` reads
//   (lib/shards.ts), and --shards names how many the run had. This is the
//   RC path: release.yml's rc-quality runs the release plan's shards,
//   RELEASE_PARALLEL at a time (lib/full-shards.ts), each failing before
//   any test when the plan is over RELEASE_CEILING, and rc-quality-verdict
//   runs this over their reports. The run must be the whole plan: a night's slice fails it.
//
// RELEASE_GATES holds the gates only a release run holds: the matrix
// first, then 11-3's timing gate, the median of each perf cell's lab vitals
// against the thresholds file, which PR and scheduled runs only report.
//
// It writes reports/quality/release.json, and under ci/run.mjs each
// failure is a failure record naming its gate. Exits 1 on any failure, 2 on
// a usage error.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  currentGate,
  REPO_ROOT,
  reportError,
  reportsDir,
  writeFailureRecord,
} from '../../ci/lib/reports.mjs';
import { RECORD_VERSION } from './lib/failure-records';
import { TIMING_GATE } from './lib/perf/timing';
import type { Failure, Verdict } from './lib/verdict';
import { mergeRun } from './merge';
import { EXTERNAL_VARIANT_FLAG } from './run';

/** What a release gate reads: the matrix's verdict, and the reports the run wrote. */
export interface ReleaseContext {
  readonly matrix: Verdict;
  readonly reports: string;
}

/** A gate a release candidate must pass, beyond what PR runs gate. */
export interface ReleaseGate {
  readonly id: string;
  readonly description: string;
  readonly run: (context: ReleaseContext) => readonly Failure[] | Promise<readonly Failure[]>;
}

/** The complete matrix passed: every failure its verdict gives fails the release. */
export const MATRIX_GATE: ReleaseGate = {
  id: 'matrix',
  description: 'quality:full over the complete matrix, fail-closed',
  run: ({ matrix }) => matrix.failures,
};

/**
 * Every release gate, in order: the matrix, then 11-3's timing gate, which
 * fails a median past its ceiling's release tolerance in the run's
 * summary.json (lib/perf/timing.ts). A sharded release reads the summary
 * quality:merge joins from every shard.
 */
export const RELEASE_GATES: readonly ReleaseGate[] = [MATRIX_GATE, TIMING_GATE];

export interface ReleaseVerdict {
  readonly ok: boolean;
  readonly gates: readonly {
    readonly id: string;
    readonly ok: boolean;
    readonly failures: readonly Failure[];
  }[];
}

/**
 * The release's verdict: the matrix's, or a no-verdict failure when the run
 * left none, then each gate's over it. A gate that throws fails with what
 * it threw.
 */
export async function judgeRelease(
  matrix: Verdict | null,
  gates: readonly ReleaseGate[] = RELEASE_GATES,
  reports: string = reportsDir(),
): Promise<ReleaseVerdict> {
  if (!matrix) {
    return {
      ok: false,
      gates: [
        {
          id: 'matrix',
          ok: false,
          failures: [
            {
              rule: 'no-verdict',
              message: 'The full matrix left no verdict, so nothing says it passed.',
            },
          ],
        },
      ],
    };
  }
  const results: { id: string; ok: boolean; failures: readonly Failure[] }[] = [];
  for (const gate of gates) {
    let failures: readonly Failure[];
    try {
      failures = await gate.run({ matrix, reports });
    } catch (error) {
      failures = [{ rule: 'gate-error', message: `${gate.id} threw: ${(error as Error).message}` }];
    }
    results.push({ id: gate.id, ok: failures.length === 0, failures });
  }
  if (!results.some((result) => result.id === MATRIX_GATE.id)) {
    results.unshift({
      id: MATRIX_GATE.id,
      ok: false,
      failures: [{ rule: 'no-matrix-gate', message: 'The release gates leave out the matrix.' }],
    });
  }
  return { ok: results.every((result) => result.ok), gates: results };
}

export function parseReleaseArgs(argv: readonly string[]): { merged?: string; shards?: number } {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  const usage = 'usage: pnpm quality:release [-- --merged <shard reports dir> --shards <m>]';
  if (args.length === 0) return {};
  if (
    args.length === 4 &&
    args[0] === '--merged' &&
    args[1] &&
    !args[1].startsWith('-') &&
    args[2] === '--shards' &&
    /^[1-9]\d*$/.test(args[3] ?? '')
  ) {
    return { merged: path.resolve(args[1]), shards: Number(args[3]) };
  }
  throw new Error(usage);
}

const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');

/** How the matrix's run ended: its exit status, or null when it couldn't start or was killed. */
export interface MatrixExit {
  readonly status: number | null;
  readonly error?: string;
}

/**
 * The matrix's verdict from the verdict.json its run wrote, held to how the
 * run ended: null when it wrote none, and a failure when its exit status
 * and its verdict disagree, or it didn't start.
 */
export function matrixVerdict(exit: MatrixExit, reports: string = reportsDir()): Verdict | null {
  let verdict: Verdict;
  try {
    verdict = JSON.parse(
      readFileSync(path.join(reports, 'quality', 'verdict.json'), 'utf8'),
    ) as Verdict;
  } catch {
    return null;
  }
  if (typeof verdict?.ok !== 'boolean' || !Array.isArray(verdict.failures)) return null;
  const disagree =
    exit.error !== undefined
      ? `The matrix's run didn't start or finish: ${exit.error}`
      : exit.status === null
        ? "The matrix's run was killed before it exited, so its verdict.json can't be trusted."
        : (exit.status === 0) !== verdict.ok
          ? `The matrix's run exited ${exit.status}, and its verdict.json says it ${verdict.ok ? 'passed' : 'failed'}.`
          : null;
  if (!disagree) return verdict;
  return {
    ...verdict,
    ok: false,
    failures: [...verdict.failures, { rule: 'matrix-exit', message: disagree }],
  };
}

/** Runs a command, as spawnSync does: injectable, so a test can stand in for the matrix. */
export type Spawn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; stdio: 'inherit'; env: NodeJS.ProcessEnv },
) => { status: number | null; error?: Error };

/**
 * quality:full whole, against the reference variant's worktree, and its
 * verdict. An old verdict.json is deleted first, so a run that writes none
 * never reads as the last one's.
 */
export function runMatrix(
  spawn: Spawn = spawnSync as unknown as Spawn,
  reports: string = reportsDir(),
): Verdict | null {
  rmSync(path.join(reports, 'quality', 'verdict.json'), { force: true });
  const result = spawn(
    process.execPath,
    [TSX_CLI, path.join('tests', 'quality', 'run.ts'), 'full', '--', EXTERNAL_VARIANT_FLAG],
    { cwd: REPO_ROOT, stdio: 'inherit', env: process.env },
  );
  if (result.error) console.error(`[quality:release] ${result.error.message}`);
  return matrixVerdict(
    { status: result.status, ...(result.error ? { error: result.error.message } : {}) },
    reports,
  );
}

/**
 * A sharded release's matrix: the merged verdict of the shards' reports
 * under `dir`, which must be quality:full's whole plan, so a night's slice
 * fails it (not-whole).
 */
export function mergedMatrix(dir: string, shards?: number): Verdict {
  return mergeRun(dir, shards, 'quality:release merged verdict', 'full', undefined, true);
}

async function main(argv: readonly string[]): Promise<number> {
  let options: ReturnType<typeof parseReleaseArgs>;
  try {
    options = parseReleaseArgs(argv);
  } catch (error) {
    console.error(`[quality:release] ${(error as Error).message}`);
    return 2;
  }
  const matrix = options.merged ? mergedMatrix(options.merged, options.shards) : runMatrix();
  const verdict = await judgeRelease(matrix);
  const quality = path.join(reportsDir(), 'quality');
  mkdirSync(quality, { recursive: true });
  writeFileSync(path.join(quality, 'release.json'), `${JSON.stringify(verdict, null, 2)}\n`);
  const gate = currentGate();
  for (const result of verdict.gates) {
    // The matrix's own failures are already records, from run.ts or the merge.
    if (result.id === MATRIX_GATE.id && matrix) continue;
    for (const { rule, message } of gate ? result.failures : []) {
      writeFailureRecord({
        ...gate!,
        schemaVersion: RECORD_VERSION,
        test: `quality:release ${result.id}`,
        rule,
        actual: message,
      });
    }
  }
  for (const result of verdict.gates) {
    console.log(
      `[quality:release] ${result.id}: ${result.ok ? 'passed' : `failed, ${result.failures.length} failure(s)`}`,
    );
    if (result.id !== MATRIX_GATE.id || !matrix) {
      for (const { rule, message } of result.failures) {
        reportError(`${result.id} ${rule}: ${message}`, { title: `quality:release ${result.id}` });
      }
    }
  }
  console.log(`[quality:release] ${verdict.ok ? 'passed' : 'failed'}`);
  return verdict.ok ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
