// `pnpm test:catalog-static` (#20): one shard of the static smoke
// (static.ts), CATALOG_SHARD=<n>/<m>, 1/1 by default, after
// `pnpm --filter @portfolio/web build:registry`. It plans every tuple, the
// generated schemes' through their reference records (PR 3), fails before
// checking any when its share is over budget, checks each, and prints its
// rate, so a new measurement reads from its log. Under ci/run.mjs each
// finding is a failure record naming its pack, axis, and first tuple.
// CATALOG_PLAN=rehearsal takes the rehearsal's budget and also writes every
// tuple's resolved tokens (tokens.ts) under the reports directory.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type * as CatalogGenerated from '../../apps/web/scripts/catalog-generated';
import { packPackages } from '../../packages/appearance/src/node/index';
import { currentGate, reportsDir, writeFailureRecord } from '../../ci/lib/reports.mjs';
import { readBuildMeta, FALLBACK_ID } from '../quality/cells';
import { crossProduct, planBudget, readPlan, readShard, recordTuple, staticPlan } from './plan';
import { publicReader, staticSmoke } from './static';
import { resolvedTokens, writeTokens } from './tokens';

const TAG = '[catalog-static]';
const WEB = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
// apps/web has no "type": "module", so its scripts are CommonJS to Node, as plan.test.ts reads them.
const { generatedEntries, referenceSets } = createRequire(import.meta.url)(
  '../../apps/web/scripts/catalog-generated.ts',
) as typeof CatalogGenerated;

function main(): number {
  const started = performance.now();
  let shard;
  let plan;
  try {
    shard = readShard(process.env.CATALOG_SHARD);
    plan = readPlan(process.env.CATALOG_PLAN);
  } catch (error) {
    process.stderr.write(`${TAG} ${(error as Error).message}\n`);
    return 1;
  }
  const meta = readBuildMeta(WEB);
  const generated = referenceSets(generatedEntries(ROOT, packPackages(ROOT)).entries);
  let tuples;
  try {
    tuples = staticPlan(crossProduct(meta, generated), shard, planBudget(plan).static);
  } catch (error) {
    process.stderr.write(`${TAG} ${(error as Error).message}\n`);
    return 1;
  }
  const findings = staticSmoke(meta, publicReader(WEB), tuples, generated);
  const seconds = (performance.now() - started) / 1000;
  const rate = Math.round(tuples.length / Math.max(seconds, 0.001));
  process.stdout.write(
    `${TAG} shard ${shard.index} of ${shard.count}: ${tuples.length} tuple(s) in ${seconds.toFixed(1)}s, ${rate} a second, resolve included.\n`,
  );
  if (plan === 'rehearsal') {
    const written = writeTokens(reportsDir(), shard.index, resolvedTokens(meta, tuples, generated));
    process.stdout.write(
      `${TAG} wrote ${written.tuples} tuple(s)' resolved tokens and ${written.maps} token map(s), ${written.bytes} bytes gzipped, to ${written.dir}.\n`,
    );
  }
  const gate = currentGate();
  for (const finding of findings) {
    const [first] = finding.tuples;
    process.stderr.write(
      `${TAG} ${finding.axis} ${finding.id} (${finding.check}): ${finding.message}, in ${finding.tuples.length} tuple(s), first ${first!.variant} ${recordTuple(first!)}.\n`,
    );
    if (gate) {
      writeFailureRecord({
        schemaVersion: '1.1',
        gate: gate.gate,
        reproCommand: gate.reproCommand,
        test: `cross-product static smoke (${finding.check}): ${finding.axis} ${finding.id}`,
        ...(finding.axis === 'variant'
          ? first!.variant === FALLBACK_ID
            ? {}
            : { variant: finding.id }
          : { pack: finding.id }),
        axis: finding.axis,
        profile: 'demo',
        displayMode: first!.displayMode,
        tuple: recordTuple(first!),
        rule: finding.check,
        actual: `${finding.message}, in ${finding.tuples.length} tuple(s)`,
      });
    }
  }
  if (findings.length > 0) {
    process.stderr.write(`${TAG} ${findings.length} finding(s).\n`);
    return 1;
  }
  return 0;
}

process.exitCode = main();
