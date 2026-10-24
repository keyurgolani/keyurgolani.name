import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { parseSelection } from '../../packages/appearance/src/index';
import { planCells, type BuildMeta, type Cell, type Plan } from './cells';
import { requiredChecks } from './lib/checks';
import { PREFERENCE_ROWS, VIEWPORTS } from './lib/matrix';
import { axeFailures, changeDiagnostic, changeFields, runnerFailure } from './lib/records';
import { loadRegistrations, type Registrations } from './lib/registration';
import { appOptionsFor, cellServer, serverId, SWEEP_CONTROLS } from './lib/server';
import { planRecord, plannedTests } from './lib/shards';
import {
  APPEARANCE_COOKIE,
  packCookie,
  packFindings,
  SWEEP_CHECKS,
  SWEEP_ROWS,
  SWEEP_VIEWPORT,
  sweepChecksOf,
} from './lib/sweep';
import { judge } from './lib/verdict';
import { cellTest, summary } from './meta/runner-cases';
import { checkoutMeta, clone, withTierPacks } from './plan-fixtures';

// The pack sweep (lib/sweep.ts): a PR's changed packs against every
// registered variant, on one server a variant, in the [37] rule's five
// checks at 1440x900, every pair planned and every failure named.

let registrations: Registrations;
test.before(async () => {
  registrations = await loadRegistrations();
});

/** The tier-pack metadata with two non-default shipping packs, a scheme and a language. */
function twoPacks(): BuildMeta {
  const meta = withTierPacks(checkoutMeta());
  const like = (kind: string) => meta.PACKS!.find((pack) => pack.kind === kind && !pack.fixture)!;
  return {
    ...meta,
    PACKS: [
      ...meta.PACKS!,
      clone(like('color-scheme'), 'second-scheme', 'stable', false),
      clone(like('design-language'), 'second-language', 'extended', false),
    ],
  };
}

const CHANGES = [
  { axis: 'colorScheme' as const, id: 'second-scheme', paths: [] },
  { axis: 'designLanguage' as const, id: 'second-language', paths: [] },
];

const variantsOf = (plan: Plan) =>
  plan.targets.filter((target) => target.kind === 'composition').map((target) => target.id);

test('a PR sweeps each changed pack against every variant, in the [37] rows at 1440x900 and no other test, and full keeps every viewport and row', () => {
  const meta = twoPacks();
  const plan = planCells({ meta, registrations, mode: 'pr', changes: CHANGES });
  const variants = variantsOf(plan);
  const swept = plan.cells.filter((cell) => cell.sweep);
  assert.deepEqual(
    swept.map((cell) => `${changeFields(cell).pack} ${cell.target}`).sort(),
    CHANGES.flatMap((change) => variants.map((variant) => `${change.id} ${variant}`)).sort(),
  );
  assert.deepEqual(
    SWEEP_ROWS.map((row) => row.id),
    ['default', 'reduced-motion', 'forced-colors', 'reduced-transparency'],
  );
  for (const cell of swept) {
    const tests = plan.tests.filter((each) => each.cell === cell);
    assert.deepEqual(
      tests.map((each) => `${each.viewport.id} ${each.row.id}`),
      SWEEP_ROWS.map((row) => `${SWEEP_VIEWPORT.id} ${row.id}`),
      cell.id,
    );
    for (const each of tests) {
      assert.equal(each.conditions, false, 'no reload conditions');
      // The five checks alone: no occlusion, overlays, hover, or reload conditions.
      const owed = requiredChecks(each.row.id, each.viewport.id, each.conditions, true);
      for (const check of ['occlusion', 'overlays', 'hover', 'reflow', 'inventory', 'enhancement'])
        assert.ok(!owed.includes(check), `${each.row.id} owes ${check}`);
    }
    // Every one of the five, once a pack and variant.
    assert.deepEqual(
      tests.flatMap(sweepChecksOf).sort(),
      SWEEP_CHECKS.map((each) => each.name).sort(),
    );
  }

  // A changed variant keeps every viewport in the default row and every row at 1440x900.
  const variant = planCells({
    meta,
    registrations,
    mode: 'pr',
    changes: [{ axis: 'variant', id: 'fallback', paths: [] }],
  });
  const byVariant = variant.cells.filter((cell) => cell.changed);
  assert.ok(byVariant.length > 0);
  for (const cell of byVariant) {
    assert.ok(!cell.sweep, cell.id);
    const tests = variant.tests.filter((each) => each.cell === cell);
    assert.equal(tests.length, VIEWPORTS.length + PREFERENCE_ROWS.length - 1, cell.id);
  }
  // The platform default's scheme directs each variant's published default, a sentinel, which isn't swept.
  const defaults = planCells({
    meta,
    registrations,
    mode: 'pr',
    changes: [{ axis: 'colorScheme', id: 'warm-parchment', paths: [] }],
  });
  const byDefault = defaults.cells.filter((cell) => cell.changed);
  assert.equal(byDefault.length, variantsOf(defaults).length);
  for (const cell of byDefault) assert.ok(cell.sentinel && !cell.sweep, cell.id);

  // quality-full plans the swept pairs at every viewport and in every row, as before.
  const full = planCells({ meta, registrations, mode: 'full' });
  assert.ok(!full.cells.some((cell) => cell.sweep));
  for (const cell of swept) {
    const same = full.cells.find((each) => each.id === cell.id)!;
    assert.ok(same, cell.id);
    assert.equal(
      full.tests.filter((each) => each.cell === same).length,
      VIEWPORTS.length * PREFERENCE_ROWS.length,
    );
  }
});

