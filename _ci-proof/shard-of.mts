// Which release shards of this tree's full plan hold the cell tests a grep picks, so a list or a
// run can take --shard=<k>/<m> and Playwright collects that shard's projects alone, not every
// project's, as an unsharded --list does.
//
//   QUALITY_RELEASE_SCOPE=<scope file> pnpm exec tsx <this file> '<grep>'   (in the checkout)
//
// It plans as `ci:quality-full --shard=<k>/<m>` does in the same tree and env: the reference
// variant's host (run.ts's externalVariantHost, made and removed here), loadPlan in full mode with
// that host, then fullGroups at releaseDurations() and releasePlan(groups, weights, m), m being the
// count the tree's release plan takes. A planned test matches when the grep (case-insensitive, as
// Playwright's) finds it in "<cell id> <viewport> <row> ", the start of cells.spec's titles. That
// only finds the shards: the sharded lists' Totals, summed, are the check.
//
// Prints `count <m>`, then `shard <k>/<m> <matched tests>` for each shard holding a match, then
// `matched <n>`. Exit 0 with at least one match, 1 with none, 2 on a usage or planning error.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [grep] = process.argv.slice(2);
if (!grep || !process.env.QUALITY_RELEASE_SCOPE) {
  console.error("usage: QUALITY_RELEASE_SCOPE=<scope file> tsx shard-of.mts '<grep>'");
  process.exit(2);
}
const root = process.cwd();
const load = (file: string) => import(pathToFileURL(path.join(root, file)).href);

const { externalVariantHost } = await load('tests/quality/run.ts');
const { loadPlan } = await load('tests/quality/plan.ts');
const { fullGroups, releaseDurations, releaseFor, releasePlan } = await load(
  'tests/quality/lib/full-shards.ts',
);
const { RUN_ENGINES } = await load('tests/quality/lib/matrix.ts');

const pattern = new RegExp(grep, 'i');
const host = externalVariantHost();
let code = 2;
try {
  const plan = await loadPlan({ ...process.env, QUALITY_WEB: host.web, QUALITY_MODE: 'full' });
  const weights = releaseDurations();
  const groups = fullGroups(plan, RUN_ENGINES.full, weights);
  const count: number = releaseFor(groups, weights).count;
  const shards = releasePlan(groups, weights, count).shards as {
    index: number;
    groups: { tests: string[] }[];
  }[];
  console.log(`count ${count}`);
  let matched = 0;
  for (const shard of shards) {
    let n = 0;
    for (const group of shard.groups) {
      for (const key of group.tests) {
        const [cell, viewport, row] = JSON.parse(key) as string[];
        if (pattern.test(`${cell} ${viewport} ${row} `)) n += 1;
      }
    }
    if (n > 0) console.log(`shard ${shard.index}/${count} ${n}`);
    matched += n;
  }
  console.log(`matched ${matched}`);
  code = matched > 0 ? 0 : 1;
} catch (error) {
  console.error(`shard-of: ${(error as Error).message}`);
  code = 2;
} finally {
  host.remove();
}
process.exit(code);
