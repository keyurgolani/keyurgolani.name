import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../../tests/harness/fixtures';

// The browser's own UI in the scheme, as the browser computes it, on Flux's complete home page
// at 1440x900: the document root's scrollbar is the boundary's border-strong on its canvas, a
// scroller inside the boundary has the border-strong thumb on a clear track, and checkboxes and
// the like take the accent; light, dark, under more contrast, and under forced colors, where
// scrollbars are the system's. The site follows the system's mode, so the browser's dark is the
// page's. An engine that reads no scrollbar-color (WebKit) is held to what it does read: the scheme
// and the accent, and a boundary scroller's bar drawn through WebKit's parts, read from a shot of
// it; the root keeps its own bar in the scheme's color-scheme. Chromium and Firefox are pinned to
// reading scrollbar-color, and a WebKit that comes to read it gets the full check. Its own file,
// since a worker-scoped appOptions can't be set in a describe.

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

/**
 * The computed scrollbar and accent colors, the boundary's roles they should be, as rgb, and
 * whether this engine reads scrollbar-color at all.
 */
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
    type Style = CSSStyleDeclaration & { scrollbarColor?: string };
    const scroller = (getComputedStyle(probe) as Style).scrollbarColor ?? null;
    probe.remove();
    return {
      roles,
      supports: CSS.supports('scrollbar-color', 'red blue'),
      forced: matchMedia('(forced-colors: active)').matches,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      root: (getComputedStyle(document.documentElement) as Style).scrollbarColor ?? null,
      scroller,
      accent: getComputedStyle(boundary).accentColor,
    };
  });

/**
 * A boundary scroller's bar as WebKit's parts draw it: its width, and its thumb's colour as
 * painted, the commonest colour down the bar's middle that isn't the scroller's own canvas, from
 * a shot of a scroller pinned at the page's corner, twice as tall inside as out.
 */
async function partRead(page: Page) {
  const box = await page.evaluate(() => {
    const boundary = document.querySelector<HTMLElement>('[data-appearance-boundary="document"]')!;
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;inset-block-start:0;inset-inline-start:0;z-index:2147483647;display:block;overflow:auto;inline-size:10rem;block-size:6rem;background:var(--color-canvas)';
    const inside = document.createElement('div');
    inside.style.cssText = 'block-size:12rem';
    probe.append(inside);
    boundary.append(probe);
    const at = probe.getBoundingClientRect();
    const canvas = getComputedStyle(probe).backgroundColor;
    return {
      x: at.left,
      y: at.top,
      width: at.width,
      height: at.height,
      bar: probe.offsetWidth - probe.clientWidth,
      canvas,
    };
  });
  const shot = PNG.sync.read(
    await page.screenshot({
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
      scale: 'css',
    }),
  );
  const canvas = box.canvas.match(/\d+/g)!.slice(0, 3).join(', ');
  const column = Math.max(0, Math.round(shot.width - box.bar / 2) - 1);
  const counts = new Map<string, number>();
  for (let y = 0; y < shot.height; y++) {
    const at = (y * shot.width + column) * 4;
    const colour = [shot.data[at], shot.data[at + 1], shot.data[at + 2]].join(', ');
    if (colour !== canvas) counts.set(colour, (counts.get(colour) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { bar: box.bar, thumb: top ? `rgb(${top[0]})` : null, rows: top?.[1] ?? 0 };
}

/** Two rgb colours within 2 of each other in every channel. */
const near = (a: string | null, b: string) => {
  if (!a) return false;
  const x = a.match(/\d+/g)!.map(Number);
  const y = b.match(/\d+/g)!.map(Number);
  return [0, 1, 2].every((index) => Math.abs(x[index]! - y[index]!) <= 2);
};

/** Chromium and Firefox read scrollbar-color, so neither takes the parts' check instead. */
function expectSupport(read: { supports: boolean }) {
  const engine = test.info().project.name;
  if (engine === 'chromium' || engine === 'firefox')
    expect(read.supports, `${engine} reads scrollbar-color`).toBe(true);
}

/** What this engine computes, beside the checks. */
function record(label: string, read: unknown) {
  const out = process.env.EV_OUT ?? 'native-evidence';
  mkdirSync(out, { recursive: true });
  writeFileSync(
    path.join(out, `scheme-${test.info().project.name}-${label.replace(/[^a-z]+/g, '-')}.json`),
    JSON.stringify(read, null, 1),
  );
}

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
      const part = read.supports ? null : await partRead(page);
      record(label, { ...read, part });
      expectSupport(read);
      expect(read.scheme, "the page's scheme").toBe(media.colorScheme);
      expect(read.accent).toBe(read.roles.accent);
      if (read.supports) {
        expect(read.root, 'the root').toBe(`${read.roles.thumb} ${read.roles.canvas}`);
        expect(read.scroller, 'a scroller').toBe(`${read.roles.bar} rgba(0, 0, 0, 0)`);
      } else {
        // The root keeps its own bar, in the scheme's color-scheme: no root part, so an overlay
        // bar never becomes a gutter. A scroller of the boundary's draws the scheme's thumb.
        expect(part!.bar, "a scroller's bar, drawn by WebKit's parts").toBe(12);
        expect(
          near(part!.thumb, read.roles.bar),
          `a scroller's thumb as painted, ${part!.thumb}, is border-strong, ${read.roles.bar}`,
        ).toBe(true);
      }
    },
  );
}

test("under forced colors the scrollbars are the system's", { annotation }, async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/', { waitUntil: 'networkidle' });
  const read = await computed(page);
  const part = read.supports ? null : await partRead(page);
  record('forced colors', { ...read, part });
  expectSupport(read);
  if (read.supports) {
    expect(read.root).toBe('auto');
    expect(read.scroller).toBe('auto');
  } else {
    // No scrollbar-color to fall back from: a scroller of the boundary's still has its bar.
    expect(part!.bar, "a scroller's bar").toBeGreaterThan(0);
  }
});
