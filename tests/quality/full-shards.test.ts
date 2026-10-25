import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';
import type { BuildMeta } from './cells';
import { planCells, type Plan } from './cells';
import { KIND_CHECKS } from './lib/checks';
import {
  BUCKETS,
  bucketGroups,
  cellRotation,
  dayNumber,
  FULL_FIXED,
  FULL_GROUP_BUDGET,
  FULL_SHARDS,
  fullEstimate,
  fullGroups,
  fullShard,
  groupNight,
  JOB_LIMIT_MINUTES,
  NIGHTLY_CEILING,
  MAX_NIGHTS,
  MAX_RELEASE_SHARDS,
  NIGHT_COUNTS,
  NIGHTLY_TIMEOUT_MINUTES,
  nightlyPlan,
  nightSlice,
  planFingerprint,
  RELEASE_CEILING,
  RELEASE_COUNTS,
  releaseFor,
  releasePlan,
  releaseTimeoutMinutes,
  rotates,
  rotationNights,
  rotationReport,
  rotationFor,
  rotationSlices,
  runProjects,
  sliceRecord,
  testBucket,
  timeoutMinutes,
  VISUAL_SECONDS,
  VISUAL_SPEC,
  type NightlyPlan,
  type NightSlice,
} from './lib/full-shards';
import { RUN_ENGINES } from './lib/matrix';
import {
  CELL_SPEC,
  groupKey,
  HARNESS_SPECS,
  harnessProject,
  loadDurations,
  PERF_SPEC,
  projectGrep,
  testKey,
  testTag,
  VISUAL_TAG,
  type PrShard,
  type ShardDurations,
  type ShardGroup,
} from './lib/pr-shards';
import { loadRegistrations, type Registrations } from './lib/registration';
import { mergeShards, planRecord, readShards } from './lib/shards';
import { plannedVisual, VISUAL_IMAGE, writeObservedFonts } from './lib/visual';
import { ALSO_RUNS, CELL, cellTest } from './meta/runner-cases';
import { SHARD_1, SHARD_2, writeShards } from './meta/shard-cases';
import { checkoutMeta, clone, withTierPacks } from './plan-fixtures';
import { externalVariantHost, planFullRun, runsPlaywright, type ReferenceSteps } from './run';
import { fullOutputs, runFullPlan } from './full-plan';
import { loadPlan } from './plan';
import { QUALITY_BUILD_ENV } from './lib/build.mjs';
import { PLATFORM_DEFAULTS, type MetaPack } from '../../packages/appearance/src/index';

// quality:full's shards (lib/full-shards.ts): the nightly rotation and the
// release plan, at the cap, within their timeouts, from quality:pr's
// planner and weights.

const ENGINES = RUN_ENGINES.full;

interface Step {
  readonly id?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: string;
  readonly env?: Record<string, string>;
  readonly with?: Record<string, unknown>;
}
interface Job {
  readonly name?: string;
  readonly needs?: readonly string[];
  readonly if?: string;
  readonly 'timeout-minutes'?: number;
  readonly container?: { readonly image?: string };
  readonly env?: Record<string, string>;
  readonly strategy?: {
    readonly 'fail-fast'?: boolean;
    readonly 'max-parallel'?: number;
    readonly matrix?: { readonly shard?: readonly number[] };
  };
  readonly steps: readonly Step[];
}
const read = (file: string) =>
  (
    parse(readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), 'utf8')) as {
      jobs: Record<string, Job>;
    }
  ).jobs;
const SCHEDULED = read('scheduled.yml');
const RELEASE = read('release.yml');
const SCRIPTS = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;

const step = (job: Job, match: (step: Step) => boolean, what: string) => {
  const found = job.steps.find(match);
  assert.ok(found, what);
  return found;
};

/**
 * #20's catalog as it ships, by axis, tier, and the display modes a scheme
 * has: the shipping packs the registry of D's kgn/20-3-generated, 6b403c60,
 * holds (the whole catalog, 2a to 2d and 3), 35 languages, 26 schemes that
 * take cells, and 8 profiles. Its two generated schemes, brand-seed and
 * hct-tonal, have no anchors and take no cells, so the model leaves them out.
 */
const CATALOG = [
  ['design-language', 'stable', 12, 'both'],
  ['design-language', 'extended', 16, 'both'],
  ['design-language', 'experimental', 7, 'both'],
  ['color-scheme', 'stable', 18, 'both'],
  ['color-scheme', 'extended', 4, 'both'],
  ['color-scheme', 'extended', 1, 'light'],
  ['color-scheme', 'extended', 1, 'dark'],
  ['color-scheme', 'experimental', 1, 'dark'],
  ['typography', 'stable', 6, 'both'],
  ['typography', 'extended', 2, 'both'],
] as const;
/**
 * The full plan 6b403c60's registry gives, with its variants (next's, at
 * a56358cd) and the reference variant, in seconds, by its own planner and
 * weights: what the model stands in for.
 */
const CATALOG_SOURCE = { commit: '6b403c60', seconds: 694_784 } as const;

type Modes = 'both' | 'light' | 'dark';

/** The display modes a pack has: a scheme's anchors, and both for the other axes. */
function modesOf(pack: MetaPack): Modes | 'none' {
  if (pack.kind !== 'color-scheme') return 'both';
  const anchors = (pack.manifest as { anchors?: Record<string, unknown> }).anchors ?? {};
  if (anchors.light && anchors.dark) return 'both';
  return anchors.light ? 'light' : anchors.dark ? 'dark' : 'none';
}

/** `pack` with only the display modes `modes` gives, for a scheme: its other anchor dropped. */
function withModes(pack: MetaPack, modes: Modes): MetaPack {
  if (modes === 'both' || pack.kind !== 'color-scheme') return pack;
  const anchors = { ...(pack.manifest.anchors as Record<string, unknown>) };
  delete anchors[modes === 'light' ? 'dark' : 'light'];
  return { ...pack, manifest: { ...pack.manifest, anchors } } as MetaPack;
}

/** The platform's default packs, which every plan pairs from, so the model keeps them. */
const DEFAULT_PACKS: ReadonlySet<string> = new Set([
  PLATFORM_DEFAULTS.designLanguage,
  PLATFORM_DEFAULTS.colorScheme,
  PLATFORM_DEFAULTS.typography,
]);

/**
 * #20's model: `meta` with CATALOG's shipping packs in place of its own. Its
 * fixture packs and the platform defaults stay, and each axis, tier, and
 * modes is filled to CATALOG's count with copies of that axis's default. So
 * it's a fixed input, the same whichever packs a checkout ships, and its
 * figures are pinned; the checkout's own plan is held to invariants.
 */
function catalogMeta(meta: BuildMeta): BuildMeta {
  const kept = (meta.PACKS ?? []).filter(
    (each) => each.fixture || DEFAULT_PACKS.has(each.manifest.id),
  );
  const added = CATALOG.flatMap(([kind, tier, count, modes]) => {
    const base = kept.find((each) => !each.fixture && each.kind === kind)!;
    const own = kept.filter(
      (each) =>
        !each.fixture &&
        each.kind === kind &&
        each.manifest.tier === tier &&
        modesOf(each) === modes,
    ).length;
    return Array.from({ length: count - own }, (_, at) =>
      withModes(clone(base, `catalog-${kind}-${tier}-${modes}-${at}`, tier, false), modes),
    );
  });
  return { ...meta, PACKS: [...kept, ...added] };
}

