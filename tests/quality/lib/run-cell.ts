// One quality cell in one viewport, preference row, and engine (#11, Slices
// 1 and 2). It applies the row, loads the cell's path from the quality
// build, and checks, in order: the status its state answers, that the
// row's emulation took, that the page's clock reads FIXED_TIME, axe with
// the WCAG 2.2 AA tags, and axe's incomplete contrast resolved against the
// worst background. Then the suites the row and viewport owe
// (checks.ts's requiredChecks): keyboard, focus, occlusion, overlays,
// hover, reflow, the content inventory, failed enhancement, motion, and
// transparency (lib/a11y/). An appearance cell, the complete fixture at
// the first route, also runs them on #19's shared primitives at
// /_fixtures/appearance under the cell's tuple, the one page that renders
// the packs today, so every pack the plan reaches is checked there.
//
// Everything it saw is attached first (axe's JSON, the vitals, the
// boundary's resolved tokens, and one failure record per failing rule and
// element), so a failure keeps its evidence. Egress is the fixtures': any
// request outside the app fails the test, from the browser or the server.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CDPSession, Page, TestInfo } from '@playwright/test';
import { reportsDir } from '../../../ci/lib/reports.mjs';
import { QUERY_KEYS } from '../../../packages/appearance/src/axes';
import { COLOR_ROLES, TOKEN_PROPERTIES } from '../../../packages/appearance/src/roles';
import type { Cell } from '../cells';
import { axeFor } from './axe';
import { CHECKS_ANNOTATION, requiredChecks } from './checks';
import { FIXED_TIME } from './clock';
import { checkEmulation } from './emulation';
import type { PreferenceRow, Viewport } from './matrix';
import { elementDetailsScript, resolvedTokensScript, type ElementDetails } from './probes';
import type { CellFailure } from './failure-records';
import {
  axeFailures,
  colorPropertyFor,
  nodeSelector,
  RECORDS_ATTACHMENT,
  runnerFailure,
  type AxeResults,
  type CellContext,
} from './records';
import { loadRegistrations, type Interaction } from './registration';
import { APPEARANCE_STATE } from './state-fixtures';
import { readVitals } from './vitals';
import {
  enhancementFindings,
  PRINT_IGNORE,
  inventoryFindings,
  reflowFindings,
  transparencyFindings,
} from './a11y/conditions';
import { incompleteContrastFindings } from './a11y/contrast';
import {
  frames,
  hoverFindings,
  keyboardFindings,
  overlayFindings,
  type Finding,
} from './a11y/interaction';
import { MOTION_SAMPLER, motionFindings } from './a11y/motion';
import { inPage } from './a11y/probe';

/** Waits for the page to settle: loaded, its fonts in, and two frames drawn (or their time, without JavaScript). */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await frames(page);
}

export interface CellRun {
  readonly page: Page;
  readonly cell: Cell;
  readonly viewport: Viewport;
  readonly row: PreferenceRow;
  readonly testInfo: TestInfo;
  readonly expect: typeof import('@playwright/test').expect;
}

/** #19's shared primitives, in every state, which render the packs a tuple names. */
export const PRIMITIVES_ROUTE = '/_fixtures/appearance';
export const PRIMITIVES_SURFACE = 'primitives';

/** The primitives page under `cell`'s tuple, by #19's demo keys. */
export function primitivesPath(cell: Cell, row: PreferenceRow): string {
  const query = new URLSearchParams({
    [QUERY_KEYS.designLanguage]: cell.tuple.designLanguage,
    [QUERY_KEYS.colorScheme]: cell.tuple.colorScheme,
    [QUERY_KEYS.typography]: cell.tuple.typography,
    [QUERY_KEYS.displayMode]: row.context.displayMode ?? cell.tuple.displayMode,
  });
  return `${PRIMITIVES_ROUTE}?${query}`;
}

/** An appearance cell: a composition's covering-array or display-mode row on the complete fixture at its first route. */
export const isAppearanceCell = (cell: Cell) =>
  cell.kind === 'composition' && cell.state === APPEARANCE_STATE.id && cell.path === '/';

