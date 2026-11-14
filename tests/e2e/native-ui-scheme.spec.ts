import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// The browser's own UI in the scheme, as the browser computes it, on Flux's complete home page
// at 1440x900: the document root's scrollbar is the boundary's border-strong on its canvas, a
// scroller inside the boundary has the border-strong thumb on a clear track, and checkboxes and
// the like take the accent; light, dark, under more contrast, and under forced colors, where
// scrollbars are the system's. The site follows the system's mode, so the browser's dark is the
// page's. Its own file, since a worker-scoped appOptions can't be set in a describe.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const SELECTED = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'flux');
const SITE = SELECTED.replace(/\n {2}displayMode: light\n/, '\n  displayMode: system\n');
if (SITE === SELECTED)
  throw new Error("The complete fixture's site no longer sets displayMode: light.");
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: SITE,
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

/** The computed scrollbar and accent colors, and the boundary's roles they should be, as rgb. */
const computed = (page: Page) =>
  page.evaluate(() => {
    const boundary = document.querySelector<HTMLElement>('[data-appearance-boundary="document"]')!;
    const probe = document.createElement('i');
    boundary.append(probe);
    const role = (name: string) => {
      probe.style.color = `var(--color-${name})`;
      return getComputedStyle(probe).color;
    };
    // The root's thumb: border-strong moved 55% toward text-primary, as color-mix(in srgb)
    // rounds it.
    const channels = (rgb: string) => rgb.match(/\d+/g)!.slice(0, 3).map(Number);
    const strong = channels(role('border-strong'));
    const text = channels(role('text-primary'));
    const step = 55;
    const thumb = `rgb(${strong.map((value, index) => Math.floor((value * (100 - step) + text[index]! * step + 50) / 100)).join(', ')})`;
    const roles = {
      thumb,
      bar: role('border-strong'),
      canvas: role('canvas'),
      accent: role('accent'),
    };
    // A scroller of the boundary's own, as any composition's overflow box is.
    probe.style.cssText = 'display:block;overflow:auto;inline-size:4rem;block-size:2rem';
    const scroller = getComputedStyle(probe).scrollbarColor;
    probe.remove();
    return {
      roles,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      root: getComputedStyle(document.documentElement).scrollbarColor,
      scroller,
      accent: getComputedStyle(boundary).accentColor,
    };
  });

for (const [label, media] of [
  ['light', { colorScheme: 'light' }],
  ['dark', { colorScheme: 'dark' }],
  ['light, more contrast', { colorScheme: 'light', contrast: 'more' }],
  ['dark, more contrast', { colorScheme: 'dark', contrast: 'more' }],
] as const) {
  test(
    `${label}: the root's and a scroller's scrollbars and the accent are the scheme's`,
    { annotation },
    async ({ page }) => {
      await page.emulateMedia(media);
      await page.goto('/', { waitUntil: 'networkidle' });
      const read = await computed(page);
      expect(read.scheme, "the page's scheme").toBe(media.colorScheme);
      expect(read.root, 'the root').toBe(`${read.roles.thumb} ${read.roles.canvas}`);
      expect(read.scroller, 'a scroller').toBe(`${read.roles.bar} rgba(0, 0, 0, 0)`);
      expect(read.accent).toBe(read.roles.accent);
    },
  );
}

test("under forced colors the scrollbars are the system's", { annotation }, async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/', { waitUntil: 'networkidle' });
  const read = await computed(page);
  expect(read.root).toBe('auto');
  expect(read.scroller).toBe('auto');
});
