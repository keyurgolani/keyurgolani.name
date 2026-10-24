import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'yaml';
import { parseSelection } from '../../packages/appearance/src/index';
import { cellAnnotations, planCells, type BuildMeta, type Cell, type Plan } from './cells';
import { CHECKS_ANNOTATION, requiredChecks, sweepCheck, sweepRowChecks } from './lib/checks';
import { FIXED_TIME } from './lib/clock';
import { PREFERENCE_ROWS, VIEWPORTS } from './lib/matrix';
import {
  axeFailures,
  changeDiagnostic,
  changeFields,
  RECORDS_ATTACHMENT,
  runnerFailure,
} from './lib/records';
import { runCell, startPack, storageFindings, type runPass } from './lib/run-cell';
import { CANARY_COOKIE } from './lib/env';
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

test('a PR sweeps each changed pack against every variant, one test a pair at 1440x900 that runs the [37] rows, and full keeps every viewport and row', () => {
  const meta = twoPacks();
  const plan = planCells({ meta, registrations, mode: 'pr', changes: CHANGES });
  const variants = variantsOf(plan);
  const swept = plan.cells.filter((cell) => cell.sweep);
  assert.deepEqual(
    swept.map((cell) => `${changeFields(cell).pack} ${cell.target}`).sort(),
    CHANGES.flatMap((change) => variants.map((variant) => `${change.id} ${variant}`)).sort(),
  );
  // Reduced motion after forced colors: its frame sampler stays on the page.
  assert.deepEqual(
    SWEEP_ROWS.map((row) => row.id),
    ['default', 'forced-colors', 'reduced-motion', 'reduced-transparency'],
  );
  for (const cell of swept) {
    const tests = plan.tests.filter((each) => each.cell === cell);
    assert.deepEqual(
      tests.map((each) => `${each.viewport.id} ${each.row.id}`),
      [`${SWEEP_VIEWPORT.id} default`],
      cell.id,
    );
    const [only] = tests;
    assert.equal(only!.conditions, false, 'no reload conditions');
    // Each row's checks by name, and none of the full cells' others.
    const owed = requiredChecks(only!.row.id, only!.viewport.id, only!.conditions, true);
    for (const check of [
      'sweep-pack',
      'axe',
      'contrast',
      'focus',
      'keyboard',
      'forced-colors:focus',
      'forced-colors:axe',
      'reduced-motion:motion',
      'reduced-transparency:transparency',
      'reduced-transparency:emulation',
    ])
      assert.ok(owed.includes(check), `owes ${check}`);
    for (const check of ['occlusion', 'overlays', 'hover', 'reflow', 'inventory', 'enhancement'])
      assert.ok(!owed.some((each) => each.endsWith(check)), `owes ${check}`);
    // Every one of the five, in the one test.
    assert.deepEqual(sweepChecksOf(only!).sort(), SWEEP_CHECKS.map((each) => each.name).sort());
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
  // A pass under forced colors, as run-cell.ts makes its context.
  const planned = plan.tests.find((each) => each.cell === cell)!;
  const row = SWEEP_ROWS.find((each) => each.id === 'forced-colors')!;
  const context = { cell, viewport: planned.viewport, row, artifacts: [] };
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
  const dropped = swept.find((each) => each.cell.id.includes('second-language'))!;
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
    verdict(all.filter((each) => each.cell !== dropped.cell.id)),
    'plan-coverage',
  );
  assert.equal(missing.length, 1);
  assert.match(missing[0]!, /second-language/);
  // The cell's id names the variant and the tuple the pack is in.
  assert.ok(missing[0]!.startsWith(`${dropped.cell.id} at 1440x900, default`), missing[0]);
  assert.match(missing[0]!, /is planned, and didn't run/);
  // A swept test that passed without one row's check, or without checking
  // the page rendered its pack, fails unchecked-cell.
  for (const check of [
    'focus',
    'forced-colors:focus',
    'reduced-motion:motion',
    'reduced-transparency:transparency',
    'sweep-pack',
  ]) {
    const without = all.map((each) =>
      each.cell === dropped.cell.id
        ? { ...each, checks: each.checks.filter((ran) => ran !== check) }
        : each,
    );
    const unchecked = rules(verdict(without), 'unchecked-cell');
    assert.equal(unchecked.length, 1, check);
    assert.match(unchecked[0]!, new RegExp(`without its ${check} check`));
  }
});

/** A stand-in for a Playwright run of one cell test: its output in a temp dir, its soft expectations kept. */
function stubRun(throwOn: string | null) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sweep-run-'));
  const softs: string[] = [];
  const testInfo = {
    annotations: [] as { type: string; description?: string }[],
    setTimeout: () => undefined,
    outputPath: (name: string) => path.join(dir, name),
    attach: async () => undefined,
  };
  const expect = {
    soft: (value: unknown, message: string) => ({
      toBe: (wanted: unknown) => void (value === wanted || softs.push(message)),
      toEqual: (wanted: unknown) => void (isDeepStrictEqual(value, wanted) || softs.push(message)),
      toBeNull: () => void (value === null || softs.push(message)),
    }),
  };
  // A page whose load rejects under one row, as a crashed or hung load does.
  const page = {
    goto: async (at: string) => {
      if (at === `/${throwOn}`) {
        throw new Error(`page.goto: net::ERR_ABORTED at ${at}\nCall log: more`);
      }
      return null;
    },
  };
  return { dir, softs, testInfo, expect, page };
}

