import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createAppearanceRegistry,
  DISPLAY_MODES,
  PLATFORM_DEFAULTS,
} from '../../packages/appearance/src/index';
import { REFERENCE_ID } from '../external-variant/id';
import { accepts, FALLBACK_ID, planCells, type BuildMeta, type Plan } from './cells';
import { TUPLE_AXES, type Tuple } from './coverage';
import { loadRegistrations, type Registrations } from './lib/registration';
import * as releaseScope from './lib/release-scope';
import { SCOPE_ENV, scopePlan, scopeProblems, SCOPES } from './lib/release-scope';
import { loadPlan } from './plan';
import { checkoutMeta, withTierPacks } from './plan-fixtures';

// The release scope (c′), the coordinator's ruling for v1.0.0 (cells.ts's `reachable`): a
// covering array pairwise over what a visitor or the owner can reach, the 15 public compositions
// and the shipping packs of every tier, beside every public composition's 114 scheme and mode
// pairs on its default packs, with the [37] rule's pairs kept, and no fixture pack, no
// acme-reference and no fallback composition. Each proof below works the reachable set out on its
// own from the registry, not from the planner.

/**
 * The checkout's registry as a release run's is, with what the scope must leave out: the reference
 * variant (acme-reference) as --external-variant installs it, the nine tier packs and a fixture
 * scheme, beside the fallback composition the checkout registers. withTierPacks' `night-only`, a
 * shipping scheme that ships nowhere, is left out, so the shipping packs are the checkout's own.
 */
function releaseMeta(): BuildMeta {
  const tiered = withTierPacks(checkoutMeta());
  const base = tiered.VARIANTS.find(({ manifest }) => manifest.id === 'obsidian-atelier')!;
  return {
    ...tiered,
    PACKS: (tiered.PACKS ?? []).filter((pack) => pack.manifest.id !== 'night-only'),
    VARIANTS: [
      ...tiered.VARIANTS,
      { ...base, manifest: { ...base.manifest, id: REFERENCE_ID, name: REFERENCE_ID } },
    ],
  } as BuildMeta;
}

const KINDS = {
  designLanguage: 'design-language',
  colorScheme: 'color-scheme',
  typography: 'typography',
} as const;

/**
 * What a person can reach, worked out from `meta` alone: every composition but the fallback one,
 * the reference variant and a fixture one; every pack outside a fixture package that isn't a
 * generator scheme, which renders only from a site's input; and every display mode.
 */
function reachableValues(meta: BuildMeta): Record<(typeof TUPLE_AXES)[number], string[]> {
  const packs = (kind: string) =>
    (meta.PACKS ?? [])
      .filter(
        (pack) =>
          pack.kind === kind &&
          !pack.fixture &&
          !pack.manifest.id.startsWith('fixture-') &&
          !('generator' in pack.manifest && pack.manifest.generator),
      )
      .map((pack) => pack.manifest.id)
      .sort();
  return {
    variant: meta.VARIANTS.map(({ manifest }) => manifest.id)
      .filter((id) => id !== FALLBACK_ID && id !== REFERENCE_ID && !id.startsWith('fixture-'))
      .sort(),
    designLanguage: packs(KINDS.designLanguage),
    colorScheme: packs(KINDS.colorScheme),
    typography: packs(KINDS.typography),
    displayMode: [...DISPLAY_MODES],
  };
}

const pairsOf = (tuple: Tuple) =>
  TUPLE_AXES.flatMap((a, i) =>
    TUPLE_AXES.slice(i + 1).map((b) => `${a}=${tuple[a]} × ${b}=${tuple[b]}`),
  );

let registrations: Registrations;
let meta: BuildMeta;
let reachable: Plan;
let full: Plan;
test.before(async () => {
  registrations = await loadRegistrations();
  meta = releaseMeta();
  reachable = planCells({ meta, registrations, mode: 'full', scope: 'reachable' });
  full = planCells({ meta, registrations, mode: 'full' });
});

const compositions = (plan: Plan) => plan.cells.filter((cell) => cell.kind === 'composition');