/** The shipping packs of `meta`, counted by axis, tier, and modes. */
function shippingCounts(meta: BuildMeta): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const pack of (meta.PACKS ?? []).filter((each) => !each.fixture)) {
    const key = `${pack.kind} ${pack.manifest.tier} ${modesOf(pack)}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** The model's cycle and release shard count. */
const CATALOG_NIGHTS = 28;
const CATALOG_SHARDS = 128;

/**
 * The first cycle and release shard count, which the synthetic plans here
 * are sized to. The checkout's own plan runs at whatever its registry needs
 * (fewestNights, fewestShards).
 */
const NIGHTS = NIGHT_COUNTS[0]!;
const RELEASE_SHARDS = RELEASE_COUNTS[0]!;

/**
 * The full plan the nightly and release runs plan: this checkout's, with the
 * tier packs a QUALITY_FIXTURES=1 build registers, and the reference variant
 * the runs install from its tarball (--external-variant), which registers a
 * composition; it stands in as Obsidian Atelier's twin, as pr-shards.test.ts's
 * fifth composition does. With `catalog`, #20's model's packs in place of
 * the checkout's (catalogMeta).
 */
function fullModel(
  registrations: Registrations,
  { catalog = false, extra = [] as string[] } = {},
): Plan {
  const meta = withTierPacks(catalog ? catalogMeta(checkoutMeta()) : checkoutMeta());
  const base = meta.VARIANTS.find(({ manifest }) => manifest.id === 'obsidian-atelier')!;
  const unit = registrations.units.find(({ id }) => id === 'obsidian-atelier')!;
  const variants = ['acme-reference', ...extra];
  return planCells({
    meta: {
      ...meta,
      VARIANTS: [
        ...meta.VARIANTS,
        ...variants.map((id) => ({ ...base, manifest: { ...base.manifest, id, name: id } })),
      ],
    } as BuildMeta,
    registrations: {
      ...registrations,
      units: [...registrations.units, ...variants.map((id) => ({ ...unit, id }))],
    },
    mode: 'full',
  });
}

let registrations: Registrations;
/** The checkout's full plan, from its registry. */
let plan: Plan;
/** #20's model's full plan. */
let catalog: Plan;
test.before(async () => {
  registrations = await loadRegistrations();
  plan = fullModel(registrations);
  catalog = fullModel(registrations, { catalog: true });
  assert.ok(plan.targets.some((target) => target.id === 'acme-reference'));
});

const total = (groups: readonly ShardGroup[]) =>
  groups.reduce((sum, group) => sum + group.weight, 0);

/** Every planned cell test once per engine, as the whole plan's verdict holds it to them. */
const everyTest = (each: Pick<Plan, 'tests'>) =>
  each.tests.flatMap((planned) =>
    ENGINES.map((engine) => testKey(planned.cell.id, planned.viewport.id, planned.row.id, engine)),
  );

/** `count` synthetic groups of `weight` seconds each, none of them split, on projects `name`(at). */
const synthetic = (
  count: number,
  weight: number,
  file = CELL_SPEC,
  name = (at: number) => `chromium s${at}`,
): ShardGroup[] =>
  Array.from({ length: count }, (_, at) => ({
    project: name(at),
    file,
    tests: [],
    costs: [],
    weight,
  }));

/** The night `days` after 2026-10-24. */
const night = (days: number) =>
  new Date((dayNumber('2026-10-24') + days) * 86_400_000).toISOString().slice(0, 10);

/**
 * The rotation `groups` run at, held to what rotationFor promises: N is one
 * of NIGHT_COUNTS, every night keeps its shards within the ceiling, and the
 * cycle before it doesn't fit.
 */
function fewestNights(groups: readonly ShardGroup[]): NightlyPlan {
  const rotation = rotationFor(groups);
  assert.ok(NIGHT_COUNTS.includes(rotation.nights), String(rotation.nights));
  assert.ok(rotation.nights <= MAX_NIGHTS);
  assert.equal(rotation.slices.length, rotation.nights);
  assert.ok(rotation.slowest <= NIGHTLY_CEILING);
  for (const shard of rotation.slices.flat()) assert.ok(fullEstimate(shard) <= NIGHTLY_CEILING);
  const before = NIGHT_COUNTS[NIGHT_COUNTS.indexOf(rotation.nights) - 1];
  if (before !== undefined) {
    assert.throws(
      () => nightlyPlan(groups, loadDurations(), FULL_SHARDS, before),
      new RegExp(`^Error: Night \\d+ of ${before} holds`),
    );
  }
  return rotation;
}

/**
 * The release plan `groups` run at, held to what releaseFor promises: the
 * count is one of RELEASE_COUNTS, every shard within the ceiling, and the
 * count before it doesn't fit.
 */
function fewestShards(groups: readonly ShardGroup[]): ReturnType<typeof releaseFor> {
  const release = releaseFor(groups);
  assert.ok(RELEASE_COUNTS.includes(release.count), String(release.count));
  assert.ok(release.count <= MAX_RELEASE_SHARDS);
  assert.equal(release.shards.length, release.count);
  assert.ok(release.slowest <= RELEASE_CEILING);
  for (const shard of release.shards) assert.ok(fullEstimate(shard) <= RELEASE_CEILING);
  const before = RELEASE_COUNTS[RELEASE_COUNTS.indexOf(release.count) - 1];
  if (before !== undefined) {
    assert.throws(
      () => releasePlan(groups, loadDurations(), before),
      new RegExp(`^Error: The release plan in ${before} shards leaves a shard at about \\d+s`),
    );
  }
  return release;
}

/**
 * Each planned test's night of a cycle of `nights`, from 1, by test key: its
 * group's night (groupNight), however heavy the nights come out.
 */
function testNights(
  each: Plan,
  nights: number,
  durations: ShardDurations = loadDurations(),
): Map<string, number> {
  const slices = rotationSlices(
    bucketGroups(fullGroups(each, ENGINES, durations), durations),
    nights,
  );
  const byTest = new Map<string, number>();
  slices.forEach((slice, at) => {
    for (const key of slice.flatMap((shard) => shard.groups.flatMap((group) => group.tests))) {
      byTest.set(key, at + 1);
    }
  });
  return byTest;
}

/** The salts the balance test rolls the nights with: the plan's own, the empty one, and 49 more. */
const SALTS = ['', ...Array.from({ length: 49 }, (_, at) => `salt-${at + 1}:`)];

test('the cap: eight shard jobs at once, nightly and at release, and the release in as many waves of them as rc-quality-plan counts', () => {
  assert.equal(FULL_SHARDS, 8, 'PR CI keeps 12 of the account’s 20 job slots');
  assert.deepEqual(NIGHT_COUNTS, [7, 14, 28, 56]);
  assert.deepEqual(RELEASE_COUNTS, [32, 64, 128]);
  const count = '${{ needs.rc-quality-plan.outputs.count }}';
  assert.deepEqual(SCHEDULED['quality-full']!.strategy?.matrix?.shard, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(
    RELEASE['rc-quality']!.strategy?.matrix?.shard,
    '${{ fromJSON(needs.rc-quality-plan.outputs.shards) }}',
  );
  for (const [where, job, total] of [
    ['scheduled.yml quality-full', SCHEDULED['quality-full']!, String(FULL_SHARDS)],
    ['release.yml rc-quality', RELEASE['rc-quality']!, count],
  ] as const) {
    assert.equal(job.strategy?.['max-parallel'], FULL_SHARDS, where);
    assert.equal(job.strategy?.['fail-fast'], false, where);
    assert.equal(job.name?.endsWith(`(\${{ matrix.shard }}/${total})`), true, where);
    const run = step(job, (each) => /pnpm ci:quality-full/.test(each.run ?? ''), where);
    assert.equal(run.env?.SHARD, `\${{ matrix.shard }}/${total}`, where);
    assert.equal(
      run.env?.CI_REPRO_COMMAND?.includes(`--shard=\${{ matrix.shard }}/${total}`),
      true,
    );
  }
  // rc-quality-plan counts them from the plan, and hands the count and the matrix list on.
  const plan = RELEASE['rc-quality-plan']!;
  assert.deepEqual(plan.needs, ['classify', 'rc-verify']);
  assert.deepEqual(RELEASE['rc-quality']!.needs, ['classify', 'rc-quality-plan']);
  const counted = step(plan, (each) => each.id === 'count', 'the count step');
  assert.equal(counted.run, 'pnpm exec tsx tests/quality/full-plan.ts');
  assert.deepEqual((plan as unknown as { outputs: Record<string, string> }).outputs, {
    count: '${{ steps.count.outputs.count }}',
    shards: '${{ steps.count.outputs.shards }}',
  });
  assert.deepEqual(fullOutputs(64, 14), {
    count: '64',
    shards: JSON.stringify(Array.from({ length: 64 }, (_, at) => at + 1)),
    nights: '14',
  });
  // Each verdict expects every shard that ran, every wave's at release.
  const merged = step(
    SCHEDULED['quality-verdict']!,
    (each) => /pnpm ci:quality-verdict/.test(each.run ?? ''),
    'the nightly merge',
  );
  assert.match(merged.run!, new RegExp(` --shards ${FULL_SHARDS} --mode full$`));
  const release = step(
    RELEASE['rc-quality-verdict']!,
    (each) => /pnpm ci:quality-release/.test(each.run ?? ''),
    'the release merge',
  );
  assert.equal(release.run, 'pnpm ci:quality-release --merged "$SHARDS" --shards "$SHARD_COUNT"');
  assert.equal(release.env?.SHARD_COUNT, count);
  assert.deepEqual(RELEASE['rc-quality-verdict']!.needs, [
    'classify',
    'rc-quality-plan',
    'rc-quality',
  ]);
  // The catalog's shards wait for the quality shards, however they ended, so the night peaks near eight.
  assert.deepEqual(SCHEDULED['catalog-full']!.needs, ['quality-full']);
  assert.equal(SCHEDULED['catalog-full']!.if, '${{ !cancelled() }}');
});

test("the nightly timeout is the lead's 90 minutes, and N the fewest nights that fit it: the registry's own, and 28 for #20's model, however the hash falls", (t) => {
  assert.equal(NIGHTLY_TIMEOUT_MINUTES, 90);
  assert.equal(SCHEDULED['quality-full']!['timeout-minutes'], NIGHTLY_TIMEOUT_MINUTES);
  assert.equal(timeoutMinutes(NIGHTLY_CEILING), NIGHTLY_TIMEOUT_MINUTES);
  // The checkout's plan, whatever its registry ships, runs the fewest nights that fit.
  const own = fullGroups(plan, ENGINES);
  const today = fewestNights(own);
  t.diagnostic(
    `this checkout: about ${Math.round(total(own))}s, ${today.nights} nights, the slowest shard about ${Math.round(today.slowest)}s of ${NIGHTLY_CEILING}s`,
  );
  // #20's model, within 15% of the plan 6b403c60's registry gives.
  const groups = fullGroups(catalog, ENGINES);
  const seconds = total(groups);
  const off = (seconds - CATALOG_SOURCE.seconds) / CATALOG_SOURCE.seconds;
  t.diagnostic(
    `the model: about ${Math.round(seconds)}s, ${(off * 100).toFixed(1)}% from ${CATALOG_SOURCE.commit}'s ${CATALOG_SOURCE.seconds}s`,
  );
  assert.ok(
    Math.abs(off) <= 0.15,
    `the model is about ${Math.round(seconds)}s, ${CATALOG_SOURCE.commit}'s plan ${CATALOG_SOURCE.seconds}s`,
  );
  const rotation = fewestNights(groups);
  const loads = rotation.slices.map((slice) => total(slice.flatMap((shard) => shard.groups)));
  t.diagnostic(
    `the model: ${rotation.nights} nights, the heaviest night about ${Math.round(Math.max(...loads))}s of tests, its slowest shard about ${Math.round(rotation.slowest)}s of ${NIGHTLY_CEILING}s`,
  );
  assert.equal(rotation.nights, CATALOG_NIGHTS);
  // On 50 draws of the hash, as #20's real pack ids roll it again, the cycle stays within the cap.
  const bucketed = bucketGroups(groups);
  const counts = new Map<number, number>();
  const ratios: number[] = [];
  for (const salt of SALTS) {
    const nights = rotationFor(groups, loadDurations(), FULL_SHARDS, salt).nights;
    counts.set(nights, (counts.get(nights) ?? 0) + 1);
    const slices = rotationSlices(bucketed, nights, FULL_SHARDS, salt);
    const each = slices.map((slice) => total(slice.flatMap((shard) => shard.groups)));
    ratios.push(Math.max(...each) / (each.reduce((sum, load) => sum + load, 0) / nights));
  }
  const sorted = [...ratios].sort((a, b) => a - b);
  t.diagnostic(
    `over 50 draws: cycles ${JSON.stringify(Object.fromEntries(counts))}; the heaviest night over the mean, median ${sorted[25]!.toFixed(3)}, max ${sorted.at(-1)!.toFixed(3)}`,
  );
  assert.ok([...counts.keys()].every((nights) => nights <= MAX_NIGHTS));
});

