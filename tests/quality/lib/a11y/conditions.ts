// The checks that reload the page under a condition (#11, Slice 2, items
// 5, 6, 8, and the original's item 4), each against the page as the cell
// first loaded it.
//
// - inventory: every heading, text block, link and its target, image alt,
//   and control the default render has is still there under each of the
//   original's item 4 conditions (no hover, no pointer precision, no
//   animation, no canvas or WebGL, no translucency, color alone, no loaded
//   font), and with JavaScript off and in print. A field counts when shown
//   or inside a closed <details>. Each condition must take, or the check
//   fails rather than pass a page it never changed.
// - enhancement: with the optional chunks (every script chunk the HTML
//   doesn't load itself), the canvas contexts, and the fonts taken away,
//   the page keeps one main, an h1, a skip link that lands in its target,
//   every fragment link's target, and its inventory.
// - reflow: at 320x568, at 200% zoom (640x400 at deviceScaleFactor 2), and
//   at 200% root text (1024x768), nothing scrolls sideways, and no text or
//   control leaves the viewport or a box that clips it, but inside a
//   declared scroll region: one a keyboard reaches, with a name.
// - transparency: under prefers-reduced-transparency, no backdrop-filter,
//   and #19's Surface, Dialog, and Navigation slots opaque.
// - A surface that needs its script by design, a Studio surface registering
//   `requiresScript` (registration.ts): with JavaScript off, and in print
//   over that page, its honest no-JavaScript state replaces the inventory
//   comparison. The page settles, says in #content that it needs
//   JavaScript, keeps one main, an h1, and its skip target, and passes axe.
//   Under failed enhancement its failure state does: an alert that it
//   couldn't load, a control to try again that takes focus, nothing still
//   aria-busy, and axe, beside the landmark, fragment, and skip checks.

import type { CDPSession, Page, Request } from '@playwright/test';
import { loadThresholds, viewportSize } from '../../../../quality/thresholds';
import { axeFor } from '../axe';
import { frames, type Finding } from './interaction';
import { decodePng } from '../pixels';
import { inPage } from './probe';

const thresholds = loadThresholds();

/** The color scheme the cells' contexts emulate, which a CDP media override must keep. */
const BASE_FEATURES = [{ name: 'prefers-color-scheme', value: 'light' }];

/** WebGL, WebGL 2, and 2D canvas contexts come back null, as on a browser without them. */
export const NO_CANVAS = `(() => {
  const none = /^(?:webgl2?|experimental-webgl|2d|bitmaprenderer|webgpu)$/;
  for (const type of [globalThis.HTMLCanvasElement, globalThis.OffscreenCanvas]) {
    if (!type) continue;
    const original = type.prototype.getContext;
    type.prototype.getContext = function (kind, ...rest) {
      return none.test(String(kind)) ? null : original.call(this, kind, ...rest);
    };
  }
})();`;

/** On paper no control works, so print may drop every one. */
export const PRINT_IGNORE = /^control: /;
/** Without JavaScript, a button that submits no form may stay out. */
export const NO_SCRIPT_IGNORE = /^control: button:(?:button|reset) /;

/** What a condition does to the page, and how the check knows it took. */
export interface Condition {
  readonly id: string;
  /** Reload under it: false for one that applies to the page as loaded. */
  readonly reload: boolean;
  /** Fields it may take away, as nothing a visitor needs under it. */
  readonly ignore?: RegExp;
  setup(page: Page, cdp: CDPSession): Promise<void>;
  /** Why it didn't take, or null when it did. */
  verify(page: Page): Promise<string | null>;
  teardown(page: Page, cdp: CDPSession): Promise<void>;
}

const matches = (query: string) => async (page: Page) =>
  (await page.evaluate((q) => matchMedia(q).matches, query)) ? null : `${query} doesn't match`;

/** A media feature only CDP emulates, such as hover or prefers-reduced-transparency. */
function feature(
  id: string,
  features: { name: string; value: string }[],
  query: string,
): Condition {
  return {
    id,
    reload: true,
    setup: async (_page, cdp) => {
      await cdp.send('Emulation.setEmulatedMedia', {
        media: '',
        features: [...BASE_FEATURES, ...features],
      });
    },
    verify: matches(query),
    teardown: async (_page, cdp) => {
      await cdp.send('Emulation.setEmulatedMedia', { media: '', features: BASE_FEATURES });
    },
  };
}

