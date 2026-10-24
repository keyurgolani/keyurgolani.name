import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { MetaPack } from '../../packages/appearance/src/index';
import { PLATFORM_DEFAULTS } from '../../packages/appearance/src/index';
import { readBuildMeta, type BuildMeta } from '../quality/cells';
import { tupleKey } from '../quality/coverage';
import {
  blamed,
  crossProduct,
  readShard,
  registeredVariants,
  sampled,
  SAMPLE_EVERY,
  shardTuples,
  shippingPacks,
  tuplePath,
} from './plan';

// #20's scheduled cross-product: every registered variant x shipping
// design language x color scheme x typography x display mode the resolver
// renders as asked, sharded round robin, so the shards together are the
// whole product and no tuple runs twice.

const WEB = fileURLToPath(new URL('../../apps/web/', import.meta.url));

function checkoutMeta(): BuildMeta {
  const file = path.join(WEB, 'src', 'lib', 'generated', 'registry.meta.ts');
  assert.ok(existsSync(file), 'run pnpm --filter @portfolio/web build:registry first');
  return readBuildMeta(WEB);
}

/** A pack like the checkout's first of `kind`, renamed `id`. */
function packLike(
  meta: BuildMeta,
  kind: string,
  id: string,
  fixture = false,
  patch = {},
): MetaPack {
  const base = (meta.PACKS ?? []).find((pack) => pack.kind === kind && !pack.fixture)!;
  return { ...base, fixture, manifest: { ...base.manifest, id, name: id, ...patch } } as MetaPack;
}

/** The checkout with a second language and scheme, a dark-only scheme, and a fixture pack. */
function wider(meta: BuildMeta): BuildMeta {
  const scheme = (meta.PACKS ?? []).find((pack) => pack.kind === 'color-scheme')!;
  const anchors = (scheme.manifest as { anchors: { dark: unknown } }).anchors;
  return {
    ...meta,
    PACKS: [
      ...(meta.PACKS ?? []),
      packLike(meta, 'design-language', 'second-language'),
      packLike(meta, 'color-scheme', 'second-scheme'),
      packLike(meta, 'color-scheme', 'night-only', false, { anchors: { dark: anchors.dark } }),
      packLike(meta, 'typography', 'fixture-typography-stable', true),
    ],
  };
}

test('the cross-product is every registered variant against every shipping pack in every mode it renders', () => {
  const meta = wider(checkoutMeta());
  const variants = registeredVariants(meta);
  assert.ok(variants.includes('fallback'));
  assert.deepEqual(shippingPacks(meta, 'designLanguage'), ['platform-neutral', 'second-language']);
  assert.deepEqual(shippingPacks(meta, 'typography'), ['humanist-ui']);
  const tuples = crossProduct(meta);
  // Two dual-mode schemes in four modes, and the dark-only one in dark and high contrast.
  assert.equal(tuples.length, variants.length * 2 * (2 * 4 + 2) * 1);
  for (const tuple of tuples) assert.notEqual(tuple.typography, 'fixture-typography-stable');
  const night = tuples
    .filter((tuple) => tuple.colorScheme === 'night-only')
    .map((t) => t.displayMode);
  assert.deepEqual([...new Set(night)].sort(), ['dark', 'high-contrast']);
  // No tuple twice.
  assert.equal(new Set(tuples.map(tupleKey)).size, tuples.length);
});

test('shards partition the cross-product evenly, and the plan is the same each time', () => {
  const tuples = crossProduct(wider(checkoutMeta()));
  for (const count of [1, 2, 3, 4, 7]) {
    const shards = Array.from({ length: count }, (_, index) =>
      shardTuples(tuples, { index: index + 1, count }),
    );
    const all = shards.flat().map(tupleKey).sort();
    assert.deepEqual(all, tuples.map(tupleKey).sort(), `${count} shards`);
    const sizes = shards.map((shard) => shard.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${count} shards: ${sizes}`);
  }
  assert.deepEqual(crossProduct(wider(checkoutMeta())), tuples);
});

test('CATALOG_SHARD reads n/m, 1/1 when unset, and refuses anything else', () => {
  assert.deepEqual(readShard(undefined), { index: 1, count: 1 });
  assert.deepEqual(readShard('3/4'), { index: 3, count: 4 });
  for (const bad of ['0/4', '5/4', '1', 'a/b', '1/0', ' 1/4']) {
    assert.throws(() => readShard(bad), /CATALOG_SHARD/, bad);
  }
});

test('a sample of each shard screenshots, its first tuple included', () => {
  assert.ok(sampled(0));
  assert.ok(!sampled(1));
  assert.ok(sampled(SAMPLE_EVERY));
});

test('a tuple loads from the demo query, the fallback composition by a variant nothing registers', () => {
  assert.equal(
    tuplePath({
      variant: 'kinetic-cosmos',
      designLanguage: 'platform-neutral',
      colorScheme: 'warm-parchment',
      typography: 'humanist-ui',
      displayMode: 'dark',
    }),
    '/?variant=kinetic-cosmos&language=platform-neutral&scheme=warm-parchment&type=humanist-ui&mode=dark',
  );
  assert.match(
    tuplePath({ ...PLATFORM_DEFAULTS, variant: 'fallback' }),
    /^\/\?variant=missing-variant&/,
  );
});

test('a failure names one pack: the axis that rendered wrong, else the first pack off the defaults, else the variant', () => {
  const tuple = { ...PLATFORM_DEFAULTS, variant: 'kinetic-cosmos', colorScheme: 'second-scheme' };
  assert.deepEqual(blamed(tuple, PLATFORM_DEFAULTS), {
    axis: 'colorScheme',
    pack: 'second-scheme',
  });
  assert.deepEqual(blamed(tuple, PLATFORM_DEFAULTS, ['typography']), {
    axis: 'typography',
    pack: 'humanist-ui',
  });
  assert.deepEqual(blamed({ ...PLATFORM_DEFAULTS, variant: 'kinetic-cosmos' }, PLATFORM_DEFAULTS), {
    axis: 'variant',
  });
});
