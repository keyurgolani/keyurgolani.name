import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Aurora Glass's reading surfaces in a browser (row 63): every word on the page, the chrome's
// aside, sits on a solid backing, an element whose computed background is a colour at alpha 1
// with no image between it and the word, in light and in dark, wide and on a phone. A gradient
// or a translucent fill under the words is what left axe 161 contrast nodes it couldn't resolve
// on the complete page, which the quality cell then resampled one by one for 106 to 114 s of its
// 240 s. The chrome (the capsule, the ornament, the visitor's control) keeps the language's own
// surface stack and its blur. On the complete fixture, under read-only, the mode left to the
// system so one server serves both.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

const SELECTED = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass');
const SYSTEM = SELECTED.replace(/\n {2}displayMode: light\n/, '\n  displayMode: system\n');
if (SYSTEM === SELECTED)
  throw new Error("The complete fixture's site no longer sets displayMode: light.");

test.use({
  viewport: { width: 1440, height: 900 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: SYSTEM,
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

/**
 * The words that don't sit on a solid backing, each once, by what's under them: walking up from
 * a text node's parent, the first element with an image under the words, or the page reached
 * with nothing at alpha 1 on the way (the sky). A translucent fill lets the walk go on to what's
 * under it, so a translucent tag on a solid pane holds. Runs in the browser.
 */
const unbacked = () => {
  const root = document.querySelector('.ag')!;
  const chrome = '.ag-capsule, .ag-ornament, [data-visitor-control-slot]';
  const alpha = (color: string) => {
    if (color === 'transparent') return 0;
    const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(color);
    if (slash) return slash[2] ? Number(slash[1]) / 100 : Number(slash[1]);
    const rgba = /^rgba\((?:[^,]+,){3}\s*([\d.]+)\)$/.exec(color);
    return rgba ? Number(rgba[1]) : 1;
  };
  const name = (el: Element) =>
    `${el.localName}${[...el.classList].map((each) => `.${each}`).join('')}`;
  const out = new Set<string>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!node.textContent?.trim() || !parent) continue;
    if (parent.closest(`.ag-hidden, [hidden], .ag-index:not(:popover-open), ${chrome}`)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const box = range.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    let backed: string | null = 'the sky';
    for (let el: Element | null = parent; el && root.contains(el); el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.backgroundImage !== 'none') {
        backed = `${name(el)}: ${style.backgroundImage.slice(0, 48)}`;
        break;
      }
      if (alpha(style.backgroundColor) >= 1) {
        backed = null;
        break;
      }
    }
    if (backed) out.add(backed);
  }
  return [...out];
};

/** The surface role the panes paint, as the page resolves it in this mode. */
const surface = () =>
  getComputedStyle(document.querySelector('.ag-pane, .ag-lite')!).backgroundColor;

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(
      `every word off the chrome sits on a solid backing, ${colorScheme}, at ${width}`,
      { annotation },
      async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.emulateMedia({ colorScheme });
        await page.goto('/', { waitUntil: 'networkidle' });
        expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(
          colorScheme === 'dark',
        );
        expect(await page.evaluate(unbacked)).toEqual([]);
      },
    );
  }
}

test('the two modes paint the backing in their own tint', { annotation }, async ({ page }) => {
  const tint = async (colorScheme: 'light' | 'dark') => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/', { waitUntil: 'networkidle' });
    return page.evaluate(surface);
  };
  expect(await tint('light')).not.toBe(await tint('dark'));
});

test(
  'a translucent backing fails the check: the words read through it to the sky',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    expect(await page.evaluate(unbacked)).toEqual([]);
    await page.addStyleTag({
      content: `[data-variant='aurora-glass'] :is(.ag-pane, .ag-lite, .ag-call) {
        background-color: color-mix(in srgb, var(--color-surface-default) 97%, transparent) !important;
      }`,
    });
    expect(await page.evaluate(unbacked)).toContain('the sky');
  },
);