/** Fonts the page asks for are aborted, and a font that loads anyway undoes the condition. */
function noFont(): Condition {
  const loaded: string[] = [];
  const onFinished = (request: Request) => {
    if (request.resourceType() === 'font') loaded.push(request.url());
  };
  return {
    id: 'no-font',
    reload: true,
    setup: async (page) => {
      loaded.length = 0;
      await page.route('**/*', (route) =>
        route.request().resourceType() === 'font'
          ? route.abort('blockedbyclient')
          : route.fallback(),
      );
      page.on('requestfinished', onFinished);
    },
    verify: async () => (loaded.length > 0 ? `${loaded[0]} loaded` : null),
    teardown: async (page) => {
      page.off('requestfinished', onFinished);
      await page.unrouteAll({ behavior: 'wait' });
    },
  };
}

function noCanvas(): Condition {
  let script = '';
  return {
    id: 'no-canvas',
    reload: true,
    setup: async (_page, cdp) => {
      // The session's Page domain must be on for its script to reach new documents.
      await cdp.send('Page.enable');
      ({ identifier: script } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: NO_CANVAS,
      }));
    },
    verify: async (page) =>
      (await page.evaluate(() => document.createElement('canvas').getContext('2d') === null))
        ? null
        : 'getContext("2d") still returns a context',
    teardown: async (_page, cdp) => {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script });
    },
  };
}

/** The original's item 4 conditions, then no JavaScript and print. */
export function conditions(): Condition[] {
  return [
    {
      // Touch: no hover and no pointer precision, as Chromium's touch emulation reports them.
      id: 'touch',
      reload: true,
      setup: async (_page, cdp) => {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      },
      verify: async (page) =>
        (await matches('(hover: none)')(page)) ?? (await matches('(pointer: coarse)')(page)),
      teardown: async (_page, cdp) => {
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      },
    },
    {
      id: 'reduced-motion',
      reload: true,
      setup: (page) => page.emulateMedia({ reducedMotion: 'reduce' }),
      verify: matches('(prefers-reduced-motion: reduce)'),
      teardown: (page) => page.emulateMedia({ reducedMotion: null }),
    },
    noCanvas(),
    feature(
      'reduced-transparency',
      [{ name: 'prefers-reduced-transparency', value: 'reduce' }],
      '(prefers-reduced-transparency: reduce)',
    ),
    {
      id: 'grayscale',
      reload: false,
      setup: (page) =>
        page.evaluate(() =>
          document.documentElement.style.setProperty('filter', 'grayscale(1)', 'important'),
        ),
      verify: async (page) =>
        (await page.evaluate(() => getComputedStyle(document.documentElement).filter)) ===
        'grayscale(1)'
          ? null
          : "the filter didn't apply",
      teardown: async (page) => {
        await page.evaluate(() => document.documentElement.style.removeProperty('filter'));
      },
    },
    noFont(),
    {
      id: 'no-javascript',
      reload: true,
      // A button that submits nothing is an enhancement, which may wait for JavaScript.
      ignore: NO_SCRIPT_IGNORE,
      setup: async (_page, cdp) => {
        await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
      },
      verify: matches('(scripting: none)'),
      teardown: async (_page, cdp) => {
        await cdp.send('Emulation.setScriptExecutionDisabled', { value: false });
      },
    },
    {
      id: 'print',
      reload: false,
      ignore: PRINT_IGNORE,
      setup: (page) => page.emulateMedia({ media: 'print' }),
      verify: matches('print'),
      teardown: (page) => page.emulateMedia({ media: null }),
    },
  ];
}

/** The longest a page may say it's still loading, by aria-busy, before a check reads it anyway. */
export const BUSY_LIMIT_MS = 10_000;

/** What a page that never stops saying it's loading is, as a finding's words. */
export const STILL_BUSY = `the page still says it's loading, aria-busy="true", after ${BUSY_LIMIT_MS / 1000} s`;

/**
 * Waits until nothing on the page says it's still loading, a shown element
 * with aria-busy="true", as a page that fetches its content after it loads
 * does (#8's Studio), up to BUSY_LIMIT_MS. One that isn't rendered, such as
 * Studio's waiting line under (scripting: none), tells no one it's loading.
 * False when the page is still busy then: the caller fails the cell with
 * STILL_BUSY, and reads the page as it stands, so it never passes on a page
 * that never settled.
 */
