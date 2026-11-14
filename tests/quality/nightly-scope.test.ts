import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PLATFORM_DEFAULTS } from '../../packages/appearance/src/index';
import { planCells, type Plan } from './cells';
import { TUPLE_AXES, type Tuple } from './coverage';
import * as fullShards from './lib/full-shards';
import {
  FULL_FIXED,
  fullEstimate,
  fullGroups,
  RELEASE_PACE,
  releaseDurations,
  rotationFor,
  TIMEOUT_MARGIN,
} from './lib/full-shards';
import { RUN_ENGINES } from './lib/matrix';
import * as nightly from './lib/nightly-scope';
import { loadRegistrations, type Registrations } from './lib/registration';
import { loadPlan } from './plan';
import { checkoutMeta } from './plan-fixtures';

// The nightly's scope (lib/nightly-scope.ts, row 151, the coordinator's (b1)): cut from the
// reachable plan, every public composition's default-pack pairs at 390 and 1440 and the whole
// pairwise array at 1440, default row, with the every-night harness, perf and visual groups, in a
// 7-night cycle at 12 shards of 120 minutes, by the release's measured weights and pace.

const ENGINES = RUN_ENGINES.full;
const WEB = fileURLToPath(new URL('../../apps/web/', import.meta.url));

const pairsOf = (tuple: Tuple) =>
  TUPLE_AXES.flatMap((a, i) =>
    TUPLE_AXES.slice(i + 1).map((b) => `${a}=${tuple[a]} × ${b}=${tuple[b]}`),
  );

let registrations: Registrations;
let reachable: Plan;
let night: Plan;
test.before(async () => {
  registrations = await loadRegistrations();
  reachable = planCells({
    meta: checkoutMeta(),
    registrations,
    mode: 'full',
    scope: 'reachable',
  });
  night = nightly.nightlyScope(reachable);
});

/** The nightly's rotation at `shards`, by the release's weights, as each night plans it. */
const rotation = (shards: number) => {
  const weights = releaseDurations();
  return rotationFor(fullGroups(night, ENGINES, weights), weights, shards);
};

test('the nightly runs 12 shards of 120 minutes, its ceiling fitted at the release pace', () => {
  assert.equal(fullShards.FULL_SHARDS, 12);
  assert.equal(fullShards.NIGHTLY_TIMEOUT_MINUTES, 120);
  assert.equal(
    fullShards.NIGHTLY_CEILING,
    fullShards.fitReleaseCeiling(RELEASE_PACE, fullShards.NIGHTLY_TIMEOUT_MINUTES),
  );
});

test('(b1) every (c′) pair is in a test the 7-night cycle runs', () => {
  const cycle = rotation(16);
  assert.equal(cycle.nights, 7);
  // Every test of the cycle, by key, once: the cells whose tests run in the 7 nights.
  const keys = cycle.slices.flat().flatMap((shard) => shard.groups.flatMap((g) => g.tests));
  const cells = new Set(keys.map((key) => (JSON.parse(key) as string[])[0]!));
  const run = night.cells.filter((cell) => cells.has(cell.id));
  const covered = new Set(
    run.filter((c) => c.kind === 'composition').flatMap((c) => pairsOf(c.tuple)),
  );
  // (c′)'s pairs: every pair its composition cells hold, which reachable-scope.test.ts proves is
  // every reachable pair.
  const wanted = new Set(
    reachable.cells.filter((c) => c.kind === 'composition').flatMap((c) => pairsOf(c.tuple)),
  );
  const missing = [...wanted].filter((pair) => !covered.has(pair));
  assert.deepEqual(missing, [], `${missing.length} (c′) pair(s) outside the cycle`);
  // And every nightly test runs once in the cycle.
  assert.equal(keys.length, new Set(keys).size);
  assert.equal(keys.length, night.tests.length);
});