test("the #20 model is a fixed input: CATALOG's shipping packs, the platform defaults among them, whichever packs the checkout ships", () => {
  const meta = checkoutMeta();
  const model = catalogMeta(meta);
  assert.deepEqual(
    shippingCounts(model),
    Object.fromEntries(
      CATALOG.map(([kind, tier, count, modes]) => [`${kind} ${tier} ${modes}`, count]),
    ),
  );
  const ids = (each: BuildMeta) => (each.PACKS ?? []).map((pack) => pack.manifest.id);
  for (const id of DEFAULT_PACKS) assert.ok(ids(model).includes(id), id);
  // The checkout's fixture packs stay as they are.
  assert.deepEqual(
    (model.PACKS ?? []).filter((pack) => pack.fixture),
    (meta.PACKS ?? []).filter((pack) => pack.fixture),
  );
  // More shipping packs, of any axis, tier, or modes, or a generated scheme with no anchors, change nothing.
  const language = (meta.PACKS ?? []).find(
    (pack) => pack.manifest.id === PLATFORM_DEFAULTS.designLanguage,
  )!;
  const scheme = (meta.PACKS ?? []).find(
    (pack) => pack.manifest.id === PLATFORM_DEFAULTS.colorScheme,
  )!;
  const generated = clone(scheme, 'generated-scheme', 'extended', false);
  const shipped = {
    ...meta,
    PACKS: [
      ...(meta.PACKS ?? []),
      clone(language, 'shipped-language', 'stable', false),
      withModes(clone(scheme, 'shipped-dark', 'experimental', false), 'dark'),
      { ...generated, manifest: { ...generated.manifest, anchors: {} } } as MetaPack,
    ],
  } as BuildMeta;
  assert.equal(modesOf((shipped.PACKS ?? []).at(-1)!), 'none');
  assert.deepEqual(ids(catalogMeta(shipped)), ids(model));
});

