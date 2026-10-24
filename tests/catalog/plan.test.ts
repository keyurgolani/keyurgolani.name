import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { MetaPack } from '../../packages/appearance/src/index';
import { PLATFORM_DEFAULTS } from '../../packages/appearance/src/index';
import { readBuildMeta, type BuildMeta } from '../quality/cells';
import { tupleKey, type Tuple } from '../quality/coverage';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { PACK_AXES } from '../../packages/appearance/src/index';
import {
  blamed,
  browserPlan,
  BUDGET,
  coverageSample,
  crossProduct,
  MEASURED,
  readSeed,
  readShard,
  registeredVariants,
  SAMPLE_SEED,
  seededDraw,
  shardTimeoutMinutes,
  shardTuples,
  shippingPacks,
  staticPlan,
  tuplePath,
} from './plan';
import type * as RegistryOptions from '../../apps/web/scripts/registry-options';
import { servedReader, staticSmoke, type ServedReader } from './static';

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

/**
 * A catalog the size #20 PR 2 brings, by cloning the checkout's packs: ten
 * languages, twenty-five schemes, ten profiles, and a dark-only scheme, so
 * the sample has more than one of each to cover.
 */
function catalog(meta: BuildMeta, languages = 10, schemes = 25, typographies = 10): BuildMeta {
  const clones = (kind: string, count: number) =>
    Array.from({ length: count - 1 }, (_, at) => packLike(meta, kind, `${kind}-${at + 2}`));
  const scheme = (meta.PACKS ?? []).find((pack) => pack.kind === 'color-scheme')!;
  const anchors = (scheme.manifest as { anchors: { dark: unknown } }).anchors;
  return {
    ...meta,
    PACKS: [
      ...(meta.PACKS ?? []),
      ...clones('design-language', languages),
      ...clones('color-scheme', schemes),
      ...clones('typography', typographies),
      packLike(meta, 'color-scheme', 'night-only', false, { anchors: { dark: anchors.dark } }),
    ],
  };
}

test('the browser sample holds every shipping pack at least once per variant and per display mode', () => {
  const meta = catalog(checkoutMeta());
  const tuples = crossProduct(meta);
  const sample = coverageSample(tuples);
  for (const variant of registeredVariants(meta)) {
    for (const displayMode of ['system', 'light', 'dark', 'high-contrast']) {
      const here = tuples.filter((t) => t.variant === variant && t.displayMode === displayMode);
      const shown = sample.filter((t) => t.variant === variant && t.displayMode === displayMode);
      for (const axis of PACK_AXES) {
        assert.deepEqual(
          [...new Set(shown.map((t) => t[axis]))].sort(),
          [...new Set(here.map((t) => t[axis]))].sort(),
          `${variant} ${displayMode} ${axis}`,
        );
      }
      // The fewest it takes: the axis with the most packs there, one tuple each.
      const most = Math.max(...PACK_AXES.map((axis) => new Set(here.map((t) => t[axis])).size));
      assert.equal(shown.length, most, `${variant} ${displayMode}`);
    }
  }
  // The dark-only scheme is shown in the modes it renders, and only those.
  assert.deepEqual(
    [
      ...new Set(sample.filter((t) => t.colorScheme === 'night-only').map((t) => t.displayMode)),
    ].sort(),
    ['dark', 'high-contrast'],
  );
  assert.deepEqual(coverageSample([...tuples].reverse()), sample, 'the same each time');
  // Sorted, and each variant and mode's first pick is its earliest tuple, the first to show the most.
  const sampled = sample.map(tupleKey);
  assert.deepEqual(sampled, [...sampled].sort(), 'in key order');
  const earliest = new Map<string, string>();
  for (const key of tuples.map(tupleKey).sort()) {
    const [variant, , , , displayMode] = key.split('/');
    if (!earliest.has(`${variant}/${displayMode}`)) earliest.set(`${variant}/${displayMode}`, key);
  }
  for (const key of earliest.values()) assert.ok(sampled.includes(key), key);

  // Each shard loads its share of it, and a seeded draw of its own tuples up to budget.
  const shards = Array.from({ length: 4 }, (_, at) =>
    browserPlan(tuples, { index: at + 1, count: 4 }),
  );
  const keys = shards.flat().map(tupleKey);
  assert.equal(new Set(keys).size, keys.length, 'no tuple in two shards');
  for (const covered of sample) assert.ok(keys.includes(tupleKey(covered)), tupleKey(covered));
  for (const shard of shards) assert.equal(shard.length, BUDGET.browserPerShard);
  assert.deepEqual(browserPlan(tuples, { index: 2, count: 4 }), shards[1], 'the same each night');
  assert.notDeepEqual(
    browserPlan(tuples, { index: 2, count: 4 }, BUDGET.browserPerShard, SAMPLE_SEED + 1),
    shards[1],
    'another seed draws others',
  );
});

