// The accessibility suites' cases for `pnpm quality:meta` (#11, Slice 2,
// VR1 and VR2): a known-bad page for each check and a known-good one, each
// run through the check run-cell.ts runs, on a loopback stand-in host in
// Chromium. The known-bad pages are under tests/quality/fixtures/a11y/,
// and good.html is the page every suite passes. Each case's findings are
// the check's own, so a page that breaks some other rule doesn't count.
// The compiled-CSS audit needs no browser.

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContextOptions, Page } from '@playwright/test';
import { axeFor } from '../lib/axe';
import { checkEmulation } from '../lib/emulation';
import { PREFERENCE_ROWS } from '../lib/matrix';
import {
  enhancementFindings,
  inventoryFindings,
  reflowFindings,
  scriptingMediaFindings,
  transparencyFindings,
} from '../lib/a11y/conditions';
import { incompleteContrastFindings } from '../lib/a11y/contrast';
import {
  frames,
  hoverFindings,
  keyboardFindings,
  overlayFindings,
  type Finding,
} from '../lib/a11y/interaction';
import { killSwitches, MOTION_SAMPLER, motionFindings, osWinsFindings } from '../lib/a11y/motion';
import { inPage } from '../lib/a11y/probe';
import type { MetaCase, MetaOutcome } from './cases';

const FIXTURES = fileURLToPath(new URL('../fixtures/a11y/', import.meta.url));

const outcome = (findings: readonly Finding[]): MetaOutcome => ({
  passed: findings.length === 0,
  findings: findings.map((each) => `${each.gate} ${each.rule}: ${each.actual ?? ''}`),
});

interface PageOptions extends BrowserContextOptions {
  /** An init script, such as the motion sampler. */
  readonly init?: string;
  /** The path to load, its query included. */
  readonly at?: string;
  /** Media features through CDP, as a row sets them. */
  readonly features?: readonly { readonly name: string; readonly value: string }[];
  /** The media type, as the print row sets it. */
  readonly media?: 'print';
  /** JavaScript off, through CDP, as run-cell.ts turns it off for the no-JavaScript row. */
  readonly noScript?: boolean;
}

/**
 * `file` served at / from a loopback host, open in Chromium at 1440x900
 * with `options`, and `check` run on it. The stand-in serves no other path.
 */
async function onPage(
  file: string,
  check: (page: Page) => Promise<Finding[]>,
  options: PageOptions = {},
): Promise<MetaOutcome> {
  // A fixture's name, or a page built here.
  const html = file.startsWith('<') ? file : readFileSync(path.join(FIXTURES, file), 'utf8');
  const server = createServer((request, response) => {
    const found = new URL(request.url ?? '/', 'http://stand-in').pathname === '/';
    response.writeHead(found ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    response.end(found ? html : 'Not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const { init, at, features, media, noScript, ...context } = options;
    const page = await (
      await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: 'light',
        baseURL: origin,
        ...context,
      })
    ).newPage();
    if (init) await page.addInitScript(init);
    if (media) await page.emulateMedia({ media });
    if (features) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setEmulatedMedia', { media: '', features: [...features] });
    }
    if (noScript) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
    }
    await page.goto(at ?? '/', { waitUntil: 'load' });
    await frames(page);
    return outcome(await check(page));
  } finally {
    await browser.close();
    server.close();
  }
}

/** A known-bad case: `file` fails `check`, every finding `gate rule`. */
function bad(
  id: string,
  file: string,
  gate: string,
  rules: string,
  check: (page: Page) => Promise<Finding[]>,
  options?: PageOptions,
): MetaCase {
  return {
    id: `${gate}/${id}`,
    gate,
    input: `tests/quality/fixtures/a11y/${file}`,
    expect: 'fail',
    reason: new RegExp(`^${gate} (?:${rules}): `),
    browser: true,
    run: () => onPage(file, check, options),
  };
}

/** A known-bad case on a page built here, every finding matching `reason`. */
function builtCase(
  id: string,
  gate: string,
  input: string,
  html: string,
  reason: RegExp,
  check: (page: Page) => Promise<Finding[]>,
  options?: PageOptions,
): MetaCase {
  return {
    id: `${gate}/${id}`,
    gate,
    input,
    expect: 'fail',
    reason,
    browser: true,
    run: () => onPage(html, check, options),
  };
}

/** The known-good case for `gate`: good.html passes `check`. */
function good(
  gate: string,
  check: (page: Page) => Promise<Finding[]>,
  options?: PageOptions,
): MetaCase {
  return {
    id: `${gate}/good`,
    gate,
    input: 'tests/quality/fixtures/a11y/good.html',
    expect: 'pass',
    browser: true,
    run: () => onPage('good.html', check, options),
  };
}