/** The cell's path under a row that sets a display mode, for a page that reads the query. */
function rowPath(cell: Cell, row: PreferenceRow): string {
  if (!row.context.displayMode) return cell.path;
  const url = new URL(cell.path, 'http://cell.test');
  url.searchParams.set(QUERY_KEYS.displayMode, row.context.displayMode);
  return `${url.pathname}${url.search}`;
}

/** The session that turned JavaScript off on a page, which audit() turns it back on through. */
const scriptless = new WeakMap<Page, CDPSession>();

/** Applies what a row sets on the page rather than the context: the media type, CDP features, JavaScript off, and the motion sampler. */
async function applyRow(page: Page, row: PreferenceRow): Promise<void> {
  if (row.context.javaScriptEnabled === false) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
    scriptless.set(page, cdp);
  }
  if (row.context.media) await page.emulateMedia({ media: row.context.media });
  if (row.context.features) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', {
      media: row.context.media ?? '',
      features: [{ name: 'prefers-color-scheme', value: 'light' }, ...row.context.features],
    });
  }
  if (row.id === 'reduced-motion') await page.addInitScript(MOTION_SAMPLER);
}

let interactionsByTarget: Promise<Map<string, readonly Interaction[]>> | undefined;

/** The interactions a surface or unit registers for `target`, on `route`. */
async function interactionsFor(target: string, route: string): Promise<readonly Interaction[]> {
  interactionsByTarget ??= loadRegistrations().then(
    ({ surfaces, units }) =>
      new Map([...surfaces, ...units].map((each) => [each.id, each.interactions])),
  );
  return ((await interactionsByTarget).get(target) ?? []).filter((each) => each.route === route);
}

interface SuiteRun {
  readonly page: Page;
  /** The path the page is on, which a condition reloads. */
  readonly at: string;
  readonly owed: ReadonlySet<string>;
  readonly interactions: readonly Interaction[];
  readonly viewport: Viewport;
  readonly ran: Set<string>;
  /** Run the default row's content conditions: the inventory and failed enhancement. */
  readonly conditions: boolean;
}

/** Slice 2's suites on the page `run.at` names, as `run.owed` says. Motion runs before axe, in runCell. */
async function suites(run: SuiteRun): Promise<Finding[]> {
  const { page, at, owed, ran } = run;
  const findings: Finding[] = [];
  const does = (check: string) => {
    if (!owed.has(check)) return false;
    ran.add(check);
    return true;
  };
  const baseline = await inPage<string[]>(page, { kind: 'inventory' });
  const scripts = await page.evaluate(() => [...document.scripts].map((script) => script.src));
  if (owed.has('keyboard')) {
    findings.push(
      ...(await keyboardFindings(page, { focus: does('focus'), occlusion: does('occlusion') })),
    );
    ran.add('keyboard');
  }
  if (does('overlays')) findings.push(...(await overlayFindings(page, run.interactions)));
  if (does('hover')) findings.push(...(await hoverFindings(page)));
  if (does('transparency')) findings.push(...(await transparencyFindings(page)));
  if (does('landscape-occlusion')) {
    const [width, height] = [run.viewport.height, run.viewport.width];
    const original = page.viewportSize()!;
    await page.setViewportSize({ width, height });
    await page.goto(at, { waitUntil: 'load' });
    await frames(page);
    for (const finding of await keyboardFindings(page, { occlusion: true })) {
      if (finding.gate === 'occlusion')
        findings.push({ ...finding, viewport: `${width}x${height}` });
    }
    await page.setViewportSize(original);
    await page.goto(at, { waitUntil: 'load' });
    await frames(page);
  }
  if (does('reflow')) {
    const disclosures = run.interactions.filter((each) => each.kind === 'disclosure');
    findings.push(
      ...(await reflowFindings(
        page,
        at,
        disclosures.map((each) => each.name),
      )),
    );
  }
  if (run.conditions && does('inventory')) {
    findings.push(...(await inventoryFindings(page, at, baseline)));
  }
  if (run.conditions && does('enhancement')) {
    findings.push(...(await enhancementFindings(page, at, baseline, scripts)));
  }
  return findings;
}