/** coverageSample() as it was before #20 sped it up: every pick scans every tuple, the first with the most still unshown. */
function scannedSample(tuples: readonly Tuple[]): Tuple[] {
  const keyOf = (tuple: Tuple) => tupleKey(tuple);
  const groups = new Map<string, Tuple[]>();
  for (const tuple of tuples) {
    const at = `${tuple.variant}\0${tuple.displayMode}`;
    groups.set(at, [...(groups.get(at) ?? []), tuple]);
  }
  const chosen: Tuple[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1));
    const unshown = PACK_AXES.map((axis) => new Set(sorted.map((tuple) => tuple[axis])));
    while (unshown.some((packs) => packs.size > 0)) {
      const shows = (tuple: Tuple) =>
        PACK_AXES.filter((axis, at) => unshown[at]!.has(tuple[axis])).length;
      let best = sorted[0]!;
      for (const tuple of sorted) if (shows(tuple) > shows(best)) best = tuple;
      PACK_AXES.forEach((axis, at) => unshown[at]!.delete(best[axis]));
      chosen.push(best);
    }
  }
  return chosen.sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1));
}

test('the coverage sample is the plain greedy scan, ties to the earliest tuple, on catalogs that are no full product', () => {
  // One variant and mode. After two picks no tuple shows a pack on every
  // open axis, and four tie at one: the earliest wins, and which one wins
  // decides whether a, x, t0 or b, x, t2 shows x later.
  const tuple = (designLanguage: string, colorScheme: string, typography: string): Tuple => ({
    variant: 'fallback',
    designLanguage,
    colorScheme,
    typography,
    displayMode: 'light',
  });
  const tied = [
    tuple('w', 's0', 't0'),
    tuple('b', 'x', 't2'),
    tuple('b', 's2', 't2'),
    tuple('a', 'x', 't0'),
    tuple('a', 's0', 't3'),
    tuple('a', 's0', 't0'),
  ];
  assert.deepEqual(coverageSample(tied).map(tupleKey), [
    'fallback/a/s0/t0/light',
    'fallback/a/s0/t3/light',
    'fallback/a/x/t0/light',
    'fallback/b/s2/t2/light',
    'fallback/w/s0/t0/light',
  ]);
  assert.deepEqual(coverageSample(tied), scannedSample(tied));
  // Seeded catalogs: random tuples from small axes, duplicates and fixture packs included, in random order.
  let state = 20;
  const random = (count: number) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state % count;
  };
  const values = {
    variant: ['fallback', 'kinetic-cosmos'],
    designLanguage: ['a', 'b', 'c', 'fixture-language-stable'],
    colorScheme: ['s1', 's2', 's3', 'fixture-scheme-extended'],
    typography: ['t1', 't2', 't3'],
    displayMode: ['light', 'dark'],
  } as const;
  for (let at = 0; at < 300; at += 1) {
    const tuples = Array.from({ length: 2 + random(24) }, () => ({
      variant: values.variant[random(2)]!,
      designLanguage: values.designLanguage[random(4)]!,
      colorScheme: values.colorScheme[random(4)]!,
      typography: values.typography[random(3)]!,
      displayMode: values.displayMode[random(2)]!,
    }));
    assert.deepEqual(coverageSample(tuples), scannedSample(tuples), `catalog ${at}`);
  }
});

test("the plan fits its budget at #20 PR 2's catalog size, and the workflow's shards and timeout are sized from it", () => {
  const tuples = crossProduct(catalog(checkoutMeta()));
  const workflow = parse(
    readFileSync(new URL('../../.github/workflows/scheduled.yml', import.meta.url), 'utf8'),
  ) as {
    jobs: Record<
      string,
      {
        'timeout-minutes': number;
        strategy: { matrix: { shard: number[] } };
        steps: { run?: string; env?: Record<string, string> }[];
      }
    >;
  };
  const job = workflow.jobs['catalog-full']!;
  const count = job.strategy.matrix.shard.length;
  for (let index = 1; index <= count; index += 1) {
    const shard = { index, count };
    assert.ok(staticPlan(tuples, shard).length <= BUDGET.staticPerShard);
    assert.ok(browserPlan(tuples, shard).length <= BUDGET.browserPerShard);
  }
  // The coverage sample leaves room for the seeded draw in every shard.
  assert.ok(Math.ceil(coverageSample(tuples).length / count) < BUDGET.browserPerShard);
  // The job's timeout is its fixed part and both steps at budget, twice over.
  assert.equal(job['timeout-minutes'], shardTimeoutMinutes());
  assert.ok(shardTimeoutMinutes() <= 60, `a shard takes ${shardTimeoutMinutes()} minutes`);
  // Each shard runs both parts, the static one first.
  const runs = job.steps.map((step) => step.run ?? '');
  assert.ok(runs.indexOf('pnpm ci:catalog-static') >= 0);
  assert.ok(runs.indexOf('pnpm ci:catalog-static') < runs.indexOf('pnpm build'));
  assert.ok(runs.indexOf('pnpm build') < runs.indexOf('pnpm ci:catalog-full'));
  assert.ok(MEASURED.staticTuplesPerSecond > 0 && MEASURED.browserSecondsPerTuple > 0);
});