export async function notBusy(page: Page): Promise<boolean> {
  return page
    .waitForFunction(
      () =>
        ![...document.querySelectorAll('[aria-busy="true"]')].some(
          (element) => element.getClientRects().length > 0,
        ),
      null,
      { timeout: BUSY_LIMIT_MS },
    )
    .then(
      () => true,
      () => false,
    );
}

/** A finding for a page a condition reloaded that never settled. */
const stillBusy = (condition: string): Finding => ({
  gate: 'runner',
  rule: 'settled',
  expected: `the page settles under ${condition}`,
  actual: STILL_BUSY,
});

/** Loads `path`, and answers whether it settled. */
async function load(page: Page, path: string): Promise<boolean> {
  await page.goto(path, { waitUntil: 'load' });
  const settled = await notBusy(page);
  await frames(page);
  return settled;
}

/** What `before` has and `now` lacks, as findings under `condition`. */
function missingItems(
  rule: string,
  gate: string,
  condition: string,
  before: readonly string[],
  now: readonly string[],
  ignore?: RegExp,
): Finding[] {
  const present = new Set(now);
  const gone = before.filter((item) => !present.has(item) && !ignore?.test(item));
  return gone.slice(0, 10).map((item) => ({
    gate,
    rule,
    expected: `present under ${condition}`,
    actual: `${gone.length} field(s) missing, here ${item}`,
  }));
}

/** The inventory under each condition, against `baseline`, the page's own. Leaves the page as the cell loaded it. */
export async function inventoryFindings(
  page: Page,
  path: string,
  baseline: readonly string[],
  only?: readonly string[],
  scriptRequired = false,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const condition of conditions().filter((each) => !only || only.includes(each.id))) {
      await condition.setup(page, cdp);
      try {
        if (condition.reload && !(await load(page, path))) findings.push(stillBusy(condition.id));
        const problem = await condition.verify(page);
        if (problem) {
          // Slice 1's fail-closed rule: a condition that didn't take proves nothing.
          findings.push({
            gate: 'runner',
            rule: 'media-emulation',
            expected: `the ${condition.id} condition takes`,
            actual: `${condition.id}: ${problem}: the emulation was ignored`,
          });
          continue;
        }
        // Without JavaScript, and in print over that page, a page that needs it says so instead.
        if (scriptRequired && condition.id === 'no-javascript') {
          findings.push(...(await scriptRequiredFindings(page, cdp, condition.id)));
          continue;
        }
        if (scriptRequired && condition.id === 'print') {
          // The no-JavaScript page in print: script back on would hide its <noscript>, so it
          // loads again with script off, as the condition before left it, and reads in print.
          await cdp.send('Emulation.setScriptExecutionDisabled', { value: true });
          try {
            if (!(await load(page, path))) findings.push(stillBusy(condition.id));
            findings.push(...(await scriptRequiredFindings(page, cdp, condition.id)));
          } finally {
            await cdp.send('Emulation.setScriptExecutionDisabled', { value: false });
          }
          continue;
        }
        findings.push(
          ...missingItems(
            'content',
            'inventory',
            condition.id,
            baseline,
            await inPage<string[]>(page, { kind: 'inventory' }),
            condition.ignore,
          ),
        );
      } finally {
        await condition.teardown(page, cdp);
      }
    }
  } finally {
    await cdp.detach();
  }
  if (!(await load(page, path))) findings.push(stillBusy('the reload after the conditions'));
  return findings;
}

/**
 * A page that needs the script it couldn't load, as it stands under failed
 * enhancement: an alert, shown and with words, that it couldn't load, a
 * control in it to try again that takes focus, nothing still aria-busy, and
 * axe. Its landmarks, fragments, and skip link are enhancementFindings' own.
 */
