// `tsx tests/catalog/full-count.ts` (#20): how many shards scheduled.yml's
// catalog-full runs tonight, after `pnpm --filter @portfolio/web
// build:registry`. It plans the browser smoke's cross-product as each shard
// will (crossProduct with no generated sets, as in the browser) and counts
// it with plan.ts's catalogFullCount: at least ten shards, and enough that
// each shard's share of the coverage sample leaves DRAW_ROOM of its budget
// for the seeded draw. It prints the count, and under GitHub Actions writes
// `count` and `shards` (a JSON list, 1 to count) to GITHUB_OUTPUT, which
// catalog-full's matrix, name, and CATALOG_SHARD read.

import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUDGET, catalogFullCount, crossProduct, DRAW_ROOM } from './plan';
import { readBuildMeta } from '../quality/cells';

const TAG = '[catalog-full-plan]';
const WEB = fileURLToPath(new URL('../../apps/web/', import.meta.url));

/** What GITHUB_OUTPUT gets: the count, and the matrix's list of shard indexes. */
export function countOutputs(count: number): { count: string; shards: string } {
  return {
    count: String(count),
    shards: JSON.stringify(Array.from({ length: count }, (_, at) => at + 1)),
  };
}

function main(): number {
  let counted;
  let tuples;
  try {
    tuples = crossProduct(readBuildMeta(WEB));
    counted = catalogFullCount(tuples);
  } catch (error) {
    process.stderr.write(`${TAG} ${(error as Error).message}\n`);
    return 1;
  }
  const { count, sample } = counted;
  console.log(
    `${TAG} ${tuples.length} tuples, a coverage sample of ${sample}, in ${count} shards: about ${Math.ceil(sample / count)} of the sample a shard, of a budget of ${BUDGET.browserPerShard}, which keeps at least ${DRAW_ROOM} for the seeded draw`,
  );
  const outputs = countOutputs(count);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `count=${outputs.count}\nshards=${outputs.shards}\n`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
