// The accessibility suites' cases for `pnpm quality:meta` (#11, Slice 2,
// VR1 and VR2): a known-bad page for each check and a known-good one, each
// run through the check run-cell.ts runs, on a loopback stand-in host in
// Chromium. The known-bad pages are under tests/quality/fixtures/a11y/,
// and good.html is the page every suite passes. Each case's findings are
// the check's own, so a page that breaks some other rule doesn't count.
// The compiled-CSS audit needs no browser.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContextOptions, CDPSession, Page, TestInfo } from '@playwright/test';
import { defaultTuple, type Cell } from '../cells';
import { axeFor } from '../lib/axe';
import { checkEmulation } from '../lib/emulation';
import { DEFAULT_ROW, PREFERENCE_ROWS, VIEWPORTS } from '../lib/matrix';
import {
  enhancementFindings,
  failureStateFindings,
  inventoryFindings,
  notBusy,
  reflowFindings,
  scriptRequiredFindings,
  STILL_BUSY,
  STILL_ENHANCING,
  scriptingMediaFindings,
  transparencyFindings,
} from '../lib/a11y/conditions';
import {
  CONTRAST_RULE,
  ENHANCED_CONTRAST_RULE,
  incompleteContrastFindings,
} from '../lib/a11y/contrast';
import {
  FRAME_PRESSES,
  frames,
  hoverFindings,
  keyboardFindings,
  overlayFindings,
  type Finding,
} from '../lib/a11y/interaction';
import { killSwitches, MOTION_SAMPLER, motionFindings, osWinsFindings } from '../lib/a11y/motion';
import { inPage, type Active } from '../lib/a11y/probe';
import { applyRow, audit, loadForPass, runPass } from '../lib/run-cell';
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
  /** A lazy enhancement's chunk the stand-in serves too, at LAZY_CHUNK: after LAZY_DELAY_MS, or never. */
  readonly chunk?: { readonly body: string } | 'never';
}

/** Where a lazy enhancement's chunk is served: a chunk the page's HTML doesn't name, which failed enhancement blocks. */
const LAZY_CHUNK = '/_next/static/chunks/lazy-reveal.js';
/** How long the stand-in takes to serve it: longer than a read that doesn't wait for it takes. */
const LAZY_DELAY_MS = 750;

/** The CDP session that turned script off on a fixture's page, when one did. */
const scriptless = new WeakMap<Page, CDPSession>();

/**
 * `file` served at / from a loopback host, open in Chromium at 1440x900
 * with `options`, and `check` run on it. The stand-in serves no other path
 * but a lazy chunk, when `options.chunk` gives one.
 */
