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
// /_fixtures/appearance under the cell's tuple, which renders every slot,
// so every pack the plan reaches is checked there.
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
import { cellAnnotations, framedContrastNote, type Cell } from '../cells';
import { axeFor } from './axe';
import {
  CHECKS_ANNOTATION,
  NOTICE_CHECK,
  requiredChecks,
  SWEEP_ISOLATION_CHECK,
  sweepCheck,
  SWEEP_PACK_CHECK,
  sweepRowChecks,
} from './checks';
import { FIXED_TIME } from './clock';
import { checkEmulation } from './emulation';
import type { PreferenceRow, Viewport } from './matrix';
import { elementDetailsScript, resolvedTokensScript, type ElementDetails } from './probes';
import type { CellFailure } from './failure-records';
import {
  axeFailures,
  changeDiagnostic,
  colorPropertyFor,
  nodeSelector,
  RECORDS_ATTACHMENT,
  runnerFailure,
  type AxeResults,
  type CellContext,
  type ResolvedTokens,
} from './records';
import { loadRegistrations, type Interaction } from './registration';
import { APPEARANCE_STATE } from './state-fixtures';
import { CANARY_COOKIE } from './env';
import { packCookie, packFindings, SWEEP_ROWS } from './sweep';
import { readVitals } from './vitals';
import {
  enhancementFindings,
  notBusy,
  PRINT_IGNORE,
  revealNoscript,
  scriptRequiredFindings,
  STILL_BUSY,
  scriptingMediaFindings,
  inventoryFindings,
  reflowFindings,
  transparencyFindings,
} from './a11y/conditions';
import { framedItems, incompleteContrastFindings } from './a11y/contrast';
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
/** Waits for the page to load and settle, and answers whether it settled (notBusy()). */
async function settle(page: Page): Promise<boolean> {
  await page.waitForLoadState('load');
  const settled = await notBusy(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await frames(page);
  return settled;
}

export interface CellRun {
  readonly page: Page;
  readonly cell: Cell;
  readonly viewport: Viewport;
  readonly row: PreferenceRow;
  /** The default row's reload conditions run here (PlannedTest.conditions). */
  readonly conditions: boolean;
  readonly testInfo: TestInfo;
  readonly expect: typeof import('@playwright/test').expect;
  /** The app's origin, which a swept cell's pack cookie is set on. */
  readonly origin?: string;
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

/** The session a row's CDP media features went through, which emulateRow() clears them on. */
const featureSessions = new WeakMap<Page, CDPSession>();

/**
 * Puts `page` under `row` alone, for a swept test's row after its first
 * (lib/sweep.ts): whatever the row before set is reset first, the CDP
 * media features and the media type, then the row's reduced motion,
 * forced colors, and contrast are emulated on the page, as a context would
 * for its first, and applyRow() sets the rest. The page then loads again.
 * Without `reset`, as a mutant, the row before's CDP features stay.
 */
export async function emulateRow(
  page: Page,
  row: PreferenceRow,
  { reset = true }: { readonly reset?: boolean } = {},
): Promise<void> {
  const features = featureSessions.get(page);
  if (reset && features) {
    await features.send('Emulation.setEmulatedMedia', { media: '', features: [] });
  }
  await page.emulateMedia({
    media: null,
    reducedMotion: row.context.reducedMotion ?? 'no-preference',
    forcedColors: row.context.forcedColors ?? 'none',
    contrast: row.context.contrast ?? 'no-preference',
  });
  await applyRow(page, row);
}

/** Applies what a row sets on the page rather than the context: the media type, CDP features, JavaScript off, and the motion sampler. */
export async function applyRow(page: Page, row: PreferenceRow): Promise<void> {
  if (row.context.javaScriptEnabled === false) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
    scriptless.set(page, cdp);
  }
  if (row.context.media) await page.emulateMedia({ media: row.context.media });
  if (row.context.features) {
    const cdp = featureSessions.get(page) ?? (await page.context().newCDPSession(page));
    featureSessions.set(page, cdp);
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
  /** A Studio surface that needs JavaScript: without it, its notice stands in for its content. */
  readonly scriptRequired: boolean;
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
    findings.push(...(await inventoryFindings(page, at, baseline, undefined, run.scriptRequired)));
    // Its no-JavaScript and print conditions read the notice in place of the content.
    if (run.scriptRequired) ran.add(NOTICE_CHECK);
  }
  if (run.conditions && does('enhancement')) {
    findings.push(...(await enhancementFindings(page, at, baseline, scripts, run.scriptRequired)));
  }
  return findings;
}

/**
 * axe, and its incomplete contrast resampled. Under forced colors the OS
 * palette replaces the page's colors, so neither contrast rule applies
 * there. Without JavaScript axe needs timers, so script runs for axe alone
 * (the page's own never ran) and stops again.
 */
/** The longest axe waits for the page's finite animations to end. */
const ANIMATION_WAIT_MS = 2_000;

/**
 * The axe rules a swept cell's audit runs alone (lib/sweep.ts): the rules
 * about color, and target size, since a design language sets how big its
 * controls are, and the [37] rule keeps touch targets under every one.
 */
export const SWEEP_AXE_RULES = ['color-contrast', 'link-in-text-block', 'target-size'] as const;

export async function audit(page: Page, row: PreferenceRow, sweptRules = false, framed = false) {
  const forced = row.context.forcedColors === 'active';
  const cdp = scriptless.get(page);
  // Read before script turns on: a query axe's pass would flip fails the row.
  const scripting = cdp ? await scriptingMediaFindings(page) : [];
  // What a <noscript> holds stays in view for axe once script is on.
  if (cdp) await revealNoscript(page);
  await cdp?.send('Emulation.setScriptExecutionDisabled', { value: false });
  try {
    // A finite animation, such as a toast's entrance fade, ends before axe
    // reads colors: without JavaScript, settle() can't wait out frames.
    await page.evaluate(
      (wait) =>
        Promise.race([
          Promise.all(
            document
              .getAnimations()
              .filter((each) => each.effect?.getComputedTiming().iterations !== Infinity)
              .map((each) => each.finished.catch(() => undefined)),
          ),
          new Promise((done) => setTimeout(done, wait)),
        ]),
      ANIMATION_WAIT_MS,
    );
    const builder = axeFor(page);
    if (sweptRules) {
      builder.withRules(SWEEP_AXE_RULES.filter((rule) => !forced || rule !== 'color-contrast'));
    }
    if (forced) builder.disableRules(['color-contrast']);
    const results: AxeResults = await builder.analyze();
    const contrast = forced ? [] : await incompleteContrastFindings(page, results, framed);
    // What the sampler left out, which the cell's report says.
    const framedLeftOut = framed && !forced ? framedItems(results) : 0;
    return { results, contrast: [...scripting, ...contrast], framedLeftOut };
  } finally {
    await cdp?.send('Emulation.setScriptExecutionDisabled', { value: true });
  }
}

/** A cell test does a lot: the default row reloads under every condition. */
const CELL_TIMEOUT_MS = 240_000;

/** Where a swept page's init script keeps what localStorage held as the document began. */
const STORAGE_AT_START = '__qualityStorageAtStart';

/**
 * A swept test's start (lib/sweep.ts): the context must hold no cookie but
 * the run's canary, or a pack before this one left its own, and then gets
 * this pack's. Every document the page loads records how many localStorage
 * entries it began with, which storageFindings() reads after the first.
 */
export async function startPack(
  page: Page,
  cell: Pick<Cell, 'tuple'>,
  origin: string,
): Promise<Finding[]> {
  const left = (await page.context().cookies()).filter((each) => each.name !== CANARY_COOKIE);
  await page.context().addCookies([packCookie(cell, origin)]);
  await page.addInitScript((key) => {
    (window as unknown as Record<string, number>)[key] = localStorage.length;
  }, STORAGE_AT_START);
  return left.map((each) => ({
    gate: 'runner',
    rule: SWEEP_ISOLATION_CHECK,
    expected: `no cookie but ${CANARY_COOKIE}`,
    actual: `the context held ${each.name}`,
  }));
}

/** Whether the page's document began with localStorage empty, as a fresh context's does. */
export async function storageFindings(page: Page): Promise<Finding[]> {
  const kept = await page.evaluate(
    (key) => (window as unknown as Record<string, number | undefined>)[key] ?? -1,
    STORAGE_AT_START,
  );
  if (kept === 0) return [];
  return [
    {
      gate: 'runner',
      rule: SWEEP_ISOLATION_CHECK,
      expected: 'localStorage empty on the first load',
      actual: kept < 0 ? 'nothing recorded it' : `${kept} entr${kept === 1 ? 'y' : 'ies'}`,
    },
  ];
}

/** What one pass of a cell test found: its row's checks on the cell's page, and on the primitives page. */
export interface Pass {
  readonly row: PreferenceRow;
  /** A swept test's first pass: whether it started clean (startPack, storageFindings). */
  readonly isolation: readonly Finding[];
  readonly status: number;
  /** Whether the page settled (notBusy()) after it loaded. */
  readonly settled: boolean;
  readonly emulation: readonly string[];
  readonly now: number;
  readonly results: AxeResults;
  readonly sweptPack: readonly Finding[];
  /** The suites' failures, the page's and the primitives'. */
  readonly suiteFailures: readonly CellFailure[];
  /** Every failure record of the pass. */
  readonly failures: readonly CellFailure[];
  readonly ran: ReadonlySet<string>;
  readonly tokenPages: readonly { route: string; tokens: ResolvedTokens; file: string }[];
  /** How many items inside a frame a framedContrast cell's contrast sampler left out. */
  readonly framedLeftOut?: number;
}

/**
 * One row's pass on `page`. A swept cell's passes after its first share
 * the page: `reemulate` resets the row before's emulation and sets this
 * row's (emulateRow), its artifacts take the row's name first, and it
 * owes its row's sweep checks (checks.ts's sweepRowChecks).
 */
export async function runPass(
  { page, cell, viewport, row, conditions, testInfo, origin }: CellRun,
  options: { readonly reemulate: boolean },
): Promise<Pass> {
  const ran = new Set<string>();
  const owed = new Set(
    cell.sweep ? sweepRowChecks(row.id) : requiredChecks(row.id, viewport.id, conditions),
  );
  // A swept test's first pass sets its pack, once it has checked the context is clean.
  const first = cell.sweep === true && !options.reemulate;
  const isolation: Finding[] = [];
  if (first) {
    if (!origin)
      throw new Error(`${cell.id} is swept, and its run names no origin to set its pack on.`);
    isolation.push(...(await startPack(page, cell, origin)));
  }
  // The print row compares the page in print with the page on screen, so it loads on screen first.
  const printRow = row.context.media === 'print';
  const onScreen = printRow ? { ...row, context: { ...row.context, media: undefined } } : row;
  if (options.reemulate) await emulateRow(page, onScreen);
  else await applyRow(page, onScreen);
  const at = rowPath(cell, row);
  const response = await page.goto(at, { waitUntil: 'load' });
  const status = response?.status() ?? 0;
  ran.add('status');
  const settled = await settle(page);
  if (first) {
    isolation.push(...(await storageFindings(page)));
    ran.add(SWEEP_ISOLATION_CHECK);
  }
  const screen = printRow ? await inPage<string[]>(page, { kind: 'inventory' }) : [];
  if (printRow) await page.emulateMedia({ media: 'print' });

  const emulation = await checkEmulation(page, row);
  ran.add('emulation');
  const now = await page.evaluate(() => Date.now());
  ran.add('clock');

  // Under reduced motion the frame window after load passes before axe, whose own frames would count.
  const motion = owed.has('motion') ? await motionFindings(page) : [];
  const { results, contrast, framedLeftOut } = await audit(
    page,
    row,
    cell.sweep ?? false,
    cell.framedContrast !== undefined,
  );
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
  const tokens: ResolvedTokens = await page.evaluate(resolvedTokensScript, [...TOKEN_PROPERTIES]);

  // On disk in the test's output directory, which the reports artifact
  // uploads, passed or not: axe's JSON, the vitals, and the resolved tokens.
  const written: string[] = [];
  const named = (name: string) => (cell.sweep ? `${row.id}-${name}` : name);
  const keep = async (name: string, value: unknown) => {
    const file = testInfo.outputPath(named(name));
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
    written.push(path.relative(reportsDir(), file));
    await testInfo.attach(named(name), { path: file, contentType: 'application/json' });
  };
  await keep('axe.json', { violations: results.violations, incomplete: results.incomplete });
  await keep('vitals.json', vitals);
  await keep('resolved-tokens.json', tokens);
  // A swept cell's tuple came by the visitor's cookie: the page must render its packs (lib/sweep.ts).
  const sweptPack = cell.sweep ? packFindings(cell, tokens) : [];
  if (cell.sweep) ran.add(SWEEP_PACK_CHECK);
  // What a change-directed cell's failures name its tokens from (the [37] rule).
  const tokenPages = [{ route: cell.route, tokens, file: written.at(-1)! }];

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

  // The no-JavaScript row on a surface that needs it reads its notice too.
  const noticeRow = cell.requiresScript !== undefined && row.id === 'no-javascript';
  if (noticeRow) ran.add(NOTICE_CHECK);
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
      scriptRequired: cell.requiresScript !== undefined,
    })),
    // The no-JavaScript row on a surface that needs it: its honest state, axe having run above.
    ...(noticeRow
      ? await scriptRequiredFindings(page, scriptless.get(page) ?? null, 'no-javascript', {
          axe: false,
        })
      : []),
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
  // A swept cell checks its variant's page alone: the full cells and quality-full keep the primitives.
  if (isAppearanceCell(cell) && row.id !== 'print' && !cell.sweep) {
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
      const primitiveTokens: ResolvedTokens = await page.evaluate(resolvedTokensScript, [
        ...TOKEN_PROPERTIES,
      ]);
      await keep('primitives-resolved-tokens.json', primitiveTokens);
      tokenPages.push({ route: PRIMITIVES_ROUTE, tokens: primitiveTokens, file: written.at(-1)! });
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
          scriptRequired: false,
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
    ...(settled ? [] : [runnerFailure(context, 'settled', STILL_BUSY)]),
    ...[...isolation, ...sweptPack].map((finding) => ({
      ...runnerFailure(context, finding.rule, finding.actual ?? ''),
      expected: finding.expected,
    })),
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
  if (owed.has('motion')) ran.add('motion');
  return {
    row,
    isolation,
    status,
    settled,
    emulation,
    now,
    results,
    sweptPack,
    suiteFailures: [...found, ...primitives],
    failures,
    ran,
    tokenPages,
    framedLeftOut,
  };
}