const keyboard = (page: Page) => keyboardFindings(page);
const focus = async (page: Page) =>
  (await keyboardFindings(page, { focus: true })).filter((each) => each.gate === 'focus');
const occlusion = async (page: Page) =>
  (await keyboardFindings(page, { occlusion: true })).filter((each) => each.gate === 'occlusion');
const overlays = (page: Page) => overlayFindings(page, []);
const baseline = (page: Page) => inPage<string[]>(page, { kind: 'inventory' });
const inventory = async (page: Page) => inventoryFindings(page, '/', await baseline(page));
const enhancement = async (page: Page) =>
  enhancementFindings(
    page,
    '/',
    await baseline(page),
    await page.evaluate(() => [...document.scripts].map((script) => script.src)),
  );

/** axe's violations of `rule` alone: what the axe gate reports for it. */
const axeRule =
  (rule: string) =>
  async (page: Page): Promise<Finding[]> =>
    (await axeFor(page).analyze()).violations
      .filter((each) => each.id === rule)
      .flatMap((each) =>
        each.nodes.map((node) => ({ gate: 'axe', rule: each.id, actual: node.failureSummary })),
      );
const axeAll = async (page: Page): Promise<Finding[]> =>
  (await axeFor(page).analyze()).violations.map((each) => ({
    gate: 'axe',
    rule: each.id,
    actual: each.help,
  }));
const contrast = async (page: Page) =>
  incompleteContrastFindings(page, await axeFor(page).analyze());

const REDUCED: BrowserContextOptions = { reducedMotion: 'reduce' };

