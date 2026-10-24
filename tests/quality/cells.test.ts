import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from 'yaml';
import { createAppearanceRegistry } from '../../packages/appearance/src/index';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { accepts, defaultTuple, planCells, siteTextFor, workRoutes, type BuildMeta } from './cells';
import { tupleKey } from './coverage';
import { isReason } from './lib/checks';
import { requiredChecks } from './lib/checks';
import { PREFERENCE_ROWS, VIEWPORTS } from './lib/matrix';
import { loadRegistrations, type Registrations } from './lib/registration';
import { checkoutMeta, clone, TIERS, withTierPacks } from './plan-fixtures';

let registrations: Registrations;
test.before(async () => {
  registrations = await loadRegistrations();
});

test('the PR plan: each sentinel at every viewport in the default row, and every row once on the first composition', () => {
  const plan = planCells({ meta: checkoutMeta(), registrations, mode: 'pr' });
  const ids = plan.cells.map(
    (cell) => `${cell.target} ${cell.state} ${cell.path} ${cell.tuple.displayMode}`,
  );
  assert.deepEqual(ids.sort(), [
    'fallback complete / system',
    'fallback last-known-good / system',
    'fallback missing-media / system',
    'fallback not-found /quality-no-such-page system',
    'fallback sparse / system',
    'fallback unavailable / system',
    'kinetic-cosmos complete / system',
    'login signed-out /studio/sign-in system',
    'obsidian-atelier complete / system',
    'spatial-bento complete / system',
  ]);
  const extraRows = PREFERENCE_ROWS.length - 1;
  assert.equal(plan.tests.length, plan.cells.length * VIEWPORTS.length + extraRows);
  const rows = plan.tests.filter((each) => each.row.id !== 'default');
  assert.deepEqual(
    rows.map((each) => `${each.cell.state} ${each.cell.path} ${each.viewport.id}`),
    Array(extraRows).fill('complete / 1440x900'),
  );
  // The stand-in states are planned, and skip with their declared reason,
  // as does the high-contrast row, which quality/units/fallback.ts excludes
  // until the site pages render a presentation boundary.
  const skipped = plan.tests.filter((each) => each.skip);
  assert.deepEqual(
    [
      ...new Set(
        skipped.map((each) => (each.row.id === 'high-contrast' ? each.row.id : each.cell.state)),
      ),
    ].sort(),
    ['high-contrast', 'last-known-good', 'unavailable'],
  );
  for (const each of skipped) assert.ok(plan.reasons.includes(each.skip!), each.skip);
  for (const reason of plan.reasons) assert.ok(isReason(reason), reason);
  assert.deepEqual(plan.targets, [
    { kind: 'composition', id: 'fallback' },
    { kind: 'composition', id: 'kinetic-cosmos' },
    { kind: 'composition', id: 'obsidian-atelier' },
    { kind: 'composition', id: 'spatial-bento' },
    { kind: 'surface', id: 'login' },
  ]);
});

test('the full plan: the covering array on complete, and every other route and state in each display mode', () => {
  const plan = planCells({ meta: checkoutMeta(), registrations, mode: 'full' });
  const composition = plan.cells.filter((cell) => cell.kind === 'composition');
  const route = workRoutes(contractFixture('complete'))[0]!;
  assert.equal(route, '/work/project-name');
  for (const mode of ['system', 'light', 'dark', 'high-contrast']) {
    for (const [state, at] of [
      ['complete', '/'],
      ['complete', route],
      ['sparse', '/'],
      ['missing-media', '/'],
      ['not-found', '/quality-no-such-page'],
    ]) {
      assert.ok(
        composition.some(
          (cell) => cell.state === state && cell.path === at && cell.tuple.displayMode === mode,
        ),
        `${state} ${at} ${mode}`,
      );
    }
  }
  for (const row of plan.coverage.rows) {
    assert.ok(
      composition.some(
        (cell) =>
          cell.state === 'complete' && cell.path === '/' && tupleKey(cell.tuple) === tupleKey(row),
      ),
      tupleKey(row),
    );
  }
  const login = plan.cells.filter((cell) => cell.target === 'login');
  assert.deepEqual(login.map((cell) => cell.path).sort(), [
    '/studio/sign-in',
    '/studio/sign-in?state=error',
    '/studio/sign-in?state=failed',
    '/studio/sign-in?state=rate_limited&retryAfter=30',
    '/studio/sign-in?state=session_ended',
  ]);
  assert.equal(plan.tests.length, plan.cells.length * VIEWPORTS.length * PREFERENCE_ROWS.length);
  assert.equal(new Set(plan.cells.map((cell) => cell.id)).size, plan.cells.length);
  // Every cell takes the default row's reload conditions in a full run.
  assert.ok(plan.tests.every((each) => each.conditions));
  const firstViewport = plan.tests.filter(
    (each) => each.row.id === 'default' && each.viewport === VIEWPORTS[0],
  );
  assert.equal(firstViewport.length, plan.cells.length);
  for (const each of firstViewport) {
    const owed = requiredChecks(each.row.id, each.viewport.id, each.conditions);
    for (const check of ['inventory', 'reflow', 'enhancement']) assert.ok(owed.includes(check));
  }
});