test('a plan over its budget fails before anything runs, naming the budget', () => {
  const tuples = crossProduct(catalog(checkoutMeta()));
  const shard = { index: 1, count: 4 };
  assert.throws(
    () => staticPlan(tuples, shard, 10),
    /^Error: catalog-full plan exceeds 10 tuples per shard: the static smoke's shard 1 of 4 holds \d+\./,
  );
  assert.throws(
    () => browserPlan(tuples, shard, 10),
    /^Error: catalog-full plan exceeds 10 tuples per shard: the browser smoke's shard 1 of 4 needs, to show every pack once per variant and display mode, \d+\./,
  );
  // At budget, it plans.
  const needed = shardTuples(coverageSample(tuples), shard).length;
  assert.equal(browserPlan(tuples, shard, needed).length, needed);
});

test('the seeded draw is a deterministic sample, and CATALOG_SEED reads a non-negative integer', () => {
  const pool = crossProduct(catalog(checkoutMeta(), 3, 4, 2));
  const drawn = seededDraw(pool, 10, 7);
  assert.equal(drawn.length, 10);
  assert.deepEqual(seededDraw(pool, 10, 7), drawn);
  assert.equal(new Set(drawn.map(tupleKey)).size, 10);
  assert.equal(seededDraw(pool, pool.length + 5, 7).length, pool.length);
  assert.equal(readSeed(undefined), SAMPLE_SEED);
  assert.equal(readSeed('42'), 42);
  for (const bad of ['-1', 'x', '1.5', ' 3'])
    assert.throws(() => readSeed(bad), /CATALOG_SEED/, bad);
});

/**
 * What registry generation serves, read in memory: a unit run writes the
 * generated modules alone (#75's served-files rule), so public/ holds no
 * compiled file to read.
 */
async function servedInMemory(): Promise<ServedReader> {
  // apps/web has no "type": "module", so its scripts are CommonJS to Node, as readBuildMeta() reads them.
  const { generateRegistry } = createRequire(import.meta.url)(
    '../../apps/web/scripts/registry-options.ts',
  ) as typeof RegistryOptions;
  const generated = await generateRegistry(process.env, { write: false });
  assert.ok(generated.result.ok, 'registry generation passes');
  return servedReader([
    ...(generated.packs ?? []),
    ...(generated.fonts ?? []),
    ...(generated.variants ?? []),
    ...(generated.assets ?? []),
    ...(generated.stills ?? []),
  ]);
}

test("the static smoke checks every tuple's packs, compiled files, and contrast, and names each finding once", async () => {
  const meta = checkoutMeta();
  const tuples = crossProduct(meta);
  const WEB = await servedInMemory();
  assert.deepEqual(staticSmoke(meta, WEB, tuples), []);
  // A compiled stylesheet that isn't the one registry generation hashed fails every tuple it's in, as one finding.
  const broken: BuildMeta = {
    ...meta,
    PACKS: (meta.PACKS ?? []).map((pack) =>
      pack.manifest.id === 'warm-parchment' && pack.stylesheet
        ? { ...pack, stylesheet: { ...pack.stylesheet, sha256: '0'.repeat(64) } }
        : pack,
    ) as BuildMeta['PACKS'],
  };
  const findings = staticSmoke(broken, WEB, tuples);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.check, 'compile');
  assert.equal(findings[0]!.axis, 'colorScheme');
  assert.equal(findings[0]!.id, 'warm-parchment');
  assert.match(findings[0]!.message, /isn't the file registry generation hashed/);
  assert.equal(findings[0]!.tuples.length, tuples.length);
  // A scheme under its contrast targets fails the contrast table in every tuple and mode it renders.
  const low = JSON.parse(
    readFileSync(
      new URL(
        '../../packages/quality-fixtures-schemes-meta/packs/fixture-scheme-experimental-low-contrast/manifest.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const dim = {
    ...meta,
    PACKS: [
      ...(meta.PACKS ?? []),
      packLike(meta, 'color-scheme', low.id, false, {
        ...low,
        anchors: undefined,
        derivation: undefined,
      }),
    ],
  };
  const dimTuples = crossProduct(dim);
  const contrast = staticSmoke(dim, WEB, dimTuples).filter(({ check }) => check === 'contrast');
  assert.ok(contrast.length > 0);
  for (const finding of contrast) {
    assert.equal(finding.axis, 'colorScheme');
    assert.equal(finding.id, low.id);
    assert.ok(finding.tuples.every((tuple) => tuple.colorScheme === low.id));
  }
  // A pack whose stylesheet sets another boundary's rules fails its pack gate.
  const clone = catalog(meta, 1, 2, 1);
  const gated = staticSmoke(clone, WEB, crossProduct(clone)).filter(
    ({ check }) => check === 'pack gate',
  );
  assert.ok(
    gated.some(({ id, message }) => id === 'color-scheme-2' && /boundary-isolation/.test(message)),
  );
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