test("the release plan fits rc-quality's timeout in the fewest shards that do: the registry's own count, and 128 for #20's model, every group once", (t) => {
  const job = RELEASE['rc-quality']!;
  assert.equal(job['timeout-minutes'], releaseTimeoutMinutes());
  assert.equal(releaseTimeoutMinutes(), timeoutMinutes(RELEASE_CEILING));
  assert.ok(releaseTimeoutMinutes() <= JOB_LIMIT_MINUTES);
  for (const [name, each] of [
    ['this checkout', plan],
    ['the model', catalog],
  ] as const) {
    const groups = fullGroups(each, ENGINES);
    const { count, shards, slowest } = fewestShards(groups);
    t.diagnostic(
      `${name}: ${count} shards, the slowest about ${Math.round(slowest)}s of ${RELEASE_CEILING}s, ${Math.round(RELEASE_CEILING - slowest)}s to spare`,
    );
    if (each === catalog) assert.equal(count, CATALOG_SHARDS);
    // Every planned test once, and every harness, perf, and visual group once.
    assert.deepEqual(
      shards.flatMap((shard) => shard.groups.flatMap((group) => group.tests)).sort(),
      everyTest(each).sort(),
      name,
    );
    const whole = (group: ShardGroup) => `${group.project} ${group.file}`;
    assert.deepEqual(
      shards
        .flatMap((shard) => shard.groups)
        .filter((group) => group.file !== CELL_SPEC)
        .map(whole)
        .sort(),
      groups
        .filter((group) => group.file !== CELL_SPEC)
        .map(whole)
        .sort(),
      name,
    );
  }
  // Its run: the whole plan, no night, in the pinned image, against the reference variant.
  assert.equal(job.container?.image, VISUAL_IMAGE);
  assert.equal(job.env?.QUALITY_CONTAINER, VISUAL_IMAGE);
  const run = step(job, (each) => /pnpm ci:quality-full/.test(each.run ?? ''), 'the run step');
  assert.equal(run.run, 'pnpm ci:quality-full "--shard=$SHARD"');
  assert.equal(
    SCRIPTS['ci:quality-full'],
    'node ci/run.mjs quality-full -- pnpm quality:full -- --external-variant',
  );
  // Scrubbed however it ended, and uploaded only when the scrub passed.
  const scrub = step(job, (each) => each.id === 'scrub', 'the scrub');
  assert.equal(scrub.run, 'node tests/quality/scrub.mjs');
  assert.equal(scrub.if, '${{ always() }}');
  const upload = step(job, (each) => /^actions\/upload-artifact@/.test(each.uses ?? ''), 'upload');
  assert.equal(upload.if, "${{ always() && steps.scrub.outcome == 'success' }}");
  assert.ok(job.steps.indexOf(scrub) < job.steps.indexOf(upload));
  const download = step(
    RELEASE['rc-quality-verdict']!,
    (each) => /^actions\/download-artifact@/.test(each.uses ?? ''),
    'the download',
  );
  assert.equal(download.with?.pattern, 'reports-quality-release-*');
  assert.equal(upload.with?.name, 'reports-quality-release-${{ matrix.shard }}');
});

test('a cycle of N nights runs every test of every cell exactly once, a cell on at most BUCKETS nights, and the harness and perf cells every night', () => {
  const groups = fullGroups(plan, ENGINES);
  const { nights: cycle, slices } = fewestNights(groups);
  const seen: string[] = [];
  const visual: string[] = [];
  const everyNight = groups
    .filter((group) => !rotates(group))
    .map(groupKey)
    .sort();
  assert.ok(everyNight.some((key) => key.endsWith(` ${PERF_SPEC}`)));
  for (const file of HARNESS_SPECS) {
    assert.ok(everyNight.includes(`${harnessProject('chromium')} ${file}`), file);
  }
  for (const slice of slices) {
    assert.equal(slice.length, FULL_SHARDS);
    const nightGroups = slice.flatMap((shard) => shard.groups);
    seen.push(...nightGroups.flatMap((group) => group.tests));
    visual.push(
      ...nightGroups.filter((group) => group.file === VISUAL_SPEC).map((group) => group.project),
    );
    assert.deepEqual(
      nightGroups
        .filter((group) => !rotates(group))
        .map(groupKey)
        .sort(),
      everyNight,
    );
  }
  assert.deepEqual(seen.sort(), everyTest(plan).sort(), 'every test of every cell once');
  // The visual tests visual.spec.ts plans, each once, on its server's bucket 0.
  const visualGroups = groups.filter((group) => group.file === VISUAL_SPEC);
  assert.ok(plannedVisual(plan).length > 0);
  assert.equal(
    total(visualGroups),
    visualGroups.length * loadDurations().group + plannedVisual(plan).length * VISUAL_SECONDS,
  );
  assert.deepEqual(visual.sort(), visualGroups.map((group) => group.project).sort());
  const bucketed = bucketGroups(groups);
  for (const group of bucketed.filter((each) => each.file === VISUAL_SPEC)) {
    assert.equal(group.bucket, 0, group.project);
  }
  // Every cell part names its bucket's tests, so the grep runs them alone.
  for (const group of bucketed.filter((each) => each.file === CELL_SPEC)) {
    assert.ok(group.part !== undefined, group.project);
    assert.ok(
      group.tests.every((key) => testBucket(key) === group.bucket),
      group.project,
    );
  }
  // A cell's tests spread over its buckets' nights, and the record names each one.
  const nights = testNights(plan, cycle);
  const rotation = fullShard(plan, ENGINES, `1/${FULL_SHARDS}`, night(0)).slice!.rotation;
  const spread = new Map<string, Set<number>>();
  for (const [key, at] of nights) {
    const cell = (JSON.parse(key) as string[])[0]!;
    spread.set(cell, (spread.get(cell) ?? new Set()).add(at));
  }
  assert.ok(
    [...spread.values()].some((own) => own.size > 1),
    'some cell spans nights',
  );
  for (const [cell, own] of spread) {
    assert.ok(own.size <= BUCKETS, cell);
    assert.deepEqual(
      rotation[cell],
      [...own].sort((a, b) => a - b),
      cell,
    );
  }
  // N nights in a row, as run.ts plans each (its shards together, as one machine runs them), run
  // each night of the cycle once, and each test on its own night.
  const indexes: number[] = [];
  const ran = new Set<string>();
  for (let day = 0; day < cycle; day += 1) {
    const whole = fullShard(plan, ENGINES, null, night(day));
    assert.equal(whole.slice!.nights, cycle);
    indexes.push(whole.slice!.index);
    for (const key of whole.shard.groups.flatMap((group) => group.tests)) {
      assert.equal(ran.has(key), false, key);
      ran.add(key);
      assert.equal(nights.get(key), whole.slice!.index, key);
    }
  }
  assert.deepEqual(
    indexes.sort((a, b) => a - b),
    Array.from({ length: cycle }, (_, at) => at + 1),
  );
  assert.equal(ran.size, everyTest(plan).length);
});