test('a PR run takes the reload conditions on the first default and the tier sentinels alone', () => {
  const plan = planCells({ meta: withTierPacks(checkoutMeta()), registrations, mode: 'pr' });
  const taking = new Set(plan.tests.filter((each) => each.conditions).map((each) => each.cell));
  const first = plan.cells.find(
    (cell) =>
      cell.kind === 'composition' &&
      cell.state === 'complete' &&
      cell.path === '/' &&
      cell.tuple.displayMode === 'system' &&
      !cell.pack,
  );
  assert.deepEqual(
    [...taking].map((cell) => cell.id).sort(),
    [first!, ...plan.cells.filter((cell) => cell.pack)].map((cell) => cell.id).sort(),
  );
  // The rest, such as sparse and the 404 page, owe none of them.
  const sparse = plan.tests.find(
    (each) => each.cell.state === 'sparse' && each.viewport === VIEWPORTS[0],
  )!;
  assert.ok(
    !requiredChecks('default', sparse.viewport.id, sparse.conditions).includes('inventory'),
  );
});

test("a PR run takes the reload conditions on every change-directed cell, where a changed variant's content and enhancement regressions show", () => {
  const meta = withTierPacks(checkoutMeta());
  const language = meta.PACKS!.find((pack) => pack.kind === 'design-language' && !pack.fixture)!;
  // A second shipping stable language, so the changed variant meets one that isn't the first default's.
  const wider: BuildMeta = {
    ...meta,
    PACKS: [...meta.PACKS!, clone(language, 'second-language', 'stable', false)],
  };
  const plan = planCells({
    meta: wider,
    registrations,
    mode: 'pr',
    changes: [{ axis: 'variant', id: 'fallback', paths: ['packages/fallback-composition/x.ts'] }],
  });
  const directed = plan.cells.filter((cell) => cell.changed);
  // Every shipping pack on every axis since #20: the second language, and the dark-only night-only scheme in its dark mode.
  assert.deepEqual(directed.map((cell) => cell.tuple.designLanguage).sort(), [
    'platform-neutral',
    'platform-neutral',
    'second-language',
  ]);
  assert.ok(
    directed.some(
      (cell) => cell.tuple.colorScheme === 'night-only' && cell.tuple.displayMode === 'dark',
    ),
  );
  for (const cell of directed) {
    const tests = plan.tests.filter((each) => each.cell === cell);
    assert.ok(tests.length > 0, cell.id);
    assert.ok(
      tests.every((each) => each.conditions),
      `${cell.id} runs the reload conditions`,
    );
    const first = tests.find(
      (each) => each.row.id === 'default' && each.viewport === VIEWPORTS[0],
    )!;
    for (const check of ['inventory', 'enhancement']) {
      assert.ok(
        requiredChecks('default', first.viewport.id, first.conditions).includes(check),
        check,
      );
    }
  }
});

test('each tier pack has a sentinel on the fallback composition, and other fixture packs stay out', () => {
  const meta = withTierPacks(checkoutMeta());
  const plan = planCells({ meta, registrations, mode: 'pr' });
  const sentinels = plan.cells.filter((cell) => cell.pack);
  const covered = sentinels.flatMap((cell) => cell.pack!.split(' ')).sort();
  assert.deepEqual(
    covered,
    ['language', 'scheme', 'typography']
      .flatMap((axis) => TIERS.map((tier) => `fixture-${axis}-${tier}`))
      .sort(),
  );
  for (const cell of sentinels) {
    assert.equal(cell.target, 'fallback');
    assert.equal(cell.state, 'complete');
    assert.ok(cell.fixture, 'a tier pack cell is a fixture cell');
    // Every row at the first viewport, so each tier meets every row on a PR.
    const rows = plan.tests
      .filter((each) => each.cell === cell && each.viewport === VIEWPORTS[0])
      .map((each) => each.row.id);
    assert.deepEqual(
      rows,
      PREFERENCE_ROWS.map((row) => row.id),
      cell.id,
    );
  }
  const full = planCells({ meta, registrations, mode: 'full' });
  assert.ok(!full.cells.some((cell) => tupleKey(cell.tuple).includes('fixture-dark-only')));
  assert.ok(full.coverage.rows.some((row) => row.colorScheme === 'night-only'));
});