export async function failureStateFindings(
  page: Page,
  { axe = true }: { readonly axe?: boolean } = {},
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const fail = (expected: string, actual: string) =>
    findings.push({ gate: 'enhancement', rule: 'failure-state', expected, actual });
  // No named helper inside: esbuild's keepNames would wrap it in a __name the page lacks.
  const state = await page.evaluate((again) => {
    const alert = [...document.querySelectorAll('[role="alert"]')].find(
      (element) =>
        element.getClientRects().length > 0 && (element as HTMLElement).innerText.trim() !== '',
    );
    const control = alert?.querySelector<HTMLElement>('button, a[href], input, select') ?? null;
    control?.focus();
    const name = control
      ? (control.getAttribute('aria-label') ?? control.innerText ?? '').trim()
      : '';
    return {
      alert: Boolean(alert),
      control: Boolean(control),
      named: new RegExp(again, 'i').test(name),
      focused: control !== null && control.tabIndex >= 0 && document.activeElement === control,
      busy: [...document.querySelectorAll('[aria-busy="true"]')].filter(
        (element) => element.getClientRects().length > 0,
      ).length,
    };
  }, TRY_AGAIN.source);
  if (!state.alert) {
    fail("an alert that it couldn't load, under failed enhancement", 'no alert says so');
  } else if (!state.control) {
    fail('a control in the alert to try again, which takes focus', 'the alert has no control');
  } else if (!state.focused) {
    fail(
      'a control in the alert to try again, which takes focus',
      "its control doesn't take focus",
    );
  } else if (!state.named) {
    fail(
      'a control in the alert to try again, which takes focus',
      'its control is named for something other than trying again',
    );
  }
  if (state.busy > 0) {
    fail('nothing still says it is loading', `${state.busy} element(s) are still aria-busy`);
  }
  if (axe) {
    for (const rule of (await axeFor(page).analyze()).violations) {
      findings.push({
        gate: 'axe',
        rule: rule.id,
        expected: `no ${rule.id} violation, under failed enhancement`,
        actual: `${rule.nodes.length} element(s): ${rule.help}`,
      });
    }
  }
  return findings;
}

/** What names a failure state's control: it tries again, as Studio's Reload Studio does. */
const TRY_AGAIN = /reload|try again|retry/;

/** Where a page that needs JavaScript says so, as Studio's <noscript> notice does. */
export const NO_JAVASCRIPT_NOTICE = '#content';

/** What its notice says it needs. */
const NEEDS_JAVASCRIPT = /JavaScript/i;

/**
 * Each <noscript>'s content, which the parser made elements with script off,
 * moved into a stand-in <div>. Script back on, as axe needs it, hides a
 * noscript's content from rendering, and so from axe; in a div it stays as a
 * reader without JavaScript has it. Run while script is still off.
 */
export async function revealNoscript(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const noscript of [...document.querySelectorAll('noscript')]) {
      const stand = document.createElement('div');
      stand.setAttribute('data-quality-noscript', '');
      stand.append(...noscript.childNodes);
      noscript.replaceWith(stand);
    }
  });
}

/**
 * A page that needs JavaScript, as it stands without it (`under` names the
 * condition): its notice in NO_JAVASCRIPT_NOTICE, shown and with words, one
 * main, an h1, a skip link whose target is there, and axe, which runs with
 * script on for its pass alone. `cdp` is the page's session, which turns
 * script off again after.
 */
export async function scriptRequiredFindings(
  page: Page,
  cdp: CDPSession | null,
  under: string,
  { axe = true }: { readonly axe?: boolean } = {},
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const fail = (rule: string, expected: string, actual: string) =>
    findings.push({ gate: 'enhancement', rule, expected: `${expected}, ${under}`, actual });
  // innerText of a shown element is its shown text alone; of a hidden one, all of it.
  const notice = await page.evaluate((at) => {
    const target = document.querySelector(at);
    if (!target) return null;
    return {
      shown: target.getClientRects().length > 0,
      text: (target as HTMLElement).innerText.trim(),
    };
  }, NO_JAVASCRIPT_NOTICE);
  const expected = `a notice in ${NO_JAVASCRIPT_NOTICE}, shown, that it needs JavaScript`;
  if (!notice) {
    fail('notice', expected, `no ${NO_JAVASCRIPT_NOTICE}`);
  } else if (!notice.shown) {
    fail('notice', expected, `${NO_JAVASCRIPT_NOTICE} isn't shown`);
  } else if (notice.text === '') {
    fail('notice', expected, `${NO_JAVASCRIPT_NOTICE} says nothing`);
  } else if (!NEEDS_JAVASCRIPT.test(notice.text)) {
    fail('notice', expected, `${NO_JAVASCRIPT_NOTICE} doesn't say it needs JavaScript`);
  }
  const structure = await inPage<Structure>(page, { kind: 'structure' });
  if (structure.mains !== 1) fail('semantics', 'one main landmark', `${structure.mains}`);
  if (structure.h1s === 0) fail('semantics', 'an h1', 'none');
  if (structure.skip && !structure.skipTarget) {
    fail('navigation', 'the skip link names its target', `${structure.skip} names no element`);
  }
  if (axe) {
    await revealNoscript(page);
    await cdp?.send('Emulation.setScriptExecutionDisabled', { value: false });
    try {
      const results = await axeFor(page).analyze();
      for (const rule of results.violations) {
        findings.push({
          gate: 'axe',
          rule: rule.id,
          expected: `no ${rule.id} violation, ${under}`,
          actual: `${rule.nodes.length} element(s): ${rule.help}`,
        });
      }
    } finally {
      await cdp?.send('Emulation.setScriptExecutionDisabled', { value: true });
    }
  }
  return findings;
}

