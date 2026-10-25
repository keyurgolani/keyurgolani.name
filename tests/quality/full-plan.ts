// `tsx tests/quality/full-plan.ts` (#11): the full plan's sizes, as
// release.yml's rc-quality-plan hands them to rc-quality. It installs the
// reference variant in a worktree and generates its registry with the
// quality flags, as quality:full -- --external-variant does before it
// builds (run.ts's externalVariantHost), plans from it, and works out
// (lib/full-shards.ts):
//
// - the release plan's shard count, the smallest of RELEASE_COUNTS that
//   keeps each shard within RELEASE_CEILING (releaseFor);
// - the nightly cycle, the smallest of NIGHT_COUNTS whose every night fits
//   at FULL_SHARDS shards (rotationFor), which every nightly shard works out
//   the same way for itself.
//
// It prints both, and under GitHub Actions writes `count`, `shards` (a JSON
// list, 1 to count), and `nights` to GITHUB_OUTPUT. A plan past either cap
// fails, naming its heaviest group. The worktree is removed however it ends.

import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FULL_SHARDS,
  fullGroups,
  NIGHTLY_CEILING,
  RELEASE_CEILING,
  releaseFor,
  rotationFor,
} from './lib/full-shards';
import { RUN_ENGINES } from './lib/matrix';
import { loadPlan } from './plan';
import { shardOutputs } from './pr-count';
import { externalVariantHost } from './run';

/** What GITHUB_OUTPUT gets: the release shard count, its matrix list, and the cycle's nights. */
export function fullOutputs(count: number, nights: number) {
  // rc-quality's max-parallel is FULL_SHARDS, so it takes no `parallel`.
  const { count: shardCount, shards } = shardOutputs(count);
  return { count: shardCount, shards, nights: String(nights) };
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
    const groups = fullGroups(plan, RUN_ENGINES.full);
    const seconds = Math.round(groups.reduce((sum, group) => sum + group.weight, 0));
    const release = releaseFor(groups);
    const rotation = rotationFor(groups);
    log(
      `[quality-full-plan] ${plan.tests.length} tests, about ${seconds}s: the release in ${release.count} shards, the slowest about ${Math.round(release.slowest)}s of ${RELEASE_CEILING}s; the nightly a ${rotation.nights}-night cycle of ${FULL_SHARDS} shards, the slowest about ${Math.round(rotation.slowest)}s of ${NIGHTLY_CEILING}s`,
    );
    const outputs = fullOutputs(release.count, rotation.nights);
    if (env.GITHUB_OUTPUT) {
      appendFileSync(
        env.GITHUB_OUTPUT,
        `count=${outputs.count}\nshards=${outputs.shards}\nnights=${outputs.nights}\n`,
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