test('(b1) each of the 7 nights fits the ceiling at 12 shards, and its slowest shard ends within 120 minutes at the release pace', () => {
  const cycle = rotation(fullShards.FULL_SHARDS);
  assert.equal(cycle.slices.length, 7);
  for (const [at, slice] of cycle.slices.entries()) {
    assert.equal(slice.length, 12);
    for (const shard of slice) {
      const estimate = fullEstimate(shard);
      assert.ok(
        estimate <= fullShards.NIGHTLY_CEILING,
        `night ${at + 1}: ${Math.round(estimate)}s`,
      );
      const seconds = RELEASE_PACE.overheadSeconds + RELEASE_PACE.pace * (estimate - FULL_FIXED);
      assert.ok(seconds * TIMEOUT_MARGIN <= fullShards.NIGHTLY_TIMEOUT_MINUTES * 60);
    }
  }
});

test('(b1) 16 shards fit the 7-night cycle too', () => {
  const cycle = rotation(16);
  assert.equal(cycle.nights, 7);
  assert.ok(cycle.slowest <= fullShards.NIGHTLY_CEILING);
});

test('the nightly scope: default-pack pairs at 390 and 1440, the pairwise array at 1440, the default row, and the perf and visual cells', () => {
  assert.equal(night.scope, 'nightly');
  const defaults = new Set(nightly.NIGHTLY_DEFAULT_VIEWPORTS as readonly string[]);
  for (const each of night.tests) {
    assert.equal(each.row.id, 'default', each.cell.id);
    assert.equal(each.cell.kind, 'composition', each.cell.id);
    if (nightly.isDefaultPair(each.cell)) assert.ok(defaults.has(each.viewport.id));
    else assert.equal(each.viewport.id, nightly.NIGHTLY_PAIRWISE_VIEWPORT);
  }
  // 114 pairs a public composition, at both viewports.
  const compositions = reachable.targets.filter((t) => t.kind === 'composition');
  assert.equal(compositions.length, 15);
  for (const { id } of compositions) {
    const pairs = night.tests.filter(
      (each) =>
        each.cell.target === id &&
        nightly.isDefaultPair(each.cell) &&
        each.cell.tuple.designLanguage === PLATFORM_DEFAULTS.designLanguage,
    );
    assert.equal(pairs.length, 114 * 2, id);
  }
  // Every row of the pairwise array, at 1440.
  const rows = new Set(
    reachable.coverage.rows.map((row) => TUPLE_AXES.map((a) => row[a]).join('/')),
  );
  const at1440 = new Set(
    night.tests
      .filter((each) => each.viewport.id === nightly.NIGHTLY_PAIRWISE_VIEWPORT)
      .map((each) => TUPLE_AXES.map((a) => each.cell.tuple[a]).join('/')),
  );
  for (const row of rows) assert.ok(at1440.has(row), row);
  // The targets stay, and each keeps its perf cell, surfaces included.
  assert.deepEqual(night.targets, reachable.targets);
  const ids = new Set(night.cells.map((cell) => cell.id));
  assert.ok(night.cells.some((cell) => cell.kind === 'surface'));
  assert.ok([...ids].every((id) => reachable.cells.some((cell) => cell.id === id)));
  // Far smaller than (c′), which the release run holds whole.
  assert.ok(night.tests.length * 10 < reachable.tests.length);
});

test('the nightly scope is cut from the reachable plan only', () => {
  const full = planCells({ meta: checkoutMeta(), registrations, mode: 'full' });
  assert.throws(() => nightly.nightlyScope(full), /cut from the reachable plan/);
});

test('a full run with a night plans the nightly scope; without one, full stays full', async () => {
  const planned = await loadPlan({
    QUALITY_WEB: WEB,
    QUALITY_MODE: 'full',
    QUALITY_NIGHT: '2026-11-11',
  });
  assert.equal(planned.scope, 'nightly');
  assert.equal(planned.tests.length, night.tests.length);
  const whole = await loadPlan({ QUALITY_WEB: WEB, QUALITY_MODE: 'full', QUALITY_NIGHT: '' });
  assert.equal(whole.scope, undefined);
});