interface Structure {
  readonly mains: number;
  readonly h1s: number;
  readonly skip: string | null;
  readonly skipTarget: string | null;
  readonly fragments: readonly { path: string; href: string; found: boolean }[];
}

/** The page with its optional enhancement taken away. `scripts` are the script URLs its HTML loads itself. */
export async function enhancementFindings(
  page: Page,
  path: string,
  baseline: readonly string[],
  scripts: readonly string[],
  scriptRequired = false,
): Promise<Finding[]> {
  const cdp = await page.context().newCDPSession(page);
  const own = new Set(scripts);
  await cdp.send('Page.enable');
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: NO_CANVAS,
  });
  await page.route('**/*', (route) => {
    const request = route.request();
    const optional =
      request.resourceType() === 'script' &&
      /\/_next\/static\/chunks\//.test(request.url()) &&
      !own.has(request.url());
    return optional || request.resourceType() === 'font'
      ? route.abort('blockedbyclient')
      : route.fallback();
  });
  const findings: Finding[] = [];
  try {
    if (!(await load(page, path))) findings.push(stillBusy('failed enhancement'));
    const structure = await inPage<Structure>(page, { kind: 'structure' });
    const missing = async () =>
      missingItems(
        'semantics',
        'enhancement',
        'failed enhancement',
        baseline,
        await inPage<string[]>(page, { kind: 'inventory' }),
      );
    // A page that needs the script it lost works without it, or shows its failure state in
    // place of the content it couldn't load. It's read as it loaded, before the skip link is
    // followed, which may change it: Studio's first fragment link opens its Content task.
    let read: Finding[] | null = null;
    if (scriptRequired) {
      const lost = await missing();
      read = lost.length > 0 ? await failureStateFindings(page) : [];
    }
    const semantics = (actual: string) =>
      findings.push({
        gate: 'enhancement',
        rule: 'semantics',
        expected: 'one main and an h1, without the enhancements',
        actual,
      });
    if (structure.mains !== 1) semantics(`${structure.mains} main landmarks`);
    if (structure.h1s === 0) semantics('no h1');
    const navigation = (actual: string, at?: string) =>
      findings.push({
        gate: 'enhancement',
        rule: 'navigation',
        path: at,
        expected: 'links and the skip link work without the enhancements',
        actual,
      });
    for (const fragment of structure.fragments.filter((each) => !each.found)) {
      navigation(`${fragment.href} names no element`, fragment.path);
    }
    if (structure.skip && structure.skipTarget) {
      await page.keyboard.press('Tab');
      await page.evaluate(
        (at) => (document.querySelector(at) as HTMLElement | null)?.focus(),
        structure.skip,
      );
      await page.keyboard.press('Enter');
      await frames(page);
      const landed = await page.evaluate(
        (target) => Boolean(document.querySelector(target)?.contains(document.activeElement)),
        structure.skipTarget,
      );
      if (!landed)
        navigation(`the skip link leaves focus outside ${structure.skipTarget}`, structure.skip);
    }
    findings.push(...(read ?? (await missing())));
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await cdp.detach();
  }
  if (!(await load(page, path))) findings.push(stillBusy('the reload after failed enhancement'));
  return findings;
}

