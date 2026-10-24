import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { planCells, type Plan } from './cells';
import { readChanges } from './lib/changes';
import { runShard } from './lib/env';
import { RUN_ENGINES } from './lib/matrix';
import { perfCells } from './lib/perf/plan';
import {
  assignShards,
  CELL_SPEC,
  GROUP_BUDGET,
  groupKey,
  HARNESS_SPECS,
  harnessProject,
  loadDurations,
  MAX_SHARDS,
  onPack,
  PERF_SPEC,
  PERF_TAG,
  pickShardCount,
  planGroups,
  projectGrep,
  prShard,
  serverProject,
  shardTests,
  shardEstimate,
  shardFiles,
  shardLimit,
  shardWall,
  SHARD_CEILING,
  SHARD_FIXED,
  SHARD_WORKERS,
  splitGroups,
  SWEEP_MAX_SHARDS,
  testKey,
  testTag,
  testWeight,
  type ShardGroup,
} from './lib/pr-shards';
import { QUALITY_BUILD_ENV } from './lib/build.mjs';
import { shardOutputs } from './pr-count';
import { loadRegistrations, type Registrations } from './lib/registration';
import { cellServer, planServers, serverId } from './lib/server';
import { parseRunArgs } from './run';
import { SWEEP_VIEWPORT } from './lib/sweep';
import { checkoutMeta, clone, withTierPacks } from './plan-fixtures';

/** The viewport a swept test runs at (lib/sweep.ts). */
const SWEEP_VIEWPORT_ID = SWEEP_VIEWPORT.id;

// quality:pr's shards (lib/pr-shards.ts): every shard plans the whole PR set
// and runs only its own test groups, so the shards' tests are the unsharded
// run's tests, each exactly once.

const ENGINES = RUN_ENGINES.pr;
const RAW_CI = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
interface Job {
  readonly name?: string;
  readonly if?: string;
  readonly needs?: readonly string[];
  readonly outputs?: Readonly<Record<string, string>>;
  readonly env?: Readonly<Record<string, string>>;
  readonly strategy?: { readonly matrix?: { readonly shard?: unknown } };
  readonly steps?: readonly {
    readonly id?: string;
    readonly name?: string;
    readonly run?: string;
    readonly env?: Readonly<Record<string, string>>;
  }[];
}
const CI = parse(RAW_CI) as { jobs: Record<string, Job> };

let registrations: Registrations;
const plans: { name: string; plan: Plan }[] = [];
test.before(async () => {
  registrations = await loadRegistrations();
  const meta = withTierPacks(checkoutMeta());
  const changed = readChanges(meta, {
    QUALITY_CHANGED_FILES: JSON.stringify(['packages/fallback-composition/src/index.tsx']),
  }).changes;
  plans.push(
    { name: 'the PR set', plan: planCells({ meta, registrations, mode: 'pr' }) },
    {
      name: 'the PR set with a changed variant',
      plan: planCells({ meta, registrations, mode: 'pr', changes: changed }),
    },
    {
      name: "the checkout's PR set, no tier packs",
      plan: planCells({ meta: checkoutMeta(), registrations, mode: 'pr' }),
    },
  );
  // A PR that changes one non-default stable pack: the [37] rule runs every
  // variant on it, each cell a pack cell at the measured pack weights.
  const language = meta.PACKS!.find((pack) => pack.kind === 'design-language' && !pack.fixture)!;
  const onePack = {
    ...meta,
    PACKS: [...meta.PACKS!, clone(language, 'second-language', 'stable', false)],
  };
  const packPlan = planCells({
    meta: onePack,
    registrations,
    mode: 'pr',
    changes: [{ axis: 'designLanguage', id: 'second-language', paths: [] }],
  });
  assert.ok(
    packPlan.cells.some((cell) => cell.changed && onPack(cell.tuple)),
    'the changed pack directs pack cells',
  );
  plans.push({ name: 'the PR set with one changed non-default pack', plan: packPlan });
  // And the same after a fifth composition registers (#17): every variant runs on the changed pack.
  const base = onePack.VARIANTS.find(({ manifest }) => manifest.id === 'obsidian-atelier')!;
  const fifth = {
    ...onePack,
    VARIANTS: [
      ...onePack.VARIANTS,
      { ...base, manifest: { ...base.manifest, id: 'fifth-composition', name: 'Fifth' } },
    ],
  };
  // Its quality unit, as every composition's: the same as Obsidian Atelier's.
  const unit = registrations.units.find(({ id }) => id === 'obsidian-atelier')!;
  const fifthPlan = planCells({
    meta: fifth,
    registrations: {
      ...registrations,
      units: [...registrations.units, { ...unit, id: 'fifth-composition' }],
    },
    mode: 'pr',
    changes: [{ axis: 'designLanguage', id: 'second-language', paths: [] }],
  });
  assert.ok(
    fifthPlan.targets.some((target) => target.id === 'fifth-composition'),
    'the fifth composition is planned',
  );
  plans.push({
    name: 'a fifth composition, and one changed non-default pack',
    plan: fifthPlan,
  });
});