test("a plan change moves no other test's night while N holds: a new composition, a new test, or a weight changing", () => {
  const { nights: cycle } = rotationFor(fullGroups(plan, ENGINES));
  const before = testNights(plan, cycle);
  // A fifth composition, Obsidian Atelier's twin, brings servers, cells, and tests of its own.
  const grown = fullModel(registrations, { extra: ['fifth-composition'] });
  const after = testNights(grown, cycle);
  assert.ok(after.size > before.size);
  // The covering array may pick other tuples for the bigger plan, more of them the bigger the
  // catalog; every test both plans hold keeps its night, and they hold some on every night.
  const shared = [...before.keys()].filter((key) => after.has(key));
  assert.equal(new Set(shared.map((key) => before.get(key))).size, cycle);
  for (const key of shared) assert.equal(after.get(key), before.get(key), key);
  // A test added to a server's group moves none of the group's other tests.
  const group = fullGroups(plan, ENGINES).find(
    (each) => each.file === CELL_SPEC && each.tests.length > 8,
  )!;
  const nightsOf = (each: ShardGroup) =>
    new Map(
      bucketGroups([each], { group: 3 }).flatMap((part) =>
        part.tests.map((key) => [key, groupNight(part)] as const),
      ),
    );
  const extra = testKey('composition:x new / tuple', '1440x900', 'default', 'chromium');
  const added = nightsOf({
    ...group,
    tests: [...group.tests, extra],
    costs: [...group.costs!, 10],
    weight: group.weight + 10,
  });
  for (const [key, at] of nightsOf(group)) assert.equal(added.get(key), at, key);
  // Every weight 10% heavier, and the pack weights twice over.
  const durations = loadDurations();
  const scale = (weights: Readonly<Record<string, number>>, by: number) =>
    Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value * by]));
  const heavier: ShardDurations = {
    ...durations,
    plain: durations.plain * 1.1,
    conditions: scale(durations.conditions, 1.1),
    pack: scale(durations.pack, 2),
    composition: scale(durations.composition, 1.1),
  };
  assert.deepEqual(testNights(plan, cycle, heavier), before);
  // A group's night is its server's and bucket's alone: its engine, file, weight, tests, and part don't move it.
  for (const other of [
    { ...group, bucket: 1 },
    { ...group, bucket: 1, project: group.project.replace(/^chromium /, 'webkit '), weight: 1 },
    { ...group, bucket: 1, tests: [], part: 7, file: VISUAL_SPEC },
  ]) {
    assert.equal(groupNight(other), groupNight({ ...group, bucket: 1 }));
  }
  assert.equal(testBucket(extra), testBucket(extra.replace('chromium', 'webkit')));
});

test('a night over its budget fails before any test, naming the night, its load, and its heaviest group', () => {
  const durations = { group: 5 };
  // Visual groups whose night is the first: two 2,000 s groups a shard fit, one on each worker; three don't.
  const first: string[] = [];
  for (let at = 0; first.length < 2 * FULL_SHARDS + 1; at += 1) {
    if (groupNight({ project: `chromium s${at}` }) === 0) first.push(`chromium s${at}`);
  }
  const groups = (count: number) => synthetic(count, 2000, VISUAL_SPEC, (at) => first[at]!);
  assert.equal(nightlyPlan(groups(2 * FULL_SHARDS), durations).nights, NIGHTS);
  assert.throws(
    () => nightlyPlan(groups(2 * FULL_SHARDS + 1), durations),
    new RegExp(
      `^Error: Night 1 of ${NIGHTS} holds about 34000s of tests, and leaves a shard at about ${FULL_FIXED + 4000}s, over the ${NIGHTLY_CEILING}s ceiling\\. Its heaviest group is chromium s\\d+ visual\\.spec\\.ts, at about 2000s\\.$`,
    ),
  );
  // A release shard holds two such groups on each worker; one more is over.
  const release = 4 * RELEASE_SHARDS;
  assert.equal(
    releasePlan(synthetic(release, 2000), durations, RELEASE_SHARDS).shards.length,
    RELEASE_SHARDS,
  );
  assert.throws(
    () => releasePlan(synthetic(release + 1, 2000), durations, RELEASE_SHARDS),
    new RegExp(
      `^Error: The release plan in ${RELEASE_SHARDS} shards leaves a shard at about ${FULL_FIXED + 6000}s, over the ${RELEASE_CEILING}s ceiling\\. Its heaviest group is chromium s\\d+ cells\\.spec\\.ts, at about 2000s\\.$`,
    ),
  );
  // It names the heaviest group of the slowest shard, not the last or the lightest.
  const mixed = [...synthetic(6, 1900), { ...synthetic(1, 100)[0]!, project: 'chromium light' }];
  assert.throws(
    () => releasePlan(mixed, durations, 1),
    /about 6220s, over the 4800s ceiling\. Its heaviest group is chromium s\d+ cells\.spec\.ts, at about 1900s\.$/,
  );
  // A group too heavy for one worker that can't split fails, by name.
  assert.throws(
    () => nightlyPlan(synthetic(1, FULL_GROUP_BUDGET + 1, PERF_SPEC), durations),
    new RegExp(
      `chromium s0 perf\\.spec\\.ts takes about ${FULL_GROUP_BUDGET + 1}s, over the ${FULL_GROUP_BUDGET}s one worker has in a shard, and only a cell group splits`,
    ),
  );
  // As run.ts plans a shard, from the real plan: a perf cell measured far slower is over, and Playwright never starts.
  const slow = { ...loadDurations(), perf: FULL_GROUP_BUDGET };
  for (const [tonight, shard] of [
    ['2026-10-24', `1/${FULL_SHARDS}`],
    [null, `1/${RELEASE_SHARDS}`],
  ] as const) {
    assert.throws(
      () => fullShard(plan, ENGINES, shard, tonight, slow),
      /^Error: chromium [0-9a-f]{10} perf\.spec\.ts takes about \d+s, over the \d+s/,
      String(tonight),
    );
    const planned = planFullRun(plan, ENGINES, { mode: 'full', shard, night: tonight }, slow);
    assert.equal(planned.budget?.rule, 'plan-budget');
    assert.match(planned.budget!.message, /perf\.spec\.ts takes about/);
    assert.equal(planned.full, null);
    assert.equal(runsPlaywright([], planned.budget), false);
  }
  // Within budget, Playwright runs when every engine launches.
  const within = planFullRun(plan, ENGINES, {
    mode: 'full',
    shard: `2/${FULL_SHARDS}`,
    night: '2026-10-24',
  });
  assert.equal(within.budget, null);
  assert.ok(within.record.slice);
  assert.equal(runsPlaywright([], within.budget), true);
  assert.equal(runsPlaywright([{ engine: 'chromium' }], within.budget), false);
  // A PR run, or an unsharded full run, keeps the plan whole.
  for (const options of [
    { mode: 'pr', shard: '1/2', night: null },
    { mode: 'full', shard: null, night: null },
  ] as const) {
    const whole = planFullRun(plan, ENGINES, options);
    assert.equal(whole.full, null);
    assert.equal(whole.record.slice, undefined);
  }
});