/** The reflow conditions from quality/thresholds.json: 320 px, 200% zoom, and 200% root text. */
export function reflowConditions() {
  const { reflow, zoom, rootText } = thresholds.viewports;
  return [
    ...reflow.map((id) => ({ rule: 'reflow', id, scale: 1, text: 1 })),
    ...zoom.map(({ viewport, deviceScaleFactor }) => ({
      rule: 'zoom',
      id: viewport,
      scale: deviceScaleFactor,
      text: 1,
    })),
    ...rootText.map(({ viewport, scale }) => ({
      rule: 'root-text',
      id: viewport,
      scale: 1,
      text: scale,
    })),
  ];
}

/** The reflow check under each condition. It puts the viewport back and reloads. */
export async function reflowFindings(
  page: Page,
  path: string,
  disclosures: readonly string[] = [],
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const original = page.viewportSize()!;
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const condition of reflowConditions()) {
      const { width, height } = viewportSize(condition.id);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: condition.scale,
        mobile: false,
      });
      if (!(await load(page, path))) findings.push(stillBusy(condition.rule));
      if (condition.text !== 1) {
        await page.evaluate(
          (scale) =>
            document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
          condition.text,
        );
        await frames(page);
      }
      const probe = async (state: string) => {
        for (const problem of await inPage<{ rule: string; path: string; detail: string }[]>(page, {
          kind: 'reflow',
        })) {
          findings.push({
            gate: 'reflow',
            rule: condition.rule,
            path: problem.path,
            expected: 'no sideways scroll, and nothing clipped or out of view',
            actual: `${problem.detail}${state}`,
            viewport: condition.id,
          });
        }
      };
      await probe('');
      // Each registered disclosure toggled, and back: what it shows reflows too.
      for (const name of disclosures) {
        const control = await inPage<{ path: string } | null>(page, { kind: 'named', name });
        if (!control) continue;
        await page.click(control.path);
        await frames(page);
        await probe(`, with ${name} toggled`);
        await page.click(control.path);
        await frames(page);
      }
    }
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await cdp.detach();
    await page.setViewportSize(original);
  }
  if (!(await load(page, path))) findings.push(stillBusy('the reload after reflow'));
  return findings;
}

/** The two fills put under a surface: a pixel inside it that changes between them is see-through. */
const UNDER = ['rgb(255, 0, 255)', 'rgb(0, 255, 0)'];

/**
 * Whether anything shows through the element `path` names: every ancestor
 * is filled with one color, then another, with everything beside them and
 * their own pseudo-elements faded out, and a pixel inside the element's
 * corner radius and border that changes is what's behind coming through.
 */
async function seeThrough(page: Page, path: string, inset: number): Promise<boolean> {
  await page
    .locator(path)
    .first()
    .scrollIntoViewIfNeeded({ timeout: 2_000 })
    .catch(() => undefined);
  const box = await inPage<{ x: number; y: number; width: number; height: number } | null>(page, {
    kind: 'box',
    path,
  });
  const viewport = page.viewportSize()!;
  if (!box) return false;
  const x = Math.max(0, Math.ceil(box.x + inset));
  const y = Math.max(0, Math.ceil(box.y + inset));
  const width = Math.min(viewport.width, Math.floor(box.x + box.width - inset)) - x;
  const height = Math.min(viewport.height, Math.floor(box.y + box.height - inset)) - y;
  if (width < 2 || height < 2) return false;
  const shots: Uint8Array[] = [];
  for (const fill of UNDER) {
    await page.evaluate(
      ({ at, color }) => {
        // Every ancestor takes the fill, and everything beside the line from
        // the root down to the surface goes, so a sibling's image under the
        // surface can't pass for an opaque fill.
        const el = document.querySelector(at);
        for (let up = el?.parentElement, child: Element | null | undefined = el; up;) {
          up.setAttribute('data-quality-under', '');
          for (const other of up.children)
            if (other !== child && other.localName !== 'style' && other.localName !== 'link')
              other.setAttribute('data-quality-aside', '');
          child = up;
          up = up.parentElement;
        }
        let style = document.querySelector<HTMLStyleElement>('style[data-quality-under]');
        if (!style) {
          style = document.createElement('style');
          style.dataset.qualityUnder = '';
          document.head.append(style);
        }
        style.textContent = `[data-quality-under] { background: ${color} !important; } [data-quality-under]::before, [data-quality-under]::after, [data-quality-aside] { opacity: 0 !important; }`;
      },
      { at: path, color: fill },
    );
    shots.push(
      await page.screenshot({
        clip: { x, y, width, height },
        animations: 'disabled',
        caret: 'hide',
      }),
    );
  }
  await page.evaluate(() => {
    document.querySelector('style[data-quality-under]')?.remove();
    for (const el of document.querySelectorAll('[data-quality-under], [data-quality-aside]')) {
      el.removeAttribute('data-quality-under');
      el.removeAttribute('data-quality-aside');
    }
  });
  const [a, b] = shots.map(decodePng);
  return a!.data.some((value, i) => value !== b!.data[i]);
}