test('only tuples the #19 resolver renders as asked become cells', () => {
  const meta = withTierPacks(checkoutMeta());
  const registry = createAppearanceRegistry(meta);
  assert.ok(accepts(registry, defaultTuple('fallback', 'system'), 'read-only'));
  const night = (displayMode: string) => ({
    ...defaultTuple('fallback', displayMode),
    colorScheme: 'night-only',
  });
  assert.ok(accepts(registry, night('dark'), 'read-only'));
  // It has no light mode, and pins system to dark.
  assert.ok(!accepts(registry, night('light'), 'read-only'));
  assert.ok(!accepts(registry, night('system'), 'read-only'));
  // Nothing registers it, so the first-party scheme renders in its place.
  assert.ok(
    !accepts(registry, { ...defaultTuple('fallback', 'light'), colorScheme: 'nope' }, 'read-only'),
  );
  const plan = planCells({ meta, registrations, mode: 'full' });
  for (const cell of plan.cells.filter((each) => each.kind === 'composition')) {
    assert.ok(accepts(registry, cell.tuple, 'read-only'), tupleKey(cell.tuple));
  }
  assert.ok(plan.coverage.uncoverable.includes('colorScheme=night-only × displayMode=light'));
});

test("a cell's site document publishes its tuple, the fallback composition by a variant nothing registers", () => {
  const site = parse(
    siteTextFor(contractFixture('complete'), {
      ...defaultTuple('fallback', 'dark'),
      typography: 'fixture-typography-stable',
    }),
  ) as { appearance: Record<string, string>; visitorControls: unknown };
  assert.deepEqual(site.appearance, {
    variant: 'missing-variant',
    designLanguage: 'platform-neutral',
    colorScheme: 'warm-parchment',
    typography: 'fixture-typography-stable',
    displayMode: 'dark',
  });
  assert.ok(site.visitorControls, "the fixture's other settings stay");
  const other = parse(
    siteTextFor(contractFixture('complete'), defaultTuple('kinetic', 'light')),
  ) as {
    appearance: Record<string, string>;
  };
  assert.equal(other.appearance.variant, 'kinetic');
});

test("a unit's notApplicable skips the cells it names with its reason, and an engine's goes to that engine", () => {
  const units = [
    {
      id: 'fallback',
      interactions: [],
      primaryActions: [],
      notApplicable: [
        {
          match: { state: 'sparse', viewport: '390x844' },
          reason: 'Sparse has nothing to reflow at 390.',
        },
        {
          match: { row: 'forced-colors', engine: 'webkit' },
          reason: 'WebKit has no forced colors.',
        },
      ],
    },
  ];
  const plan = planCells({
    meta: checkoutMeta(),
    registrations: { ...registrations, units },
    mode: 'full',
  });
  // The fallback composition's cells: its unit is the one that names them.
  const fallback = plan.tests.filter((each) => each.cell.target === 'fallback');
  const sparse = fallback.filter(
    (each) => each.cell.state === 'sparse' && each.viewport.id === '390x844',
  );
  assert.ok(sparse.length > 0);
  for (const each of sparse) assert.equal(each.skip, 'Sparse has nothing to reflow at 390.');
  const forced = fallback.filter(
    (each) => each.row.id === 'forced-colors' && each.cell.kind === 'composition',
  );
  for (const each of forced)
    assert.deepEqual(each.engineSkips, { webkit: 'WebKit has no forced colors.' });
  assert.ok(plan.reasons.includes('Sparse has nothing to reflow at 390.'));
  const other = fallback.filter(
    (each) => each.cell.state === 'sparse' && each.viewport.id !== '390x844',
  );
  // Another composition's cells are its own unit's to exclude, and this one names none of them.
  assert.ok(
    plan.tests
      .filter((each) => each.cell.target === 'kinetic-cosmos' && each.cell.state === 'sparse')
      .every((each) => each.skip !== 'Sparse has nothing to reflow at 390.'),
  );
  for (const each of other) assert.equal(each.skip, undefined);
});

test('the plan is the same each time', () => {
  const a = planCells({ meta: checkoutMeta(), registrations, mode: 'full' });
  const b = planCells({ meta: checkoutMeta(), registrations, mode: 'full' });
  assert.deepEqual(
    a.tests.map((each) => `${each.cell.id} ${each.viewport.id} ${each.row.id}`),
    b.tests.map((each) => `${each.cell.id} ${each.viewport.id} ${each.row.id}`),
  );
});