/** A page of `body`, built here for the cases that need many of one thing. */
const built = (title: string, style: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>:focus-visible { outline: 2px solid #000; outline-offset: 2px; } ${style}</style></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

/** More :hover subjects than the check takes, the one that reveals content last in the page. */
const MANY_HOVERS = built(
  'Many hover rules',
  `${Array.from({ length: 45 }, (_, i) => `.h${i}:hover { color: #000; }`).join(' ')} .card .more { display: none; } .card:hover .more { display: block; }`,
  `${Array.from({ length: 45 }, (_, i) => `<p class="h${i}">Item ${i}</p>`).join('')}<div class="card"><a href="#card">A card</a><p class="more">Only a pointer finds this.</p></div>`,
);

/** Sixty links under one :hover rule that styles only the link: one hover stands for them all. */
const MANY_LINKS = built(
  'Many links',
  'a:hover { color: #000; }',
  Array.from({ length: 60 }, (_, i) => `<p><a href="#l${i}">Link ${i}</a></p>`).join(''),
);

/** More controls that toggle something than the overlay check takes. */
const MANY_TRIGGERS = built(
  'Many toggles',
  '',
  Array.from(
    { length: 21 },
    (_, i) =>
      `<button type="button" aria-expanded="false" onclick="this.setAttribute('aria-expanded', String(this.getAttribute('aria-expanded') !== 'true'))">Toggle ${i}</button>`,
  ).join(''),
);

/** Forty-five light bands axe can't judge, and a dark one last: no cap stops the resampling before it. */
const MANY_BANDS = built(
  'Many bands',
  'body { font: 16px/1.5 system-ui, sans-serif; background: #fff; } .ok { background: linear-gradient(90deg, #fff, #ddd); color: #111; } .bad { background: linear-gradient(90deg, #fff, #8a8a8a); color: #6a6a6a; }',
  `${Array.from({ length: 45 }, (_, i) => `<p class="ok">Readable band ${i}.</p>`).join('')}<p class="bad">The last band fades into its text.</p>`,
);
const TRANSPARENCY = [
  { name: 'prefers-color-scheme', value: 'light' },
  { name: 'prefers-reduced-transparency', value: 'reduce' },
];

/**
 * The ignored-emulation check (Slice 1's fail-closed rule) on one of Slice
 * 2's rows, with the row applied as run-cell.ts applies it, or left off.
 */
function emulationCase(rowId: string, applied: boolean): MetaCase {
  const row = PREFERENCE_ROWS.find((each) => each.id === rowId)!;
  const { context } = row;
  const options: PageOptions = applied
    ? {
        noScript: context.javaScriptEnabled === false,
        media: context.media,
        features: context.features,
        at: context.displayMode ? `/?mode=${context.displayMode}` : '/',
      }
    : { at: context.displayMode ? `/?mode=${context.displayMode}&ignore` : '/' };
  return {
    id: `runner/ignored-${rowId}-${applied ? 'emulated' : 'ignored'}`,
    gate: 'runner',
    input: `the ${rowId} row ${applied ? 'applied' : 'left off'}, on tests/quality/fixtures/a11y/display-mode.html`,
    expect: applied ? 'pass' : 'fail',
    reason: applied ? undefined : new RegExp(`^runner media-emulation: ${rowId}: .*ignored$`),
    browser: true,
    run: () =>
      onPage(
        'display-mode.html',
        async (page) =>
          (await checkEmulation(page, row)).map((problem) => ({
            gate: 'runner',
            rule: 'media-emulation',
            actual: problem,
          })),
        options,
      ),
  };
}

const KILL_SWITCH = `@media (prefers-reduced-motion: reduce) {
  [data-variant='acme'] *, [data-variant='acme'] *::before { animation: none !important; transition: none !important; }
}`;
const TOKENS = `*, *::before, *::after { box-sizing: border-box; }
[data-variant='acme'] .card { transition: opacity var(--ui-motion-fast) var(--ui-motion-easing); }
[data-variant='acme'] .card:hover { transform: var(--ui-state-hover-transform); }
[data-variant='acme'][data-motion='reduced'] .drift { animation: none; }`;

const auditOutcome = (css: string): MetaOutcome => {
  const found = killSwitches(css);
  return {
    passed: found.length === 0,
    findings: found.map(
      ({ selector, declaration }) => `motion kill-switch: ${selector} { ${declaration} }`,
    ),
  };
};

export const A11Y_CASES: readonly MetaCase[] = [
  bad('trap', 'keyboard-trap.html', 'keyboard', 'trap|reachable', keyboard),
  bad('hidden-focusable', 'keyboard-hidden.html', 'keyboard', 'hidden-focusable', keyboard),
  bad('unreachable', 'keyboard-unreachable.html', 'keyboard', 'reachable', keyboard),
  good('keyboard', keyboard),
  bad('no-indicator', 'focus-none.html', 'focus', 'visible', focus),
  bad('faint-indicator', 'focus-faint.html', 'focus', 'contrast', focus),
  bad('thin-indicator', 'focus-thin.html', 'focus', 'perimeter', focus),
  {
    ...good('focus', focus),
    id: 'focus/ring-set-out',
    input: 'tests/quality/fixtures/a11y/focus-offset.html',
    run: () => onPage('focus-offset.html', focus),
  },
  good('focus', focus),
  bad('fixed-footer', 'occlusion.html', 'occlusion', 'obscured', occlusion),
  bad('pointer-events-footer', 'occlusion-pointer.html', 'occlusion', 'obscured', occlusion),
  bad('scroll-shown-footer', 'occlusion-scroll.html', 'occlusion', 'obscured', occlusion),
  {
    ...good('occlusion', occlusion),
    id: 'occlusion/grain-overlay',
    input: 'tests/quality/fixtures/a11y/occlusion-grain.html',
    run: () => onPage('occlusion-grain.html', occlusion),
  },
  good('occlusion', occlusion),
  {
    ...bad('no-escape', 'dialog-escape.html', 'keyboard', 'escape', overlays),
    id: 'keyboard/dialog-no-escape',
  },
  {
    ...bad('focus-lost', 'dialog-return.html', 'keyboard', 'focus-return', overlays),
    id: 'keyboard/dialog-focus-lost',
  },
  {
    ...bad('leak', 'dialog-leak.html', 'keyboard', 'containment', overlays),
    id: 'keyboard/dialog-leak',
  },
  {
    ...bad('slow', 'dialog-slow.html', 'keyboard', 'escape', overlays),
    id: 'keyboard/dialog-slow',
  },
  builtCase(
    'too-many-triggers',
    'runner',
    'a page with 21 controls that toggle something, past the 20 the check takes',
    MANY_TRIGGERS,
    /^runner coverage: 21 on the page, so 1 went unchecked$/,
    overlays,
  ),
  { ...good('keyboard', overlays), id: 'keyboard/dialog-good' },
  bad('hover-only', 'hover-only.html', 'hover', 'parity', hoverFindings),
  bad('title-only', 'title-only.html', 'hover', 'title-only', hoverFindings),
  builtCase(
    'too-many-hovers',
    'hover',
    'a page with 46 :hover subjects, past the 40 the check takes, the one that reveals content last',
    MANY_HOVERS,
    /^(?:runner coverage: 46 on the page, so 6 went unchecked|hover parity: .*)$/,
    hoverFindings,
  ),
  {
    id: 'hover/many-links-one-rule',
    gate: 'hover',
    input:
      'sixty links under one :hover rule that styles only the link, past the 40 the check takes',
    expect: 'pass',
    browser: true,
    run: () => onPage(MANY_LINKS, hoverFindings),
  },
  good('hover', hoverFindings),
  bad('fixed-width', 'reflow-wide.html', 'reflow', 'reflow|zoom', (page) =>
    reflowFindings(page, '/'),
  ),
  bad('clipped', 'reflow-clipped.html', 'reflow', 'reflow|zoom|root-text', (page) =>
    reflowFindings(page, '/'),
  ),
  bad('wider-than-320', 'reflow-narrow.html', 'reflow', 'reflow', (page) =>
    reflowFindings(page, '/'),
  ),
  bad('undeclared-scroller', 'reflow-scroller.html', 'reflow', 'reflow|zoom|root-text', (page) =>
    reflowFindings(page, '/'),
  ),
  good('reflow', (page) => reflowFindings(page, '/')),
  bad('needs-hover', 'inventory.html', 'inventory', 'content', inventory),
  good('inventory', inventory),
  bad('needs-canvas', 'enhancement.html', 'enhancement', 'semantics|navigation', enhancement),
  good('enhancement', enhancement),
  bad('spinner', 'motion-spin.html', 'motion', 'animation', motionFindings, {
    ...REDUCED,
    init: MOTION_SAMPLER,
  }),
  bad('frame-loop', 'motion-loop.html', 'motion', 'frame-loop', motionFindings, {
    ...REDUCED,
    init: MOTION_SAMPLER,
  }),
  good('motion', motionFindings, { ...REDUCED, init: MOTION_SAMPLER }),
  // Each OS-wins signal alone: the tokens, and the hover transform.
  bad('tokens-over-os', 'os-wins-tokens.html', 'motion', 'os-wins', osWinsFindings, {
    ...REDUCED,
    init: MOTION_SAMPLER,
  }),
  bad('hover-over-os', 'os-wins-hover.html', 'motion', 'os-wins', osWinsFindings, {
    ...REDUCED,
    init: MOTION_SAMPLER,
  }),
  {
    id: 'motion/os-wins-good',
    gate: 'motion',
    input: 'tests/quality/fixtures/a11y/os-wins-good.html',
    expect: 'pass',
    browser: true,
    run: () => onPage('os-wins-good.html', osWinsFindings, { ...REDUCED, init: MOTION_SAMPLER }),
  },
  {
    id: 'motion/kill-switch',
    gate: 'motion',
    input: 'a universal !important animation and transition kill switch',
    expect: 'fail',
    reason: /^motion kill-switch: /,
    run: () => auditOutcome(KILL_SWITCH),
  },
  {
    id: 'motion/tokens',
    gate: 'motion',
    input: 'motion through the boundary tokens, and a universal rule that sets no motion',
    expect: 'pass',
    run: () => auditOutcome(TOKENS),
  },
  bad(
    'frosted',
    'transparency.html',
    'transparency',
    'backdrop-filter|opaque',
    transparencyFindings,
    { features: TRANSPARENCY },
  ),
  bad(
    'see-through-gradient',
    'transparency-gradient.html',
    'transparency',
    'opaque',
    transparencyFindings,
    { features: TRANSPARENCY },
  ),
  bad(
    'nav-over-image',
    'transparency-nav-over-image.html',
    'transparency',
    'opaque',
    transparencyFindings,
    { features: TRANSPARENCY },
  ),
  good('transparency', transparencyFindings, { features: TRANSPARENCY }),
  bad('gradient', 'contrast-gradient.html', 'contrast', 'text|large-text', contrast),
  builtCase(
    'past-forty',
    'contrast',
    'forty-five bands axe reports incomplete, and a low-contrast one after them',
    MANY_BANDS,
    /^contrast text: \d\.\d+:1 against its worst background pixel$/,
    contrast,
  ),
  good('contrast', contrast),
  bad('button-name', 'axe-semantics.html', 'axe', 'button-name', axeRule('button-name')),
  bad('target-size', 'axe-semantics.html', 'axe', 'target-size', axeRule('target-size')),
  bad('color-contrast', 'axe-semantics.html', 'axe', 'color-contrast', axeRule('color-contrast')),
  good('axe', axeAll),
  emulationCase('high-contrast', false),
  emulationCase('high-contrast', true),
  emulationCase('reduced-transparency', false),
  emulationCase('reduced-transparency', true),
  emulationCase('print', false),
  emulationCase('print', true),
  emulationCase('no-javascript', false),
  emulationCase('no-javascript', true),
  {
    id: 'runner/no-javascript-scripting-media',
    gate: 'runner',
    input: 'tests/quality/fixtures/a11y/no-script-media.html, styled by (scripting: none)',
    expect: 'fail',
    reason: /^runner media-emulation: a stylesheet styles by @media \(scripting: none\)/,
    browser: true,
    run: () => onPage('no-script-media.html', scriptingMediaFindings, { noScript: true }),
  },
  {
    id: 'runner/no-javascript-no-scripting-media',
    gate: 'runner',
    input: 'tests/quality/fixtures/a11y/good.html, styled by no scripting query',
    expect: 'pass',
    browser: true,
    run: () => onPage('good.html', scriptingMediaFindings, { noScript: true }),
  },
];
