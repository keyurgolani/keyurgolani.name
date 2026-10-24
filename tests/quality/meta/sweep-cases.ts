// The pack sweep's cases for `pnpm quality:meta` (lib/sweep.ts, #11 and
// #20): a sweep runs its packs one after another on one variant's server,
// so these hold it to what batching must not do, in Chromium, on a
// loopback stand-in for a sweep server. The stand-in renders the pack the
// visitor's preference cookie names, as the host does, and one known-bad
// scheme, whose text fails contrast and which leaves itself in
// localStorage, where a page that shared its context would pick it up.
//
// Each pack runs as each swept test starts, through run-cell.ts's own
// functions: a fresh context, startPack (no cookie but the canary's, then
// the pack's), a full load, storageFindings (localStorage empty), then the
// sweep's default-row checks (a swept test then loads the page again for
// each other row, in the same context): the boundary renders the pack
// (packFindings), axe on the contrast and target-size rules with the
// incomplete contrast resampled (audit), and keyboard focus. The loop over
// packs is this file's: cells.spec.ts gives each pack a test of its own,
// so Playwright's context per test is what keeps them apart there.
//
// - sweep/known-bad-pack (the lead's): a good pack, the known-bad one,
//   then another good one. It fails, every finding names the bad pack, and
//   the pack after it still ran, so batching neither hides a failure nor
//   stops at the first.
// - sweep/small-controls: a design language whose controls are 16 px, under
//   axe's 24 px target size, after a good pack. It fails on target-size,
//   every finding naming that language.
// - sweep-isolation/good-pack-either-order (C's): the good pack after the
//   bad one and before it. It passes both times.
// - sweep-isolation/shared-context: the same packs on one context, which
//   the sweep never does, as a worker-scoped context would be. The good
//   pack after the bad one fails, on sweep-isolation first: the bad pack's
//   cookie and localStorage are still there.
// - sweep-isolation/worker-context: the same, its isolation findings
//   alone, so startPack and storageFindings have to catch it themselves.
// - sweep-rows/either-order (C's): one test's rows on one page, a
//   known-bad row (the focus ring gone under forced colors) after good
//   rows and before them. Each good row finds nothing and the bad row
//   finds its ring missing, in both orders.
// - sweep-rows/no-reset: reduced transparency's media features left on
//   for the default row, which emulateRow() never does. The default row's
//   emulation check fails, so the case above would catch a leak.

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Browser, BrowserContext } from '@playwright/test';
import type { Cell } from '../cells';
import { frames, keyboardFindings, type Finding } from '../lib/a11y/interaction';
import { checkEmulation } from '../lib/emulation';
import { DEFAULT_ROW, PREFERENCE_ROWS } from '../lib/matrix';
import { resolvedTokensScript } from '../lib/probes';
import { audit, emulateRow, startPack, storageFindings } from '../lib/run-cell';
import { APPEARANCE_COOKIE, packFindings } from '../lib/sweep';
import type { MetaCase, MetaOutcome } from './cases';

const GOOD = 'sweep-good';
const BAD = 'sweep-bad';
const LATER = 'sweep-good-later';
/** A known-bad design language: its controls 16 px, under the 24 px target size. */
const SMALL = 'sweep-small-controls';
const VARIANT = 'fallback';

/** A swept cell of the stand-in's variant on `pack`, a language or a scheme, as the planner would make it. */
const swept = (pack: string): Pick<Cell, 'tuple' | 'target'> => ({
  target: VARIANT,
  tuple: {
    variant: VARIANT,
    designLanguage: pack === SMALL ? SMALL : 'platform-neutral',
    colorScheme: pack === SMALL ? GOOD : pack,
    typography: 'humanist-ui',
    displayMode: 'light',
  },
});