test('the slice is a pure function of the date and the plan', () => {
  assert.equal(dayNumber('1970-01-01'), 0);
  assert.equal(dayNumber('2026-10-24'), 20750);
  assert.equal(nightSlice('2026-10-24'), 20750 % NIGHTS);
  for (let day = 0; day < 2 * NIGHTS; day += 1) {
    assert.equal(nightSlice(night(day)), (20750 + day) % NIGHTS);
  }
  // The same night and plan, planned again, as each shard's process plans it, is the same shard.
  for (const shard of ['1/8', '5/8', null]) {
    const first = fullShard(plan, ENGINES, shard, '2026-10-24');
    const again = fullShard(structuredClone(plan), ENGINES, shard, '2026-10-24');
    assert.deepEqual(JSON.parse(JSON.stringify(again)), JSON.parse(JSON.stringify(first)));
    assert.deepEqual([...again.projects].sort(), [...first.projects].sort());
  }
  // The fingerprint names the plan: a change to the plan changes it.
  assert.equal(planFingerprint(structuredClone(plan)), planFingerprint(plan));
  assert.notEqual(planFingerprint({ tests: plan.tests.slice(1) }), planFingerprint(plan));
  assert.equal(
    fullShard(plan, ENGINES, '1/8', '2026-10-24').slice!.fingerprint,
    planFingerprint(plan),
  );
  // A night's shards list the same projects: every one any of its groups runs in.
  const shards = Array.from(
    { length: FULL_SHARDS },
    (_, at) => fullShard(plan, ENGINES, `${at + 1}/8`, '2026-10-24').shard,
  );
  const listed = fullShard(plan, ENGINES, '1/8', '2026-10-24').projects;
  assert.deepEqual([...listed].sort(), [...runProjects(shards)].sort());
  // The whole slice on one machine runs the same groups as its shards between them.
  const local = fullShard(plan, ENGINES, null, '2026-10-24');
  assert.deepEqual(
    local.shard.groups.map(groupKey).sort(),
    shards
      .flatMap((each) => each.groups)
      .map(groupKey)
      .sort(),
  );
  for (const bad of ['2026-02-30', '2026-1-1', '24-10-2026', '']) {
    assert.throws(() => dayNumber(bad), /UTC date/, bad);
  }
});