/** The count the planner picks for the PR set, as quality-pr-plan emits it. */
const picked = () => pickShardCount(planGroups(plans[0]!.plan, ENGINES)).count;

/** Every planned cell test once per engine, as the unsharded run's verdict holds it to them. */
const unsharded = (plan: Plan) =>
  plan.tests.flatMap((each) =>
    ENGINES.map((engine) => testKey(each.cell.id, each.viewport.id, each.row.id, engine)),
  );

/** `count` synthetic cell groups of `weight` seconds each, none of them split. */
const synthetic = (count: number, weight: number): ShardGroup[] =>
  Array.from({ length: count }, (_, at) => ({
    project: `chromium s${at}`,
    file: CELL_SPEC,
    tests: [],
    costs: [],
    weight,
  }));

test('the count is the fewest shards the weights allow within the ceiling, and more than the most fails, naming the group', () => {
  const durations = { group: 5 };
  // 95 s fixed and two workers a shard: two 100 s groups fit one shard, and two 200 s groups a shard.
  assert.equal(pickShardCount(synthetic(2, 100), durations).count, 1);
  assert.equal(pickShardCount(synthetic(8, 200), durations).count, 4);
  assert.equal(MAX_SHARDS, 12);
  assert.equal(pickShardCount(synthetic(24, 200), durations).count, MAX_SHARDS);
  assert.throws(
    () => pickShardCount(synthetic(25, 200), durations),
    new RegExp(
      `Even ${MAX_SHARDS} shards leave one at about 495s, over the ${SHARD_CEILING}s ceiling\\. Its heaviest group is chromium s\\d+ ${CELL_SPEC}, at about 200s\\.`,
    ),
  );
  // One fewer always breaks the ceiling: the count is the least that holds.
  for (const [groups, count] of [
    [synthetic(8, 200), 4],
    [synthetic(24, 200), 12],
  ] as const) {
    const slowest = Math.max(...assignShards(groups, count - 1).map(shardEstimate));
    assert.ok(slowest > SHARD_CEILING, `${count - 1} shards: ${slowest}s`);
  }
});

