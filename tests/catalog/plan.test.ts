import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type { GeneratedSchemes, MetaPack } from '../../packages/appearance/src/index';
import { PLATFORM_DEFAULTS } from '../../packages/appearance/src/index';
import { readBuildMeta, type BuildMeta } from '../quality/cells';
import { fallbackPacks } from '../quality/plan-fixtures';
import { tupleKey, type Tuple } from '../quality/coverage';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { DISPLAY_MODES, PACK_AXES } from '../../packages/appearance/src/index';
import {
  STATES,
  statesPages as requestStatesPages,
  statesTimeoutMinutes as requestStatesTimeout,
} from '../../ci/rehearsal-request.mjs';
import {
  blamed,
  browserPlan,
  BUDGET,
  CATALOG_FULL_MIN_SHARDS,
  catalogFullCount,
  coverageSample,
  crossProduct,
  DRAW_ROOM,
  MEASURED,
  readSeed,
  readShard,
  registeredVariants,
  SAMPLE_SEED,
  seededDraw,
  planBudget,
  readPlan,
  REHEARSAL,
  rehearsalTimeoutMinutes,
  shardTimeoutMinutes,
  shardTuples,
  shippingPacks,
  staticPlan,
  statesPlan,
  statesTimeoutMinutes,
  tuplePath,
} from './plan';
import { countOutputs } from './full-count';
import { resolvedTokens } from './tokens';
import type * as CatalogGenerated from '../../apps/web/scripts/catalog-generated';
import { packPackages } from '../../packages/appearance/src/node/index';
import type * as RegistryOptions from '../../apps/web/scripts/registry-options';
import { servedReader, staticSmoke, type ServedReader } from './static';

// #20's scheduled cross-product: every registered variant x shipping
// design language x color scheme x typography x display mode the resolver
// renders as asked, sharded round robin, so the shards together are the
// whole product and no tuple runs twice.