test("a night's plan record is its slice's, visual tests included, so the merge judges the night against it, and a release refuses it", (t) => {
  const full = fullShard(plan, ENGINES, '1/8', '2026-10-24');
  const tonight = full.slice!;
  const record = sliceRecord(planRecord(plan), plan, tonight, ENGINES, full.tonight!);
  const ran = new Set(
    Array.from({ length: FULL_SHARDS }, (_, at) =>
      fullShard(plan, ENGINES, `${at + 1}/8`, '2026-10-24').shard.groups.flatMap((group) =>
        group.tests.map((key) => JSON.stringify((JSON.parse(key) as string[]).slice(0, 3))),
      ),
    ).flat(),
  );
  assert.ok(record.planned.length > 0 && record.planned.length < plan.tests.length);
  // Exactly the tests tonight's shards run between them.
  assert.deepEqual(
    record.planned.map((each) => JSON.stringify([each.cell, each.viewport, each.row])).sort(),
    [...ran].sort(),
  );
  assert.equal(record.tests, record.planned.length);
  assert.deepEqual(record.slice, tonight);
  // The night's visual tests: those its visual groups run, which a whole run's record holds every one of.
  assert.deepEqual(planRecord(plan).visual, plannedVisual(plan));
  assert.deepEqual(
    record.visual,
    plannedVisual(plan).filter((each) => full.tonight!.visual.has(each.cell)),
  );
  assert.ok(
    [...full.tonight!.visual].every((cell) => tonight.rotation[cell]!.includes(tonight.index)),
    "a visual cell's bucket 0 runs tonight too",
  );
  // The perf cells stay whole, since every night runs them.
  assert.deepEqual(record.perf, planRecord(plan).perf);
  // A target whose cells all run another night, or only skip tonight, isn't tonight's to answer for.
  const three = {
    ...planRecord(plan),
    targets: [
      { kind: 'composition' as const, id: 'a' },
      { kind: 'composition' as const, id: 'b' },
      { kind: 'composition' as const, id: 'c' },
    ],
    planned: [
      ['composition:a x', null],
      ['composition:b y', null],
      ['composition:c z', 'It needs a state no fixture has yet.'],
    ].map(([cell, skip]) => ({
      cell: cell!,
      viewport: '1440x900',
      row: 'default',
      skip: skip ?? null,
      engineSkips: {},
      conditions: true,
    })),
  };
  const owners = {
    cells: [
      { id: 'composition:a x', kind: 'composition', target: 'a' },
      { id: 'composition:b y', kind: 'composition', target: 'b' },
      { id: 'composition:c z', kind: 'composition', target: 'c' },
    ],
  } as unknown as Pick<Plan, 'cells'>;
  const onlyA = sliceRecord(three, owners, tonight, ENGINES, {
    tests: new Set(
      ['composition:a x', 'composition:c z'].map((cell) =>
        JSON.stringify([cell, '1440x900', 'default']),
      ),
    ),
    visual: new Set(),
  });
  assert.deepEqual(onlyA.targets, [{ kind: 'composition', id: 'a' }]);
  assert.deepEqual(
    onlyA.planned.map((each) => each.cell),
    ['composition:a x', 'composition:c z'],
  );

  // The merge holds a night's shards to their slice, visual tests included.
  const root = mkdtempSync(path.join(tmpdir(), 'quality-full-slice-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const visualTest = cellTest(ALSO_RUNS, {
    title: 'fallback complete at 1440x900, seeded, in the pinned image',
    file: 'tests/quality/visual.spec.ts',
    kind: 'visual',
    viewport: '1440x900',
    row: undefined,
    checks: [...KIND_CHECKS.visual],
  });
  writeShards(root, [SHARD_1, { ...SHARD_2, tests: [...SHARD_2.tests, visualTest] }]);
  const slice: NightSlice = {
    night: '2026-10-24',
    index: 3,
    nights: NIGHTS,
    fingerprint: '0123456789abcdef',
    cells: [CELL],
    rotation: { [CELL]: [3] },
  };
  const visual = [{ cell: CELL, viewport: '1440x900' }];
  const sliced = readShards(root).map((shard) => ({
    ...shard,
    plan: { ...shard.plan!, visual, slice },
  }));
  const night = mergeShards(sliced, { expected: 2, mode: 'full' });
  assert.ok(night.ok, JSON.stringify(night.failures));
  // A visual group the night dropped fails it.
  const dropped = sliced.map((shard) =>
    shard.summary
      ? {
          ...shard,
          summary: {
            ...shard.summary,
            tests: shard.summary.tests.filter((test) => test.kind !== 'visual'),
          },
        }
      : shard,
  );
  const missing = mergeShards(dropped, { expected: 2, mode: 'full' });
  assert.deepEqual(
    missing.failures.map((each) => each.rule),
    ['visual-coverage'],
  );
  assert.match(missing.failures[0]!.message, /at 1440x900 on chromium is planned, and didn't run/);
  // A visual test the plan doesn't have is a stray.
  const stray = mergeShards(
    sliced.map((shard) => ({ ...shard, plan: { ...shard.plan, visual: [] } })),
    { expected: 2, mode: 'full' },
  );
  assert.match(stray.failures.map((each) => each.message).join('\n'), /no such visual test/);
  // A release refuses the slice.
  const refused = mergeShards(sliced, { expected: 2, mode: 'full', whole: true });
  assert.deepEqual(
    refused.failures.map((each) => each.rule),
    ['not-whole'],
  );
  assert.match(
    refused.failures[0]!.message,
    new RegExp(`the night of 2026-10-24's slice, 3 of ${NIGHTS}`),
  );
  // Two nights' shards aren't one run.
  const mixed = sliced.map((shard, at) =>
    at === 0
      ? shard
      : { ...shard, plan: { ...shard.plan, slice: { ...slice, night: '2026-10-25' } } },
  );
  assert.ok(
    mergeShards(mixed, { expected: 2, mode: 'full' }).failures.some(
      (each) => each.rule === 'shard-mismatch',
    ),
  );
});

test('a project whose cell group is split still runs its visual tests, as it does its perf tests', () => {
  const key = testKey('composition:x a / tuple', '1440x900', 'default', 'chromium');
  const grep = projectGrep('abc', [key]);
  assert.equal(grep.test(`x complete at 1440x900 @server-abc ${VISUAL_TAG}`), true);
  assert.equal(grep.test(`x complete at 1440x900 @server-abd ${VISUAL_TAG}`), false);
  assert.equal(grep.test(`x @server-abc ${VISUAL_TAG}s`), false, 'only the tag itself');
  const [cell, viewport, row] = JSON.parse(key) as string[];
  assert.equal(grep.test(`x @server-abc ${testTag(cell!, viewport!, row!)}`), true);
  const spec = readFileSync(new URL('./visual.spec.ts', import.meta.url), 'utf8');
  assert.match(spec, /tag: \[tag, VISUAL_TAG\]/);
  assert.match(spec, /const cells = visualCells\(plan\);/);
});

test("the night's rotation report: which night ran, the plan's fingerprint, each cell's nights and result tonight, and the nights it was scheduled", () => {
  // 2026-10-26 is day 20752, so of three nights it runs the second.
  assert.equal(nightSlice('2026-10-26', 3), 1);
  const slice: NightSlice = {
    night: '2026-10-26',
    index: 2,
    nights: 3,
    fingerprint: 'feedfacecafebeef',
    cells: ['b', 'c', 'e'],
    rotation: { a: [1], b: [2], c: [2], d: [3], e: [1, 2] },
  };
  assert.deepEqual(rotationNights(slice, 1), { last: '2026-10-25', next: '2026-10-28' });
  assert.deepEqual(rotationNights(slice, 2), { last: '2026-10-26', next: '2026-10-29' });
  assert.deepEqual(rotationNights(slice, 3), { last: '2026-10-24', next: '2026-10-27' });
  const report = rotationReport(slice, [
    { cell: 'b', kind: 'cell', outcome: 'expected' },
    { cell: 'b', kind: 'visual', outcome: 'expected' },
    { cell: 'c', kind: 'cell', outcome: 'expected' },
    { cell: 'c', kind: 'cell', outcome: 'unexpected' },
    { cell: 'e', kind: 'cell', outcome: 'expected' },
    { cell: 'a', kind: 'perf', outcome: 'expected' },
  ]);
  assert.equal(report.slice, 2);
  assert.equal(report.nights, 3);
  assert.equal(report.fingerprint, 'feedfacecafebeef');
  assert.deepEqual(report.cycle, { from: '2026-10-25', to: '2026-10-27' });
  assert.deepEqual(
    report.cells.map(({ cell, nights, tonight, lastPassed }) => [
      cell,
      nights,
      tonight,
      lastPassed,
    ]),
    [
      ['a', [1], null, null],
      ['b', [2], 'passed', '2026-10-26'],
      ['c', [2], 'failed', null],
      ['d', [3], null, null],
      // Tonight's tests of e passed, and the rest ran on night 1: when all of e last passed is unknown.
      ['e', [1, 2], 'passed', null],
    ],
  );
  assert.equal(report.cells[0]!.scheduledLast, '2026-10-25');
  assert.equal(report.cells[3]!.scheduledNext, '2026-10-27');
  // A cell on two nights: the later of their last turns, and the sooner of their next.
  assert.equal(report.cells[4]!.scheduledLast, '2026-10-26');
  assert.equal(report.cells[4]!.scheduledNext, '2026-10-28');
  // It says plainly what scheduledLast is, and why it can't read an earlier night's results.
  assert.match(report.note, /actions: read/);
  assert.match(
    report.note,
    /scheduledLast is the last night the rotation scheduled the cell, which is no proof/,
  );
  assert.match(report.note, /up to four nights/);
  // The cycle starts on the night whose slice is the first.
  assert.equal(nightSlice(report.cycle.from, 3), 0);
});

test("a cell's tests may run on several nights, and a test on two is refused, so every test runs once a cycle", () => {
  const shard = (tests: string[]): PrShard[] => [
    {
      index: 1,
      count: 1,
      weight: 1,
      groups: [{ project: 'p', file: CELL_SPEC, tests, weight: 1 }],
    },
  ];
  const a = (row: string) => testKey('composition:x a / tuple', '1440x900', row, 'chromium');
  const cells = { cells: [{ id: 'composition:x a / tuple' }] } as unknown as Pick<Plan, 'cells'>;
  assert.deepEqual(cellRotation(cells, [shard([a('default')]), shard([a('print')])]), {
    'composition:x a / tuple': [1, 2],
  });
  assert.throws(
    () => cellRotation(cells, [shard([a('default')]), shard([a('default')])]),
    /The test .*composition:x a \/ tuple.* runs on nights 1 and 2\./,
  );
});

test("every run in the pinned image writes the image's fonts for fonts.txt's bootstrap, whatever its tests", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-full-fonts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fonts = () => ['/usr/share/fonts/a.ttf: A:style=Regular'];
  assert.equal(writeObservedFonts(dir, {}, fonts), null);
  assert.equal(existsSync(path.join(dir, 'fonts.observed.txt')), false);
  const file = writeObservedFonts(dir, { QUALITY_CONTAINER: VISUAL_IMAGE }, fonts)!;
  assert.equal(file, path.join(dir, 'fonts.observed.txt'));
  assert.match(readFileSync(file, 'utf8'), /\/usr\/share\/fonts\/a\.ttf: A:style=Regular\n$/);
  // run.ts writes it before it plans, and the visual spec no longer does.
  const run = readFileSync(new URL('./run.ts', import.meta.url), 'utf8');
  assert.match(run, /writeObservedFonts\(quality\)/);
  const spec = readFileSync(new URL('./visual.spec.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(spec, /writeFileSync/);
});

test('a test waits at most N nights between runs, and across a change of N at most the larger N, since the nights nest', () => {
  const groups = bucketGroups(fullGroups(plan, ENGINES)).filter(rotates);
  /** The longest a group waits between runs, around a switch from `before` nights to `after`. */
  const longest = (before: number, after: number) => {
    let worst = 0;
    for (let day = 20750; day < 20750 + 2 * (before + after); day += 1) {
      for (const group of groups) {
        let last = day - 1;
        while (last % before !== groupNight(group, before)) last -= 1;
        let next = day;
        while (next % after !== groupNight(group, after)) next += 1;
        worst = Math.max(worst, next - last);
      }
    }
    return worst;
  };
  assert.equal(longest(NIGHTS, NIGHTS), NIGHTS);
  assert.ok(longest(NIGHTS, 2 * NIGHTS) <= 2 * NIGHTS, 'doubling');
  assert.ok(longest(2 * NIGHTS, NIGHTS) <= 2 * NIGHTS, 'halving');
  assert.ok(longest(4 * NIGHTS, NIGHTS) <= 4 * NIGHTS, 'two steps down');
});

test('N and the release shard count are the fewest that fit, a doubling only splits each night in two, and a plan past 56 nights or 128 shards fails', () => {
  const durations = { group: 5 };
  // Visual groups of 2,000 s, as many as it takes for each step to fail before the next fits.
  const visual = (count: number) => synthetic(count, 2000, VISUAL_SPEC, (at) => `chromium v${at}`);
  for (const count of [40, 160, 320]) {
    const { nights } = rotationFor(visual(count), durations);
    assert.ok(NIGHT_COUNTS.includes(nights));
    // It fits, and the cycle before it doesn't.
    nightlyPlan(visual(count), durations, FULL_SHARDS, nights);
    const before = NIGHT_COUNTS[NIGHT_COUNTS.indexOf(nights) - 1];
    if (before !== undefined) {
      assert.throws(
        () => nightlyPlan(visual(count), durations, FULL_SHARDS, before),
        /^Error: Night \d+ of/,
      );
    }
  }
  assert.ok(rotationFor(visual(320), durations).nights > NIGHTS);
  assert.throws(
    () => rotationFor(visual(2000), durations),
    /^Error: Even 56 nights don't fit, past the longest cycle \(MAX_NIGHTS\): Night \d+ of 56 holds about \d+s of tests, .* Its heaviest group is chromium v\d+ visual\.spec\.ts, at about 2000s\.$/,
  );
  // The release: 2,000 s groups, two on each worker of a shard.
  for (const [count, shards] of [
    [4 * 32, 32],
    [4 * 32 + 1, 64],
    [4 * 64 + 1, 128],
  ] as const) {
    assert.equal(releaseFor(synthetic(count, 2000), durations).count, shards, String(count));
  }
  assert.throws(
    () => releaseFor(synthetic(4 * 128 + 1, 2000), durations),
    /^Error: Even 128 release shards don't fit \(MAX_RELEASE_SHARDS\): The release plan in 128 shards leaves a shard at about \d+s, over the 4800s ceiling\. Its heaviest group is chromium s\d+ cells\.spec\.ts, at about 2000s\.$/,
  );
  // Each count is the last doubled, and a group's night at 2N is its night at N, or that plus N.
  NIGHT_COUNTS.slice(1).forEach((nights, at) => assert.equal(nights, 2 * NIGHT_COUNTS[at]!));
  RELEASE_COUNTS.slice(1).forEach((shards, at) => assert.equal(shards, 2 * RELEASE_COUNTS[at]!));
  const groups = bucketGroups(fullGroups(plan, ENGINES)).filter(rotates);
  for (const nights of NIGHT_COUNTS.slice(0, -1)) {
    for (const group of groups) {
      assert.equal(
        groupNight(group, 2 * nights) % nights,
        groupNight(group, nights),
        groupKey(group),
      );
    }
  }
  // So a night of the doubled cycle runs some of the old night's groups, and nothing else.
  for (const day of [20750, 20751, 20757]) {
    for (const group of groups) {
      if (day % (2 * NIGHTS) === groupNight(group, 2 * NIGHTS)) {
        assert.equal(day % NIGHTS, groupNight(group, NIGHTS));
      }
    }
  }
  const docs = readFileSync(new URL('../../CONTRIBUTING.md', import.meta.url), 'utf8');
  assert.match(docs, /N is always 7·2\^k, so nights nest/);
});

test("run.ts plans from the reference host's registry, and checks the budget, before it builds the host", () => {
  const run = readFileSync(new URL('./run.ts', import.meta.url), 'utf8');
  const main = run.slice(run.indexOf('async function main('));
  const planned = main.indexOf('planFullRun(plan, engines, options)');
  const built = main.indexOf('if (build && budget === null) build();');
  assert.ok(planned > 0 && built > planned, 'the budget is checked, then the host built');
  assert.ok(main.indexOf('runsPlaywright(missing, budget)') > built);
});

test('the reference host generates its registry and builds with one env, the quality flags, so the run tests the plan it budgeted', (t) => {
  const calls: { step: string; host: string; env?: Record<string, string> }[] = [];
  const work = mkdtempSync(path.join(tmpdir(), 'quality-full-host-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const host = externalVariantHost(
    {
      install: (dir) => {
        calls.push({ step: 'install', host: dir });
        return { host: path.join(dir, 'host'), store: '' } as ReturnType<ReferenceSteps['install']>;
      },
      generate: (dir, env) => calls.push({ step: 'generate', host: dir, env }),
      build: (dir, env) => calls.push({ step: 'build', host: dir, env }),
      remove: (dir) => calls.push({ step: 'remove', host: dir }),
    },
    work,
  );
  assert.deepEqual(
    calls.map((each) => each.step),
    ['install', 'generate'],
    'it plans before it builds',
  );
  host.build();
  host.remove();
  const generate = calls.find((each) => each.step === 'generate')!;
  const build = calls.find((each) => each.step === 'build')!;
  assert.equal(generate.host, build.host);
  assert.deepEqual(generate.env, { ...QUALITY_BUILD_ENV });
  assert.deepEqual(build.env, generate.env);
  assert.deepEqual(host.env, generate.env);
  assert.deepEqual(Object.keys(generate.env!).sort(), [
    'APPEARANCE_FIXTURES',
    'BUDGET_FIXTURES',
    'QUALITY_FIXTURES',
  ]);
  assert.equal(host.web, path.join(work, 'host', 'apps', 'web'));
});

test("full-plan.ts writes the plan's own release count, matrix, and cycle to GITHUB_OUTPUT, and removes its host however it ends", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-full-plan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'output');
  const web = fileURLToPath(new URL('../../apps/web/', import.meta.url));
  let removed = 0;
  const lines: string[] = [];
  const status = await runFullPlan({
    host: { web, remove: () => (removed += 1) },
    env: { GITHUB_OUTPUT: output },
    log: (line) => lines.push(line),
    fail: (line) => lines.push(line),
  });
  assert.equal(status, 0, lines.join('\n'));
  assert.equal(removed, 1);
  // What this checkout's plan gives, worked out here on its own.
  const groups = fullGroups(await loadPlan({ QUALITY_WEB: web, QUALITY_MODE: 'full' }), ENGINES);
  const { count } = releaseFor(groups);
  const { nights } = rotationFor(groups);
  assert.equal(
    readFileSync(output, 'utf8'),
    `count=${count}\nshards=${JSON.stringify(Array.from({ length: count }, (_, at) => at + 1))}\nnights=${nights}\n`,
  );
  assert.match(
    lines.join('\n'),
    new RegExp(`the release in ${count} shards.*a ${nights}-night cycle`),
  );
  // A host it can't plan from fails, writes nothing, and is still removed.
  const missing = path.join(dir, 'missing-output');
  const failed = await runFullPlan({
    host: { web: path.join(dir, 'no-web'), remove: () => (removed += 1) },
    env: { GITHUB_OUTPUT: missing },
    log: (line) => lines.push(line),
    fail: (line) => lines.push(line),
  });
  assert.equal(failed, 1);
  assert.equal(removed, 2);
  assert.equal(existsSync(missing), false);
});

test("a release shard runs the count it's handed, and a count too small for the ceiling fails rather than taking another", () => {
  // The count rc-quality-plan worked out is the one each shard plans with.
  const { count } = releaseFor(fullGroups(plan, ENGINES));
  const handed = fullShard(plan, ENGINES, `1/${count}`, null);
  assert.equal(handed.shard.count, count);
  assert.equal(runProjects([handed.shard]).size > 0, true);
  // Two shards can't hold today's plan within the ceiling: the shard fails, naming its heaviest group.
  assert.throws(
    () => fullShard(plan, ENGINES, '1/2', null),
    /^Error: The release plan in 2 shards leaves a shard at about \d+s, over the 4800s ceiling\. Its heaviest group is /,
  );
});