test("every variant's swept packs share one sweep server, its own and not the published default's, whose site lets the visitor pick each pack", () => {
  const plan = planCells({ meta: twoPacks(), registrations, mode: 'pr', changes: CHANGES });
  const swept = plan.cells.filter((cell) => cell.sweep);
  const servers = new Map<string, Set<string>>();
  for (const cell of swept) {
    const id = serverId(cellServer(cell));
    servers.set(id, new Set([...(servers.get(id) ?? []), cell.target]));
  }
  // One server a variant, holding that variant's packs alone.
  assert.equal(servers.size, variantsOf(plan).length);
  for (const targets of servers.values()) assert.equal(targets.size, 1);
  for (const cell of swept) {
    const published = plan.cells.find(
      (each) => !each.changed && each.target === cell.target && each.tuple.displayMode === 'system',
    )!;
    assert.notEqual(serverId(cellServer(cell)), serverId(cellServer(published)), cell.id);
    const site = parse(appOptionsFor(cellServer(cell), '/web', 'canary').siteText!) as {
      appearance: Record<string, string>;
      visitorControls: Record<string, string>;
    };
    assert.deepEqual(site.visitorControls, SWEEP_CONTROLS);
    // The variant's published default appearance, which the cookie changes for each pack.
    assert.equal(site.appearance.colorScheme, 'warm-parchment');
    assert.equal(site.appearance.displayMode, 'system');
  }
});