async function onPage(
  file: string,
  check: (page: Page) => Promise<Finding[]>,
  options: PageOptions = {},
): Promise<MetaOutcome> {
  // A fixture's name, or a page built here.
  const html = file.startsWith('<') ? file : readFileSync(path.join(FIXTURES, file), 'utf8');
  const { init, at, features, media, noScript, chunk, ...context } = options;
  const server = createServer((request, response) => {
    const asked = new URL(request.url ?? '/', 'http://stand-in').pathname;
    if (chunk && asked === LAZY_CHUNK) {
      // One that never comes holds its request open until the page goes.
      if (chunk === 'never') return;
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        response.end(chunk.body);
      }, LAZY_DELAY_MS);
      return;
    }
    const found = asked === '/';
    response.writeHead(found ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    response.end(found ? html : 'Not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
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
      scriptless.set(page, cdp);
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

/** A known-good case on a fixture of its own: `file` passes `check`. */
function goodFile(
  id: string,
  file: string,
  gate: string,
  check: (page: Page) => Promise<Finding[]>,
  options?: PageOptions,
): MetaCase {
  return {
    id: `${gate}/${id}`,
    gate,
    input: `tests/quality/fixtures/a11y/${file}`,
    expect: 'pass',
    browser: true,
    run: () => onPage(file, check, options),
  };
}

/** Whether the page settles, as settle() and the reload conditions wait for it. */
const settled = async (page: Page): Promise<Finding[]> =>
  (await notBusy(page)) ? [] : [{ gate: 'runner', rule: 'settled', actual: STILL_BUSY }];
const keyboard = (page: Page) => keyboardFindings(page);
/** A page whose script didn't arrive, as failed enhancement reads it; axe has cases of its own. */
const failureState = (page: Page) => failureStateFindings(page, { axe: false });
/** A page that needs JavaScript, as the no-JavaScript checks read it; axe has cases of its own. */
const scriptRequired = (page: Page) =>
  scriptRequiredFindings(page, null, 'no-javascript', { axe: false });
/** The no-JavaScript row's axe pass on the page, as run-cell.ts runs it: script off, then audit(). */
const rowAudit = async (page: Page): Promise<Finding[]> => {
  const row = PREFERENCE_ROWS.find((each) => each.id === 'no-javascript')!;
  await applyRow(page, row);
  await page.reload({ waitUntil: 'load' });
  const { results } = await audit(page, row);
  return results.violations.map((rule) => ({
    gate: 'axe',
    rule: rule.id,
    actual: `${rule.nodes.length} element(s): ${rule.help}`,
  }));
};
/** The same, with axe, which turns script on for its pass through the page's own session. */
const scriptRequiredAxe = (page: Page) =>
  scriptRequiredFindings(page, scriptless.get(page) ?? null, 'no-javascript');
const focus = async (page: Page) =>
  (await keyboardFindings(page, { focus: true })).filter((each) => each.gate === 'focus');
/**
 * `check`'s findings, held to one per stop in `selectors`, each matched by the element its path
 * names: a stop with none, or more than one, or a finding on another element, adds a finding
 * that matches no case's reason, so a path that passes silently fails the case.
 */
const onePerStop =
  (check: (page: Page) => Promise<Finding[]>, selectors: readonly string[]) =>
  async (page: Page): Promise<Finding[]> => {
    const findings = await check(page);
    const owners = await page.evaluate(
      ([paths, wanted]) =>
        paths.map((path) => {
          const el = path ? document.querySelector(path) : null;
          return wanted.findIndex(
            (selector) => el !== null && el === document.querySelector(selector),
          );
        }),
      [findings.map((each) => each.path ?? ''), [...selectors]] as const,
    );
    const misses: Finding[] = selectors.flatMap((selector, index) => {
      const count = owners.filter((owner) => owner === index).length;
      return count === 1
        ? []
        : [{ gate: 'meta', rule: 'per-stop', actual: `${count} findings on ${selector}, not one` }];
    });
    const strays: Finding[] = findings
      .filter((_, index) => owners[index] === -1)
      .map((each) => ({ gate: 'meta', rule: 'per-stop', actual: `a finding on ${each.path}` }));
    return [...findings, ...misses, ...strays];
  };
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

/**
 * A page whose lazy enhancement reveals `control`, hidden in its server
 * markup, as Shell's palette reveals its jump buttons: once the page has
 * loaded, its island goes live, as the host marks one, and loads its chunk
 * from LAZY_CHUNK, which the stand-in serves late. The chunk's script
 * element goes once it has run, so the page names no chunk of its own; if
 * it fails, the island marks itself failed and keeps its markup.
 */
const lazyReveal = (title: string, control: string, head = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><a href="#main">Skip to content</a><main id="main" tabindex="-1"><h1>${title}</h1><div data-enhancement-island="reveal" data-island="markup"><p>The page reads without its enhancement.</p>${control}</div></main><script>
addEventListener('load', () => setTimeout(() => {
  const island = document.querySelector('[data-enhancement-island]');
  island.setAttribute('data-island', 'live');
  const chunk = document.createElement('script');
  chunk.src = '${LAZY_CHUNK}';
  chunk.onload = () => chunk.remove();
  chunk.onerror = () => { chunk.remove(); island.setAttribute('data-island', 'failed'); };
  document.head.append(chunk);
}));
</script></body></html>`;

/**
 * The chunk lazyReveal() loads: it shows what its island's markup holds
 * hidden, 400 ms after it lands, on a timer, as React's Suspense throttle
 * reveals a lazy enhancement a while after its chunk, the page idle between.
 */
const REVEAL = {
  body: "setTimeout(() => { for (const el of document.querySelectorAll('[data-lazy]')) el.hidden = false; }, 400);",
};

/** `check` once the lazy enhancement has revealed its control, as the cell reads its baseline once axe has run. */
const revealed =
  (check: (page: Page) => Promise<Finding[]>) =>
  async (page: Page): Promise<Finding[]> => {
    await page.waitForSelector('[data-lazy]:not([hidden])', { timeout: 5_000 });
    return check(page);
  };

/**
 * The conditions that let a button that submits nothing go, on a page whose
 * lazy enhancement has revealed it: no JavaScript, then print over the page
 * live again, as the print row reads it, against the one baseline.
 */
const scriptlessInventory = async (page: Page): Promise<Finding[]> => {
  const before = await baseline(page);
  const scriptless = await inventoryFindings(page, '/', before, ['no-javascript']);
  await page.waitForSelector('[data-lazy]:not([hidden])', { timeout: 5_000 });
  return [...scriptless, ...(await inventoryFindings(page, '/', before, ['print']))];
};

/**
 * `check`'s findings, each with the condition it was read under, and one
 * more for each condition in `under` that found nothing missing, so a case
 * holds only when every one of them still counts what it hid.
 */
const missingUnder =
  (under: readonly string[], check: (page: Page) => Promise<Finding[]>) =>
  async (page: Page): Promise<Finding[]> => {
    const findings = await check(page);
    return [
      ...findings.map((each) => ({ ...each, actual: `${each.expected}: ${each.actual}` })),
      ...under
        .filter(
          (condition) =>
            !findings.some(({ expected }) => expected === `present under ${condition}`),
        )
        .map((condition) => ({
          gate: 'meta',
          rule: 'per-condition',
          actual: `nothing missing under ${condition}`,
        })),
    ];
  };

/** Hides the lazy enhancement in print too, as Flux's print sheet hides Copy email, and styles .button as one (shown only, so hidden still hides it). */
const PRINT_HIDES =
  '<style>@media print { [data-lazy] { display: none !important; } } .button:not([hidden]) { display: inline-block; padding: 8px 16px; border: 2px solid #1a1a1a; border-radius: 6px; background: #f2f2f2; color: #1a1a1a; text-decoration: none; }</style>';

/** Flux's Copy email: a type=button alone in its <p>, beside an empty polite status. */
const BUTTON_LABEL =
  '<p><button type="button" hidden data-lazy>Copy email</button><span role="status" aria-live="polite"></span></p>';

/** What the button-label rule must still count: each guard's markup, and the fields it hides under each condition. */
const LABEL_GUARDS = [
  {
    id: 'hidden-text',
    what: 'A hidden paragraph',
    html: '<p hidden data-lazy>The address is on the card.</p>',
    scriptless: ['text: The address is on the card.'],
    print: ['text: The address is on the card.'],
  },
  {
    id: 'hidden-link-text',
    what: 'A hidden link',
    html: '<p><a href="/elsewhere" hidden data-lazy>Elsewhere</a></p>',
    scriptless: ['text: Elsewhere', 'link: /elsewhere Elsewhere'],
    print: ['text: Elsewhere', 'link: /elsewhere Elsewhere'],
  },
  {
    id: 'submit-label',
    what: 'A hidden submit button',
    html: '<form action="/"><p><button type="submit" hidden data-lazy>Send</button></p></form>',
    scriptless: ['text: Send', 'control: button:submit Send'],
    // Print lets every control go, a submit button too, but not its label.
    print: ['text: Send'],
  },
  {
    id: 'link-button-label',
    what: 'A link styled as a button',
    html: '<p><a href="/elsewhere" class="button" hidden data-lazy>Copy email</a></p>',
    scriptless: ['text: Copy email', 'link: /elsewhere Copy email'],
    print: ['text: Copy email', 'link: /elsewhere Copy email'],
  },
] as const;

/** Swiss's Back to the top, alone: a same-document skip link, which print hides. */
const SKIP_LINK = '<a href="#main" class="top" hidden data-lazy>Back to the top</a>';

/** Swiss's colophon cell: a short label, its skip link, and a button that submits nothing. */
const CONTROL_LABEL =
  '<p hidden data-lazy><b>This page</b> <a href="#main">Back to the top</a> <button type="button">Print as a résumé</button></p>';

/** What the skip-link and control-label rules must still count, as LABEL_GUARDS words it. */
const SKIP_GUARDS = [
  {
    id: 'fragment-link',
    what: 'A hidden link to a section of the page',
    html: '<a href="#section-x" hidden data-lazy>Section X</a><p id="section-x">Section X starts here.</p>',
    scriptless: ['link: #section-x Section X'],
    print: ['link: #section-x Section X'],
  },
  {
    id: 'own-words-and-button',
    what: 'A hidden paragraph with words of its own beside a button',
    html: '<p hidden data-lazy>The address is on the card below. <button type="button">Copy email</button></p>',
    scriptless: ['text: The address is on the card below. Copy email'],
    print: ['text: The address is on the card below. Copy email'],
  },
  {
    id: 'label-and-link',
    what: 'A short label and a real link',
    html: '<p hidden data-lazy><b>This page</b> <a href="/elsewhere">Elsewhere</a></p>',
    scriptless: ['text: This page Elsewhere', 'link: /elsewhere Elsewhere'],
    print: ['text: This page Elsewhere', 'link: /elsewhere Elsewhere'],
  },
] as const;

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every finding is `check` missing exactly `fields` under one of the conditions, as missingUnder() words it. */
const missingFields = (check: string, under: Record<string, readonly string[]>) =>
  new RegExp(
    `^${check}: (?:${Object.entries(under)
      .map(
        ([condition, fields]) =>
          `present under ${escaped(condition)}: ${fields.length} field\\(s\\) missing, here (?:${fields.map(escaped).join('|')})`,
      )
      .join('|')})$`,
  );

/**
 * A page whose enhancement swaps a control once it mounts, as Aurora's sky
 * marks the page live and its plain Index link gives way to the capsule's
 * popover button: the plain link in `plain`, the live button in `live`, on
 * white, at 16px. The chunk (LAZY_CHUNK, 750 ms late) marks the root
 * data-live as it runs, and the stylesheet does the rest.
 */
const liveSwap = (title: string, plain: string, live: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>
body { margin: 0; background: #fff; color: #111; font: 16px/1.5 system-ui, sans-serif; }
main { padding: 1rem; }
.plain { color: ${plain}; }
.live { color: ${live}; background: #fff; border: 1px solid #111; font: inherit; }
:root:not([data-live]) .live, :root[data-live] .plain { display: none; }
</style></head><body><a href="#main">Skip to content</a><main id="main" tabindex="-1"><h1>${title}</h1><p>The page's own words, dark on white.</p><nav aria-label="Index"><a class="plain" href="#index">Index</a><button class="live" type="button">Index</button></nav><p id="index">The contents.</p></main><script>
addEventListener('load', () => setTimeout(() => {
  const chunk = document.createElement('script');
  chunk.src = '${LAZY_CHUNK}';
  chunk.onload = () => chunk.remove();
  document.head.append(chunk);
}));
</script></body></html>`;

/** The chunk liveSwap() loads: it marks the page live as it runs, as an enhancement's mount does. */
const GO_LIVE = { body: "document.documentElement.setAttribute('data-live', '');" };

/**
 * A row's main pass as run-cell.ts's runPass() reads it: the page loaded and
 * its enhancements in (loadForPass()), then audit(), its contrast rules'
 * violations and the sampler's findings, and the runner's if it never
 * enhanced or was read before it went live.
 */
const mainPassContrast = async (page: Page): Promise<Finding[]> => {
  const { enhanced } = await loadForPass(page, '/');
  const live = await page.evaluate(() => document.documentElement.hasAttribute('data-live'));
  return [
    ...(enhanced ? [] : [{ gate: 'runner', rule: 'enhanced', actual: STILL_ENHANCING }]),
    ...(live
      ? []
      : [{ gate: 'runner', rule: 'enhanced', actual: 'audited before the page went live' }]),
    ...(await rowContrast('default')(page)),
  ];
};

/**
 * Row 44: a page whose one link shows only where a mouse is, as Horizontal Cinema pins its chrome
 * (its styles.css: `(hover: hover) and (pointer: fine)`), at 1440x900 with no touch.
 */
const POINTER_PINNED = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pinned</title>
<style>.pinned { display: none } @media (hover: hover) and (pointer: fine) { .pinned { display: block } }</style>
</head><body><main><h1>Pinned under a mouse</h1><p>Words every condition keeps.</p>
<nav class="pinned" aria-label="Pinned"><a href="#chapter-2">Pinned chapter link</a></nav>
<h2 id="chapter-2">Chapter 2</h2></main></body></html>`;

/**
 * Touch, then grayscale, on POINTER_PINNED: the mouse page's own pointer media holds again once
 * touch is torn down, so the link touch takes away is back under grayscale. Touch's own losses are
 * the touch condition's, a design question (row 43), and left aside here. With the link absent at
 * load (no fine pointer to start with) the case proves nothing, so that's a finding too.
 */
const pointerAfterTouch = async (page: Page): Promise<Finding[]> => {
  const before = await baseline(page);
  const precondition: Finding[] = before.some((item) => item.includes('Pinned chapter link'))
    ? []
    : [
        {
          gate: 'inventory',
          rule: 'content',
          expected:
            'the pinned link in the page as it loaded, under (hover: hover) and (pointer: fine)',
          actual: 'absent at load: the browser has no fine pointer to start with',
        },
      ];
  const found = await inventoryFindings(page, '/', before, ['touch', 'grayscale']);
  return [...precondition, ...found.filter((each) => each.expected !== 'present under touch')];
};

/**
 * Touch, then grayscale, then a load of its own after them, as a full cell loads its primitives
 * page once its conditions are done: that load still reads (hover: hover) and (pointer: fine),
 * and still shows the link only a mouse shows (row 44: touch's state outlived touch).
 */
const pointerAfterConditions = async (page: Page): Promise<Finding[]> => {
  const before = await baseline(page);
  const found = await inventoryFindings(page, '/', before, ['touch', 'grayscale']);
  await page.goto('/', { waitUntil: 'load' });
  const mouse = await page.evaluate(
    () => matchMedia('(hover: hover)').matches && matchMedia('(pointer: fine)').matches,
  );
  const shown = (await baseline(page)).some((item) => item.includes('Pinned chapter link'));
  const after: Finding[] = [
    ...(mouse
      ? []
      : [
          {
            gate: 'inventory',
            rule: 'content',
            expected: 'a load after the conditions reads (hover: hover) and (pointer: fine)',
            actual: "it doesn't: the touch condition's pointer media outlived it",
          },
        ]),
    ...(shown
      ? []
      : [
          {
            gate: 'inventory',
            rule: 'content',
            expected: 'the pinned link in a load after the conditions',
            actual: 'absent: the page loaded as if without a mouse',
          },
        ]),
  ];
  return [
    ...(before.some((item) => item.includes('Pinned chapter link'))
      ? []
      : [
          {
            gate: 'inventory',
            rule: 'content',
            expected:
              'the pinned link in the page as it loaded, under (hover: hover) and (pointer: fine)',
            actual: 'absent at load: the browser has no fine pointer to start with',
          },
        ]),
    ...found.filter((each) => each.expected !== 'present under touch'),
    ...after,
  ];
};

/** The touch condition alone on a page whose enhancement's chunk never comes. */
const touchInventory = async (page: Page) =>
  inventoryFindings(page, '/', await baseline(page), ['touch']);

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

/**
 * The sampler's findings, the batch path's, and a `contrast batch`
 * finding as well when the per-element path, run on the same page after
 * it, finds anything else, record for record (row 14's equivalence).
 */
const contrastBothWays = async (page: Page): Promise<Finding[]> => {
  const results = await axeFor(page).analyze();
  const batched = await incompleteContrastFindings(page, results);
  const alone = await incompleteContrastFindings(page, results, false, { batch: false });
  const records = (each: readonly Finding[]) => each.map((finding) => JSON.stringify(finding));
  const [a, b] = [records(batched), records(alone)];
  return a.join('\n') === b.join('\n')
    ? batched
    : [
        ...batched,
        {
          gate: 'contrast',
          rule: 'batch',
          actual: `the batch path found ${a.join(' | ') || 'nothing'}, and each element on its own ${b.join(' | ') || 'nothing'}`,
        },
      ];
};

/** How many round trips to the page, and how many screenshots, the sampler may take for `elements` incomplete ones in one viewport. */
const tripsFor = (elements: number) => Math.ceil(elements / 2) + 20;

/**
 * The sampler's findings, and a `contrast round-trips` finding when it
 * takes more round trips to the page (evaluates, and a locator's
 * evaluates and scrolls), or more screenshots, than tripsFor() allows:
 * the per-element cost that ran Schematic's cells past their limit (row
 * 14), about fifteen round trips and three shots an element.
 */
const contrastTrips = async (page: Page): Promise<Finding[]> => {
  const results = await axeFor(page).analyze();
  let trips = 0;
  let shots = 0;
  const counted = <T extends object>(target: T, calls: readonly string[]): T =>
    new Proxy(target, {
      get(of, name) {
        const value = Reflect.get(of, name, of) as unknown;
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          if (calls.includes(String(name))) trips++;
          if (name === 'screenshot') shots++;
          const out = (value as (...a: unknown[]) => unknown).apply(of, args);
          // A locator's first() is a locator too.
          return name === 'locator' || name === 'first'
            ? counted(out as object, ['evaluate', 'scrollIntoViewIfNeeded'])
            : out;
        };
      },
    });
  const findings = await incompleteContrastFindings(counted(page, ['evaluate']), results);
  const elements = results.incomplete
    .filter((rule) => rule.id === CONTRAST_RULE)
    .reduce((sum, rule) => sum + rule.nodes.length, 0);
  const over = [
    ...(trips > tripsFor(elements) ? [`${trips} round trips to the page`] : []),
    ...(shots > tripsFor(elements) ? [`${shots} screenshots`] : []),
  ];
  return over.length === 0
    ? findings
    : [
        ...findings,
        {
          gate: 'contrast',
          rule: 'round-trips',
          actual: `${over.join(' and ')} for ${elements} elements in one viewport, over ${tripsFor(elements)}`,
        },
      ];
};

/** `count` short texts on a near-white gradient, in one 1440x900 viewport, far apart. */
const manyTexts = (count: number) =>
  built(
    'Many texts on a gradient',
    'main { display: grid; grid-template-columns: repeat(5, 1fr); gap: 24px 48px; } p { margin: 0; font: 16px/1.5 Arial, sans-serif; color: #444; background: linear-gradient(90deg, #fff, #fafafa); }',
    Array.from({ length: count }, (_, at) => `<p>Text number ${at + 1}.</p>`).join(''),
  );

/**
 * A row's axe pass and its sampler, as run-cell.ts's audit() runs them on
 * `rowId`: the contrast rules' violations, color-contrast-enhanced's among
 * them where the page renders high contrast, and the incomplete items
 * resampled.
 */
const rowContrast =
  (rowId: string) =>
  async (page: Page): Promise<Finding[]> => {
    const row = PREFERENCE_ROWS.find((each) => each.id === rowId)!;
    const { results, contrast: resampled } = await audit(page, row);
    const axe = results.violations
      .filter((rule) => rule.id === CONTRAST_RULE || rule.id === ENHANCED_CONTRAST_RULE)
      .flatMap((rule) =>
        rule.nodes.map((node) => ({
          gate: 'axe',
          rule: rule.id,
          actual: node.failureSummary ?? rule.help,
        })),
      );
    return [...axe, ...resampled];
  };

/**
 * 16px text at `color` on white, and over a near-white gradient that axe
 * leaves to the sampler, inside a presentation boundary rendering `mode`.
 * #696969 on white is 5.49:1, past AA's 4.5 and short of high contrast's
 * 7; #545454 is 7.57:1.
 */
const modeText = (
  title: string,
  color: string,
  mode: string,
  over: 'solid' | 'gradient' | 'both',
) =>
  built(
    title,
    `.on { color: ${color}; background: #fff; } .over { color: ${color}; background-image: linear-gradient(#fff, #fefefe); } p { font-size: 16px; font-weight: 400; }`,
    `<div data-appearance-boundary="document" data-display-mode="${mode}" data-contrast="no-preference">${
      over === 'gradient' ? '' : '<p class="on">Text on a solid surface.</p>'
    }${over === 'solid' ? '' : '<p class="over">Text over a gradient.</p>'}</div>`,
  );

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

/**
 * A page with a link before and after a sandboxed frame of `links` links, as
 * Demo Studio's Content task frames the sample: opaque, scripts alone. With
 * `trap`, the frame's document keeps Tab on its first link.
 */
function framedPage(links: number, trap = false): string {
  const inner = `<!doctype html><html lang='en'><body>${Array.from(
    { length: links },
    (_, i) => `<p><a href='#f${i}'>Framed ${i}</a></p>`,
  ).join('')}${
    trap
      ? "<script>document.addEventListener('keydown', (event) => { if (event.key === 'Tab') { event.preventDefault(); document.querySelector('a').focus(); } });</script>"
      : ''
  }</body></html>`;
  const srcdoc = inner.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return built(
    'A page with a frame',
    'iframe { display: block; width: 40rem; height: 20rem; }',
    `<p><a href="#before" id="before">Before</a></p><iframe title="Framed" sandbox="allow-scripts" srcdoc="${srcdoc}"></iframe><p><a href="#after" id="after">After</a></p>`,
  );
}
const FRAMED_MANY = framedPage(60);
const FRAMED_TRAP = framedPage(3, true);
/** The keyboard walk, with the focus check, as a framed surface's cells run it. */
const framedWalk = (page: Page) => keyboardFindings(page, { focus: true, framed: true });
/**
 * The framed walk under a ceiling a little past the frame's own bound: its
 * page takes two presses to reach the frame and FRAME_PRESSES + 1 inside it,
 * so a walk that lost that bound stops here with another reason, and fails
 * its case at once rather than running on.
 */
const FRAMED_TRAP_CEILING = FRAME_PRESSES + 50;
const framedTrapWalk = (page: Page) =>
  keyboardFindings(page, { focus: true, framed: true, pressCeiling: FRAMED_TRAP_CEILING });
/** The keyboard walk alone, as a cell without the flag runs it. */
const unframedWalk = (page: Page) => keyboardFindings(page);

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

/**
 * Forty-five light bands axe can't judge, and a dark one last: no cap stops the resampling
 * before it. The last band is darkest at its start, under its words, where the sampler looks.
 */
const MANY_BANDS = built(
  'Many bands',
  'body { font: 16px/1.5 system-ui, sans-serif; background: #fff; } .ok { background: linear-gradient(90deg, #fff, #ddd); color: #111; } .bad { background: linear-gradient(90deg, #8a8a8a, #fff); color: #6a6a6a; }',
  `${Array.from({ length: 45 }, (_, i) => `<p class="ok">Readable band ${i}.</p>`).join('')}<p class="bad">The last band fades into its text.</p>`,
);
/** A known-good fixture's page, with `marker` (an HTML comment in it) replaced by `html`. */
const withFixture = (file: string, marker: string, html: string) => {
  const page = readFileSync(path.join(FIXTURES, file), 'utf8');
  if (!page.includes(marker)) throw new Error(`${file} has no ${marker}`);
  return page.replace(marker, html);
};

/** The walk's findings, each naming its stop, so a case can say which control Tab skipped. */
const keyboardAt = async (page: Page): Promise<Finding[]> =>
  (await keyboardFindings(page)).map((each) => ({
    ...each,
    actual: `${each.actual ?? ''} (${each.path ?? ''})`,
  }));

/** keyboard-folded.html with a script that moves focus past the fold's own summary. */
const SUMMARY_SKIPPED = withFixture(
  'keyboard-folded.html',
  '<!-- skip -->',
  "<script>document.getElementById('record-summary').addEventListener('focus', () => document.getElementById('last').focus());</script>",
);

/** contrast-stuck.html with text at 1.00:1 that nothing covers. */
const STUCK_FAINT = withFixture(
  'contrast-stuck.html',
  '<!-- faint -->',
  '<p class="faint">Text at 1.00:1 that nothing covers.</p>',
);

/** contrast-halo.html with a plate whose star, in its name's color, touches the name's last letter. */
const HALO_CROWDED = withFixture(
  'contrast-halo.html',
  '<!-- crowd -->',
  '<p class="plate">Ceres<span class="star" aria-hidden="true"></span></p>',
);

/** contrast-halo.html with a plate whose name is faint, #bbb, and nothing else in its box. */
const HALO_FAINT = withFixture(
  'contrast-halo.html',
  '<!-- faint -->',
  '<p class="plate faint">Eris</p>',
);

/** contrast-animated.html with text over a gradient that pulses for good. */
const ARRIVAL_PULSING = withFixture(
  'contrast-animated.html',
  '<!-- infinite -->',
  '<p class="band pulse">Text over a gradient that pulses for good.</p>',
);

/** contrast-animated.html with a figure a scroll-driven animation slides in as it comes into view. */
const ARRIVAL_SCROLL_DRIVEN = withFixture(
  'contrast-animated.html',
  '<!-- scroll-driven -->',
  '<figure class="arrives later"><p class="band">Text whose figure slides in as it scrolls into view.</p></figure>',
);

/** contrast-animated.html with a block whose outline and --x pulse for good, beside a spinning sibling. */
const ARRIVAL_UNRELATED = withFixture(
  'contrast-animated.html',
  '<!-- unrelated -->',
  '<div class="glow"><p class="band">Text in a block whose outline pulses for good.</p><span class="spinner" aria-hidden="true"></span></div>',
);

/** contrast-animated.html with faint text whose figure, `figure`, rests part-way through a scroll-driven slide. */
const RESTING_FIGURE =
  '<figure class="rests later"><p class="ramp">Faint text whose figure rests part-way in.</p></figure>';
const ARRIVAL_RESTING = withFixture('contrast-animated.html', '<!-- resting -->', RESTING_FIGURE);

/**
 * The contrast sampler on ARRIVAL_RESTING, held to three more things: the
 * figure's style attribute is as it was, byte for byte, once the sampler is
 * done, absent when it had none, and its own when it had one; its scroll-driven animation is still attached and follows the
 * scroll; and the ratio is exactly the one its static twin reads, the same
 * page with the figure's resting transform written plainly and no
 * animation. Each that fails adds a finding no case's reason matches.
 */
const restingContrast = async (page: Page): Promise<Finding[]> => {
  const figure = 'figure.rests';
  const style = () =>
    page.evaluate((selector) => document.querySelector(selector)!.getAttribute('style'), figure);
  const meta: Finding[] = [];
  const restored = (before: string | null, after: string | null) => {
    if (after !== before) {
      meta.push({
        gate: 'meta',
        rule: 'restore',
        actual: `its style attribute reads ${JSON.stringify(after)}, not ${JSON.stringify(before)}`,
      });
    }
  };
  // With no style attribute, then with one of its own, oddly spaced, in a fresh load.
  const before = await style();
  const findings = await contrast(page);
  restored(before, await style());
  await page.reload({ waitUntil: 'load' });
  const own = '--seed:1 ;  outline: 0px  solid transparent';
  await page.evaluate(
    ([selector, value]) => document.querySelector(selector)!.setAttribute('style', value),
    [figure, own] as const,
  );
  await frames(page);
  await contrast(page);
  restored(own, await style());
  // At rest in view, as the sampler had it, then scrolled back a little: its progress must move.
  await page.locator(`${figure} p`).scrollIntoViewIfNeeded();
  await frames(page, 200);
  const rest = await page.evaluate(async (selector) => {
    const el = document.querySelector(selector)!;
    const animation = el.getAnimations()[0];
    const progress = () => animation?.effect?.getComputedTiming().progress ?? null;
    const at = progress();
    const transform = getComputedStyle(el).transform;
    scrollBy({ top: -120, behavior: 'instant' });
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    return { attached: animation !== undefined, at, moved: progress(), transform };
  }, figure);
  if (!rest.attached || rest.at === rest.moved) {
    meta.push({
      gate: 'meta',
      rule: 'tracking',
      actual: rest.attached
        ? `its progress held at ${rest.at} as the page scrolled`
        : 'its animation is gone',
    });
  }
  await page.setContent(
    withFixture(
      'contrast-animated.html',
      '<!-- resting -->',
      RESTING_FIGURE.replace(
        'class="rests later"',
        `class="later" style="transform: ${rest.transform}"`,
      ),
    ),
  );
  await frames(page);
  const twin = await contrast(page);
  const said = (each: readonly Finding[]) => JSON.stringify(each.map((one) => one.actual));
  if (said(findings) !== said(twin)) {
    meta.push({
      gate: 'meta',
      rule: 'twin',
      actual: `it read ${said(findings)}, and its static twin, at ${rest.transform}, ${said(twin)}`,
    });
  }
  return [...findings, ...meta];
};

/** Text a fixed header covers on a page too short to scroll it out from under. */
const STUCK_FOR_GOOD = built(
  'Under a fixed header',
  'body { margin: 0; font: 16px/1.5 Arial, sans-serif; } header { position: fixed; inset: 0 0 auto; height: 14rem; background: #222; } .band { background: linear-gradient(90deg, #fff, #f6f6f6); color: #222; }',
  '<header></header><p class="band">A paragraph the fixed header always covers.</p>',
);

/** contrast-rotated.html with a second sticker whose line is its own background's color. */
const ROTATED_FAINT = withFixture(
  'contrast-rotated.html',
  '<!-- faint -->',
  '<div class="sticker"><p class="faint">A faint line on a sticker</p></div>',
);

/**
 * focus-stuck.html with three links whose 1px ring is faint, #ccc on white: one in view, one
 * focus leaves under the header, which the check scrolls clear, and one rotated.
 */
const FOCUS_FAINT = withFixture(
  'focus-stuck.html',
  '<!-- faint -->',
  `<p><a class="faint" id="faint-visible" href="#faint">A visible link with a faint 1px ring</a></p>
  <p style="margin-top: 4rem"><a class="faint" id="faint-lifted" href="#faint-lifted">A faint link focus leaves under the header</a></p>
  <p style="margin-top: 4rem"><a class="faint turned" id="faint-turned" href="#faint-turned">A faint rotated link</a></p>
  <script>document.getElementById('faint-lifted').addEventListener('focus', (event) => { const top = event.target.getBoundingClientRect().top + scrollY; scrollTo(0, top - 64 + 2); });</script>`,
);

/** contrast-stuck.html with text at 1.00:1 the header covers until the sampler scrolls it clear. */
const STUCK_FAINT_UNDER = withFixture(
  'contrast-stuck.html',
  '<!-- under -->',
  '<p class="faint">Faint text the header covers until it is scrolled clear.</p>',
);

/** Text over a gradient in a box turned in 3D. */
const TURNED_3D = built(
  'Turned in 3D',
  'body { font: 16px/1.5 Arial, sans-serif; } .tilt { transform: perspective(400px) rotateX(25deg); } .band { background: linear-gradient(90deg, #fff, #f6f6f6); color: #222; }',
  '<div class="tilt"><p class="band">Text in a box tilted back in 3D.</p></div>',
);

/** An inline span over a gradient, split across two lines, in a rotated block. */
const TURNED_SPLIT = built(
  'Turned and split',
  'body { font: 16px/1.5 Arial, sans-serif; } .tilt { width: 14rem; rotate: 4deg; background: #fff; } .band { background: linear-gradient(90deg, #fff, #f6f6f6); color: #222; }',
  '<div class="tilt"><p>Plain words, then <span class="band">an inline span over a gradient that wraps onto another line</span>.</p></div>',
);

/** focus-wrapped.html with a second wrapped link whose 1px ring is faint, #ccc on white. */
const WRAPPED_FAINT = withFixture(
  'focus-wrapped.html',
  '<!-- faint -->',
  '<p><a class="faint" href="#faint">A second link long enough to wrap onto three lines</a></p>',
);

/**
 * focus-wrapped.html with a link wrapped onto two lines, the first on a band the ring's own #222:
 * its ring is whole on the second line and lost on the first.
 */
const WRAPPED_HALF = withFixture(
  'focus-wrapped.html',
  '<!-- faint -->',
  '<p style="width: 20rem; background: linear-gradient(#222 0 24px, transparent 24px)"><a href="#half">A two-line link,<br />its first line on the ring\'s color</a></p>',
);

/**
 * focus-straight.html with a second plate at the same sub-pixel offset, whose straight ring fails
 * however it's measured: a square one a box clips along its right side, or an opaque neighbour
 * in the stage's colour covers along its top (each a quarter of its ring, so its pixels reach a
 * 1px ring's and it's held to its centre line, which refuses it); one 1px (held to its pixels);
 * or one whose colour is under 3:1 (2.4:1).
 */
const straightTwin = (html: string) => withFixture('focus-straight.html', '<!-- twin -->', html);
const STRAIGHT_CLIPPED = straightTwin(
  '<div class="clip"><a class="plate square" id="clipped" href="#clipped" style="top: 20px">Writing</a></div>',
);
const STRAIGHT_THIN = straightTwin(
  '<a class="plate thin" id="thin" href="#thin" style="top: 300px">Record, 12 years</a>',
);
const STRAIGHT_FAINT = straightTwin(
  '<a class="plate faint" id="faint" href="#faint" style="top: 300px">Personal, now</a>',
);
const STRAIGHT_COVERED = straightTwin(
  '<a class="plate square" id="covered" href="#covered" style="top: 600px">Personal</a><div class="cover" style="top: 594px"></div>',
);

/**
 * An underlined inline link at a 1px offset, as Obsidian Atelier's links under Primer: the ring's
 * inner bottom row lies on the underline, and changes from it under 3:1 (2.37:1), so the ring is
 * one row thick there. The centre line, 2px out, reads that row, or the outer one, and must not
 * pass it (the lead's ruling, 3 Nov 2026).
 */
const STRAIGHT_UNDERLINED = built(
  'An underlined link at a 1px offset',
  `body { margin: 0; padding: 2rem; font: 16px/1.5 Arial, 'Liberation Sans', Helvetica, sans-serif; background: #f0e7d6; color: #2b241c; }
  p { margin: 0 0 2rem; }
  a { color: #2b241c; text-decoration-line: underline; text-decoration-thickness: 1px; text-underline-offset: 0.3em; }
  a:focus-visible { outline: 2px solid #8e4d2b; outline-offset: 1px; }`,
  '<p><a id="underlined" href="#underlined">An underlined link, its underline at 0.3em</a></p>',
);

/**
 * A ring whose bottom edge the next line's box paints over, as Obsidian Atelier's episode title
 * in forced colours: an opaque box in the ground's colour, a quarter px into the ring's outer
 * row, so that row shows a quarter of the ring and the inner one all of it. The stop sits at whole
 * px (fixed), as the case measures it, so the outline's own snapping doesn't move the rows. The centre line,
 * crediting the inner row, must not pass it.
 */
const STRAIGHT_LIDDED = built(
  "A ring the next line's box covers",
  `body { margin: 0; padding: 2rem; font: 16px/1.5 Arial, 'Liberation Sans', Helvetica, sans-serif; background: #fff; color: #000; }
  .holder { position: fixed; top: 200px; left: 80px; display: inline-flex; }
  .holder a { display: inline-block; height: 18px; line-height: 18px; color: #000; text-decoration: none; }
  .holder a:focus-visible { outline: 2px solid #37336d; outline-offset: 1px; }
  .lid { position: absolute; left: -8px; right: -8px; top: calc(100% + 2px); translate: 0 0.25px; height: 18px; background: #fff; }`,
  '<p><span class="holder"><a id="lidded" href="#lidded">A link the next line covers</a><span class="lid"></span></span></p>',
);

/**
 * focus-only-shown.html with a menu open only on :focus-within, whose items have no ring: the
 * blur hides each item with the list that holds it.
 */
const MENU_WITHIN = withFixture(
  'focus-only-shown.html',
  '<!-- twin -->',
  `<style>
    .menu ul { display: none; }
    .menu:focus-within ul { display: block; }
    .menu a:focus-visible { outline: none; }
    .menu button:focus-visible { outline: 2px solid #222; outline-offset: 2px; }
  </style>
  <nav class="menu"><button type="button">Menu</button><ul><li><a href="#m1">First</a></li><li><a href="#m2">Second</a></li></ul></nav>`,
);

/**
 * focus-only-shown.html with a dropdown moved off-screen until :focus-within, whose items have no
 * ring: the blur moves each item off-screen with the list that holds it.
 */
const MENU_OFFSCREEN = withFixture(
  'focus-only-shown.html',
  '<!-- twin -->',
  `<style>
    .menu { position: relative; }
    .menu ul { position: absolute; left: -9999px; }
    .menu:focus-within ul { left: 0; }
    .menu a:focus-visible { outline: none; }
    .menu button:focus-visible { outline: 2px solid #222; outline-offset: 2px; }
  </style>
  <nav class="menu"><button type="button">Menu</button><ul><li><a href="#m1">First</a></li><li><a href="#m2">Second</a></li></ul></nav>`,
);

/**
 * focus-only-shown.html with a menu whose items are visibility: hidden until :focus-within, and
 * have no ring: the blur hides each item by its own visibility while its list item still shows.
 */
const MENU_INVISIBLE = withFixture(
  'focus-only-shown.html',
  '<!-- twin -->',
  `<style>
    .menu a { visibility: hidden; }
    .menu:focus-within a { visibility: visible; }
    .menu a:focus-visible { outline: none; }
    .menu button:focus-visible { outline: 2px solid #222; outline-offset: 2px; }
  </style>
  <nav class="menu"><button type="button">Menu</button><ul><li><a href="#m1">First</a></li><li><a href="#m2">Second</a></li></ul></nav>`,
);

/**
 * focus-only-shown.html with a second skip link with no ring, in an sr-only wrapper, 1px both
 * ways, clipped, and off-screen at left: -10000px, that it grows into view on :focus-within: the
 * blur takes the link off-screen with its wrapper, so the exemption rests on the wrapper having
 * grown into the viewport, and the skip link's showing is its indicator, as the first one's is.
 * `stays` keeps the wrapper off-screen on focus too: a stop focused out of view.
 */
const skipSrOnly = (stays: boolean) =>
  withFixture(
    'focus-only-shown.html',
    '<!-- twin -->',
    `<style>
    .sr-only { position: absolute; left: -10000px; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    ${stays ? '' : '.sr-only:focus-within { position: static; width: auto; height: auto; overflow: visible; clip-path: none; }'}
    .sr-only a:focus-visible { outline: none; }
  </style>
  <div class="sr-only"><a href="#content">Skip to the content again</a></div>`,
  );

/**
 * focus-only-shown.html with a padded panel, a stop with a ring, whose content is
 * content-visibility: hidden until :focus-within, and a link in it with no ring: the blur skips the
 * link while the panel still shows.
 */
const PANEL_SKIPPED = withFixture(
  'focus-only-shown.html',
  '<!-- twin -->',
  `<style>
    .panel { padding: 1rem; border: 1px solid #222; }
    .panel:focus-visible { outline: 2px solid #222; outline-offset: 2px; }
    .panel:not(:focus-within) { content-visibility: hidden; }
    .panel a:focus-visible { outline: none; }
  </style>
  <div class="panel" tabindex="0"><p><a href="#p1">In the panel</a></p></div>`,
);

/**
 * focus-only-shown.html with a menu whose items are opacity: 0 until :focus-within, and have no
 * ring: the blur hides each item by its own opacity while its list item still shows.
 */
const MENU_TRANSPARENT = withFixture(
  'focus-only-shown.html',
  '<!-- twin -->',
  `<style>
    .menu a { opacity: 0; }
    .menu:focus-within a { opacity: 1; }
    .menu a:focus-visible { outline: none; }
    .menu button:focus-visible { outline: 2px solid #222; outline-offset: 2px; }
  </style>
  <nav class="menu"><button type="button">Menu</button><ul><li><a href="#m1">First</a></li><li><a href="#m2">Second</a></li></ul></nav>`,
);

/** focus-only-shown.html with a link that no longer takes focus once it's blurred. */
const GONE_ON_BLUR = withFixture(
  'focus-only-shown.html',
  '<!-- twin -->',
  `<p><a id="gone" href="#gone">A link gone once blurred</a></p>
  <script>document.getElementById('gone').addEventListener('blur', (event) => event.target.removeAttribute('href'));</script>`,
);

/** Each button of focus-rounded.html, and the corners the probe should read for it. */
const ROUNDED_READS = [
  ['.circle', [60, 60]],
  ['.long', [999, 999]],
  ['.ellipse', [80, 40]],
] as const;
/** The probe's rounding of each button of focus-rounded.html, focused: a finding where it's off. */
const roundedReads = async (page: Page): Promise<Finding[]> => {
  const findings: Finding[] = [];
  for (const [selector, [h, v]] of ROUNDED_READS) {
    await page.focus(selector);
    const active = await inPage<Active>(page, { kind: 'active' });
    const read = JSON.stringify(active.rounding ?? null);
    const want = JSON.stringify({
      corners: [
        [h, v],
        [h, v],
        [h, v],
        [h, v],
      ],
      offset: 2,
      width: 2,
    });
    if (read !== want) {
      findings.push({
        gate: 'focus',
        rule: 'rounding',
        path: selector,
        actual: `read ${read}, not ${want}`,
      });
    }
  }
  return findings;
};

/** Print's inventory, read after an earlier check left the page scrolled to its end. */
const printAfterScroll = async (page: Page): Promise<Finding[]> => {
  const before = await baseline(page);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await frames(page, 100);
  return inventoryFindings(page, '/', before, ['print']);
};

/** The checks whose failures defaultPassContent() keeps: the content conditions', and the runner's. */
const CONTENT_GATES = new Set(['inventory', 'enhancement', 'runner']);

/**
 * The stand-in's page as a cell's default row at 1440x900 runs it, through
 * run-cell.ts's own runPass(), in its order: the load, axe and the contrast
 * sampler, then the suites, the inventory's conditions and failed
 * enhancement among them. Its findings are what those conditions and the
 * runner record. What the pass writes goes to a folder of its own, gone
 * once it has run.
 */
const defaultPassContent = async (page: Page): Promise<Finding[]> => {
  const out = mkdtempSync(path.join(tmpdir(), 'quality-meta-pass-'));
  try {
    const testInfo = {
      outputPath: (name: string) => path.join(out, name),
      attach: async () => undefined,
    } as unknown as TestInfo;
    const cell: Cell = {
      id: 'surface:meta-stand-in / meta-stand-in/platform-neutral/warm-parchment/humanist-ui/system',
      kind: 'surface',
      target: 'meta-stand-in',
      owner: '#11',
      profile: 'read-only',
      performanceTier: 'light',
      tuple: defaultTuple('meta-stand-in', 'system'),
      path: '/',
      route: '/',
      state: 'complete',
      expectedStatus: 200,
      source: 'complete',
      sentinel: true,
      fixture: true,
    };
    const pass = await runPass(
      {
        page,
        cell,
        viewport: VIEWPORTS[0]!,
        row: DEFAULT_ROW,
        conditions: true,
        testInfo,
        expect: undefined as never,
      },
      { reemulate: false },
    );
    return pass.suiteFailures
      .filter((failure) => CONTENT_GATES.has(failure.check))
      .map((failure) => ({
        gate: failure.check,
        rule: failure.rule,
        actual: String(failure.actual),
      }));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
};

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
  {
    id: 'keyboard/framed-many-links',
    gate: 'keyboard',
    input:
      "a framed surface's page with a sandboxed frame of sixty links between two of its own: Tab goes in, through, and out",
    expect: 'pass',
    browser: true,
    run: () => onPage(FRAMED_MANY, framedWalk),
  },
  builtCase(
    'unframed-many-links',
    'keyboard',
    'the same page, with no framed flag: the page sees the frame at every press, and calls it a trap',
    FRAMED_MANY,
    /^(?:keyboard trap: focus came back to it after \d+ stops, short of the end|keyboard reachable: Tab never reached it)$/,
    unframedWalk,
  ),
  builtCase(
    'framed-trap',
    'keyboard',
    `a framed surface's page whose frame keeps Tab on its first link: past ${FRAME_PRESSES} presses inside it, a trap`,
    FRAMED_TRAP,
    new RegExp(
      `^(?:keyboard trap: focus never left the frame after ${FRAME_PRESSES} presses inside it|keyboard reachable: Tab never reached it)$`,
    ),
    framedTrapWalk,
  ),
  bad('hidden-focusable', 'keyboard-hidden.html', 'keyboard', 'hidden-focusable', keyboard),
  bad('unreachable', 'keyboard-unreachable.html', 'keyboard', 'reachable', keyboard),
  // A closed fold's own summary is a stop; what it folds away, nested summaries, a closed
  // dialog's or popover's controls, and hidden and inert ones, isn't owed.
  goodFile('folded', 'keyboard-folded.html', 'keyboard', keyboard),
  builtCase(
    'summary-skipped',
    'keyboard',
    "tests/quality/fixtures/a11y/keyboard-folded.html, with a script that moves focus past the fold's own summary",
    SUMMARY_SKIPPED,
    /^keyboard reachable: Tab never reached it \(#record-summary\)$/,
    keyboardAt,
  ),
  good('keyboard', keyboard),
  bad('no-indicator', 'focus-none.html', 'focus', 'visible', focus),
  bad('faint-indicator', 'focus-faint.html', 'focus', 'contrast', focus),
  bad('thin-indicator', 'focus-thin.html', 'focus', 'perimeter', focus),
  // A ring under a sticky header is measured once it's scrolled clear, and a rotated one round
  // its own sides; a faint 1px ring still fails, in view, scrolled clear of the header, and
  // rotated, one finding on each.
  goodFile('stuck-and-rotated', 'focus-stuck.html', 'focus', focus),
  builtCase(
    'faint-visible',
    'focus',
    'tests/quality/fixtures/a11y/focus-stuck.html, with links whose 1px ring is #ccc on white: in view, under the header until scrolled clear, and rotated',
    FOCUS_FAINT,
    /^focus contrast: /,
    onePerStop(focus, ['#faint-visible', '#faint-lifted', '#faint-turned']),
  ),
  // A full-height rail beside a link leaves no room to scroll it clear: its faint ring is
  // measured where it is, and fails, never passing out of the shot.
  bad('beside-rail', 'focus-rail.html', 'focus', 'contrast', focus),
  // A wrapped link's ring is held to the outline round its line boxes, not its bounding box: a
  // 2px ring passes, and a faint one still fails.
  goodFile('wrapped', 'focus-wrapped.html', 'focus', focus),
  builtCase(
    'wrapped-faint',
    'focus',
    'tests/quality/fixtures/a11y/focus-wrapped.html, with a second wrapped link whose 1px ring is #ccc on white',
    WRAPPED_FAINT,
    /^focus contrast: /,
    focus,
  ),
  // A two-line link is measured round each line: a ring lost on its first line fails, whole
  // as it is on the second.
  builtCase(
    'wrapped-half',
    'focus',
    "tests/quality/fixtures/a11y/focus-wrapped.html, with a two-line link whose first line sits on a band the ring's #222",
    WRAPPED_HALF,
    /^focus (?:perimeter|contrast): /,
    focus,
  ),
  // A straight 2px ring at a sub-pixel place, whole at its colour, its horizontal sides
  // antialiased across three rows, passes along its centre line, as a rounded ring does. One a
  // box clips on a side, one 1px (held to its pixels), one under 3:1, and one a neighbour covers
  // still fail, one finding each on its own stop.
  goodFile('straight-sub-pixel', 'focus-straight.html', 'focus', focus),
  builtCase(
    'straight-clipped',
    'focus',
    'tests/quality/fixtures/a11y/focus-straight.html, with a square plate a box clips along its right side',
    STRAIGHT_CLIPPED,
    /^focus perimeter: \d+ of \d+ points/,
    onePerStop(focus, ['#clipped']),
  ),
  builtCase(
    'straight-thin',
    'focus',
    'tests/quality/fixtures/a11y/focus-straight.html, with a second plate whose straight ring is 1px',
    STRAIGHT_THIN,
    /^focus (?:perimeter|contrast): /,
    onePerStop(focus, ['#thin']),
  ),
  builtCase(
    'straight-faint',
    'focus',
    'tests/quality/fixtures/a11y/focus-straight.html, with a second plate whose straight ring is 2.4:1 on the stage',
    STRAIGHT_FAINT,
    /^focus (?:perimeter|contrast): /,
    onePerStop(focus, ['#faint']),
  ),
  builtCase(
    'straight-covered',
    'focus',
    'tests/quality/fixtures/a11y/focus-straight.html, with a square plate an opaque neighbour covers along its top',
    STRAIGHT_COVERED,
    /^focus perimeter: \d+ of \d+ points/,
    onePerStop(focus, ['#covered']),
  ),
  // A straight ring the centre line reads across its whole width: one whose inner row lies on its
  // link's underline, and one whose outer row the next line's box covers, fail, whichever row
  // the line or its one-px credit reads (the lead's ruling, 3 Nov 2026). The sub-pixel case above
  // still passes: its partial rows are the ring blended over one ground.
  builtCase(
    'straight-underlined',
    'focus',
    "a page of its own: an underlined link at a 1px offset, its ring's inner bottom row on the underline",
    STRAIGHT_UNDERLINED,
    /^focus perimeter: \d+ of \d+ points/,
    onePerStop(focus, ['#underlined']),
  ),
  builtCase(
    'straight-lidded',
    'focus',
    "a page of its own: a ring whose outer bottom row the next line's box covers three quarters of",
    STRAIGHT_LIDDED,
    /^focus perimeter: \d+ of \d+ points/,
    onePerStop(focus, ['#lidded']),
  ),
  // A skip link shown only while it has focus isn't focused again after the blur, and the walk
  // goes on from it: no trap, every stop reached, every ring whole.
  goodFile('shown-on-focus', 'focus-only-shown.html', 'focus', (page) =>
    keyboardFindings(page, { focus: true }),
  ),
  // A menu open only on :focus-within hides with its items on the blur, so the clips show it
  // opening, not their rings: each item with no ring is unresolved, never passed.
  builtCase(
    'within-menu',
    'focus',
    'tests/quality/fixtures/a11y/focus-only-shown.html, with a :focus-within menu whose items have outline: none',
    MENU_WITHIN,
    /^focus visible: unresolved: the blur hid it with what holds it/,
    focus,
  ),
  // So does a dropdown moved off-screen until :focus-within, and a menu whose items are
  // visibility: hidden until then: each item with no ring is unresolved.
  builtCase(
    'offscreen-menu',
    'focus',
    'tests/quality/fixtures/a11y/focus-only-shown.html, with a dropdown at left: -9999px until :focus-within, its items outline: none',
    MENU_OFFSCREEN,
    /^focus visible: unresolved: the blur hid it with what holds it/,
    focus,
  ),
  builtCase(
    'invisible-items',
    'focus',
    'tests/quality/fixtures/a11y/focus-only-shown.html, with a menu whose items are visibility: hidden until :focus-within, outline: none',
    MENU_INVISIBLE,
    /^focus visible: unresolved: the blur hid it by its own visibility/,
    focus,
  ),
  // So do items opacity: 0 until :focus-within, and a link a padded panel's content-visibility
  // skips once focus leaves it.
  builtCase(
    'transparent-items',
    'focus',
    'tests/quality/fixtures/a11y/focus-only-shown.html, with a menu whose items are opacity: 0 until :focus-within, outline: none',
    MENU_TRANSPARENT,
    /^focus visible: unresolved: the blur hid it by its own visibility, opacity/,
    focus,
  ),
  builtCase(
    'skipped-content',
    'focus',
    'tests/quality/fixtures/a11y/focus-only-shown.html, with a padded panel content-visibility: hidden until :focus-within, its link outline: none',
    PANEL_SKIPPED,
    /^focus visible: unresolved: the blur hid it by its own visibility, opacity, or a skipped content-visibility/,
    focus,
  ),
  // A skip link with no ring in an off-screen sr-only wrapper it grows into view on :focus-within
  // is its own indicator; the same wrapper left off-screen on focus is a stop focused out of view.
  {
    ...goodFile('skip-sr-only', 'focus-only-shown.html', 'focus', (page) =>
      keyboardFindings(page, { focus: true }),
    ),
    input:
      'tests/quality/fixtures/a11y/focus-only-shown.html, with a ringless skip link in an off-screen sr-only wrapper it grows into view on :focus-within',
    run: () => onPage(skipSrOnly(false), (page) => keyboardFindings(page, { focus: true })),
  },
  builtCase(
    'skip-sr-only-stays',
    'focus',
    'tests/quality/fixtures/a11y/focus-only-shown.html, with a ringless skip link in an off-screen sr-only wrapper that stays off-screen on focus',
    skipSrOnly(true),
    /^keyboard hidden-focusable: it has focus outside the viewport/,
    (page) => keyboardFindings(page, { focus: true }),
  ),
  // A link that refocusing doesn't give focus back to is unresolved: the walk lost its place.
  builtCase(
    'gone-on-blur',
    'focus',
    "tests/quality/fixtures/a11y/focus-only-shown.html, with a link that loses its href when it's blurred",
    GONE_ON_BLUR,
    /^focus visible: unresolved: focus didn't come back/,
    focus,
  ),
  // A link the clearing scroll takes out of view is unresolved, never passed out of the shot.
  {
    ...bad('scrolled-away', 'focus-scrolled-away.html', 'focus', 'visible', focus),
    reason: /^focus visible: unresolved: scrolling it clear of .*took it out of the viewport/,
  },
  // Rounded rings read in the browser: a 50% circle, a 999px one CSS scales to 60px, and a 50%
  // ellipse pass, held to their rounded paths, and the probe reads each corner as computed.
  goodFile('rounded', 'focus-rounded.html', 'focus', focus),
  goodFile('rounded-read', 'focus-rounded.html', 'focus', roundedReads),
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
  // A visually hidden heading's words, a span inside a 1px clipped box, are no clip finding
  // (by clip-path and by clip); a visible heading its own box cuts is, and so is a box only one
  // way small, which shows a sliver of what it holds.
  goodFile('sr-only', 'reflow-sr-only.html', 'reflow', (page) => reflowFindings(page, '/')),
  bad('clipped-heading', 'reflow-clipped-heading.html', 'reflow', 'reflow|zoom|root-text', (page) =>
    reflowFindings(page, '/'),
  ),
  bad('sliver', 'reflow-sliver.html', 'reflow', 'reflow|zoom|root-text', (page) =>
    reflowFindings(page, '/'),
  ),
  good('reflow', (page) => reflowFindings(page, '/')),
  bad('needs-hover', 'inventory.html', 'inventory', 'content', inventory),
  good('inventory', inventory),
  // Print reads the page from the top, where the baseline was read: a running head a script
  // keeps in step with the scroll says what it said then.
  {
    id: 'inventory/running-head',
    gate: 'inventory',
    input:
      'tests/quality/fixtures/a11y/inventory-running-head.html, its print read after the page was left scrolled to its end',
    expect: 'pass',
    browser: true,
    run: () => onPage('inventory-running-head.html', printAfterScroll),
  },
  // The cell's baseline is read before the contrast sampler moves the page, not after: a live
  // status that names the panel a strip rests on, which the sampler scrolls to its far end, says
  // there what each condition's reload says.
  {
    id: 'inventory/scroll-status',
    gate: 'inventory',
    input:
      "tests/quality/fixtures/a11y/inventory-scroll-status.html, through runPass()'s default row at 1440x900",
    expect: 'pass',
    browser: true,
    run: () => onPage('inventory-scroll-status.html', defaultPassContent),
  },
  // A reload reads the page once its enhancements have mounted or failed: a button a lazy
  // chunk reveals after load is there under each condition, as it was for the baseline.
  {
    id: 'inventory/lazy-reveal',
    gate: 'inventory',
    input:
      'a type=button hidden in the server markup, which a lazy chunk served 750 ms late reveals 400 ms after it lands, the page idle between',
    expect: 'pass',
    browser: true,
    run: () =>
      onPage(
        lazyReveal('A lazy button', '<button type="button" hidden data-lazy>jump</button>'),
        revealed(inventory),
        { chunk: REVEAL },
      ),
  },
  // Row 44: after the touch condition, a mouse cell's later conditions render under its own
  // pointer media, so what only a mouse shows (HC's pinned chrome) is still there under grayscale.
  {
    id: 'inventory/pointer-after-touch',
    gate: 'inventory',
    input:
      'a link shown only under (hover: hover) and (pointer: fine), at 1440x900, under touch then grayscale',
    expect: 'pass',
    browser: true,
    run: () => onPage(POINTER_PINNED, pointerAfterTouch),
  },
  // And a load of its own after the conditions, as a full cell's primitives page, keeps it too.
  {
    id: 'inventory/pointer-after-conditions',
    gate: 'inventory',
    input:
      'a link shown only under (hover: hover) and (pointer: fine), at 1440x900, loaded again after touch then grayscale',
    expect: 'pass',
    browser: true,
    run: () => onPage(POINTER_PINNED, pointerAfterConditions),
  },
  // And one whose chunk never comes is no read: past BUSY_LIMIT_MS the cell fails, saying so.
  builtCase(
    'lazy-never',
    'runner',
    'a lazy chunk the stand-in never serves, under the touch condition',
    lazyReveal('A chunk that never comes', '<button type="button" hidden data-lazy>jump</button>'),
    new RegExp(`^runner enhanced: ${STILL_ENHANCING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
    touchInventory,
    { chunk: 'never' },
  ),
  bad('needs-canvas', 'enhancement.html', 'enhancement', 'semantics|navigation', enhancement),
  good('enhancement', enhancement),
  // Under failed enhancement a button that submits nothing may wait for its script, as
  // without JavaScript: Shell's jump buttons, hidden until the palette mounts.
  {
    id: 'enhancement/lazy-button',
    gate: 'enhancement',
    input:
      'a type=button hidden in the server markup, which a lazy chunk reveals, under failed enhancement',
    expect: 'pass',
    browser: true,
    run: () =>
      onPage(
        lazyReveal('A lazy button', '<button type="button" hidden data-lazy>jump</button>'),
        revealed(enhancement),
        { chunk: REVEAL },
      ),
  },
  // Nothing broader: a link, a text field, or a submit button it hides is still missing.
  ...(
    [
      ['lazy-link', '<a href="/elsewhere" hidden data-lazy>Elsewhere</a>'],
      ['lazy-input', '<label>Search <input type="text" hidden data-lazy></label>'],
      [
        'lazy-submit',
        '<form action="/"><button type="submit" hidden data-lazy>Send</button></form>',
      ],
    ] as const
  ).map(([id, control]) =>
    builtCase(
      id,
      'enhancement',
      `${control}, hidden in the server markup, which a lazy chunk reveals, under failed enhancement`,
      lazyReveal(`A lazy ${id.slice(5)}`, control),
      /^enhancement semantics: 1 field\(s\) missing, here (?:link|control): /,
      revealed(enhancement),
      { chunk: REVEAL },
    ),
  ),
  // A button that submits nothing goes with its own label: a block that holds nothing else, as
  // Flux's Copy email holds its <p>, isn't missing without JavaScript, under failed enhancement,
  // or in print (lead, 1 Nov 2026).
  {
    id: 'inventory/button-label',
    gate: 'inventory',
    input: `${BUTTON_LABEL}, which a lazy chunk reveals and print hides, without JavaScript and in print`,
    expect: 'pass',
    browser: true,
    run: () =>
      onPage(
        lazyReveal('A button label', BUTTON_LABEL, PRINT_HIDES),
        revealed(scriptlessInventory),
        {
          chunk: REVEAL,
        },
      ),
  },
  {
    id: 'enhancement/button-label',
    gate: 'enhancement',
    input: `${BUTTON_LABEL}, which a lazy chunk reveals, under failed enhancement`,
    expect: 'pass',
    browser: true,
    run: () =>
      onPage(lazyReveal('A button label', BUTTON_LABEL, PRINT_HIDES), revealed(enhancement), {
        chunk: REVEAL,
      }),
  },
  // A same-document skip link is a control, and a block of such controls and a short label of its
  // own goes with them: Swiss's Back to the top, alone and in its colophon cell, isn't missing
  // without JavaScript, under failed enhancement, or in print (lead, 1 Nov 2026).
  ...(
    [
      ['skip-link', 'A skip link', SKIP_LINK],
      ['control-label', 'A control label', CONTROL_LABEL],
    ] as const
  ).flatMap(([id, what, html]): MetaCase[] => [
    {
      id: `inventory/${id}`,
      gate: 'inventory',
      input: `${what}, ${html}, which a lazy chunk reveals and print hides, without JavaScript and in print`,
      expect: 'pass',
      browser: true,
      run: () =>
        onPage(lazyReveal(what, html, PRINT_HIDES), revealed(scriptlessInventory), {
          chunk: REVEAL,
        }),
    },
    {
      id: `enhancement/${id}`,
      gate: 'enhancement',
      input: `${what}, ${html}, which a lazy chunk reveals, under failed enhancement`,
      expect: 'pass',
      browser: true,
      run: () =>
        onPage(lazyReveal(what, html, PRINT_HIDES), revealed(enhancement), { chunk: REVEAL }),
    },
  ]),
  // Nothing broader: a paragraph, a link's text, a submit button's label, or a link styled as a
  // button, hidden the same way, is still missing, each field of it, under each condition; and so
  // are a link to a section, a paragraph of its own words beside a button, and a short label
  // beside a real link.
  ...[...LABEL_GUARDS, ...SKIP_GUARDS].flatMap(({ id, what, html, scriptless, print }) => [
    builtCase(
      id,
      'inventory',
      `${what}, ${html}, which a lazy chunk reveals and print hides, without JavaScript and in print`,
      lazyReveal(what, html, PRINT_HIDES),
      missingFields('inventory content', { 'no-javascript': scriptless, print }),
      missingUnder(['no-javascript', 'print'], revealed(scriptlessInventory)),
      { chunk: REVEAL },
    ),
    builtCase(
      id,
      'enhancement',
      `${what}, ${html}, which a lazy chunk reveals, under failed enhancement`,
      lazyReveal(what, html, PRINT_HIDES),
      missingFields('enhancement semantics', { 'failed enhancement': scriptless }),
      missingUnder(['failed enhancement'], revealed(enhancement)),
      { chunk: REVEAL },
    ),
  ]),
  // A page that declares nothing is read after its skip link is followed, as a visitor has it.
  bad('skip-changes', 'enhancement-skip-changes.html', 'enhancement', 'semantics', enhancement),
  // A Studio surface that declares requiresScript: with JavaScript off it says so in #content.
  bad(
    'no-javascript-silent',
    'no-javascript-silent.html',
    'enhancement',
    'notice',
    scriptRequired,
    {
      noScript: true,
    },
  ),
  // Its notice is shown, says it needs JavaScript, and axe reads it as a reader without it has it.
  bad(
    'no-javascript-hidden',
    'no-javascript-hidden.html',
    'enhancement',
    'notice',
    scriptRequired,
    {
      noScript: true,
    },
  ),
  bad(
    'no-javascript-unrelated',
    'no-javascript-unrelated.html',
    'enhancement',
    'notice',
    scriptRequired,
    { noScript: true },
  ),
  // And when the script it needs doesn't arrive, it says it couldn't load, and stops loading.
  bad(
    'failure-state-silent',
    'failure-state-silent.html',
    'enhancement',
    'failure-state',
    failureState,
  ),
  bad(
    'failure-state-busy',
    'failure-state-busy.html',
    'enhancement',
    'failure-state',
    failureState,
  ),
  // Its alert holds a control to try again, which takes focus.
  bad(
    'failure-state-no-control',
    'failure-state-no-control.html',
    'enhancement',
    'failure-state',
    failureState,
  ),
  bad(
    'failure-state-disabled',
    'failure-state-disabled.html',
    'enhancement',
    'failure-state',
    failureState,
  ),
  bad(
    'failure-state-unnamed',
    'failure-state-unnamed.html',
    'enhancement',
    'failure-state',
    failureState,
  ),
  // A Reload a script can focus but the keyboard never reaches.
  {
    ...bad(
      'failure-state-unreachable',
      'failure-state-unreachable.html',
      'enhancement',
      'failure-state',
      failureState,
    ),
    reason: /^enhancement failure-state: its control is out of the tab order$/,
  },
  {
    id: 'enhancement/failure-state',
    gate: 'enhancement',
    input: 'tests/quality/fixtures/a11y/failure-state.html',
    expect: 'pass',
    browser: true,
    run: () => onPage('failure-state.html', failureState),
  },
  {
    id: 'enhancement/no-javascript-notice',
    gate: 'enhancement',
    input: 'tests/quality/fixtures/a11y/no-javascript-notice.html',
    expect: 'pass',
    browser: true,
    run: () =>
      onPage(
        'no-javascript-notice.html',
        async (page) => [
          // With axe, as the no-JavaScript and print conditions run it.
          ...(await scriptRequiredAxe(page)),
          // Its waiting line is hidden without script, so the page has settled.
          ...((await notBusy(page))
            ? []
            : [{ gate: 'runner', rule: 'settled', actual: STILL_BUSY } as Finding]),
        ],
        { noScript: true },
      ),
  },
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
  // A sticky header over text isn't its background: scrolled clear, the text passes.
  goodFile('stuck', 'contrast-stuck.html', 'contrast', contrast),
  // And text at 1.00:1 that nothing covers still fails as a measure.
  builtCase(
    'faint-uncovered',
    'contrast',
    'tests/quality/fixtures/a11y/contrast-stuck.html, with text at 1.00:1 that nothing covers',
    STUCK_FAINT,
    /^contrast text: 1\.0\d:1 against its worst background pixel$/,
    contrast,
  ),
  // Text a fixed header covers wherever the page scrolls is unresolved, never a ratio.
  builtCase(
    'stuck-unresolved',
    'contrast',
    'text a fixed header covers on a page too short to scroll it clear',
    STUCK_FOR_GOOD,
    /^contrast text: unresolved: /,
    contrast,
  ),
  // Text an on-scroll entrance slides into place is read once the slide has ended, where its
  // glyphs paint, and passes.
  goodFile('arrival', 'contrast-arrival.html', 'contrast', contrast),
  // So is a word whose tab's color, which it inherits, a state change moves over 600 ms as it comes
  // into view: read once the tab's transition has ended, not part-way at its ground's color
  // (INHERITED_PAINTS; Flux's .fx-tab__word read at 1.00:1).
  goodFile('inherited-paint', 'contrast-inherited-paint.html', 'contrast', contrast),
  // And a word whose ink a script turns, with no transition, as the shots end a fade beside it,
  // landing a drop under it at once: its color is read again once its shots are taken, and read
  // once more where it turned, so its color and its background come from one state of the page,
  // never dark ink read before over the dark drop shot after (row 25; Flux's .fx-tab__word).
  goodFile('script-turn', 'contrast-script-turn.html', 'contrast', contrast),
  // So is one a timeout turns at 60 % of a drop's 1.2 s transition under it, as Flux's tabs do:
  // the shots end the transition, and the timeout, on the transition's own clock, comes after
  // them, so its color is read again only once the time the transition had left has passed.
  goodFile('timed-turn', 'contrast-timed-turn.html', 'contrast', contrast),
  // And links at rest that transition their own color, as Kinetic Cosmos's arc stops do: the
  // sampler's own mark and its removal set the transition off, so a link read again part-way back
  // to its ink is read at the transition's end, never called turned (row 25).
  goodFile('own-transition', 'contrast-own-transition.html', 'contrast', contrast),
  // A word whose color a script changes every frame never shows one state twice: unresolved,
  // a record that fails the gate, never a pass (row 25).
  {
    id: 'contrast/restless-ink',
    gate: 'contrast',
    input: 'tests/quality/fixtures/a11y/contrast-restless-ink.html',
    expect: 'fail',
    reason:
      /^contrast text: unresolved: its color turned while its background was shot, .+, and again once it held still, .+, so its color and its background never came from one state of the page$/,
    browser: true,
    run: () => onPage('contrast-restless-ink.html', contrast),
  },
  // So is text whose ancestor a scroll-driven animation slides in, once its progress holds.
  {
    id: 'contrast/arrival-scroll-driven',
    gate: 'contrast',
    input:
      'tests/quality/fixtures/a11y/contrast-animated.html, with a figure a scroll-driven animation slides in as it comes into view',
    expect: 'pass',
    browser: true,
    run: () => onPage(ARRIVAL_SCROLL_DRIVEN, contrast),
  },
  // Faint text whose figure rests part-way through a scroll-driven slide, which the shots would
  // cancel, is pinned where it rests for them, then let go: its ratio is its static twin's.
  builtCase(
    'resting-scroll-driven',
    'contrast',
    'tests/quality/fixtures/a11y/contrast-animated.html, with faint text whose figure rests part-way through a scroll-driven slide',
    ARRIVAL_RESTING,
    /^contrast text: \d\.\d\d:1 against its worst background pixel$/,
    restingContrast,
  ),
  // An ancestor's animation that moves nothing, an outline's color and --x, for good, and a
  // sibling's spin don't hold the text up: it's sampled, and passes.
  {
    id: 'contrast/animated-unrelated',
    gate: 'contrast',
    input:
      'tests/quality/fixtures/a11y/contrast-animated.html, with a block whose outline and --x pulse for good beside a spinning sibling',
    expect: 'pass',
    browser: true,
    run: () => onPage(ARRIVAL_UNRELATED, contrast),
  },
  // And text that animates for good never holds still: it's unresolved, saying so.
  builtCase(
    'animated-for-good',
    'contrast',
    'tests/quality/fixtures/a11y/contrast-animated.html, with text over a gradient that pulses for good',
    ARRIVAL_PULSING,
    /^contrast text: unresolved: an infinite animation, pulse, moves or repaints it, /,
    contrast,
  ),
  // Nor is a rotated sticker's border round its line: sampled inside its own quad, it passes.
  goodFile('rotated', 'contrast-rotated.html', 'contrast', contrast),
  // And a rotated line at 1.00:1 still fails as a measure.
  builtCase(
    'rotated-faint',
    'contrast',
    'tests/quality/fixtures/a11y/contrast-rotated.html, with a sticker whose line is its own background color',
    ROTATED_FAINT,
    /^contrast text: 1\.0\d:1 against its worst background pixel$/,
    contrast,
  ),
  // Faint text a cover hides until the sampler scrolls it clear still fails, measured clear.
  builtCase(
    'faint-under-cleared',
    'contrast',
    'tests/quality/fixtures/a11y/contrast-stuck.html, with text at 1.00:1 the sticky header covers until it is scrolled clear',
    STUCK_FAINT_UNDER,
    /^contrast text: 1\.0\d:1 against its worst background pixel$/,
    contrast,
  ),
  // The background is what lies within HALO of the glyphs: a star in the plate's box but clear
  // of its name isn't the name's background, and it passes; the whole box is 1.00:1.
  goodFile('halo-beside', 'contrast-halo.html', 'contrast', contrast),
  // A star that touches the last letter is, and the name fails against it.
  builtCase(
    'halo-crowded',
    'contrast',
    "tests/quality/fixtures/a11y/contrast-halo.html, with a plate whose star, in its name's color, touches its last letter",
    HALO_CROWDED,
    /^contrast text: 1\.\d\d:1 against its worst background pixel$/,
    contrast,
  ),
  // And a faint name with nothing else in its box fails on its glyphs' own background.
  builtCase(
    'halo-faint',
    'contrast',
    'tests/quality/fixtures/a11y/contrast-halo.html, with a plate whose name is #bbb and holds no decoration',
    HALO_FAINT,
    /^contrast text: 1\.[89]\d:1 against its worst background pixel$/,
    contrast,
  ),
  // A box turned in 3D, or an inline split across lines in a rotated block, has no one quad.
  builtCase(
    'unresolved-3d',
    'contrast',
    'text over a gradient in a box turned in 3D',
    TURNED_3D,
    /^contrast text: unresolved: it is transformed in 3D/,
    contrast,
  ),
  builtCase(
    'unresolved-split',
    'contrast',
    'an inline span over a gradient, split across two lines in a rotated block',
    TURNED_SPLIT,
    /^contrast text: unresolved: it is rotated or skewed across more than one line box/,
    contrast,
  ),
  // A fixed glow painted under raised text is its background, not a cover: white on it fails.
  builtCase(
    'glow-under',
    'contrast',
    'tests/quality/fixtures/a11y/contrast-glow.html: white text raised in a wrapping span over a fixed #eee glow',
    readFileSync(path.join(FIXTURES, 'contrast-glow.html'), 'utf8'),
    /^contrast (?:text|large-text): 1\.\d\d:1 against its worst background pixel$/,
    contrast,
  ),
  // A color-mix() text color computes to Oklab, which the sampler reads: faint, it still fails.
  builtCase(
    'oklab-faint',
    'contrast',
    'text in oklab(0.6 0 0) over a gradient of that grey, and readable Oklab and OKLCh text beside it',
    built(
      'Oklab text',
      'body { font: 16px/1.5 Arial, sans-serif; } p { background: linear-gradient(90deg, #fff, #f6f6f6); } .faint { color: oklab(0.6 0 0); background: linear-gradient(90deg, oklab(0.6 0 0), oklab(0.6 0 0)); } .ok { color: oklab(0.25 0.01 0.02); } .lch { color: oklch(0.3 0.05 260); }',
      '<p class="faint">Faint Oklab text.</p><p class="ok">Readable Oklab text.</p><p class="lch">Readable OKLCh text.</p>',
    ),
    /^contrast text: 1\.0\d:1 against its worst background pixel$/,
    contrast,
  ),
  // #20's .pf-period in dark mode: an en dash's edge inside the date's box isn't its background.
  goodFile('neighbour-glyphs', 'contrast-neighbour.html', 'contrast', contrast, {
    colorScheme: 'dark',
  }),
  // Text behind an element is its backdrop, not a neighbour: a large aria-hidden numeral behind a
  // heading stays in the sample, and the heading fails over it.
  // The finding must be the sampler's own measure against the numeral, about 2.1:1, not a
  // case it couldn't sample.
  builtCase(
    'backdrop-numeral',
    'contrast',
    'tests/quality/fixtures/a11y/contrast-backdrop.html',
    readFileSync(path.join(FIXTURES, 'contrast-backdrop.html'), 'utf8'),
    /^contrast large-text: [12]\.\d+:1 against its worst background pixel$/,
    contrast,
    { colorScheme: 'dark' },
  ),
  // And hiding the dash doesn't hide a date that's faint itself.
  bad('neighbour-faint', 'contrast-neighbour-faint.html', 'contrast', 'text', contrast, {
    colorScheme: 'dark',
  }),
  // The batch path (row 14): two texts in one viewport whose marks reach each other's box never
  // share a batch, so the one whose neighbour's currentColor border is its background still fails
  // over it, and the batch path finds what each element on its own does, record for record.
  {
    id: 'contrast/batch-neighbours',
    gate: 'contrast',
    input: 'tests/quality/fixtures/a11y/contrast-batch-neighbours.html',
    expect: 'fail',
    reason: /^contrast text: 1\.\d\d:1 against its worst background pixel$/,
    browser: true,
    run: () => onPage('contrast-batch-neighbours.html', contrastBothWays),
  },
  // A member something starts moving after its wait, as a later member waits, is checked again
  // before it's read and shot, and takes its own path: it's measured at rest, as on its own.
  goodFile('batch-late', 'contrast-batch-late.html', 'contrast', contrastBothWays),
  // And forty far-apart texts in one viewport cost a few round trips and shots, not fifteen and three each.
  {
    id: 'contrast/batch-round-trips',
    gate: 'contrast',
    input: `forty texts on a gradient in one 1440x900 viewport, within ${tripsFor(40)} round trips and as many screenshots`,
    expect: 'pass',
    browser: true,
    run: () => onPage(manyTexts(40), contrastTrips),
  },
  // High contrast holds text to thresholds.json's highContrast ratio, 7, by the element's own
  // boundary (a tuple cell's, here on the default row) or by prefers-contrast: more: axe's
  // color-contrast-enhanced on a solid surface, and the sampler over a gradient.
  builtCase(
    'high-contrast-solid-5-5',
    'axe',
    '16px text at 5.49:1 on a solid surface, in a boundary rendering high-contrast',
    modeText('High contrast, solid', '#696969', 'high-contrast', 'solid'),
    /^axe color-contrast-enhanced: /,
    rowContrast('default'),
  ),
  builtCase(
    'high-contrast-gradient-5-5',
    'contrast',
    '16px text at 5.49:1 over a gradient, in a boundary rendering high-contrast',
    modeText('High contrast, gradient', '#696969', 'high-contrast', 'gradient'),
    /^contrast high-contrast-text: 5\.\d+:1 against its worst background pixel$/,
    rowContrast('default'),
  ),
  // The main pass audits the page once its enhancements are in: the plain link an
  // enhancement hides as it goes live is no finding, however low its contrast (Aurora's
  // plain Index, whose boxes the sampler then found gone), and what shows live is the one read.
  {
    id: 'contrast/pre-live-node',
    gate: 'contrast',
    input:
      'a plain link at 1.7:1 (#c8c8c8 on white) that a lazy chunk, 750 ms late, hides as it marks the page live, its live button dark on white',
    expect: 'pass',
    browser: true,
    run: () =>
      onPage(liveSwap('A plain link gone live', '#c8c8c8', '#111'), mainPassContrast, {
        chunk: GO_LIVE,
      }),
  },
  // And a control that's low contrast once live still fails.
  builtCase(
    'low-after-live',
    'axe',
    'a live button at 1.7:1 (#c8c8c8 on white) that a lazy chunk, 750 ms late, shows as it marks the page live',
    liveSwap('A live button too pale', '#111', '#c8c8c8'),
    /^axe color-contrast: /,
    mainPassContrast,
    { chunk: GO_LIVE },
  ),
  builtCase(
    'contrast-more-5-5',
    'contrast',
    '16px text at 5.49:1, solid and over a gradient, under prefers-contrast: more',
    modeText('Contrast more', '#696969', 'light', 'both'),
    /^(?:axe color-contrast-enhanced|contrast high-contrast-text): /,
    rowContrast('contrast-more'),
    { contrast: 'more' },
  ),
  {
    id: 'contrast/normal-5-5',
    gate: 'contrast',
    input: '16px text at 5.49:1, solid and over a gradient, in a boundary rendering light',
    expect: 'pass',
    browser: true,
    run: () => onPage(modeText('Normal', '#696969', 'light', 'both'), rowContrast('default')),
  },
  {
    id: 'contrast/high-contrast-7-5',
    gate: 'contrast',
    input: '16px text at 7.57:1, solid and over a gradient, in a boundary rendering high-contrast',
    expect: 'pass',
    browser: true,
    run: () =>
      onPage(
        modeText('High contrast, 7.5', '#545454', 'high-contrast', 'both'),
        rowContrast('high-contrast'),
      ),
  },
  bad('button-name', 'axe-semantics.html', 'axe', 'button-name', axeRule('button-name')),
  bad('target-size', 'axe-semantics.html', 'axe', 'target-size', axeRule('target-size')),
  bad('color-contrast', 'axe-semantics.html', 'axe', 'color-contrast', axeRule('color-contrast')),
  // A page that requires script: axe reads its <noscript> notice as a reader without it has it.
  bad(
    'no-javascript-faint',
    'no-javascript-faint.html',
    'axe',
    'color-contrast',
    scriptRequiredAxe,
    {
      noScript: true,
    },
  ),
  // And so does the no-JavaScript row's own axe pass, through run-cell's audit().
  bad('no-javascript-row-faint', 'no-javascript-faint.html', 'axe', 'color-contrast', rowAudit),
  {
    id: 'axe/no-javascript-row-notice',
    gate: 'axe',
    input: 'tests/quality/fixtures/a11y/no-javascript-notice.html',
    expect: 'pass',
    browser: true,
    run: () => onPage('no-javascript-notice.html', rowAudit),
  },
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
  // A page settles once nothing on it says it's at work but a fixture's marked specimens:
  // a loading Action inside data-quality-specimen="busy" is at work for good by design; the
  // same button unmarked, or a region or status line, is the page still loading.
  bad('busy-region', 'busy-region.html', 'runner', 'settled', settled),
  bad('busy-unmarked', 'busy-unmarked.html', 'runner', 'settled', settled),
  {
    id: 'runner/busy-specimen',
    gate: 'runner',
    input: 'tests/quality/fixtures/a11y/busy-specimen.html',
    expect: 'pass',
    browser: true,
    run: () => onPage('busy-specimen.html', settled),
  },
];