/** The stand-in's page for the language and scheme its cookie names, the platform's own without one. */
function page({ language, scheme }: { language: string; scheme: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sweep stand-in</title>
    <style>
      body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #fff; }
      main { max-width: 40rem; margin: 0 auto; padding: 1rem; }
      [data-color-scheme] { color: #111; }
      [data-color-scheme='${BAD}'] { color: #b8b8b8; }
      :focus-visible { outline: 2px solid #000; outline-offset: 2px; }
      a, button { display: inline-block; min-width: 24px; min-height: 24px; color: inherit; }
      [data-design-language='${SMALL}'] button { min-width: 0; min-height: 0; width: 16px; height: 16px; padding: 0; margin: 0; }
    </style>
  </head>
  <body>
    <div data-appearance-boundary="document" data-variant="${VARIANT}" data-design-language="${language}" data-color-scheme="${scheme}" data-typography="humanist-ui">
      <main>
        <h1>A swept pack</h1>
        <p>Body text in the scheme's own color, which the known-bad scheme makes too faint to read.</p>
        <p><a href="/">A link</a> <button type="button">A button</button><button type="button">Another</button></p>
      </main>
    </div>
    <script>
      (() => {
        // What a page could keep between packs on one context: the bad scheme leaves itself here.
        const boundary = document.querySelector('[data-appearance-boundary]');
        const kept = localStorage.getItem('sweep-scheme');
        if (kept) boundary.dataset.colorScheme = kept;
        if (boundary.dataset.colorScheme === '${BAD}') localStorage.setItem('sweep-scheme', '${BAD}');
      })();
    </script>
  </body>
</html>`;
}

/** The language and scheme the request's preference cookie names. */
function cookiePacks(header: string | undefined): { language: string; scheme: string } {
  const value = (header ?? '')
    .split(/;\s*/)
    .find((each) => each.startsWith(`${APPEARANCE_COOKIE}=`))
    ?.slice(APPEARANCE_COOKIE.length + 1);
  const query = new URLSearchParams(decodeURIComponent(value ?? ''));
  return {
    language: query.get('language') ?? 'platform-neutral',
    scheme: query.get('scheme') ?? GOOD,
  };
}

/** The sweep's checks on one pack's page, each finding named by the pack, the variant, and the row. */
async function checkPack(context: BrowserContext, scheme: string, origin: string) {
  const cell = swept(scheme);
  const tab = await context.newPage();
  try {
    // run-cell.ts's own start: a clean context, then the pack's cookie.
    const isolation = await startPack(tab, cell, origin);
    await tab.goto('/', { waitUntil: 'load' });
    await frames(tab);
    isolation.push(...(await storageFindings(tab)));
    const tokens = await tab.evaluate(resolvedTokensScript, []);
    const { results, contrast } = await audit(tab, DEFAULT_ROW, true);
    const findings: Finding[] = [
      ...isolation,
      ...packFindings(cell, tokens),
      ...results.violations.map((rule) => ({
        gate: 'axe',
        rule: rule.id,
        actual: `${rule.nodes.length} element(s)`,
      })),
      ...contrast,
      ...(await keyboardFindings(tab, { focus: true })),
    ];
    return findings.map(
      (each) =>
        `${scheme} on ${cell.target}, ${DEFAULT_ROW.id}: ${each.gate} ${each.rule}: ${each.expected ? `${each.expected}, ` : ''}${each.actual ?? ''}`,
    );
  } finally {
    await tab.close();
  }
}

/**
 * The stand-in's packs, `schemes` in order, each in a fresh context as the
 * sweep runs them, or with `shared` all in one. `keep` picks whose
 * findings count; every pack still has to have run.
 */
async function sweep(
  orders: readonly (readonly string[])[],
  keep: (scheme: string) => boolean,
  shared = false,
  only: (finding: string) => boolean = () => true,
): Promise<MetaOutcome> {
  const server = createServer((request, response) => {
    const found = new URL(request.url ?? '/', 'http://stand-in').pathname === '/';
    response.writeHead(found ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    response.end(found ? page(cookiePacks(request.headers.cookie)) : 'Not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { chromium } = await import('playwright');
  const browser: Browser = await chromium.launch();
  const options = {
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light' as const,
    baseURL: origin,
  };
  try {
    const findings: string[] = [];
    for (const schemes of orders) {
      let ran = 0;
      const one = shared ? await browser.newContext(options) : null;
      for (const scheme of schemes) {
        const context = one ?? (await browser.newContext(options));
        const own = await checkPack(context, scheme, origin);
        ran += 1;
        if (keep(scheme)) findings.push(...own.filter(only));
        if (!one) await context.close();
      }
      await one?.close();
      if (ran !== schemes.length) findings.push(`the sweep ran ${ran} of ${schemes.length} packs`);
    }
    return { passed: findings.length === 0, findings };
  } finally {
    await browser.close();
    server.close();
  }
}

const INPUT = 'a loopback stand-in for a sweep server, its packs by the preference cookie';

// The rows of one swept test, on one page (run-cell.ts's emulateRow): the
// stand-in's focus ring goes under forced colors, so that row is known
// bad and the others good. A row must report its own findings, whatever
// row came before it, and its emulation must be its own.
const ROWS_INPUT = 'one page of a loopback stand-in, its focus ring gone under forced colors';
const BAD_ROW = 'forced-colors';

const ROWS_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sweep rows stand-in</title>
    <style>
      body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #111; background: #fff; }
      main { max-width: 40rem; margin: 0 auto; padding: 1rem; }
      :focus-visible { outline: 2px solid #000; outline-offset: 2px; }
      a, button { display: inline-block; min-width: 24px; min-height: 24px; }
      @media (forced-colors: active) { :focus-visible { outline: none; } }
    </style>
  </head>
  <body>
    <main>
      <h1>Rows on one page</h1>
      <p><a href="/">A link</a> <button type="button">A button</button></p>
    </main>
  </body>
</html>`;

/**
 * Each order's rows on one page, emulated one after another as a swept
 * test does, each checked for its emulation and its focus ring. The good
 * rows must find nothing, and the bad row its missing ring, every time.
 */
async function rows(orders: readonly (readonly string[])[], reset = true): Promise<MetaOutcome> {
  const server = createServer((request, response) => {
    const found = new URL(request.url ?? '/', 'http://stand-in').pathname === '/';
    response.writeHead(found ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    response.end(found ? ROWS_PAGE : 'Not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { chromium } = await import('playwright');
  const browser: Browser = await chromium.launch();
  try {
    const findings: string[] = [];
    for (const order of orders) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: 'light',
        baseURL: origin,
      });
      const tab = await context.newPage();
      for (const id of order) {
        const row = PREFERENCE_ROWS.find((each) => each.id === id)!;
        await emulateRow(tab, row, { reset });
        await tab.goto('/', { waitUntil: 'load' });
        await frames(tab);
        const own = [
          ...(await checkEmulation(tab, row)).map(
            (problem) => `runner media-emulation: ${problem}`,
          ),
          ...(await keyboardFindings(tab, { focus: true })).map(
            (each) => `${each.gate} ${each.rule}: ${each.actual ?? ''}`,
          ),
        ];
        if (id !== BAD_ROW) findings.push(...own.map((each) => `${id}: ${each}`));
        else if (!own.some((each) => each.startsWith('focus '))) {
          findings.push(
            `${id}: the known-bad row found no missing focus ring after ${order.join(', ')}`,
          );
        }
      }
      await context.close();
    }
    return { passed: findings.length === 0, findings };
  } finally {
    await browser.close();
    server.close();
  }
}

export const SWEEP_CASES: readonly MetaCase[] = [
  {
    id: 'sweep/known-bad-pack',
    gate: 'sweep',
    input: `${INPUT}: ${GOOD}, ${BAD}, then ${LATER}`,
    expect: 'fail',
    reason: new RegExp(`^${BAD} on ${VARIANT}, default: (?:axe color-contrast|contrast \\S+):`),
    browser: true,
    run: () => sweep([[GOOD, BAD, LATER]], () => true),
  },
  {
    id: 'sweep/small-controls',
    gate: 'sweep',
    input: `${INPUT}: ${GOOD}, then the design language ${SMALL}, its controls 16 px`,
    expect: 'fail',
    reason: new RegExp(`^${SMALL} on ${VARIANT}, default: axe target-size:`),
    browser: true,
    run: () => sweep([[GOOD, SMALL]], () => true),
  },
  {
    id: 'sweep/good-packs',
    gate: 'sweep',
    input: `${INPUT}: ${GOOD}, then ${LATER}`,
    expect: 'pass',
    browser: true,
    run: () => sweep([[GOOD, LATER]], () => true),
  },
  {
    id: 'sweep-isolation/good-pack-either-order',
    gate: 'sweep-isolation',
    input: `${INPUT}: ${BAD} then ${GOOD}, and ${GOOD} then ${BAD}, each in its own context`,
    expect: 'pass',
    browser: true,
    run: () =>
      sweep(
        [
          [BAD, GOOD],
          [GOOD, BAD],
        ],
        (scheme) => scheme === GOOD,
      ),
  },
  {
    id: 'sweep-isolation/shared-context',
    gate: 'sweep-isolation',
    input: `${INPUT}: ${BAD} then ${GOOD} on one context, which the sweep never does`,
    expect: 'fail',
    reason: new RegExp(
      `^${GOOD} on ${VARIANT}, default: (?:runner sweep-isolation: |runner sweep-pack: data-color-scheme=${GOOD}, data-color-scheme=${BAD}$|axe color-contrast:|contrast \\S+:)`,
    ),
    browser: true,
    run: () => sweep([[BAD, GOOD]], (scheme) => scheme === GOOD, true),
  },
  {
    id: 'sweep-isolation/worker-context',
    gate: 'sweep-isolation',
    input: `${INPUT}: ${BAD} then ${GOOD} on one context, as a worker-scoped one would be, isolation's findings alone`,
    expect: 'fail',
    reason: new RegExp(
      `^${GOOD} on ${VARIANT}, default: runner sweep-isolation: (?:no cookie but quality_canary, the context held portfolio_appearance|localStorage empty on the first load, 1 entry)$`,
    ),
    browser: true,
    run: () =>
      sweep(
        [[BAD, GOOD]],
        (scheme) => scheme === GOOD,
        true,
        (finding) => finding.includes(' runner sweep-isolation: '),
      ),
  },
  {
    id: 'sweep-rows/either-order',
    gate: 'sweep-rows',
    input: `${ROWS_INPUT}: the bad row after good ones, and good ones after it`,
    expect: 'pass',
    browser: true,
    run: () =>
      rows([
        ['default', 'forced-colors', 'reduced-transparency', 'default'],
        ['forced-colors', 'reduced-transparency', 'reduced-motion', 'default'],
      ]),
  },
  {
    id: 'sweep-rows/no-reset',
    gate: 'sweep-rows',
    input: `${ROWS_INPUT}: reduced transparency, then the default row without resetting its features`,
    expect: 'fail',
    reason: /^default: runner media-emulation: /,
    browser: true,
    run: () => rows([['reduced-transparency', 'default']], false),
  },
];
