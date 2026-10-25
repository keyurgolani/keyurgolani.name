// `tsx tests/quality/pr-count.ts` (#11): how many shards CI's quality-pr runs
// this PR in. It plans the PR set as each shard will, from the registry the
// quality host builds (QUALITY_FIXTURES, APPEARANCE_FIXTURES, and
// BUDGET_FIXTURES, generated with --modules-only) and the paths the merge
// changes (QUALITY_CHANGED_BASE or QUALITY_CHANGED_FILES), and picks the
// fewest shards that keep every one within the ceiling (lib/pr-shards.ts's
// pickShardCount). It prints the count and each shard's estimate, and under
// GitHub Actions writes `count`, `shards` (a JSON list, 1 to count), and
// `parallel` (how many run at once: PR_PARALLEL for a catalog-scale sweep,
// else count) to GITHUB_OUTPUT, which quality-pr's matrix and
// quality-pr-verdict read.
// Needing more than MAX_SHARDS fails, naming the group that's to blame,
// and a PR with a pack sweep may take MAX_SHARDS plus what the sweep alone
// needs, up to SWEEP_MAX_SHARDS (lib/pr-shards.ts's shardLimit), which the
// log names. A sweep that doesn't fit SWEEP_MAX_SHARDS, alone or with the
// rest of the plan but the changed variants, is catalog-scale: the most is
// CATALOG_MAX_SHARDS, and the log says `catalog-scale sweep: N shards`.
//
// Locally, after `QUALITY_FIXTURES=1 APPEARANCE_FIXTURES=1 BUDGET_FIXTURES=1
// pnpm --filter @portfolio/web build:registry --modules-only`:
//
//   QUALITY_CHANGED_BASE=origin/next QUALITY_WEB=apps/web pnpm exec tsx tests/quality/pr-count.ts

import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUN_ENGINES } from './lib/matrix';
import {
  CATALOG_MAX_SHARDS,
  groupKey,
  MAX_SHARDS,
  pickShardCount,
  planGroups,
  PR_PARALLEL,
  shardEstimate,
  SHARD_CEILING,
  SWEEP_MAX_SHARDS,
} from './lib/pr-shards';
import { loadPlan } from './plan';

/**
 * What GITHUB_OUTPUT gets: the count, the matrix's list of shard indexes,
 * and how many run at once, quality-pr's max-parallel: PR_PARALLEL for a
 * catalog-scale sweep, so it runs in waves, and every shard otherwise, so
 * an ordinary plan runs in one wave.
 */
export function shardOutputs(
  count: number,
  catalogScale = false,
): { count: string; shards: string; parallel: string } {
  return {
    count: String(count),
    shards: JSON.stringify(Array.from({ length: count }, (_, at) => at + 1)),
    parallel: String(catalogScale ? PR_PARALLEL : count),
  };
}

async function main(): Promise<number> {
  // The checkout's apps/web unless QUALITY_WEB names another, absolute as cells.ts requires it.
  const web = path.resolve(process.env.QUALITY_WEB ?? path.join('apps', 'web'));
  const plan = await loadPlan({ ...process.env, QUALITY_WEB: web, QUALITY_MODE: 'pr' });
  let picked;
  try {
    picked = pickShardCount(planGroups(plan, RUN_ENGINES.pr));
  } catch (error) {
    process.stderr.write(`[quality-pr-plan] ${(error as Error).message}\n`);
    return 1;
  }
  const { count, slowest, shards, directedShards, sweepShards, variantShards, max, catalogScale } =
    picked;
  console.log(
    `[quality-pr-plan] ${plan.tests.length} tests in ${count} shard(s), the slowest about ${Math.round(slowest)}s of ${SHARD_CEILING}s`,
  );
  if (catalogScale) {
    console.log(
      `[quality-pr-plan] catalog-scale sweep: ${count} shards. The pack sweep alone needs ${sweepShards}, and it doesn't fit ${SWEEP_MAX_SHARDS}, alone or with the rest of the plan but the changed variants, so the most is ${CATALOG_MAX_SHARDS}.`,
    );
  } else if (directedShards > 0) {
    console.log(
      `[quality-pr-plan] The directed load alone needs ${directedShards} shard(s), the pack sweep's ${sweepShards} and the changed variants' ${variantShards}, so the most is ${max}${count > MAX_SHARDS ? `, and this PR takes ${count}, over the usual ${MAX_SHARDS}` : ''}.`,
    );
  }
  for (const shard of shards) {
    console.log(`  ${shard.index}/${count}: about ${Math.round(shardEstimate(shard))}s`);
    for (const group of shard.groups) {
      console.log(`    ${groupKey(group)} (${Math.round(group.weight)}s)`);
    }
  }
  const outputs = shardOutputs(count, catalogScale);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `count=${outputs.count}\nshards=${outputs.shards}\nparallel=${outputs.parallel}\n`,
    );
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