test('a pack sweep adds the shards it alone needs to the usual 12, up to 16, and nothing else raises it', () => {
  const durations = { group: 5 };
  // A shard holds two 200 s groups, one a worker.
  const swept = (count: number, weight: number): ShardGroup[] =>
    synthetic(count, weight).map((group, at) => ({
      ...group,
      project: `chromium sweep${at}`,
      sweep: true,
    }));
  assert.equal(SWEEP_MAX_SHARDS, 16);
  // No sweep load: needing 14 fails at 12, naming the heaviest group.
  assert.deepEqual(shardLimit(synthetic(28, 200), durations), {
    max: MAX_SHARDS,
    sweepShards: 0,
    reason: null,
  });
  assert.throws(
    () => pickShardCount(synthetic(28, 200), durations),
    /^Error: Even 12 shards leave one at about \d+s, over the 300s ceiling\. Its heaviest group is chromium s\d+ cells\.spec\.ts, at about 200s\.$/,
  );
  // 2a's shape: a sweep that alone needs 8 beside the rest's 6, so up to 16, and 14 picked.
  const catalog = pickShardCount([...synthetic(12, 200), ...swept(16, 200)], durations);
  assert.equal(catalog.sweepShards, 8);
  assert.equal(catalog.max, 16);
  assert.equal(catalog.count, 14);
  assert.equal(
    catalog.reason,
    "the pack sweep's 16 group(s) alone need 8 shard(s), so the most is 16",
  );
  // One small pack raises the most to 13, and the count is still the fewest that fit.
  const small = [...synthetic(8, 200), ...swept(1, 50)];
  assert.deepEqual(shardLimit(small, durations), {
    max: 13,
    sweepShards: 1,
    reason: "the pack sweep's 1 group(s) alone need 1 shard(s), so the most is 13",
  });
  const fewest = pickShardCount(small, durations);
  assert.equal(fewest.count, 5);
  const fewer = Math.max(
    ...assignShards(splitGroups(small, GROUP_BUDGET, durations), 4).map(shardEstimate),
  );
  assert.ok(fewer > SHARD_CEILING, `4 shards: ${fewer}s`);
  // One pack can't make room for the rest: without the sweep it needs 13, so it fails at 12.
  assert.throws(
    () => pickShardCount([...synthetic(26, 200), ...swept(1, 50)], durations),
    /^Error: Even 12 shards leave one at about \d+s, over the 300s ceiling \(the groups outside the pack sweep, alone\)\. Its heaviest group is chromium s\d+ cells\.spec\.ts, at about 200s\.$/,
  );
  // The most is never over 16, however much the sweep needs.
  for (const count of [1, 8, 16, 24, 40]) {
    assert.ok(shardLimit(swept(count, 200), durations).max <= SWEEP_MAX_SHARDS, `${count}`);
  }
  assert.throws(
    () => pickShardCount(swept(40, 200), durations),
    /^Error: Even 16 shards leave one at about \d+s, over the 300s ceiling \(the pack sweep's 40 group\(s\) alone need more than 16 shards, so the most is 16\)\./,
  );
});

test('an ordinary PR plans 4 to 7 shards, as the base PR set plans 7, and one that changes a pack plans 7, its most 13', () => {
  for (const { name, plan } of plans.filter(({ plan }) => !plan.cells.some((cell) => cell.sweep))) {
    const { count, reason } = pickShardCount(planGroups(plan, ENGINES));
    assert.ok(count >= 4 && count <= 7, `${name}: ${count}`);
    assert.equal(reason, null, name);
  }
  const onePack = plans.find(
    ({ name }) => name === 'the PR set with one changed non-default pack',
  )!;
  const { count, sweepShards, max } = pickShardCount(planGroups(onePack.plan, ENGINES));
  assert.deepEqual({ count, sweepShards, max }, { count: 7, sweepShards: 1, max: 13 });
});

test('a cell group too heavy for one worker is split, by cell or by test, and its parts run each of its tests once', () => {
  const durations = { group: 5 };
  const viewports = ['1440x900', '1024x768', '390x844'];
  const cells = Array.from({ length: 6 }, (_, at) => `composition:x c${at} / tuple`);
  // Six cells of three 30 s tests, then a tier sentinel's like: nine 25 s tests, too heavy for one part.
  const sentinel = 'composition:fallback complete / fixture/dark';
  const rows = ['default', 'reduced-motion', 'forced-colors'];
  const tests = [
    ...cells.flatMap((cell) =>
      viewports.map((viewport) => testKey(cell, viewport, 'default', 'chromium')),
    ),
    ...viewports.flatMap((viewport) =>
      rows.map((row) => testKey(sentinel, viewport, row, 'chromium')),
    ),
  ];
  const costs = tests.map((key) => (key.includes(sentinel) ? 25 : 30));
  const heavy: ShardGroup = {
    project: 'chromium heavy',
    file: CELL_SPEC,
    tests,
    costs,
    weight: costs.reduce((sum, cost) => sum + cost, 5),
  };
  const light = synthetic(1, 50)[0]!;
  const split = splitGroups([heavy, light], GROUP_BUDGET, durations);
  // The light group is as it was; the heavy one is parts, each within one worker's share.
  assert.deepEqual(split.at(-1), light);
  const parts = split.slice(0, -1);
  assert.ok(parts.length > 3, `${parts.length} parts`);
  parts.forEach((part, at) => {
    assert.equal(groupKey(part), `chromium heavy ${CELL_SPEC} #${at + 1}`);
    assert.ok(part.weight <= GROUP_BUDGET, `${part.weight}s`);
  });
  assert.deepEqual(
    parts.flatMap((part) => part.tests),
    tests,
  );
  // A cell that fits stays in one part; the sentinel, which doesn't, spans parts.
  const partOf = (cell: string) =>
    new Set(parts.filter((part) => part.tests.some((key) => key.includes(cell))).map(groupKey));
  for (const cell of cells) assert.equal(partOf(cell).size, 1, cell);
  assert.ok(partOf(sentinel).size > 1);
  // Every count still partitions the tests, and each shard's grep takes its parts' tests alone.
  const { count, shards } = pickShardCount([heavy, light], durations);
  assert.ok(count > 1);
  assert.deepEqual(
    shards.flatMap((shard) => shard.groups.flatMap((group) => group.tests)).sort(),
    [...tests].sort(),
  );
  for (const shard of shards) {
    const mine = shardTests(shard).get('chromium heavy') ?? [];
    const grep = projectGrep('abc', mine);
    for (const key of tests) {
      const [cell, viewport, row] = JSON.parse(key) as string[];
      const title = `${cell} ${viewport} ${row} @server-abc ${testTag(cell!, viewport!, row!)}`;
      assert.equal(grep.test(title), mine.includes(key), `${key} on shard ${shard.index}`);
    }
    assert.equal(grep.test(`perf @server-abc ${PERF_TAG}`), true, 'its perf tests still run');
    const [cell, viewport, row] = JSON.parse(tests[0]!) as string[];
    assert.equal(
      grep.test(`x @server-abd ${testTag(cell!, viewport!, row!)}`),
      false,
      'another server',
    );
  }
  // A test that alone breaks the ceiling can't be split, and neither can a harness or perf group.
  const lone: ShardGroup = {
    ...heavy,
    tests: [testKey('composition:x huge / tuple', '1440x900', 'default', 'chromium')],
    costs: [250],
    weight: 255,
  };
  assert.throws(
    () => splitGroups([lone], GROUP_BUDGET, durations),
    /The test composition:x huge \/ tuple at 1440x900, default alone takes about 255s on chromium heavy, over the 205s/,
  );
  assert.throws(
    () => splitGroups([{ ...synthetic(1, 250)[0]!, file: PERF_SPEC }], GROUP_BUDGET, durations),
    /only a cell group splits/,
  );
});

test('a group split N ways goes on N shards, each part on its own, and the planner picks N', () => {
  const durations = { group: 5 };
  // Five one-test cells, 100, 100, 100, 100, and 30 s: three parts, 205, 205, and 35 s.
  const cells = [100, 100, 100, 100, 30].map((cost, at) => ({
    key: testKey(`composition:x c${at} / tuple`, '1440x900', 'default', 'chromium'),
    cost,
  }));
  const heavy: ShardGroup = {
    project: 'chromium heavy',
    file: CELL_SPEC,
    tests: cells.map((each) => each.key),
    costs: cells.map((each) => each.cost),
    weight: cells.reduce((sum, each) => sum + each.cost, 5),
  };
  // Two whole groups beside it. Heaviest first onto the lightest shard, the
  // 35 s part would land beside a 205 s part of its own file, and the two
  // would run one after another, past the ceiling.
  const others = [
    { ...synthetic(1, 190)[0]!, project: 'chromium a' },
    { ...synthetic(1, 150)[0]!, project: 'chromium b' },
  ];
  const parts = splitGroups([heavy], GROUP_BUDGET, durations);
  assert.deepEqual(
    parts.map((part) => part.weight),
    [205, 205, 35],
  );
  const { count, shards } = pickShardCount([heavy, ...others], durations);
  assert.equal(count, parts.length);
  for (const shard of shards) {
    const own = shard.groups.filter((group) => group.project === 'chromium heavy');
    assert.ok(own.length <= 1, `shard ${shard.index} holds ${own.length} parts of one file`);
    assert.ok(shardEstimate(shard) <= SHARD_CEILING, `shard ${shard.index}`);
  }
  // Every test still runs once.
  assert.deepEqual(
    shards.flatMap((shard) => shard.groups.flatMap((group) => group.tests)).sort(),
    [...heavy.tests].sort(),
  );
  // With more parts than shards, two share one, and they're still weighed one after another.
  const two = assignShards(parts, 2);
  const shared = two.find((shard) => shard.groups.length > 1)!;
  assert.equal(shardWall(shared.groups), shared.weight);
});

test("a split group's parts on one shard run on one worker, one after another, so they weigh together", () => {
  const durations = { group: 5 };
  // Two 150 s cells on one project: too heavy for a part together, so a part each.
  const tests = ['a', 'b'].map((cell) =>
    testKey(`composition:x ${cell} / tuple`, '1440x900', 'default', 'chromium'),
  );
  const twin: ShardGroup = {
    project: 'chromium twin',
    file: CELL_SPEC,
    tests,
    costs: [150, 150],
    weight: 305,
  };
  const parts = splitGroups([twin], GROUP_BUDGET, durations);
  assert.deepEqual(
    parts.map((part) => part.weight),
    [155, 155],
  );
  // On one shard they're one file in one project, which runs on one worker: 310 s, not 155 s.
  assert.equal(shardWall(parts), 310);
  assert.ok(SHARD_FIXED + shardWall(parts) > SHARD_CEILING);
  const { count, slowest } = pickShardCount([twin], durations);
  assert.equal(count, 2, `count ${count} at ${slowest}s`);
  // Different files and projects still share a shard's workers.
  assert.equal(
    shardWall([...synthetic(1, 100), { ...synthetic(1, 100)[0]!, file: PERF_SPEC }]),
    100,
  );
  // And the planner assumes as many workers as the config runs.
  assert.match(
    readFileSync(new URL('./playwright.config.ts', import.meta.url), 'utf8'),
    /\n {2}workers: SHARD_WORKERS,\n/,
  );
  assert.equal(SHARD_WORKERS, 2);
});

/** quality-pr's four shards in CI run 40066815817: each job's wall time and the tests it timed. */
interface RecordedRun {
  readonly run: number;
  readonly shards: Readonly<
    Record<
      string,
      {
        readonly jobSeconds: number;
        readonly tests: readonly {
          readonly project: string;
          readonly file: string;
          readonly cell?: string;
          readonly viewport?: string;
          readonly row?: string;
          readonly title?: string;
          readonly seconds: number;
        }[];
      }
    >
  >;
}
const RECORDED = JSON.parse(
  readFileSync(new URL('./fixtures/shard-run-40066815817.json', import.meta.url), 'utf8'),
) as RecordedRun;
/**
 * A recorded cell as this checkout plans it. The run was recorded while the
 * fallback composition carried each state's sentinel (#11); once a
 * registered composition is the plan's first, #13's Editorial Evidence, the
 * sentinels are its, the same states on the same viewports and rows, so a
 * recorded fallback state cell is that composition's.
 */
function asPlanned(cell: string, sentinel: string): string {
  const match = /^composition:fallback (\S+) (.*)$/.exec(cell);
  if (!match || match[1] === 'complete' || sentinel === 'fallback') return cell;
  return `composition:${sentinel} ${match[1]} ${match[2]!.replaceAll('fallback/', `${sentinel}/`)}`;
}

/** How far the planner's estimate of a recorded shard may be from its job's wall time. */
const RECORDED_MARGIN = 0.15;

/** The planner's estimate of a recorded shard: what it ran, weighed as planGroups() weighs it, on its workers. */
function recordedEstimate(
  shard: RecordedRun['shards'][string],
  durations: ReturnType<typeof loadDurations>,
): { estimate: number; matched: number } {
  const planned = new Map(
    plans.flatMap(({ plan }) =>
      plan.tests.map((each) => [`${each.cell.id} ${each.viewport.id} ${each.row.id}`, each]),
    ),
  );
  // The composition that carries the state sentinels in this checkout's plan.
  const sentinel =
    /^composition:(\S+) missing-media /.exec(
      [...planned.keys()].find((key) => / missing-media /.test(key)) ?? '',
    )?.[1] ?? 'fallback';
  const byFile = new Map<string, number>();
  let matched = 0;
  for (const test of shard.tests) {
    const key = `${test.project} ${test.file}`;
    let weight: number;
    if (test.file === CELL_SPEC) {
      const each = planned.get(`${asPlanned(test.cell!, sentinel)} ${test.viewport} ${test.row}`);
      if (!each) continue;
      matched += 1;
      weight = testWeight(each, ENGINES[0]!, durations);
    } else if (test.file === PERF_SPEC) {
      weight = durations.perf;
    } else {
      // A harness spec weighs as one, its total, once.
      if (byFile.has(key)) continue;
      weight = durations.harness[`tests/quality/${test.file}`] ?? 0;
    }
    byFile.set(key, (byFile.get(key) ?? durations.group) + weight);
  }
  const groups = [...byFile].map(([key, weight]) => {
    const at = key.lastIndexOf(' ');
    return { project: key.slice(0, at), file: key.slice(at + 1), tests: [], weight };
  });
  return { estimate: SHARD_FIXED + shardWall(groups), matched };
}

test("the planner's estimate of each shard of a recorded CI run is within 15% of how long its job took", () => {
  const durations = loadDurations();
  const shards = Object.entries(RECORDED.shards);
  assert.equal(shards.length, 4);
  for (const [name, shard] of shards) {
    const cells = shard.tests.filter((test) => test.file === CELL_SPEC).length;
    const { estimate, matched } = recordedEstimate(shard, durations);
    // Every cell the run timed is one this checkout still plans.
    assert.equal(matched, cells, `${name}: ${matched} of ${cells} cells planned`);
    const off = Math.abs(estimate - shard.jobSeconds) / shard.jobSeconds;
    assert.ok(
      off <= RECORDED_MARGIN,
      `${name}: planned about ${Math.round(estimate)}s, the job took ${shard.jobSeconds}s`,
    );
  }
  // Weighed as a stand-in state's, 2.4 s, a composition's complete cell would put a shard far outside it.
  const undercount = {
    ...durations,
    composition: Object.fromEntries(
      Object.keys(durations.composition).map((key) => [key, durations.plain]),
    ),
  };
  const worst = Math.max(
    ...shards.map(([, shard]) => {
      const { estimate } = recordedEstimate(shard, undercount);
      return Math.abs(estimate - shard.jobSeconds) / shard.jobSeconds;
    }),
  );
  assert.ok(
    worst > RECORDED_MARGIN,
    `weighed as plain, the worst shard is only ${Math.round(worst * 100)}% off`,
  );
});

test("CI's PR set, split and sharded at the count the planner picks, holds the ceiling, where Playwright's split doesn't", () => {
  for (const { name, plan } of plans) {
    const groups = planGroups(plan, ENGINES);
    const { count, slowest, shards } = pickShardCount(groups);
    assert.ok(count >= 1 && count <= MAX_SHARDS, `${name}: ${count}`);
    assert.ok(slowest <= SHARD_CEILING, `${name}: the slowest shard takes about ${slowest}s`);
    for (const shard of shards) assert.ok(shardEstimate(shard) <= SHARD_CEILING, name);
    if (count > 1) {
      const fewer = Math.max(...assignShards(splitGroups(groups), count - 1).map(shardEstimate));
      assert.ok(fewer > SHARD_CEILING, `${name}: ${count - 1} shards would do, at ${fewer}s`);
      const theirs = Math.max(...byCount(groups, count).map((part) => shardWall(part)));
      assert.ok(
        slowest - SHARD_FIXED < theirs,
        `${name}: by duration ${slowest}s, by test count ${theirs}s`,
      );
    }
  }
});

test('quality-pr-plan emits the count, and the matrix, the verdict, gate, and selected all read it', () => {
  const jobs = CI.jobs;
  const plan = jobs['quality-pr-plan'];
  assert.ok(plan, 'ci.yml has quality-pr-plan');
  // Selected by name, as every check job is; select-jobs.test.mjs holds every rule to select it with quality-pr.
  assert.equal(plan.if, "${{ contains(fromJSON(needs.changes.outputs.jobs), 'quality-pr-plan') }}");
  assert.deepEqual(plan.needs, ['changes']);
  const step = plan.steps?.find((each) => each.id === 'count');
  assert.match(step?.run ?? '', /tsx tests\/quality\/pr-count\.ts$/);
  assert.equal(step?.env?.QUALITY_CHANGED_BASE, 'HEAD^1');
  assert.deepEqual(plan.outputs, {
    count: '${{ steps.count.outputs.count }}',
    shards: '${{ steps.count.outputs.shards }}',
  });
  const count = '${{ needs.quality-pr-plan.outputs.count }}';
  const pr = jobs['quality-pr']!;
  assert.deepEqual(pr.needs, ['changes', 'quality-pr-plan']);
  assert.equal(pr.strategy?.matrix?.shard, '${{ fromJSON(needs.quality-pr-plan.outputs.shards) }}');
  assert.equal(pr.name, `quality-pr (\${{ matrix.shard }}/${count})`);
  const run = pr.steps?.find((each) => /pnpm ci:quality-pr /.test(each.run ?? ''));
  assert.equal(run?.env?.SHARD, `\${{ matrix.shard }}/${count}`);
  assert.equal(
    run?.env?.CI_REPRO_COMMAND,
    `pnpm ci:quality-pr --shard=\${{ matrix.shard }}/${count}`,
  );
  // No count is written down anywhere in the two jobs: it's the planner's alone.
  const block = RAW_CI.slice(
    RAW_CI.indexOf('\n  quality-pr-plan:\n'),
    RAW_CI.indexOf('\n  quality-meta:\n'),
  );
  assert.doesNotMatch(block, /matrix\.shard \}\}\/\d|--shards \d|shard: \[/);
  const verdict = jobs['quality-pr-verdict']!;
  assert.deepEqual(verdict.needs, ['changes', 'quality-pr-plan', 'quality-pr']);
  const merge = verdict.steps?.find((each) => /pnpm ci:quality-pr-verdict/.test(each.run ?? ''));
  assert.equal(merge?.env?.SHARD_COUNT, count);
  assert.match(merge?.run ?? '', /--shards "\$SHARD_COUNT"/);
  // gate and selected need the planner, the matrix job by its id, whose result
  // fails when any shard fails, is cancelled, or never ran, and the verdict.
  for (const name of ['gate', 'selected']) {
    for (const job of ['quality-pr-plan', 'quality-pr', 'quality-pr-verdict']) {
      assert.ok(jobs[name]?.needs?.includes(job), `${name} needs ${job}`);
    }
  }
  assert.doesNotMatch(RAW_CI, /quality-pr \(\d/);
  // The planner plans what the shards run: its registry takes exactly the
  // flags the quality host builds with, and neither quality-pr nor its run
  // step sets one of its own.
  const build = plan.steps?.find((each) => /build:registry --modules-only$/.test(each.run ?? ''));
  assert.deepEqual(build?.env, { ...QUALITY_BUILD_ENV });
  const flag = /^[A-Z_]+_FIXTURES$/;
  for (const env of [pr.env, ...(pr.steps ?? []).map((each) => each.env)]) {
    assert.deepEqual(
      Object.keys(env ?? {}).filter((key) => flag.test(key)),
      [],
    );
  }
  // What the planner writes is what the matrix and the verdict read.
  assert.deepEqual(shardOutputs(3), { count: '3', shards: '[1,2,3]' });
  assert.deepEqual(JSON.parse(shardOutputs(picked()).shards).length, picked());
});

test("the shards' groups and cell tests union exactly to the unsharded plan's, for any count", () => {
  for (const { name, plan } of plans) {
    const groups = splitGroups(planGroups(plan, ENGINES));
    const all = groups.map(groupKey).sort();
    for (let count = 1; count <= MAX_SHARDS; count += 1) {
      const shards = assignShards(groups, count);
      assert.equal(shards.length, count);
      const keys = shards.flatMap((shard) => shard.groups.map(groupKey));
      assert.deepEqual([...keys].sort(), all, `${name}, ${count} shards: each group once`);
      const tests = shards.flatMap((shard) => shard.groups.flatMap((group) => group.tests));
      assert.deepEqual(
        [...tests].sort(),
        unsharded(plan).sort(),
        `${name}, ${count} shards: each planned test once`,
      );
    }
  }
});

test('every project the config makes, and every spec it runs there, is one group', () => {
  for (const { name, plan } of plans) {
    const groups = planGroups(plan, ENGINES);
    const expected: string[] = [];
    for (const engine of ENGINES) {
      for (const file of HARNESS_SPECS) expected.push(`${harnessProject(engine)} ${file}`);
      const perf = new Set(perfCells(plan).map((cell) => serverId(cellServer(cell))));
      for (const { id } of planServers(plan)) {
        expected.push(`${serverProject(engine, id)} ${CELL_SPEC}`);
        if (perf.has(id)) expected.push(`${serverProject(engine, id)} ${PERF_SPEC}`);
      }
    }
    assert.deepEqual(groups.map(groupKey).sort(), expected.sort(), name);
    // Every perf cell's test is in a group, and only there: one per target on its server.
    assert.equal(
      groups.filter((group) => group.file === PERF_SPEC).length,
      new Set(perfCells(plan).map((cell) => serverId(cellServer(cell)))).size * ENGINES.length,
    );
  }
});

test('the assignment is the same on every runner, whatever order the groups come in', () => {
  const { plan } = plans[0]!;
  const count = picked();
  const groups = splitGroups(planGroups(plan, ENGINES));
  const names = (shards: ReturnType<typeof assignShards>) =>
    shards.map((shard) => shard.groups.map(groupKey));
  assert.deepEqual(
    names(assignShards([...groups].reverse(), count)),
    names(assignShards(groups, count)),
  );
  for (let index = 1; index <= count; index += 1) {
    assert.deepEqual(
      prShard(plan, ENGINES, `${index}/${count}`).groups.map(groupKey),
      names(assignShards(groups, count))[index - 1],
    );
  }
  assert.throws(() => assignShards([...groups, groups[0]!], count), /share a project and file/);
});

test("shardFiles gives each project its own spec files, and none of another shard's", () => {
  const { plan } = plans[0]!;
  const count = picked();
  const shards = Array.from({ length: count }, (_, at) =>
    prShard(plan, ENGINES, `${at + 1}/${count}`),
  );
  const owners = new Map<string, number>();
  shards.forEach((shard, at) => {
    const tests = shardTests(shard);
    for (const [project, files] of shardFiles(shard)) {
      for (const file of files) {
        // A split cell group's parts may share a file across shards, each with its own tests.
        const key = `${project} ${file}${file === CELL_SPEC && tests.has(project) ? ` ${tests.get(project)!.join(',')}` : ''}`;
        assert.equal(owners.get(key), undefined, `${key} is in two shards`);
        owners.set(key, at);
      }
    }
  });
  assert.equal(owners.size, splitGroups(planGroups(plan, ENGINES)).length);
});

/** Playwright's own --shard on the same groups: equal test counts, groups in order. */
function byCount(groups: readonly ShardGroup[], count: number): ShardGroup[][] {
  const size = (group: ShardGroup) => Math.max(1, group.tests.length);
  const total = groups.reduce((sum, group) => sum + size(group), 0);
  const sizes = Array.from(
    { length: count },
    (_, at) => Math.floor(total / count) + (at < total % count ? 1 : 0),
  );
  const out: ShardGroup[][] = sizes.map(() => []);
  let seen = 0;
  for (const group of groups) {
    let at = 0;
    for (let from = 0; at < count - 1 && seen >= from + sizes[at]!; at += 1) from += sizes[at]!;
    out[at]!.push(group);
    seen += size(group);
  }
  return out;
}

test('the weights file has every row a conditions test can plan, and a perf, harness, and group weight', () => {
  const durations = loadDurations();
  for (const spec of HARNESS_SPECS) {
    assert.ok(durations.harness[`tests/quality/${spec}`]! > 0, spec);
  }
  assert.ok(durations.perf > 0 && durations.group >= 0 && durations.plain > 0);
  for (const { plan } of plans) {
    for (const each of plan.tests) {
      if (!each.conditions || each.skip !== undefined) continue;
      if (Object.values(each.engineSkips).length > 0) continue;
      const key = `${each.viewport.id} ${each.row.id}`;
      assert.ok(durations.conditions[key]! > 0, `${key} has a measured weight`);
      if (onPack(each.cell.tuple)) {
        assert.ok(durations.pack[key]! > 0, `${key} has a measured weight on a pack cell`);
      }
    }
    for (const each of plan.tests.filter((test) => test.cell.sweep)) {
      const key = `${each.viewport.id} ${each.row.id}`;
      assert.ok(durations.sweep[key]! > 0, `${key} has a weight on a swept cell`);
    }
  }
});

test("a changed pack's cells run in each variant's sweep group, at the sweep's row weights, so a PR that changes a pack is sized by them (#20)", () => {
  const durations = loadDurations();
  const meta = withTierPacks(checkoutMeta());
  const scheme = meta.PACKS!.find((pack) => pack.kind === 'color-scheme' && !pack.fixture)!;
  const wider = {
    ...meta,
    PACKS: [
      ...meta.PACKS!,
      clone(scheme, 'second-scheme', 'stable', false),
      clone(scheme, 'third-scheme', 'stable', false),
    ],
  };
  const plan = planCells({
    meta: wider,
    registrations,
    mode: 'pr',
    changes: [
      { axis: 'colorScheme', id: 'second-scheme', paths: [] },
      { axis: 'colorScheme', id: 'third-scheme', paths: [] },
    ],
  });
  const swept = plan.cells.filter((cell) => cell.sweep);
  const variants = plan.targets.filter((target) => target.kind === 'composition');
  // Two packs against every variant, and one sweep server a variant.
  assert.equal(swept.length, 2 * variants.length);
  const servers = new Set(swept.map((cell) => serverId(cellServer(cell))));
  assert.equal(servers.size, variants.length);
  const groups = planGroups(plan, ENGINES, durations);
  for (const id of servers) {
    const group = groups.find(
      (each) => each.project === serverProject(ENGINES[0]!, id) && each.file === CELL_SPEC,
    )!;
    const tests = plan.tests.filter((each) => serverId(cellServer(each.cell)) === id);
    // Both packs, one test each, at the sweep's weight.
    assert.equal(tests.length, 2);
    const expected = tests.reduce(
      (sum, each) =>
        sum +
        (each.skip !== undefined || each.engineSkips[ENGINES[0]!] !== undefined
          ? durations.skipped
          : durations.sweep[`${each.viewport.id} ${each.row.id}`]!),
      durations.group,
    );
    assert.ok(Math.abs(group.weight - expected) < 1e-6, `${id}: ${group.weight} vs ${expected}`);
  }
  for (const cell of swept) assert.ok(onPack(cell.tuple), cell.id);
  // A pair's one test costs under half of the eleven it cost as a cell of its own.
  const sweepPair = durations.sweep[`${SWEEP_VIEWPORT_ID} default`]!;
  const cellPair = Object.values(durations.pack).reduce((sum, each) => sum + each, 0);
  assert.ok(sweepPair < cellPair / 2, `${sweepPair}s against ${cellPair}s`);
  // The platform default's tuple is no pack cell.
  assert.ok(!onPack(plan.cells.find((cell) => !cell.pack && !cell.changed)!.tuple));
});

test('a sweep group too heavy for one worker splits by pack, each pack whole in one part, and every pack runs once', () => {
  const meta = withTierPacks(checkoutMeta());
  const language = meta.PACKS!.find((pack) => pack.kind === 'design-language' && !pack.fixture)!;
  // Enough packs that one variant's sweep is more than a worker's share.
  const durations = loadDurations();
  const pair = durations.sweep[`${SWEEP_VIEWPORT_ID} default`]!;
  const count = Math.ceil(GROUP_BUDGET / pair) + 1;
  const ids = Array.from({ length: count }, (_, at) => `swept-language-${at + 1}`);
  const plan = planCells({
    meta: {
      ...meta,
      PACKS: [...meta.PACKS!, ...ids.map((id) => clone(language, id, 'stable', false))],
    },
    registrations,
    mode: 'pr',
    changes: ids.map((id) => ({ axis: 'designLanguage' as const, id, paths: [] })),
  });
  const groups = planGroups(plan, ENGINES, durations);
  const swept = plan.cells.filter((cell) => cell.sweep);
  const sweepProjects = new Set(
    swept.map((cell) => serverProject(ENGINES[0]!, serverId(cellServer(cell)))),
  );
  const heavy = groups.filter(
    (group) => sweepProjects.has(group.project) && group.weight > GROUP_BUDGET,
  );
  assert.ok(heavy.length > 0, `${count} packs make a sweep group heavier than one worker has`);
  const split = splitGroups(groups, GROUP_BUDGET, durations);
  for (const group of heavy) {
    const parts = split.filter((part) => part.project === group.project && part.file === CELL_SPEC);
    assert.ok(parts.length > 1, group.project);
    for (const part of parts) assert.ok(part.weight <= GROUP_BUDGET, `${part.weight}s`);
    // Every test of the group in exactly one part, in order: each pack is one test, so it's whole.
    assert.deepEqual(
      parts.flatMap((part) => part.tests),
      group.tests,
    );
    const cellOf = (key: string) => (JSON.parse(key) as string[])[0]!;
    for (const cell of new Set(group.tests.map(cellOf))) {
      const holding = parts.filter((part) => part.tests.some((key) => cellOf(key) === cell));
      assert.equal(holding.length, 1, `${cell} spans ${holding.length} parts`);
    }
  }
  // The shards still run every planned test once, at the count the planner picks.
  const { shards } = pickShardCount(groups, durations);
  assert.deepEqual(
    shards.flatMap((shard) => shard.groups.flatMap((group) => group.tests)).sort(),
    unsharded(plan).sort(),
  );
});

test("quality:pr takes --shard as the runner's own, and hands it to Playwright's processes by QUALITY_SHARD", () => {
  assert.deepEqual(parseRunArgs(['pr', '--', '--shard=2/3', '--grep', 'login']), {
    mode: 'pr',
    shard: '2/3',
    night: null,
    externalVariant: false,
    playwright: ['--grep', 'login'],
  });
  assert.throws(() => parseRunArgs(['pr', '--shard=4/3']), /1 <= n <= m/);
  assert.throws(() => parseRunArgs(['pr', '--shard=1/3', '--shard=2/3']), /twice/);
  assert.equal(runShard({}), null);
  assert.equal(runShard({ QUALITY_SHARD: '' }), null);
  assert.equal(runShard({ QUALITY_SHARD: '3/3' }), '3/3');
  assert.throws(() => runShard({ QUALITY_SHARD: '0/3' }), /QUALITY_SHARD/);
});

test("a project's grep finds its tests whatever their titles hold, a newline included", () => {
  const key = testKey('composition:x a / tuple', '1440x900', 'default', 'chromium');
  const grep = projectGrep('abc', [key]);
  const tag = testTag('composition:x a / tuple', '1440x900', 'default');
  assert.equal(grep.test(`a title\nover two lines @server-abc ${tag}`), true);
  assert.equal(grep.test(`a title\nover two lines @server-abc ${PERF_TAG}`), true);
  assert.equal(grep.test(`a title\nover two lines @server-abd ${tag}`), false);
});