test('(c′) every pair of reachable factor values is in at least one tuple of the reachable scope', () => {
  const values = reachableValues(meta);
  assert.equal(values.variant.length, 15, values.variant.join(', '));
  const registry = createAppearanceRegistry(meta);
  // Every pair some tuple a person can reach holds: each tuple of the cross product the resolver
  // renders as asked, enumerated here on its own.
  const reachablePairs = new Set<string>();
  let tuples = 0;
  for (const variant of values.variant)
    for (const designLanguage of values.designLanguage)
      for (const colorScheme of values.colorScheme)
        for (const typography of values.typography)
          for (const displayMode of values.displayMode) {
            const tuple = { variant, designLanguage, colorScheme, typography, displayMode };
            if (!accepts(registry, tuple, 'read-only')) continue;
            tuples += 1;
            for (const pair of pairsOf(tuple)) reachablePairs.add(pair);
          }
  // 15 compositions x 33 languages x 15 typographies x 114 scheme and mode pairs.
  assert.equal(
    tuples,
    values.variant.length * values.designLanguage.length * values.typography.length * 114,
  );
  const planned = new Set(compositions(reachable).flatMap((cell) => pairsOf(cell.tuple)));
  const missing = [...reachablePairs].filter((pair) => !planned.has(pair));
  assert.deepEqual(missing, [], `${missing.length} reachable pair(s) in no tuple`);
  // And every planned pair is a reachable one: the scope holds nothing a person can't reach.
  assert.deepEqual(
    [...planned].filter((pair) => !reachablePairs.has(pair)),
    [],
  );
  // `full` holds them too, mostly off the public compositions; the reachable scope is its own.
  assert.notDeepEqual(
    new Set(compositions(full).map((cell) => cell.id)),
    new Set(compositions(reachable).map((cell) => cell.id)),
  );
});

test('(c′) every public composition carries all 114 valid scheme and mode pairs on its default packs', () => {
  const values = reachableValues(meta);
  const registry = createAppearanceRegistry(meta);
  for (const variant of values.variant) {
    const valid = values.colorScheme
      .flatMap((colorScheme) =>
        values.displayMode.map((displayMode) => ({
          variant,
          designLanguage: PLATFORM_DEFAULTS.designLanguage,
          colorScheme,
          typography: PLATFORM_DEFAULTS.typography,
          displayMode,
        })),
      )
      .filter((tuple) => accepts(registry, tuple, 'read-only'))
      .map((tuple) => `${tuple.colorScheme}/${tuple.displayMode}`)
      .sort();
    assert.equal(valid.length, 114, variant);
    // Each on the appearance fixture at the composition's first route, as a covering-array row is.
    const carried = compositions(reachable)
      .filter(
        (cell) =>
          cell.target === variant &&
          cell.state === 'complete' &&
          cell.path === '/' &&
          cell.tuple.variant === variant &&
          cell.tuple.designLanguage === PLATFORM_DEFAULTS.designLanguage &&
          cell.tuple.typography === PLATFORM_DEFAULTS.typography,
      )
      .map((cell) => `${cell.tuple.colorScheme}/${cell.tuple.displayMode}`);
    assert.deepEqual([...new Set(carried)].sort(), valid, variant);
  }
});

test('(c′) no fixture, acme-reference or fallback tuple is in the reachable scope', () => {
  // The registry it planned from has each of them, so leaving them out is the scope's doing.
  const ids = meta.VARIANTS.map(({ manifest }) => manifest.id);
  assert.ok(ids.includes(FALLBACK_ID) && ids.includes(REFERENCE_ID));
  assert.ok((meta.PACKS ?? []).filter((pack) => pack.fixture).length >= 10);
  assert.ok(full.cells.some((cell) => cell.target === REFERENCE_ID));
  assert.ok(full.cells.some((cell) => cell.fixture));
  const out = (id: string) =>
    id === FALLBACK_ID || id === REFERENCE_ID || id.startsWith('fixture-');
  const fixturePacks = new Set(
    (meta.PACKS ?? []).filter((pack) => pack.fixture).map((pack) => pack.manifest.id),
  );
  for (const cell of compositions(reachable)) {
    assert.ok(!out(cell.target), cell.id);
    assert.ok(!out(cell.tuple.variant), cell.id);
    for (const axis of ['designLanguage', 'colorScheme', 'typography'] as const) {
      assert.ok(!fixturePacks.has(cell.tuple[axis]) && !out(cell.tuple[axis]), cell.id);
    }
    assert.equal(cell.fixture, false, cell.id);
    assert.equal(cell.pack, undefined, cell.id);
  }
  assert.ok(reachable.cells.every((cell) => !cell.fixture));
  assert.ok(reachable.coverage.rows.every((row) => TUPLE_AXES.every((axis) => !out(row[axis]))));
  // Its targets, each of which needs results, are the public compositions and the surfaces.
  assert.deepEqual(
    reachable.targets.filter((each) => each.kind === 'composition').map((each) => each.id),
    reachableValues(meta).variant.sort(),
  );
  // The surfaces stay as `full` plans them: Studio and the rest are the owner's, on any
  // composition, and their cells render on the harness's server, never a visitor's fallback.
  const surfaces = (plan: Plan) => plan.cells.filter((cell) => cell.kind === 'surface');
  assert.ok(surfaces(full).length > 0);
  assert.deepEqual(surfaces(reachable), surfaces(full));
});

