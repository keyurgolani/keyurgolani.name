import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { home, onMissingMediaHome, SUMMARY, type Setting } from './obsidian-atelier-appearance';

// Obsidian Atelier's home at 390 on phone emulation with the root text at 200% laid out 469 px wide
// with nothing open, so it scrolled sideways (WCAG 1.4.10), and the chrome's name lay over the
// Appearance summary. Its page grid is twelve columns and two margins, thirteen gutters between
// them, each gutter the platform's small space: at 200% each was 36 px, 468 px of gutters in a
// 390 px window, every track at 0, and every band of the page ran to the grid's 468. And the top
// row's corner, Appearance and Index side by side, is wider than a phone's content at 200%. With
// the root text at 200% at 390, and at the default size at 320, the page lays out inside the window
// and the chrome's name clears the Appearance summary.
// On the missing-media contract fixture's home in Warm Parchment, light.

onMissingMediaHome();

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

async function readTop(page: Page, origin: string, width: number, setting: Setting) {
  await home(page, origin, setting);
  const read = await page.evaluate(
    ({ summary, width }) => {
      const r = (n: number) => Math.round(n * 10) / 10;
      const box = (el: Element | null) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return [r(b.left), r(b.top), r(b.right), r(b.bottom)];
      };
      const mark = box(document.querySelector('.oa-chrome__mark'));
      const control = box(document.querySelector(summary));
      const overlap =
        mark !== null &&
        control !== null &&
        mark[0]! < control[2]! &&
        control[0]! < mark[2]! &&
        mark[1]! < control[3]! &&
        control[1]! < mark[3]!;
      const entrance = document.querySelector('.oa-entrance');
      const cs = entrance ? getComputedStyle(entrance) : null;
      const past = [...document.body.querySelectorAll('*')]
        .map((el) => ({ el, b: el.getBoundingClientRect() }))
        .filter(({ b }) => b.width > 0 && b.right > width + 0.5)
        .sort((a, b) => b.b.right - a.b.right)
        .slice(0, 5)
        .map(
          ({ el, b }) =>
            `${el.localName}.${typeof el.className === 'string' ? el.className.split(/\s+/)[0] : ''} to ${r(b.right)}`,
        );
      return {
        pageWide: document.scrollingElement!.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        mark,
        control,
        overlap,
        grid: cs ? { columns: cs.gridTemplateColumns.slice(0, 120), gap: cs.columnGap } : null,
        past,
      };
    },
    { summary: SUMMARY, width },
  );
  expect(
    { insideTheWindow: read.pageWide <= width, nameClearsTheSummary: !read.overlap },
    JSON.stringify(read),
  ).toEqual({ insideTheWindow: true, nameClearsTheSummary: true });
}

test.describe('390', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test(
    'at 390 with the root text at 200%, the home lays out inside the window and the chrome name clears the Appearance summary',
    { annotation },
    async ({ page, app }) => {
      await readTop(page, app.origin, 390, { mode: 'light', rootText: '200%' });
    },
  );
});

test.describe('320', () => {
  test.use({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
  test(
    'at 320 with the default text size, the home lays out inside the window and the chrome name clears the Appearance summary',
    { annotation },
    async ({ page, app }) => {
      await readTop(page, app.origin, 320, { mode: 'light' });
    },
  );
});
