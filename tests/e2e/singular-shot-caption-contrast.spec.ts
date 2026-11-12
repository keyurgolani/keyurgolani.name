import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Row 106 (#211; rows-evidence 0390804f1, 2026-11-11): Singular's case page, the project shot's
// caption, figure[data-media-asset="project-shot"] > figcaption. The figure sits in a gallery inside
// section.sg-panel, whose ground is inverse (data-ground="inverse": dark in light mode, light in dark
// mode), but the caption kept the page's own --color-text-secondary: rgb(84, 76, 67) on
// rgb(43, 36, 28) in light, rgb(202, 192, 172) on rgb(244, 232, 210) in dark. axe read 1.48:1 and
// 1.81:1, and the high-contrast text check 1.00:1. The caption is small text, so its bar is 4.5:1,
// against the panel's ground, in every mode, the contrast-more row too, at 1440, 1024 and 390.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const CASE = '/work/project-name';
const CAPTION = 'figure[data-media-asset="project-shot"] > figcaption';
const READ_ONLY = { type: 'profile', description: 'read-only' };
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'singular'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  colorScheme: 'light',
});

/** The caption's color and its first opaque ground up its ancestors, and their WCAG ratio. */
async function captionContrast(page: Page) {
  return page
    .locator(CAPTION)
    .first()
    .evaluate((caption) => {
      // Computed colours aren't always rgb(): a color-mix() ink computes to oklab(), whose numbers
      // aren't channels. A canvas paints any CSS colour and hands back its sRGB bytes.
      const paint = document
        .createElement('canvas')
        .getContext('2d', { willReadFrequently: true })!;
      const rgba = (value: string) => {
        paint.clearRect(0, 0, 1, 1);
        paint.fillStyle = value;
        paint.fillRect(0, 0, 1, 1);
        const [r = 0, g = 0, b = 0, alpha = 0] = paint.getImageData(0, 0, 1, 1).data;
        return { r, g, b, a: alpha / 255 };
      };
      let ground = rgba('rgb(255, 255, 255)');
      let groundBy = 'none';
      for (let at: Element | null = caption; at; at = at.parentElement) {
        const bg = rgba(getComputedStyle(at).backgroundColor);
        if (bg.a > 0) {
          ground = bg;
          groundBy = `${at.tagName.toLowerCase()}.${[...at.classList].join('.')}`;
          break;
        }
      }
      const ink = rgba(getComputedStyle(caption).color);
      // The ink over its ground, where it's not opaque.
      const over = (c: number, g: number) => c * ink.a + g * (1 - ink.a);
      const fg = { r: over(ink.r, ground.r), g: over(ink.g, ground.g), b: over(ink.b, ground.b) };
      const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
        const [lr, lg, lb] = [r, g, b].map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
      };
      const [hi, lo] = [lum(fg), lum(ground)].sort((a, b) => b - a);
      return {
        ratio: (hi! + 0.05) / (lo! + 0.05),
        ink: getComputedStyle(caption).color,
        ground: `rgb(${ground.r}, ${ground.g}, ${ground.b})`,
        groundBy,
      };
    });
}

for (const mode of ['light', 'dark', 'system', 'high-contrast'] as const) {
  for (const contrast of ['no-preference', 'more'] as const) {
    test(
      `in ${mode}${contrast === 'more' ? ' with more contrast' : ''}, the project shot's caption reads at 4.5:1 on its panel's ground, at 1440, 1024 and 390 (row 106)`,
      { annotation: [{ type: 'route', description: '/work/[slug]' }, READ_ONLY] },
      async ({ page, app }) => {
        await page.emulateMedia({ contrast });
        await page.context().addCookies([
          {
            name: 'portfolio_appearance',
            value: new URLSearchParams({ scheme: 'warm-parchment', mode }).toString(),
            url: app.origin,
          },
        ]);
        for (const size of WIDTHS) {
          await page.setViewportSize(size);
          await page.goto(CASE, { waitUntil: 'networkidle' });
          const boundary = page.locator('[data-variant]').first();
          await expect(boundary).toHaveAttribute('data-variant', 'singular');
          await expect(boundary).toHaveAttribute('data-display-mode', mode);
          await expect(page.locator(CAPTION).first()).toBeVisible();
          const read = await captionContrast(page);
          expect(read.groundBy, `at ${size.width}: the caption's ground is its panel's`).toMatch(
            /^section\..*sg-panel/,
          );
          expect(
            read.ratio,
            `at ${size.width}: ${read.ink} on ${read.ground}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      },
    );
  }
}