/** A pass as runPass() returns one, after loading its row's page, with every check its row owes. */
const stubPass: typeof runPass = async (run) => {
  await run.page.goto(`/${run.row.id}`);
  return {
    row: run.row,
    isolation: [],
    status: run.cell.expectedStatus,
    settled: true,
    emulation: [],
    now: Date.parse(FIXED_TIME),
    results: { violations: [], incomplete: [] } as never,
    sweptPack: [],
    suiteFailures: [],
    failures: [],
    ran: new Set(sweepRowChecks(run.row.id)),
    tokenPages: [],
  };
};

test('a swept row that throws is one sweep-row failure for that row, and the rows after it still run', async () => {
  const plan = planCells({ meta: twoPacks(), registrations, mode: 'pr', changes: CHANGES });
  const cell = plan.cells.find((each) => each.sweep)!;
  const planned = plan.tests.find((each) => each.cell === cell)!;
  for (const throwOn of ['default', 'forced-colors']) {
    const { dir, softs, testInfo, expect, page } = stubRun(throwOn);
    await runCell(
      {
        page: page as never,
        cell,
        viewport: planned.viewport,
        row: planned.row,
        conditions: planned.conditions,
        testInfo: testInfo as never,
        expect: expect as never,
        origin: 'http://127.0.0.1:3000',
      },
      stubPass,
    );
    const records = JSON.parse(readFileSync(path.join(dir, RECORDS_ATTACHMENT), 'utf8')) as {
      rule: string;
      preferenceMode: string;
      pack?: string;
      actual: string;
    }[];
    rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(
      records.map((each) => `${each.rule} ${each.preferenceMode} ${each.pack}`),
      [`sweep-row ${throwOn} ${changeFields(cell).pack}`],
    );
    assert.equal(records[0]!.actual, `page.goto: net::ERR_ABORTED at /${throwOn}`);
    const ran = testInfo.annotations
      .find((each) => each.type === CHECKS_ANNOTATION)!
      .description!.split(' ');
    // Every other row ran to the end, and the broken one listed none of its checks.
    for (const row of SWEEP_ROWS) {
      const own = sweepRowChecks(row.id).map((check) => sweepCheck(row.id, check));
      if (row.id === throwOn)
        assert.ok(
          own.every((check) => !ran.includes(check)),
          row.id,
        );
      else
        assert.ok(
          own.every((check) => ran.includes(check)),
          row.id,
        );
    }
    // So the test fails, by its soft expectation.
    assert.equal(softs.filter((each) => each.startsWith('every row of the sweep ran')).length, 1);
  }
  // A cell that isn't swept still throws, as Playwright reports it.
  const plain = plan.cells.find((each) => !each.sweep)!;
  const own = plan.tests.find((each) => each.cell === plain)!;
  const { testInfo, expect, page } = stubRun(own.row.id);
  await assert.rejects(
    runCell(
      {
        page: page as never,
        cell: plain,
        viewport: own.viewport,
        row: own.row,
        conditions: own.conditions,
        testInfo: testInfo as never,
        expect: expect as never,
      },
      stubPass,
    ),
    /ERR_ABORTED/,
  );
});

test('a cell a changed variant and a changed pack both direct keeps every viewport and row, and the pack still sweeps the other variants', () => {
  const meta = withTierPacks(checkoutMeta());
  const language = meta.PACKS!.find((pack) => pack.kind === 'design-language' && !pack.fixture)!;
  const plan = planCells({
    meta: { ...meta, PACKS: [...meta.PACKS!, clone(language, 'second-language', 'stable', false)] },
    registrations,
    mode: 'pr',
    changes: [
      { axis: 'variant', id: 'fallback', paths: [] },
      { axis: 'designLanguage', id: 'second-language', paths: [] },
    ],
  });
  const both = plan.cells.filter(
    (cell) =>
      cell.changed?.some((by) => by.axis === 'variant') &&
      cell.changed.some((by) => by.axis === 'designLanguage'),
  );
  assert.equal(both.length, 1);
  assert.equal(both[0]!.target, 'fallback');
  assert.ok(!both[0]!.sweep);
  assert.equal(
    plan.tests.filter((each) => each.cell === both[0]).length,
    VIEWPORTS.length + PREFERENCE_ROWS.length - 1,
  );
  const swept = plan.cells.filter((cell) => cell.sweep);
  assert.deepEqual(
    swept.map((cell) => cell.target).sort(),
    variantsOf(plan)
      .filter((variant) => variant !== 'fallback')
      .sort(),
  );
});

