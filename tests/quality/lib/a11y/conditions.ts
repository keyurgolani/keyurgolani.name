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

import type { CDPSession, Page, Request } from '@playwright/test';
import { loadThresholds, viewportSize } from '../../../../quality/thresholds';
import { frames, type Finding } from './interaction';
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

async function load(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: 'load' });
  await frames(page);
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
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const condition of conditions().filter((each) => !only || only.includes(each.id))) {
      await condition.setup(page, cdp);
      try {
        if (condition.reload) await load(page, path);
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
  await load(page, path);
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
    await load(page, path);
    const structure = await inPage<Structure>(page, { kind: 'structure' });
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
    findings.push(
      ...missingItems(
        'semantics',
        'enhancement',
        'failed enhancement',
        baseline,
        await inPage<string[]>(page, { kind: 'inventory' }),
      ),
    );
  } finally {
    await page.unrouteAll({ behavior: 'wait' });
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    await cdp.detach();
  }
  await load(page, path);
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
      await load(page, path);
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
  await load(page, path);
  return findings;
}

/** The reduced-transparency check on the page as it stands. */
export async function transparencyFindings(page: Page): Promise<Finding[]> {
  return (
    await inPage<{ rule: string; path: string; detail: string }[]>(page, { kind: 'transparency' })
  ).map((problem) => ({
    gate: 'transparency',
    rule: problem.rule,
    path: problem.path,
    expected: 'no backdrop-filter, and Surface, Dialog, and Navigation opaque',
    actual: problem.detail,
  }));
}
