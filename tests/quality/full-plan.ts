// `tsx tests/quality/full-plan.ts` (#11): the full plan's sizes, as
// release.yml's rc-quality-plan hands them to rc-quality. It installs the
// reference variant in a worktree and generates its registry with the
// quality flags, as quality:full -- --external-variant does before it
// builds (run.ts's externalVariantHost), plans from it, and works out
// (lib/full-shards.ts):
//
// - the release plan's shard count, the fewest, up to MAX_RELEASE_PLAN,
//   that keep each shard within RELEASE_CEILING (releaseFor), and which of
//   them each of release.yml's three rc-quality jobs runs (releaseSlices);
// - the nightly cycle, the smallest of NIGHT_COUNTS whose every night fits
//   at FULL_SHARDS shards (rotationFor), which every nightly shard works out
//   the same way for itself.
//
// It prints both, and the release's shard count and its runner-minutes at
// rc-quality's timeout (releaseSummary), which it also writes to the job
// summary, GITHUB_STEP_SUMMARY, when that's set. Under GitHub Actions it
// writes `count`, `shards1` to `shards3` (each rc-quality job's JSON list of
// shards, together 1 to count, `[]` for a job with none), and `nights` to
// GITHUB_OUTPUT. A plan past either cap
// fails, naming its heaviest group. The worktree is removed however it ends.

import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FULL_SHARDS,
  RELEASE_JOBS,
  releaseSlices,
  fullEstimate,
  fullGroups,
  NIGHTLY_CEILING,
  RELEASE_CEILING,
  RELEASE_PARALLEL,
  releaseDurations,
  releaseFor,
  releaseTimeoutMinutes,
  rotationFor,
} from './lib/full-shards';
import { RUN_ENGINES } from './lib/matrix';
import { loadPlan } from './plan';
import { externalVariantHost } from './run';

/**
 * The release's size, as the run prints it and its job summary holds it:
 * the shard count, each rc-quality job's share and how many of them run at
 * once, and the runner-minutes they could take, every shard at rc-quality's
 * timeout.
 */
export function releaseSummary(count: number): string {
  const timeout = releaseTimeoutMinutes();
  const jobs = releaseSlices(count)
    .map((slice, at) => `${RELEASE_JOBS[at]!.id} ${slice.length} at ${RELEASE_JOBS[at]!.parallel}`)
    .join(', ');
  return `rc-quality: ${count} shards (${jobs}), ${RELEASE_PARALLEL} at a time, at most ${count * timeout} runner-minutes at the ${timeout}-minute timeout`;
}

/**
 * The release plan of `plan`, as rc-quality-plan counts it and each rc-quality shard plans it: by
 * the release's measured weights, each key at its p90 (releaseDurations()), so each shard's
 * estimate is the sum of its tests' per-key p90 weights, within RELEASE_CEILING.
 */
export function releaseOf(plan: Parameters<typeof fullGroups>[0]) {
  const weights = releaseDurations();
  const groups = fullGroups(plan, RUN_ENGINES.full, weights);
  return { groups, ...releaseFor(groups, weights) };
}

/**
 * What GITHUB_OUTPUT gets: the release shard count, each rc-quality job's matrix list (shards1 to
 * shards3, releaseSlices), and the cycle's nights. Each job's max-parallel is RELEASE_JOBS's, a
 * constant, so it takes no `parallel`.
 */
export function fullOutputs(count: number, nights: number): Record<string, string> {
  const slices = releaseSlices(count);
  return {
    count: String(count),
    ...Object.fromEntries(slices.map((slice, at) => [`shards${at + 1}`, JSON.stringify(slice)])),
    nights: String(nights),
  };
}

/**
 * The script: plans from `host`'s registry, prints the sizes, writes them to
 * `env`'s GITHUB_OUTPUT when it names one, and removes the host however it
 * ends. 0 when the plan fits both caps, 1 when it doesn't or can't plan.
 */
export async function runFullPlan({
  host = externalVariantHost(),
  env = process.env,
  log = (line: string) => console.log(line),
  fail = (line: string) => process.stderr.write(`${line}\n`),
}: {
  readonly host?: { readonly web: string; readonly remove: () => void };
  readonly env?: NodeJS.ProcessEnv;
  readonly log?: (line: string) => void;
  readonly fail?: (line: string) => void;
} = {}): Promise<number> {
  try {
    const plan = await loadPlan({ ...env, QUALITY_WEB: host.web, QUALITY_MODE: 'full' });
    // The release sizes its shards by its own measured weights (releaseOf); the nightly by the PR's.
    const release = releaseOf(plan);
    const groups = fullGroups(plan, RUN_ENGINES.full);
    const seconds = Math.round(release.groups.reduce((sum, group) => sum + group.weight, 0));
    const rotation = rotationFor(groups);
    log(
      `[quality-full-plan] ${plan.tests.length} tests, about ${seconds}s: the release in ${release.count} shards, the slowest about ${Math.round(release.slowest)}s of ${RELEASE_CEILING}s; the nightly a ${rotation.nights}-night cycle of ${FULL_SHARDS} shards, the slowest about ${Math.round(rotation.slowest)}s of ${NIGHTLY_CEILING}s`,
    );
    // Each release shard's estimate, the sum of its tests' per-key p90 weights, for the run's real
    // times to be read against.
    for (const shard of release.shards) {
      log(
        `[quality-full-plan] release shard ${shard.index}/${release.count}: sum of p90 weights about ${Math.round(fullEstimate(shard))}s, ${shard.groups.reduce((sum, group) => sum + group.tests.length, 0)} cell test(s)`,
      );
    }
    const summary = releaseSummary(release.count);
    log(`[quality-full-plan] ${summary}`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${summary}\n`);
    const outputs = fullOutputs(release.count, rotation.nights);
    if (env.GITHUB_OUTPUT) {
      appendFileSync(
        env.GITHUB_OUTPUT,
        Object.entries(outputs)
          .map(([key, value]) => `${key}=${value}\n`)
          .join(''),
      );
    }
    return 0;
  } catch (error) {
    fail(`[quality-full-plan] ${(error as Error).message}`);
    return 1;
  } finally {
    host.remove();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runFullPlan();
}
