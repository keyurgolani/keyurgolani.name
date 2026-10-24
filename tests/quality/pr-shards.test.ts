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
  shardWall,
  SHARD_CEILING,
  splitGroups,
  testKey,
  testTag,
  type ShardGroup,
} from './lib/pr-shards';
import { shardOutputs } from './pr-count';
import { loadRegistrations, type Registrations } from './lib/registration';
import { cellServer, planServers, serverId } from './lib/server';
import { parseRunArgs } from './run';
import { checkoutMeta, withTierPacks } from './plan-fixtures';

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
  assert.equal(pickShardCount(synthetic(16, 200), durations).count, MAX_SHARDS);
  assert.throws(
    () => pickShardCount(synthetic(17, 200), durations),
    new RegExp(
      `Even ${MAX_SHARDS} shards leave one at about 495s, over the ${SHARD_CEILING}s ceiling\\. Its heaviest group is chromium s\\d+ ${CELL_SPEC}, at about 200s\\.`,
    ),
  );
  // One fewer always breaks the ceiling: the count is the least that holds.
  for (const [groups, count] of [
    [synthetic(8, 200), 4],
    [synthetic(16, 200), 8],
  ] as const) {
    const slowest = Math.max(...assignShards(groups, count - 1).map(shardEstimate));
    assert.ok(slowest > SHARD_CEILING, `${count - 1} shards: ${slowest}s`);
  }
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
        slowest - 95 < theirs,
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
    }
  }
});

test("quality:pr takes --shard as the runner's own, and hands it to Playwright's processes by QUALITY_SHARD", () => {
  assert.deepEqual(parseRunArgs(['pr', '--', '--shard=2/3', '--grep', 'login']), {
    mode: 'pr',
    shard: '2/3',
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