const WEB = fileURLToPath(new URL('../../apps/web/', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

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
  const meta = wider(fallbackPacks(checkoutMeta()));
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
 * the sample has more than one of each to cover. It tops each axis up to
 * that size, so a checkout that already ships part of the catalog isn't
 * counted twice.
 */
function catalog(meta: BuildMeta, languages = 10, schemes = 25, typographies = 10): BuildMeta {
  const shipped = (kind: string) =>
    (meta.PACKS ?? []).filter((pack) => pack.kind === kind && !pack.fixture).length;
  const clones = (kind: string, count: number) =>
    Array.from({ length: Math.max(0, count - shipped(kind)) }, (_, at) =>
      packLike(meta, kind, `${kind}-${at + 2}`),
    );
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

  // Each shard loads its share of it, and a seeded draw of its own tuples up to budget,
  // at the shard count catalog-full-plan counts, by the same function, so the two can't drift.
  const { count } = catalogFullCount(tuples);
  const shards = Array.from({ length: count }, (_, at) =>
    browserPlan(tuples, { index: at + 1, count }),
  );
  const keys = shards.flat().map(tupleKey);
  assert.equal(new Set(keys).size, keys.length, 'no tuple in two shards');
  for (const covered of sample) assert.ok(keys.includes(tupleKey(covered)), tupleKey(covered));
  for (const shard of shards) assert.equal(shard.length, BUDGET.browserPerShard);
  assert.deepEqual(browserPlan(tuples, { index: 2, count }), shards[1], 'the same each night');
  assert.notDeepEqual(
    browserPlan(tuples, { index: 2, count }, BUDGET.browserPerShard, SAMPLE_SEED + 1),
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

interface WorkflowJob {
  readonly name: string;
  readonly needs?: readonly string[];
  readonly if?: string;
  readonly 'timeout-minutes': number;
  readonly outputs?: Readonly<Record<string, string>>;
  readonly strategy?: { 'max-parallel'?: number; matrix: { shard: unknown } };
  readonly steps: { id?: string; name?: string; run?: string; env?: Record<string, string> }[];
}

/** A workflow's jobs, and its text. */
function workflowJobs(file: string): { jobs: Record<string, WorkflowJob>; text: string } {
  const text = readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8');
  return { jobs: (parse(text) as { jobs: Record<string, WorkflowJob> }).jobs, text };
}

/** scheduled.yml's catalog-full job, which runs the plan each night. */
function catalogFullJob(): WorkflowJob {
  return workflowJobs('scheduled.yml').jobs['catalog-full']!;
}

test("the plan fits its budget at #20 PR 2's catalog size, at the count catalog-full-plan counts, and the timeout is sized from it", (t) => {
  const tuples = crossProduct(catalog(checkoutMeta()));
  const job = catalogFullJob();
  const { count, sample } = catalogFullCount(tuples);
  assert.equal(sample, coverageSample(tuples).length);
  for (let index = 1; index <= count; index += 1) {
    const shard = { index, count };
    assert.ok(staticPlan(tuples, shard).length <= BUDGET.staticPerShard);
    assert.ok(browserPlan(tuples, shard).length <= BUDGET.browserPerShard);
  }
  // The count: at least ten, and the fewest past ten whose shares of the coverage sample each
  // leave DRAW_ROOM for the seeded draw.
  assert.equal(CATALOG_FULL_MIN_SHARDS, 10);
  assert.ok(DRAW_ROOM > 0 && DRAW_ROOM < BUDGET.browserPerShard, `${DRAW_ROOM}`);
  for (const each of [tuples, crossProduct(checkoutMeta())]) {
    const counted = catalogFullCount(each);
    const room = BUDGET.browserPerShard - DRAW_ROOM;
    assert.ok(counted.count >= CATALOG_FULL_MIN_SHARDS);
    assert.ok(Math.ceil(counted.sample / counted.count) <= room, `${counted.count} shards`);
    if (counted.count > CATALOG_FULL_MIN_SHARDS) {
      assert.ok(Math.ceil(counted.sample / (counted.count - 1)) > room, `${counted.count} shards`);
    }
    t.diagnostic(`a coverage sample of ${counted.sample}: ${counted.count} shards`);
  }
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

test("catalog-full-plan counts the night's shards from the registry it builds, and catalog-full's matrix, name, and shard read them", () => {
  const { jobs, text } = workflowJobs('scheduled.yml');
  const plan = jobs['catalog-full-plan'];
  assert.ok(plan, 'scheduled.yml has catalog-full-plan');
  assert.deepEqual(plan.needs, ['quality-full']);
  assert.equal(plan.if, '${{ !cancelled() }}');
  // Sized like ci.yml's quality-pr-plan, which does the same: an install, the registry, a plan.
  assert.equal(
    plan['timeout-minutes'],
    workflowJobs('ci.yml').jobs['quality-pr-plan']!['timeout-minutes'],
  );
  const runs = plan.steps.map((step) => step.run ?? '');
  assert.ok(runs.includes('pnpm --filter @portfolio/web build:registry'));
  const count = plan.steps.find((step) => step.id === 'count');
  // It runs its check as `pnpm ci:<job>`, which runs full-count.ts under ci/run.mjs, and
  // ci/run.mjs hands GITHUB_OUTPUT on to it.
  assert.equal(count?.run, 'pnpm ci:catalog-full-plan');
  const { scripts } = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> };
  assert.equal(
    scripts['ci:catalog-full-plan'],
    'node ci/run.mjs catalog-full-plan -- tsx tests/catalog/full-count.ts',
  );
  assert.ok(
    runs.indexOf('pnpm --filter @portfolio/web build:registry') < runs.indexOf(count!.run!),
  );
  assert.deepEqual(plan.outputs, {
    count: '${{ steps.count.outputs.count }}',
    shards: '${{ steps.count.outputs.shards }}',
  });
  // What the count step writes is what the matrix reads.
  assert.deepEqual(countOutputs(10), {
    count: '10',
    shards: '[1,2,3,4,5,6,7,8,9,10]',
  });
  assert.deepEqual(
    JSON.parse(countOutputs(13).shards),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
  );
  // catalog-full runs the plan's shards, seven at once, and names each of the count.
  const job = jobs['catalog-full']!;
  const total = '${{ needs.catalog-full-plan.outputs.count }}';
  assert.deepEqual(job.needs, ['quality-full', 'catalog-full-plan']);
  // Only once the plan succeeded: a failed or skipped plan leaves no matrix, so the shards skip
  // rather than run an empty one, and report counts that skip as a failure, since its
  // EXPECTED_SKIPS names neither job.
  assert.equal(job.if, "${{ !cancelled() && needs.catalog-full-plan.result == 'success' }}");
  const skips = text.slice(
    text.indexOf('EXPECTED_SKIPS:'),
    text.indexOf('\n', text.indexOf('EXPECTED_SKIPS:')),
  );
  assert.ok(skips.length > 0, 'report sets EXPECTED_SKIPS');
  assert.doesNotMatch(skips, /catalog-full/);
  // Its failure record uploads, as every scheduled job's does.
  const upload = plan.steps.find((step) => step.name === 'Upload reports') as
    { with?: Record<string, string> } | undefined;
  assert.equal(upload?.with?.name, 'reports-catalog-full-plan');
  assert.equal(job.strategy?.['max-parallel'], 7);
  assert.equal(
    job.strategy?.matrix.shard,
    '${{ fromJSON(needs.catalog-full-plan.outputs.shards) }}',
  );
  assert.equal(job.name, `catalog-full (\${{ matrix.shard }}/${total})`);
  for (const command of ['pnpm ci:catalog-static', 'pnpm ci:catalog-full']) {
    const step = job.steps.find((each) => each.run === command);
    assert.equal(step?.env?.CATALOG_SHARD, `\${{ matrix.shard }}/${total}`, command);
    assert.equal(
      step?.env?.CI_REPRO_COMMAND,
      `CATALOG_SHARD=\${{ matrix.shard }}/${total} ${command}`,
      command,
    );
  }
  // No count is written down in the job: it's the plan's alone.
  const block = text.slice(text.indexOf('\n  catalog-full:\n'), text.indexOf('\n  report:\n'));
  assert.doesNotMatch(block, /matrix\.shard \}\}\/\d|shard: \[/);
  assert.ok(jobs.report?.needs?.includes('catalog-full-plan'), 'report needs catalog-full-plan');
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
  // Every tuple warm-parchment is in, and only those.
  assert.equal(
    findings[0]!.tuples.length,
    tuples.filter((tuple) => tuple.colorScheme === 'warm-parchment').length,
  );
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
  const clone = {
    ...meta,
    PACKS: [...(meta.PACKS ?? []), packLike(meta, 'color-scheme', 'color-scheme-2')],
  };
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

/** The generated schemes' reference sets, read as static-smoke.ts reads them (#20 PR 3). */
function referenceSets(): GeneratedSchemes {
  const { generatedEntries, referenceSets: sets } = createRequire(import.meta.url)(
    '../../apps/web/scripts/catalog-generated.ts',
  ) as typeof CatalogGenerated;
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return sets(generatedEntries(root, packPackages(root)).entries);
}

test('with reference sets the static cross-product holds every registered generated scheme, and without them none (#20 PR 3)', () => {
  const meta = checkoutMeta();
  const generated = referenceSets();
  const without = crossProduct(meta);
  const withSets = crossProduct(meta, generated);
  const schemes = (tuples: readonly { colorScheme: string }[]) =>
    [...new Set(tuples.map(({ colorScheme }) => colorScheme))].sort();
  const registered = (meta.PACKS ?? [])
    .filter((pack) => pack.kind === 'color-scheme' && !pack.fixture && pack.manifest.generator)
    .map((pack) => pack.manifest.id)
    .sort();
  assert.ok(registered.includes('brand-seed') && registered.includes('hct-tonal'));
  for (const id of registered) {
    assert.ok(!schemes(without).includes(id), `${id} has no sets without its record`);
    assert.ok(schemes(withSets).includes(id), `${id} joins with its record`);
  }
  // Each takes every mode, as a dual-mode authored scheme does.
  const of = (tuples: readonly { colorScheme: string }[], id: string) =>
    tuples.filter(({ colorScheme }) => colorScheme === id).length;
  for (const id of registered) assert.equal(of(withSets, id), of(without, 'warm-parchment'), id);
  // And every other tuple is the same.
  const others = new Set(registered);
  assert.deepEqual(
    withSets.filter(({ colorScheme }) => !others.has(colorScheme)),
    without,
  );
});

test("the rehearsal's tokens name every map they read, once, and each tuple's color sets are the ones its mode renders", () => {
  const meta = checkoutMeta();
  const generated = referenceSets();
  const tuples = shardTuples(crossProduct(meta, generated), { index: 3, count: 400 });
  const { lines, maps } = resolvedTokens(meta, tuples, generated);
  assert.equal(lines.length, tuples.length);
  for (const line of lines) {
    for (const digest of [line.language, line.typography, ...Object.values(line.color)]) {
      assert.ok(maps.has(digest!), digest);
    }
    const sets = Object.keys(line.color).sort();
    if (line.displayMode === 'high-contrast')
      assert.ok(sets.every((name) => name.startsWith('high-contrast')));
    else assert.ok(sets.length >= 2, `${line.displayMode} renders its base and high-contrast sets`);
    assert.deepEqual(line.fallbackAxes, []);
  }
  const brand = lines.find(
    ({ colorScheme, displayMode }) => colorScheme === 'brand-seed' && displayMode === 'light',
  );
  if (brand) assert.deepEqual(maps.get(brand.color.light!), generated['brand-seed']!.light);
  assert.deepEqual(resolvedTokens(meta, tuples, generated).lines, lines, 'the same each time');
});

test("a typography role's own font-size-adjust is in its profile's token digest, so changing it changes the map", () => {
  const meta = checkoutMeta();
  const [tuple] = shardTuples(crossProduct(meta), { index: 1, count: 400 });
  const typographyOf = (with_: BuildMeta) => {
    const { lines, maps } = resolvedTokens(with_, [tuple!]);
    return { digest: lines[0]!.typography, map: maps.get(lines[0]!.typography) };
  };
  const aspect = (value: number): BuildMeta => ({
    ...meta,
    PACKS: (meta.PACKS ?? []).map((pack) => {
      if (pack.kind !== 'typography' || pack.manifest.id !== tuple!.typography) return pack;
      const manifest = pack.manifest as { roles: Record<string, object> };
      return {
        ...pack,
        manifest: {
          ...pack.manifest,
          roles: { ...manifest.roles, body: { ...manifest.roles.body, 'font-size-adjust': value } },
        },
      } as MetaPack;
    }),
  });
  const plain = typographyOf(meta);
  const tight = typographyOf(aspect(0.45));
  const open = typographyOf(aspect(0.56));
  assert.notEqual(tight.digest, plain.digest);
  assert.notEqual(open.digest, tight.digest);
  assert.equal(
    (tight.map as { roles: { body: { 'font-size-adjust'?: number } } }).roles.body[
      'font-size-adjust'
    ],
    0.45,
  );
  assert.equal(typographyOf(aspect(0.45)).digest, tight.digest, 'the same each time');
});

test('the rehearsal workflow runs only on its request, never cancels, reads only, and is sized from REHEARSAL under its cap', () => {
  const text = readFileSync(
    new URL('../../.github/workflows/catalog-rehearsal.yml', import.meta.url),
    'utf8',
  );
  const workflow = parse(text) as {
    on: Record<string, { paths?: string[]; branches?: string[] }>;
    permissions: Record<string, string>;
    concurrency: { 'cancel-in-progress': boolean };
    jobs: Record<
      string,
      {
        'timeout-minutes': number | string;
        outputs?: Record<string, string>;
        needs?: string;
        if?: string;
        strategy?: { matrix: { shard: number[] } };
        steps: { run?: string; env?: Record<string, string> }[];
      }
    >;
  };
  assert.deepEqual(Object.keys(workflow.on), ['pull_request']);
  assert.deepEqual(workflow.on.pull_request!.paths, ['tests/catalog/rehearsal.json']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.doesNotMatch(text, /workflow_dispatch|schedule:|secrets\./);
  const { request, shard, states, review } = workflow.jobs;
  assert.deepEqual(Object.keys(workflow.jobs), ['request', 'shard', 'states', 'review']);
  assert.ok(request!.steps.some(({ run }) => run === 'node ci/rehearsal-request.mjs --github'));
  for (const job of [shard!, states!, review!]) {
    assert.equal(job.needs, 'request');
    assert.equal(job.if, "${{ needs.request.outputs.run == 'true' }}");
  }
  assert.equal(shard!.strategy!.matrix.shard.length, REHEARSAL.shards);
  assert.equal(shard!['timeout-minutes'], rehearsalTimeoutMinutes());
  const runs = shard!.steps.map((step) => step.run ?? '');
  assert.ok(runs.indexOf('pnpm ci:catalog-static') < runs.indexOf('pnpm build'));
  assert.ok(runs.indexOf('pnpm build') < runs.indexOf('pnpm ci:catalog-full'));
  for (const step of shard!.steps.filter(({ run }) => run?.startsWith('pnpm ci:catalog-'))) {
    assert.equal(step.env?.CATALOG_PLAN, 'rehearsal', step.run);
    assert.equal(step.env?.CATALOG_SHARD, '${{ matrix.shard }}/8', step.run);
  }
  const pages = statesPlan(checkoutMeta()).length;
  assert.equal(
    pages,
    (shippingPacks(checkoutMeta(), 'designLanguage').length +
      shippingPacks(checkoutMeta(), 'typography').length) *
      4,
  );
  // The states job's timeout is the request job's output, worked out from the
  // checkout's packs with no install, which is plan.ts's: the same pages, the
  // same constants, and the same minutes for any count of pages.
  assert.equal(states!['timeout-minutes'], '${{ fromJSON(needs.request.outputs.states_minutes) }}');
  assert.equal(request!.outputs?.states_minutes, '${{ steps.decide.outputs.states_minutes }}');
  assert.equal(requestStatesPages(ROOT), pages);
  assert.deepEqual(STATES, {
    fixedSeconds: MEASURED.fixedSeconds,
    buildSeconds: REHEARSAL.statesBuildSeconds,
    secondsPerPage: MEASURED.browserSecondsPerTuple,
    displayModes: DISPLAY_MODES.length,
  });
  for (const count of [0, 1, 172, pages, 400]) {
    assert.equal(requestStatesTimeout(count), statesTimeoutMinutes(count), String(count));
  }
  const statesMinutes = statesTimeoutMinutes(pages);
  assert.ok(states!.steps.some(({ run }) => run === 'pnpm ci:catalog-states'));
  assert.ok(
    review!.steps.some(({ run }) => run === 'pnpm catalog review --out reports/catalog/review'),
  );
  const total =
    Number(request!['timeout-minutes']) +
    REHEARSAL.shards * Number(shard!['timeout-minutes']) +
    statesMinutes +
    Number(review!['timeout-minutes']);
  assert.ok(total <= REHEARSAL.capRunnerMinutes, `${total} runner-minutes at the timeouts`);
  // A shard's static budget is what its timeout leaves, before the 2x margin,
  // once its fixed part and browser part are in, at the measured rate.
  assert.equal(
    REHEARSAL.staticPerShard,
    Math.floor(
      ((rehearsalTimeoutMinutes() * 60) / 2 -
        MEASURED.fixedSeconds -
        REHEARSAL.browserPerShard * MEASURED.browserSecondsPerTuple) *
        MEASURED.staticTuplesPerSecond,
    ),
  );
  assert.equal(rehearsalTimeoutMinutes(), 18);
  // The rehearsal's sample shows each pack once per variant; the nightly's, once per variant and mode.
  assert.equal(REHEARSAL.coverage, 'variant');
  // The plan fits at the checkout's size, generated schemes included.
  const tuples = crossProduct(checkoutMeta(), referenceSets());
  const browser = crossProduct(checkoutMeta());
  for (let index = 1; index <= REHEARSAL.shards; index += 1) {
    const at = { index, count: REHEARSAL.shards };
    assert.ok(staticPlan(tuples, at, REHEARSAL.staticPerShard).length <= REHEARSAL.staticPerShard);
    assert.equal(
      browserPlan(browser, at, REHEARSAL.browserPerShard, SAMPLE_SEED, REHEARSAL.coverage).length,
      REHEARSAL.browserPerShard,
    );
  }
  // The request, when it's there, asks for this plan.
  const request_ = new URL('./rehearsal.json', import.meta.url);
  if (existsSync(request_)) {
    const asked = JSON.parse(readFileSync(request_, 'utf8')) as Record<string, unknown>;
    for (const key of [
      'shards',
      'staticPerShard',
      'browserPerShard',
      'seed',
      'capRunnerMinutes',
    ] as const) {
      assert.equal(asked[key], REHEARSAL[key], `rehearsal.json's ${key}`);
    }
  }
});

test('CATALOG_PLAN is nightly or rehearsal, and each takes its own budget', () => {
  assert.equal(readPlan(undefined), 'nightly');
  assert.equal(readPlan(''), 'nightly');
  assert.equal(readPlan('rehearsal'), 'rehearsal');
  assert.throws(() => readPlan('full'), /CATALOG_PLAN is full/);
  assert.deepEqual(planBudget('nightly'), {
    static: BUDGET.staticPerShard,
    browser: BUDGET.browserPerShard,
    coverage: 'mode',
  });
  assert.deepEqual(planBudget('rehearsal'), {
    static: REHEARSAL.staticPerShard,
    browser: REHEARSAL.browserPerShard,
    coverage: 'variant',
  });
});

test("the per-variant sample shows every pack once per variant, in fewer tuples than the per-mode one, and each per-mode group's packs are in it", () => {
  const tuples = crossProduct(checkoutMeta());
  const byMode = coverageSample(tuples);
  const byVariant = coverageSample(tuples, 'variant');
  assert.ok(byVariant.length < byMode.length, `${byVariant.length} against ${byMode.length}`);
  for (const variant of new Set(tuples.map((tuple) => tuple.variant))) {
    const all = tuples.filter((tuple) => tuple.variant === variant);
    const shown = byVariant.filter((tuple) => tuple.variant === variant);
    for (const axis of PACK_AXES) {
      assert.deepEqual(
        new Set(shown.map((tuple) => tuple[axis])),
        new Set(all.map((tuple) => tuple[axis])),
        `${variant} ${axis}`,
      );
    }
  }
  assert.deepEqual(coverageSample(tuples, 'variant'), byVariant, 'the same each time');
});