interface Transparency {
  readonly filters: readonly { path: string; detail: string }[];
  readonly surfaces: readonly { path: string; inset: number }[];
}

/** The page's filters and see-through surfaces, as they stand, each path once. */
async function transparencyNow(page: Page, seen: Set<string>): Promise<Finding[]> {
  const findings: Finding[] = [];
  const { filters, surfaces } = await inPage<Transparency>(page, { kind: 'transparency' });
  const expected = 'no backdrop-filter, and Surface, Dialog, and Navigation opaque';
  for (const filter of filters.filter((each) => !seen.has(each.path))) {
    seen.add(filter.path);
    findings.push({
      gate: 'transparency',
      rule: 'backdrop-filter',
      path: filter.path,
      expected,
      actual: filter.detail,
    });
  }
  for (const surface of surfaces.filter((each) => !seen.has(each.path))) {
    seen.add(surface.path);
    if (await seeThrough(page, surface.path, surface.inset)) {
      findings.push({
        gate: 'transparency',
        rule: 'opaque',
        path: surface.path,
        expected,
        actual: 'what is under it shows through',
      });
    }
  }
  return findings;
}

/**
 * The reduced-transparency check: on the page as it stands, then with each
 * control that opens something opened from the keyboard, a dialog's
 * ::backdrop included, and closed again.
 */
export async function transparencyFindings(page: Page): Promise<Finding[]> {
  const seen = new Set<string>();
  const findings = await transparencyNow(page, seen);
  for (const trigger of await inPage<{ path: string }[]>(page, { kind: 'triggers' })) {
    await page.evaluate(
      (at) => (document.querySelector(at) as HTMLElement | null)?.focus(),
      trigger.path,
    );
    await page.keyboard.press('Enter');
    await frames(page, 150);
    if ((await inPage<{ path: string }[]>(page, { kind: 'overlays' })).length > 0) {
      findings.push(...(await transparencyNow(page, seen)));
      await page.keyboard.press('Escape');
      await frames(page, 100);
    } else if (
      (await inPage<string | null>(page, { kind: 'expanded', path: trigger.path })) === 'true'
    ) {
      await page.keyboard.press('Enter');
      await frames(page);
    }
  }
  return findings;
}

/**
 * The no-JavaScript row's fail-closed rule: axe needs timers, so the row
 * turns script on for axe alone, which flips (scripting: none). A page
 * styled by a scripting query would be audited as it never renders, so any
 * such query fails the row until axe can run with JavaScript off.
 */
export async function scriptingMediaFindings(page: Page): Promise<Finding[]> {
  // No named inner function: tsx's keepNames would wrap it in a __name the
  // page doesn't have.
  const queries = await page.evaluate(() => {
    const found: string[] = [];
    const pending: CSSRule[] = [];
    for (const sheet of document.styleSheets) {
      try {
        pending.push(...sheet.cssRules);
      } catch {
        // The policy loads no sheet from another origin.
      }
    }
    while (pending.length > 0) {
      const rule = pending.pop()!;
      const condition = (rule as CSSConditionRule).conditionText ?? '';
      if (/\bscripting\b/.test(condition)) found.push(condition);
      const nested = (rule as CSSGroupingRule).cssRules;
      if (nested) pending.push(...nested);
    }
    return found;
  });
  return queries.map((query) => ({
    gate: 'runner',
    rule: 'media-emulation',
    expected: 'no scripting media query, while axe needs JavaScript on to run',
    actual: `a stylesheet styles by @media ${query}, which axe's pass would flip`,
  }));
}
