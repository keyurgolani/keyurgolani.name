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
  groupKey,
  HARNESS_SPECS,
  harnessProject,
  loadDurations,
  PERF_SPEC,
  planGroups,
  prShard,
  serverProject,
  shardFiles,
  testKey,
  type ShardGroup,
} from './lib/pr-shards';
import { loadRegistrations, type Registrations } from './lib/registration';
import { cellServer, planServers, serverId } from './lib/server';
import { parseRunArgs } from './run';
import { checkoutMeta, withTierPacks } from './plan-fixtures';

// quality:pr's shards (lib/pr-shards.ts): every shard plans the whole PR set
// and runs only its own test groups, so the shards' tests are the unsharded
// run's tests, each exactly once.

const ENGINES = RUN_ENGINES.pr;
const CI = parse(
  readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'),
) as { jobs: Record<string, { strategy?: { matrix?: { shard?: number[] } } }> };
/** The shard count ci.yml's quality-pr matrix runs. */
const COUNT = CI.jobs['quality-pr']?.strategy?.matrix?.shard?.length ?? 0;

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

/** Every planned cell test once per engine, as the unsharded run's verdict holds it to them. */
const unsharded = (plan: Plan) =>
  plan.tests.flatMap((each) =>
    ENGINES.map((engine) => testKey(each.cell.id, each.viewport.id, each.row.id, engine)),
  );

test('ci.yml runs quality-pr in shards', () => {
  assert.ok(COUNT > 1, 'quality-pr has a shard matrix');
});

test('quality-pr runs in four shards, and gate, selected, and its verdict require every one', () => {
  const raw = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const jobs = CI.jobs as Record<string, { needs?: string[]; strategy?: unknown }>;
  // Four since the fourth composition registered: three took the slowest shard past 5 minutes.
  assert.deepEqual(CI.jobs['quality-pr']?.strategy?.matrix?.shard, [1, 2, 3, 4]);
  // Every place the job spells its count says the matrix's, and so does the verdict's --shards.
  const job = raw.slice(raw.indexOf('\n  quality-pr:\n'), raw.indexOf('\n  quality-pr-verdict:\n'));
  const spelled = [...job.matchAll(/matrix\.shard \}\}\/(\d+)/g)].map(([, count]) => Number(count));
  assert.deepEqual(spelled, [COUNT, COUNT, COUNT, COUNT]);
  assert.match(
    raw,
    new RegExp(`pnpm ci:quality-pr-verdict "\\$SHARDS" --shards ${COUNT} --mode pr`),
  );
  // gate, selected, and the verdict need the matrix job by its id, whose result
  // is a failure when any shard fails, is cancelled, or never ran, never one
  // shard by its display name.
  for (const name of ['gate', 'selected']) {
    assert.ok(jobs[name]?.needs?.includes('quality-pr'), `${name} needs quality-pr`);
    assert.ok(jobs[name]?.needs?.includes('quality-pr-verdict'), `${name} needs its verdict`);
  }
  assert.deepEqual(jobs['quality-pr-verdict']?.needs, ['changes', 'quality-pr']);
  assert.doesNotMatch(raw, /quality-pr \(\d/);
});

test("the shards' groups and cell tests union exactly to the unsharded plan's, for any count", () => {
  for (const { name, plan } of plans) {
    const groups = planGroups(plan, ENGINES);
    const all = groups.map(groupKey).sort();
    for (const count of [1, 2, 3, 4, 6, COUNT]) {
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
  const groups = planGroups(plan, ENGINES);
  const names = (shards: ReturnType<typeof assignShards>) =>
    shards.map((shard) => shard.groups.map(groupKey));
  assert.deepEqual(
    names(assignShards([...groups].reverse(), COUNT)),
    names(assignShards(groups, COUNT)),
  );
  for (let index = 1; index <= COUNT; index += 1) {
    assert.deepEqual(
      prShard(plan, ENGINES, `${index}/${COUNT}`).groups.map(groupKey),
      names(assignShards(groups, COUNT))[index - 1],
    );
  }
  assert.throws(() => assignShards([...groups, groups[0]!], COUNT), /share a project and file/);
});

test("shardFiles gives each project its own spec files, and none of another shard's", () => {
  const { plan } = plans[0]!;
  const shards = Array.from({ length: COUNT }, (_, at) =>
    prShard(plan, ENGINES, `${at + 1}/${COUNT}`),
  );
  const owners = new Map<string, number>();
  shards.forEach((shard, at) => {
    for (const [project, files] of shardFiles(shard)) {
      for (const file of files) {
        const key = `${project} ${file}`;
        assert.equal(owners.get(key), undefined, `${key} is in two shards`);
        owners.set(key, at);
      }
    }
  });
  assert.equal(owners.size, planGroups(plan, ENGINES).length);
});

/** The longest a shard's two workers take, placing its groups heaviest first on the freer worker. */
function wall(groups: readonly ShardGroup[], workers = 2): number {
  const load = Array.from({ length: workers }, () => 0);
  for (const group of [...groups].sort((a, b) => b.weight - a.weight)) {
    const freer = load.indexOf(Math.min(...load));
    load[freer] = load[freer]! + group.weight;
  }
  return Math.max(...load);
}

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

test("the measured weights keep CI's PR set within about 5 minutes a shard, where Playwright's split doesn't", () => {
  const { plan } = plans[0]!;
  const groups = planGroups(plan, ENGINES);
  const shards = assignShards(groups, COUNT);
  const ours = Math.max(...shards.map((shard) => wall(shard.groups)));
  // A shard job's fixed part (container, checkout, install, the quality host's
  // build, Playwright's start) took about 95 seconds on #84 and #89.
  assert.ok(95 + ours <= 300, `the slowest shard takes about ${95 + ours}s`);
  const theirs = Math.max(...byCount(groups, COUNT).map((part) => wall(part)));
  assert.ok(ours < theirs, `by duration ${ours}s, by test count ${theirs}s`);
});

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