test("(c′) the reachable scope keeps the [37] rule's tuples, and every other route and state, on the public compositions", () => {
  const ids = new Set(reachable.cells.map((cell) => cell.id));
  const publicOf = (cell: Plan['cells'][number]) =>
    cell.kind === 'composition' &&
    cell.target !== FALLBACK_ID &&
    cell.target !== REFERENCE_ID &&
    !cell.fixture;
  const directed = full.cells.filter((cell) => cell.changed && publicOf(cell));
  assert.ok(directed.length > 0);
  for (const cell of directed) assert.ok(ids.has(cell.id), `[37]: ${cell.id}`);
  // Every changed pack meets every public composition: each shipping pack, on each axis.
  const values = reachableValues(meta);
  for (const axis of ['designLanguage', 'colorScheme', 'typography'] as const) {
    for (const id of values[axis]) {
      for (const variant of values.variant) {
        assert.ok(
          reachable.cells.some(
            (cell) =>
              cell.target === variant &&
              cell.changed?.some((by) => by.axis === axis && by.id === id),
          ),
          `${axis} ${id} × ${variant}`,
        );
      }
    }
  }
  // The other routes and states under each composition's default appearance, as `full` plans them.
  const others = full.cells.filter(
    (cell) => publicOf(cell) && (cell.state !== 'complete' || cell.path !== '/'),
  );
  assert.ok(others.length > 0);
  for (const cell of others) assert.ok(ids.has(cell.id), cell.id);
  // Every test in every row and viewport, as `full` runs them.
  const testIds = new Set(reachable.tests.map((each) => `${each.cell.id} ${each.viewport.id}`));
  for (const each of full.tests.filter((t) => ids.has(t.cell.id))) {
    assert.ok(testIds.has(`${each.cell.id} ${each.viewport.id}`));
  }
  assert.equal(reachable.scope, 'reachable');
  assert.equal(full.scope, undefined);
});

test('the reachable scope narrows a full plan only', () => {
  assert.throws(
    () => planCells({ meta, registrations, mode: 'pr', scope: 'reachable' }),
    /narrows a full plan, and this one is pr/,
  );
});

test('a release scope file may name reachable, a final promotes on it, and it keeps a plan planned with it', () => {
  assert.ok((SCOPES as readonly string[]).includes('reachable'));
  assert.deepEqual([...(releaseScope.FINAL_SCOPES ?? [])], ['full', 'reachable']);
  const file = {
    release: '1.0.0-rc.4',
    scope: 'reachable',
    unswept:
      'Only what no visitor or owner reaches: the fallback composition, acme-reference, and the fixture and tier packs.',
    records: 'records.json',
  };
  assert.deepEqual(scopeProblems(file), []);
  assert.deepEqual(scopeProblems({ ...file, release: '1.0.0' }), []);
  assert.equal(scopePlan(reachable, { scope: 'reachable' }), reachable);
  assert.throws(() => scopePlan(full, { scope: 'reachable' }), /planned, not cut/);
});

test("loadPlan plans the reachable scope when a release's scope file names it", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'reachable-scope-'));
  writeFileSync(
    path.join(dir, 'scope.json'),
    JSON.stringify({
      release: '1.0.0-rc.4',
      scope: 'reachable',
      unswept: 'Only what no visitor or owner reaches.',
      records: 'records.json',
    }),
  );
  writeFileSync(path.join(dir, 'records.json'), '[]\n');
  const web = fileURLToPath(new URL('../../apps/web/', import.meta.url));
  const plan = await loadPlan({
    QUALITY_WEB: web,
    QUALITY_MODE: 'full',
    [SCOPE_ENV]: path.join(dir, 'scope.json'),
  });
  assert.equal(plan.scope, 'reachable');
  assert.ok(plan.targets.every((each) => each.id !== FALLBACK_ID));
  assert.ok(plan.cells.every((cell) => cell.kind === 'surface' || cell.target !== FALLBACK_ID));
  // Without the file, full mode stays full.
  const whole = await loadPlan({ QUALITY_WEB: web, QUALITY_MODE: 'full' });
  assert.equal(whole.scope, undefined);
  assert.ok(whole.targets.some((each) => each.id === FALLBACK_ID));
});
