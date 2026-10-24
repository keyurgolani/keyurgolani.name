// `pnpm test:catalog-static` (#20): one shard of the static smoke
// (static.ts), CATALOG_SHARD=<n>/<m>, 1/1 by default, after
// `pnpm --filter @portfolio/web build:registry`. It plans every tuple,
// fails before checking any when its share is over BUDGET, checks each, and
// prints its rate, so a new measurement reads from its log. Under ci/run.mjs
// each finding is a failure record naming its pack, axis, and first tuple.

import { fileURLToPath } from 'node:url';
import { currentGate, writeFailureRecord } from '../../ci/lib/reports.mjs';
import { readBuildMeta, FALLBACK_ID } from '../quality/cells';
import { crossProduct, readShard, recordTuple, staticPlan } from './plan';
import { staticSmoke } from './static';

const TAG = '[catalog-static]';
const WEB = fileURLToPath(new URL('../../apps/web/', import.meta.url));

function main(): number {
  const started = performance.now();
  const shard = readShard(process.env.CATALOG_SHARD);
  const meta = readBuildMeta(WEB);
  let tuples;
  try {
    tuples = staticPlan(crossProduct(meta), shard);
  } catch (error) {
    process.stderr.write(`${TAG} ${(error as Error).message}\n`);
    return 1;
  }
  const findings = staticSmoke(meta, WEB, tuples);
  const seconds = (performance.now() - started) / 1000;
  const rate = Math.round(tuples.length / Math.max(seconds, 0.001));
  process.stdout.write(
    `${TAG} shard ${shard.index} of ${shard.count}: ${tuples.length} tuple(s) in ${seconds.toFixed(1)}s, ${rate} a second, resolve included.\n`,
  );
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
