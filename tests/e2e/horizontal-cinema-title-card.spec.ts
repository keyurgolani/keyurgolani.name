import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { frames, load, renderedLayout } from './horizontal-cinema-model';

// Horizontal Cinema's title scene with no hero (HC family 1). rc-preflight on 04dc5e378 failed 18
// cells of the sparse fixture in high contrast on the prologue chapter: the h1 at 1.00:1 and clipped
// by #chapter-prologue, the top bar's counter and the bottom bar's next ("none of its glyphs paints
// inside its box"), and the prologue's next link (no pixel changes; #scene-2 is there). The sparse
// fixture has no hero, so the title scene sets the identity's name itself, and the name must still
// sit inside its scene, every part of it shown, and the scene's way on must ring when focused. On the
// sparse contract fixture as the matrix serves it in those cells (platform-neutral, warm-parchment,
// humanist-ui, high-contrast), the scheme and the mode picked by the visitor's appearance cookie and
// read back from the boundary, in the strip view, at 1440x900 and 1024x768. Nothing is pressed
// before the geometry is read: the page is as a mouse leaves it.

const FIXTURE = contractFixture('sparse');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

const SCENE = '#chapter-prologue';
const NAME = '#chapter-prologue h1';
const COUNTER = '#chapter-prologue > .hc-bar--top > .hc-bar__counter';
/** The prologue's next link, the bottom bar's, as the walk's probe names it in the preflight keys. */
const NEXT = '#chapter-prologue > div:nth-child(4) > a:nth-child(2)';
/** Sub-pixel rounding between a box's edge and its scene's, in CSS px: not a looser bar. */
const TOLERANCE = 0.5;

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});

/** Home on the cells' tuple in high contrast, by the visitor's cookie, and what rendered. */
async function loadHighContrast(page: Page, origin: string): Promise<void> {
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({ scheme: 'warm-parchment', mode: 'high-contrast' }).toString(),
      url: origin,
    },
  ]);
  await load(page);
  const boundary = page.locator('[data-variant]').first();
  await expect(boundary).toHaveAttribute('data-design-language', 'platform-neutral');
  await expect(boundary).toHaveAttribute('data-color-scheme', 'warm-parchment');
  await expect(boundary).toHaveAttribute('data-typography', 'humanist-ui');
  await expect(boundary).toHaveAttribute('data-display-mode', 'high-contrast');
  // The strip view, not the List.
  await expect(page.locator('.hc[data-view]')).toHaveAttribute('data-view', 'strip');
  await frames(page);
}

/** The scene's, the name's, the counter's and the next link's boxes, and the name's own overflow. */
const boxes = (page: Page) =>
  page.evaluate(
    ([scene, name, counter, next]) => {
      const rect = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          left: +r.left.toFixed(2),
          right: +r.right.toFixed(2),
          top: +r.top.toFixed(2),
          bottom: +r.bottom.toFixed(2),
        };
      };
      const h1 = document.querySelector<HTMLElement>(name);
      return {
        scene: rect(scene),
        name: rect(name),
        counter: rect(counter),
        next: rect(next),
        nameScroll: h1 ? { scrollWidth: h1.scrollWidth, clientWidth: h1.clientWidth } : null,
      };
    },
    [SCENE, NAME, COUNTER, NEXT] as const,
  );

type Rect = { left: number; right: number; top: number; bottom: number };
const inside = (part: Rect, scene: Rect) =>
  part.left >= scene.left - TOLERANCE &&
  part.right <= scene.right + TOLERANCE &&
  part.top >= scene.top - TOLERANCE &&
  part.bottom <= scene.bottom + TOLERANCE;

for (const viewport of VIEWPORTS) {
  const at = `${viewport.width}x${viewport.height}`;
  test(
    `at ${at} in high contrast, the title scene with no hero keeps its name, its counter and its way on inside it, and its way on rings when focused (HC family 1)`,
    { annotation, tag },
    async ({ page, app }) => {
      await page.setViewportSize(viewport);
      await loadHighContrast(page, app.origin);
      await renderedLayout(page);
      await expect(page.locator(SCENE)).toHaveCount(1);
      await expect(page.locator(NAME)).toHaveCount(1);
      await expect(page.locator(COUNTER)).toHaveCount(1);
      expect(
        await page.locator(NEXT).evaluate((el) => el.matches('.hc-bar--bottom > .hc-bar__next')),
        `${NEXT} is the bottom bar's next link`,
      ).toBe(true);
      const read = await boxes(page);
      const scene = read.scene!;
      const rects = JSON.stringify(read);
      expect(
        inside(read.name!, scene),
        `the name ${JSON.stringify(read.name)} inside the scene ${JSON.stringify(scene)}: ${rects}`,
      ).toBe(true);
      expect(
        inside(read.counter!, scene),
        `the top bar's counter ${JSON.stringify(read.counter)} inside the scene ${JSON.stringify(scene)}: ${rects}`,
      ).toBe(true);
      expect(
        inside(read.next!, scene),
        `the bottom bar's next ${JSON.stringify(read.next)} inside the scene ${JSON.stringify(scene)}: ${rects}`,
      ).toBe(true);
      expect(
        read.nameScroll!.scrollWidth,
        `the name's scrollWidth within its clientWidth + 1: ${rects}`,
      ).toBeLessThanOrEqual(read.nameScroll!.clientWidth + 1);
      // The scene's way on, focused as from the keyboard, and the walk's own focus check.
      const next = page.locator(NEXT);
      await page.keyboard.press('Shift');
      await next.focus();
      expect(await next.evaluate((el) => el.matches(':focus-visible')), NEXT).toBe(true);
      const active = await inPage<Active>(page, { kind: 'active' });
      expect(active.path).toBe(NEXT);
      expect(await focusFindings(page, active), `${NEXT}: ${rects}`).toEqual([]);
    },
  );
}