test("a pack's cookie is the host's preference cookie, naming the swept tuple, and a page that renders another pack fails sweep-pack", () => {
  const source = readFileSync(
    new URL('../../apps/web/src/lib/document-appearance.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, new RegExp(`APPEARANCE_COOKIE = '${APPEARANCE_COOKIE}'`));
  const cell = {
    tuple: {
      variant: 'kinetic-cosmos',
      designLanguage: 'second-language',
      colorScheme: 'second-scheme',
      typography: 'humanist-ui',
      displayMode: 'dark',
    },
  };
  const cookie = packCookie(cell, 'http://127.0.0.1:3000');
  assert.equal(cookie.name, 'portfolio_appearance');
  assert.equal(cookie.url, 'http://127.0.0.1:3000');
  assert.deepEqual(parseSelection(cookie.value), {
    designLanguage: 'second-language',
    colorScheme: 'second-scheme',
    typography: 'humanist-ui',
    displayMode: 'dark',
  });

  const boundary = (scheme: string) => ({
    boundaries: [
      {
        kind: 'document',
        attributes: {
          'data-design-language': 'second-language',
          'data-color-scheme': scheme,
          'data-typography': 'humanist-ui',
        },
        tokens: {},
      },
    ],
  });
  assert.deepEqual(packFindings(cell, boundary('second-scheme')), []);
  assert.deepEqual(packFindings(cell, boundary('warm-parchment')), [
    {
      gate: 'runner',
      rule: 'sweep-pack',
      expected: 'data-color-scheme=second-scheme',
      actual: 'data-color-scheme=warm-parchment',
    },
  ]);
  assert.equal(packFindings(cell, { boundaries: [] })[0]!.actual, 'the page rendered none');
});

test("a swept cell's failures name the pack, its axis, the variant, and the check", () => {
  const plan = planCells({ meta: twoPacks(), registrations, mode: 'pr', changes: CHANGES });
  const cell = plan.cells.find(
    (each) =>
      each.sweep && each.target === 'kinetic-cosmos' && each.tuple.colorScheme === 'second-scheme',
  ) as Cell;
  const planned = plan.tests.find((each) => each.cell === cell && each.row.id === 'forced-colors')!;
  const context = { cell, viewport: planned.viewport, row: planned.row, artifacts: [] };
  const runner = {
    ...runnerFailure(context, 'sweep-pack', 'data-color-scheme=warm-parchment'),
    check: 'focus',
  };
  const [axe] = axeFailures(
    context,
    {
      violations: [
        {
          id: 'color-contrast',
          help: 'Elements must meet minimum color contrast ratio thresholds',
          nodes: [{ target: ['main p'], any: [], failureSummary: 'Fix any: low contrast' }],
        },
      ],
    } as never,
    {},
  );
  for (const failure of [runner, axe!]) {
    assert.equal(failure.pack, 'second-scheme');
    assert.equal(failure.axis, 'colorScheme');
    assert.equal(failure.surface, 'kinetic-cosmos');
    assert.equal(failure.preferenceMode, 'forced-colors');
  }
  assert.equal(runner.check, 'focus');
  assert.equal(axe!.check, 'axe');
  assert.match(changeDiagnostic(cell, [])!, /the colorScheme second-scheme changed/);
});

test("a swept test that didn't run fails plan-coverage, naming its pack and variant, and one that passed owes the sweep's checks alone", () => {
  const plan = planCells({ meta: twoPacks(), registrations, mode: 'pr', changes: CHANGES });
  // As a merged run reads it, from plan.json.
  const tests = plannedTests(planRecord(plan));
  const swept = tests.filter((each) => each.cell.sweep);
  assert.equal(swept.length, plan.tests.filter((each) => each.cell.sweep).length);
  const ran = (each: (typeof tests)[number], checks?: string[]) =>
    cellTest(each, {
      checks:
        checks ?? requiredChecks(each.row.id, each.viewport.id, each.conditions, each.cell.sweep),
    });
  const dropped = swept.find(
    (each) => each.row.id === 'forced-colors' && each.cell.id.includes('second-language'),
  )!;
  const verdict = (summaryTests: ReturnType<typeof cellTest>[]) =>
    judge({
      plan: { targets: plan.targets, tests },
      engines: ['chromium'],
      summary: summary(summaryTests),
      missingBrowsers: [],
      canary: null,
    }).failures;
  const all = tests.map((each) => ran(each));
  const rules = (failures: ReturnType<typeof verdict>, rule: string) =>
    failures.filter((each) => each.rule === rule).map((each) => each.message);
  assert.deepEqual(rules(verdict(all), 'plan-coverage'), []);
  assert.deepEqual(rules(verdict(all), 'unchecked-cell'), []);
  const missing = rules(
    verdict(all.filter((each) => !(each.cell === dropped.cell.id && each.row === 'forced-colors'))),
    'plan-coverage',
  );
  assert.equal(missing.length, 1);
  assert.match(missing[0]!, /second-language/);
  // The cell's id names the variant and the tuple the pack is in.
  assert.ok(missing[0]!.startsWith(`${dropped.cell.id} at 1440x900, forced-colors`), missing[0]);
  assert.match(missing[0]!, /is planned, and didn't run/);
  // A swept test that passed without its focus check, or without checking
  // the page rendered its pack, fails unchecked-cell.
  for (const check of ['focus', 'sweep-pack']) {
    const without = all.map((each) =>
      each.cell === dropped.cell.id && each.row === 'forced-colors'
        ? { ...each, checks: each.checks.filter((ran) => ran !== check) }
        : each,
    );
    const unchecked = rules(verdict(without), 'unchecked-cell');
    assert.equal(unchecked.length, 1, check);
    assert.match(unchecked[0]!, new RegExp(`without its ${check} check`));
  }
});