/**
 * A cell test: its row's pass, or a swept cell's four (lib/sweep.ts), one
 * after another on the test's page, each checked to the end before the
 * next, and every finding recorded before the test fails.
 */
export async function runCell(run: CellRun, pass: typeof runPass = runPass) {
  const { cell, testInfo, expect } = run;
  testInfo.setTimeout(CELL_TIMEOUT_MS);
  // First, so a cell that throws carries them too.
  testInfo.annotations.push(...cellAnnotations(cell));
  const passes: Pass[] = [];
  // A swept row that throws is a failure of its own, and the rows after it still run.
  const broken: CellFailure[] = [];
  for (const [at, row] of (cell.sweep ? SWEEP_ROWS : [run.row]).entries()) {
    try {
      passes.push(await pass({ ...run, row }, { reemulate: at > 0 }));
    } catch (error) {
      if (!cell.sweep) throw error;
      const context: CellContext = { cell, viewport: run.viewport, row, artifacts: [] };
      broken.push(
        runnerFailure(context, 'sweep-row', (error as Error).message.split('\n')[0] ?? ''),
      );
    }
  }
  const failures = [...passes.flatMap((pass) => pass.failures), ...broken];
  const file = testInfo.outputPath(RECORDS_ATTACHMENT);
  writeFileSync(file, `${JSON.stringify(failures, null, 2)}\n`);
  await testInfo.attach(RECORDS_ATTACHMENT, { path: file, contentType: 'application/json' });
  // A swept test's checks by row (checks.ts's sweepCheck), so the verdict holds it to each row's.
  const ran = passes.flatMap((pass) =>
    [...pass.ran].map((check) => (cell.sweep ? sweepCheck(pass.row.id, check) : check)),
  );
  testInfo.annotations.push({ type: CHECKS_ANNOTATION, description: ran.join(' ') });
  // A cell that leaves its frame out of the contrast sampler says how many items, and why.
  if (cell.framedContrast !== undefined) {
    const leftOut = passes.reduce((sum, each) => sum + (each.framedLeftOut ?? 0), 0);
    testInfo.annotations.push(framedContrastNote(cell, leftOut));
  }
  // A change-directed cell's failures name the changed axis, and the tokens it resolved.
  const diagnostic = changeDiagnostic(
    cell,
    passes.flatMap((pass) => pass.tokenPages),
  );
  if (diagnostic) testInfo.annotations.push({ type: 'changed', description: diagnostic });
  const about = (what: string) => (diagnostic ? `${what}. ${diagnostic}` : what);

  expect
    .soft(
      broken.map((failure) => `${failure.preferenceMode}: ${failure.actual}`),
      about('every row of the sweep ran to the end'),
    )
    .toEqual([]);
  for (const each of passes) {
    const { row, status, settled, emulation, now, results } = each;
    const under = cell.sweep ? `, under ${row.id}` : '';
    expect
      .soft(status, `${cell.path} answers ${cell.expectedStatus}${under}`)
      .toBe(cell.expectedStatus);
    expect.soft(settled ? null : STILL_BUSY, `${cell.path} settles${under}`).toBeNull();
    expect.soft(emulation, `the ${row.id} row's media emulation`).toEqual([]);
    expect
      .soft(
        each.isolation.map((finding) => `${finding.expected}, found ${finding.actual}`),
        about(`the swept test started clean${under}`),
      )
      .toEqual([]);
    expect
      .soft(
        each.sweptPack.map((finding) => `${finding.expected}, rendered ${finding.actual}`),
        about(`the swept pack's tuple, as the page rendered it${under}`),
      )
      .toEqual([]);
    expect.soft(new Date(now).toISOString(), `the page's clock${under}`).toBe(FIXED_TIME);
    expect
      .soft(
        results.violations.map(
          (rule) => `${rule.id}: ${rule.nodes.length} element(s), ${rule.help}`,
        ),
        about(`axe, WCAG 2.2 AA${under}`),
      )
      .toEqual([]);
    expect
      .soft(
        each.suiteFailures.map(
          (failure) =>
            `${failure.check} ${failure.rule} on ${failure.surface} at ${failure.viewport}${failure.element?.selector ? `, ${failure.element.selector}` : ''}: ${failure.actual}`,
        ),
        about(`Slice 2's suites${under}`),
      )
      .toEqual([]);
  }
}
