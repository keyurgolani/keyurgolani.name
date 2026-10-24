// The pack sweep's cases for `pnpm quality:meta` (lib/sweep.ts, #11 and
// #20): a sweep runs its packs one after another on one variant's server,
// so these hold it to what batching must not do, in Chromium, on a
// loopback stand-in for a sweep server. The stand-in renders the pack the
// visitor's preference cookie names, as the host does, and one known-bad
// scheme, whose text fails contrast and which leaves itself in
// localStorage, where a page that shared its context would pick it up.
//
// Each pack runs as each swept test starts: a fresh context, its cookie
// (packCookie), a full load, then the sweep's default-row checks,
// run-cell.ts's own (a swept test then loads the page again for each
// other row, in the same context):
// the boundary renders the pack (packFindings), axe on the contrast rules
// with the incomplete contrast resampled (audit), and keyboard focus.
//
// - sweep/known-bad-pack (the lead's): a good pack, the known-bad one,
//   then another good one. It fails, every finding names the bad pack, and
//   the pack after it still ran, so batching neither hides a failure nor
//   stops at the first.
// - sweep-isolation/good-pack-either-order (C's): the good pack after the
//   bad one and before it. It passes both times.
// - sweep-isolation/shared-context: the same packs on one context, which
//   the sweep never does. The good pack after the bad one fails, so the
//   case above would catch a sweep that let one pack's state carry over.

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Browser, BrowserContext } from '@playwright/test';
import type { Cell } from '../cells';
import { frames, keyboardFindings, type Finding } from '../lib/a11y/interaction';
import { DEFAULT_ROW } from '../lib/matrix';
import { resolvedTokensScript } from '../lib/probes';
import { audit } from '../lib/run-cell';
import { APPEARANCE_COOKIE, packCookie, packFindings } from '../lib/sweep';
import type { MetaCase, MetaOutcome } from './cases';

const GOOD = 'sweep-good';
const BAD = 'sweep-bad';
const LATER = 'sweep-good-later';
const VARIANT = 'fallback';

/** A swept cell of the stand-in's variant on `scheme`, as the planner would make it. */
const swept = (scheme: string): Pick<Cell, 'tuple' | 'target'> => ({
  target: VARIANT,
  tuple: {
    variant: VARIANT,
    designLanguage: 'platform-neutral',
    colorScheme: scheme,
    typography: 'humanist-ui',
    displayMode: 'light',
  },
});

/** The stand-in's page for the scheme its cookie names, the platform's own without one. */
function page(scheme: string): string {
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
    </style>
  </head>
  <body>
    <div data-appearance-boundary="document" data-variant="${VARIANT}" data-design-language="platform-neutral" data-color-scheme="${scheme}" data-typography="humanist-ui">
      <main>
        <h1>A swept pack</h1>
        <p>Body text in the scheme's own color, which the known-bad scheme makes too faint to read.</p>
        <p><a href="/">A link</a> <button type="button">A button</button></p>
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

/** The scheme the request's preference cookie names. */
function cookieScheme(header: string | undefined): string {
  const value = (header ?? '')
    .split(/;\s*/)
    .find((each) => each.startsWith(`${APPEARANCE_COOKIE}=`))
    ?.slice(APPEARANCE_COOKIE.length + 1);
  return new URLSearchParams(decodeURIComponent(value ?? '')).get('scheme') ?? GOOD;
}

/** The sweep's checks on one pack's page, each finding named by the pack, the variant, and the row. */
async function checkPack(context: BrowserContext, scheme: string, origin: string) {
  const cell = swept(scheme);
  await context.addCookies([packCookie(cell, origin)]);
  const tab = await context.newPage();
  try {
    await tab.goto('/', { waitUntil: 'load' });
    await frames(tab);
    const tokens = await tab.evaluate(resolvedTokensScript, []);
    const { results, contrast } = await audit(tab, DEFAULT_ROW, true);
    const findings: Finding[] = [
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
): Promise<MetaOutcome> {
  const server = createServer((request, response) => {
    const found = new URL(request.url ?? '/', 'http://stand-in').pathname === '/';
    response.writeHead(found ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    response.end(found ? page(cookieScheme(request.headers.cookie)) : 'Not found');
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
        if (keep(scheme)) findings.push(...own);
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
      `^${GOOD} on ${VARIANT}, default: (?:runner sweep-pack: data-color-scheme=${GOOD}, data-color-scheme=${BAD}$|axe color-contrast:|contrast \\S+:)`,
    ),
    browser: true,
    run: () => sweep([[BAD, GOOD]], (scheme) => scheme === GOOD, true),
  },
];