/**
 * axe, and its incomplete contrast resampled. Under forced colors the OS
 * palette replaces the page's colors, so neither contrast rule applies
 * there. Without JavaScript axe needs timers, so script runs for axe alone
 * (the page's own never ran) and stops again.
 */
async function audit(page: Page, row: PreferenceRow) {
  const forced = row.context.forcedColors === 'active';
  const cdp = scriptless.get(page);
  await cdp?.send('Emulation.setScriptExecutionDisabled', { value: false });
  try {
    const builder = axeFor(page);
    if (forced) builder.disableRules(['color-contrast']);
    const results: AxeResults = await builder.analyze();
    return { results, contrast: forced ? [] : await incompleteContrastFindings(page, results) };
  } finally {
    await cdp?.send('Emulation.setScriptExecutionDisabled', { value: true });
  }
}

/** A cell test does a lot: the default row reloads under every condition. */
const CELL_TIMEOUT_MS = 240_000;

export async function runCell({ page, cell, viewport, row, testInfo, expect }: CellRun) {
  testInfo.setTimeout(CELL_TIMEOUT_MS);
  const ran = new Set<string>();
  const owed = new Set(requiredChecks(row.id, viewport.id));
  // The print row compares the page in print with the page on screen, so it loads on screen first.
  const printRow = row.context.media === 'print';
  await applyRow(page, printRow ? { ...row, context: { ...row.context, media: undefined } } : row);
  const at = rowPath(cell, row);
  const response = await page.goto(at, { waitUntil: 'load' });
  const status = response?.status() ?? 0;
  ran.add('status');
  await settle(page);
  const screen = printRow ? await inPage<string[]>(page, { kind: 'inventory' }) : [];
  if (printRow) await page.emulateMedia({ media: 'print' });

  const emulation = await checkEmulation(page, row);
  ran.add('emulation');
  const now = await page.evaluate(() => Date.now());
  ran.add('clock');

  // Under reduced motion the frame window after load passes before axe, whose own frames would count.
  const motion = owed.has('motion') ? await motionFindings(page) : [];
  const { results, contrast } = await audit(page, row);
  ran.add('axe');
  const details: Record<string, ElementDetails[]> = {};
  for (const rule of results.violations) {
    details[rule.id] = await page.evaluate(elementDetailsScript, {
      selectors: rule.nodes.map((node) => nodeSelector(node) ?? ':not(*)'),
      property: colorPropertyFor(rule.id),
      roles: [...COLOR_ROLES],
    });
  }
  const vitals = await readVitals(page);
  const tokens = await page.evaluate(resolvedTokensScript, [...TOKEN_PROPERTIES]);

  // On disk in the test's output directory, which the reports artifact
  // uploads, passed or not: axe's JSON, the vitals, and the resolved tokens.
  const written: string[] = [];
  const keep = async (name: string, value: unknown) => {
    const file = testInfo.outputPath(name);
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    written.push(path.relative(reportsDir(), file));
    await testInfo.attach(name, { path: file, contentType: 'application/json' });
  };
  await keep('axe.json', { violations: results.violations, incomplete: results.incomplete });
  await keep('vitals.json', vitals);
  await keep('resolved-tokens.json', tokens);

  const context: CellContext = { cell, viewport, row, artifacts: written };
  const found: CellFailure[] = [];
  const record = async (findings: readonly Finding[], surface?: { id: string; route: string }) => {
    const paths = [...new Set(findings.flatMap((finding) => (finding.path ? [finding.path] : [])))];
    const elements = await page
      .evaluate(elementDetailsScript, { selectors: paths, property: null, roles: [...COLOR_ROLES] })
      .catch(() => [] as ElementDetails[]);
    for (const finding of findings) {
      const element = finding.path ? elements[paths.indexOf(finding.path)] : undefined;
      found.push({
        ...runnerFailure(context, finding.rule, finding.actual ?? ''),
        check: finding.gate,
        ...(surface ? { surface: surface.id, composition: false, route: surface.route } : {}),
        ...(finding.viewport ? { viewport: finding.viewport } : {}),
        ...(finding.inputMode ? { inputMode: finding.inputMode } : {}),
        expected: finding.expected,
        element: finding.path
          ? {
              semanticRole: element?.semanticRole,
              accessibleName: element?.accessibleName,
              uiSlot: element?.uiSlot,
              selector: finding.path,
            }
          : undefined,
      });
    }
  };

  // The page's own suites, then the primitives under the cell's tuple.
  const own = [
    ...motion,
    ...contrast,
    ...(await suites({
      page,
      at,
      owed,
      interactions: await interactionsFor(cell.target, cell.route),
      viewport,
      ran,
      conditions: row.id === 'default',
    })),
  ];
  ran.add('contrast');
  if (printRow) {
    // The print row's inventory: the page in print against the page on screen.
    ran.add('inventory');
    const printed = new Set(await inPage<string[]>(page, { kind: 'inventory' }));
    const gone = screen.filter((item) => !printed.has(item) && !PRINT_IGNORE.test(item));
    for (const item of gone.slice(0, 10)) {
      own.push({
        gate: 'inventory',
        rule: 'content',
        expected: 'present in print',
        actual: `${gone.length} field(s) missing, here ${item}`,
      });
    }
  }
  await record(own);
  const primitives: CellFailure[] = [];
  if (isAppearanceCell(cell) && row.id !== 'print') {
    const before = found.length;
    const route = primitivesPath(cell, row);
    const answer = await page.goto(route, { waitUntil: 'load' });
    await settle(page);
    const surface = { id: PRIMITIVES_SURFACE, route: PRIMITIVES_ROUTE };
    const findings: Finding[] = [];
    if (answer?.status() !== 200) {
      findings.push({
        gate: 'runner',
        rule: 'status',
        actual: `${answer?.status() ?? 0}, not 200`,
      });
    } else {
      const problems = await checkEmulation(page, row);
      for (const problem of problems)
        findings.push({ gate: 'runner', rule: 'media-emulation', actual: problem });
      findings.push(...(owed.has('motion') ? await motionFindings(page) : []));
      const { results: axe, contrast: resampled } = await audit(page, row);
      const primitiveContext: CellContext = {
        ...context,
        cell: { ...cell, target: PRIMITIVES_SURFACE, kind: 'surface', route: PRIMITIVES_ROUTE },
      };
      primitives.push(...axeFailures(primitiveContext, axe, {}));
      findings.push(...resampled);
      findings.push(
        ...(await suites({
          page,
          at: route,
          owed,
          interactions: [],
          viewport,
          ran: new Set(),
          conditions: false,
        })),
      );
    }
    await record(findings, surface);
    primitives.push(...found.splice(before));
  }

  const failures: CellFailure[] = [
    ...axeFailures(context, results, details),
    ...(status === cell.expectedStatus
      ? []
      : [runnerFailure(context, 'status', `${status}, not ${cell.expectedStatus}`)]),
    ...emulation.map((problem) => runnerFailure(context, 'media-emulation', problem)),
    ...(now === Date.parse(FIXED_TIME)
      ? []
      : [
          runnerFailure(
            context,
            'fixed-clock',
            `${new Date(now).toISOString()}, not ${FIXED_TIME}`,
          ),
        ]),
    ...found,
    ...primitives,
  ];
  await keep(RECORDS_ATTACHMENT, failures);
  if (owed.has('motion')) ran.add('motion');
  testInfo.annotations.push({ type: CHECKS_ANNOTATION, description: [...ran].join(' ') });

  expect.soft(status, `${cell.path} answers ${cell.expectedStatus}`).toBe(cell.expectedStatus);
  expect.soft(emulation, `the ${row.id} row's media emulation`).toEqual([]);
  expect.soft(new Date(now).toISOString(), "the page's clock").toBe(FIXED_TIME);
  expect
    .soft(
      results.violations.map((rule) => `${rule.id}: ${rule.nodes.length} element(s), ${rule.help}`),
      'axe, WCAG 2.2 AA',
    )
    .toEqual([]);
  expect
    .soft(
      [...found, ...primitives].map(
        (failure) =>
          `${failure.check} ${failure.rule} on ${failure.surface} at ${failure.viewport}${failure.element?.selector ? `, ${failure.element.selector}` : ''}: ${failure.actual}`,
      ),
      "Slice 2's suites",
    )
    .toEqual([]);
}