test('the planner fails a plan that leaves a changed pack, variant, and check out', () => {
  const meta = twoPacks();
  // A sixth check no swept test runs: every pair misses it.
  const sweepChecks = [...SWEEP_CHECKS, { name: 'hover', row: 'default', check: 'hover' }];
  assert.throws(
    () => planCells({ meta, registrations, mode: 'pr', changes: CHANGES, sweepChecks }),
    /^Error: The PR plan leaves out \d+ changed pack, variant, and check triple\(s\) the \[37\] rule directs, first \w+ second-\w+ × \S+ × hover\.$/,
  );
  // The five it runs pass.
  assert.ok(
    planCells({ meta, registrations, mode: 'pr', changes: CHANGES, sweepChecks: SWEEP_CHECKS }),
  );
});

test("a swept test checks it starts clean: no cookie but the canary's, then its pack's, and localStorage empty on its first load", async () => {
  const cell = {
    tuple: {
      variant: 'fallback',
      designLanguage: 'platform-neutral',
      colorScheme: 'second-scheme',
      typography: 'humanist-ui',
      displayMode: 'light',
    },
  };
  const stub = (cookies: string[], storage: number | undefined) => {
    const added: { name: string; value: string }[] = [];
    const page = {
      context: () => ({
        cookies: async () => cookies.map((name) => ({ name, value: 'x' })),
        addCookies: async (each: { name: string; value: string }[]) => void added.push(...each),
      }),
      addInitScript: async () => undefined,
      evaluate: async () => storage ?? -1,
    };
    return { page: page as never, added };
  };
  const fresh = stub([CANARY_COOKIE], 0);
  assert.deepEqual(await startPack(fresh.page, cell, 'http://127.0.0.1:3000'), []);
  assert.deepEqual(
    fresh.added.map((each) => each.name),
    [APPEARANCE_COOKIE],
  );
  assert.deepEqual(await storageFindings(fresh.page), []);
  // A context a pack before this one used: its cookie, and what it kept.
  const used = stub([CANARY_COOKIE, APPEARANCE_COOKIE], 1);
  assert.deepEqual(
    (await startPack(used.page, cell, 'http://127.0.0.1:3000')).map(
      (each) => `${each.rule}: ${each.actual}`,
    ),
    [`sweep-isolation: the context held ${APPEARANCE_COOKIE}`],
  );
  assert.deepEqual(
    (await storageFindings(used.page)).map((each) => `${each.rule}: ${each.actual}`),
    ['sweep-isolation: 1 entry'],
  );
  // A page nothing recorded fails too: the check never passes by default.
  assert.equal((await storageFindings(stub([], undefined).page))[0]!.actual, 'nothing recorded it');
});

test("each swept row's pass answers whether its page settled, and a cell's annotations go on before any row runs, so a throwing cell carries them (#123)", async () => {
  const plan = planCells({ meta: twoPacks(), registrations, mode: 'pr', changes: CHANGES });
  const cell = plan.cells.find((each) => each.sweep)!;
  const planned = plan.tests.find((each) => each.cell === cell)!;
  const { dir, softs, testInfo, expect, page } = stubRun(null);
  const busyUnder: typeof runPass = async (run, options) => ({
    ...(await stubPass(run, options)),
    settled: run.row.id !== 'reduced-motion',
  });
  await runCell(
    {
      page: page as never,
      cell,
      viewport: planned.viewport,
      row: planned.row,
      conditions: planned.conditions,
      testInfo: testInfo as never,
      expect: expect as never,
      origin: 'http://127.0.0.1:3000',
    },
    busyUnder,
  );
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(
    softs.filter((each) => each.includes(' settles')),
    [`${cell.path} settles, under reduced-motion`],
  );
  // A cell that throws still carries what cellAnnotations() gives it, pushed first.
  const plain = plan.cells.find((each) => !each.sweep)!;
  const own = plan.tests.find((each) => each.cell === plain)!;
  const scripted = { ...plain, requiresScript: 'It draws its workspace with JavaScript.' };
  const run = stubRun(own.row.id);
  await assert.rejects(
    runCell(
      {
        page: run.page as never,
        cell: scripted,
        viewport: own.viewport,
        row: own.row,
        conditions: own.conditions,
        testInfo: run.testInfo as never,
        expect: run.expect as never,
      },
      stubPass,
    ),
    /ERR_ABORTED/,
  );
  rmSync(run.dir, { recursive: true, force: true });
  assert.deepEqual(run.testInfo.annotations, cellAnnotations(scripted));
  assert.ok(run.testInfo.annotations.length > 0);
});
