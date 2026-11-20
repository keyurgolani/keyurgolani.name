import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { viewportSize } from '../../quality/thresholds';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { reflowConditions } from '../quality/lib/a11y/conditions';
import { frames } from '../quality/lib/a11y/interaction';
import { inPage } from '../quality/lib/a11y/probe';
import { sweepSiteText } from '../quality/lib/server';
import { appFor } from './flux-shared';

// Flux's case page under 200% root text, as the reflow check sets it. The case sheet's body is a
// grid of one track, and a child's least width widens that track: on a phone the facts' rows,
// each a term's column of 6rem beside its value, came to about 275px in a body of 176px at 320,
// so every part of the sheet ran that wide and its right edge stood past the window, where the
// page's own clip hid it (the second picture's caption, the story's paragraphs, the facts'
// values, and an unavailable picture's label). On every typography, asked for by the visitor's
// appearance cookie on a site that lets the visitor choose it (the page's boundary must render the
// one asked for), at 320 and at the reflow check's own viewport: no part of the case sheet runs
// past its body, the reflow check's probe finds nothing in the sheet, and each line of an
// unavailable picture's label sits inside the shape its box is clipped to.

const annotation = [
  { type: 'route', description: '/work/project-name' },
  { type: 'profile', description: 'read-only' },
];

/** The visitor's preference cookie (apps/web/src/lib/document-appearance.ts). */
const APPEARANCE_COOKIE = 'portfolio_appearance';

/** The reflow check's root-text condition, from quality/thresholds.json. */
const ROOT_TEXT = reflowConditions().find((condition) => condition.rule === 'root-text')!;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPOGRAPHIES = readdirSync(path.join(ROOT, 'packages/appearance-typography/packs'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

// The visitor may choose the typography here, as the quality runner's sites let them.
const APP = appFor(contractFixture('complete'));
test.use({ appOptions: { ...APP, siteText: sweepSiteText(APP.siteText) } });

/**
 * The case sheet as it stands: each part of its body that runs past the body's right edge (px), and
 * each line of an unavailable picture's label that leaves the shape its box is clipped to (px).
 */
const sheet = () => {
  const body = document.querySelector<HTMLElement>('.fx-case__sheet .fx-sheet__body')!;
  const edge = body.getBoundingClientRect().right;
  const past = [...body.children]
    .map((child) => ({ child, over: child.getBoundingClientRect().right - edge }))
    .filter(({ over }) => over > 0.5)
    .map(({ child, over }) => `${child.className || child.localName} ${over.toFixed(1)}px`);
  const cut: string[] = [];
  for (const label of document.querySelectorAll(
    '.fx-case__pictures .pf-figure--unavailable .pf-media-box__label',
  )) {
    const box = label.closest<HTMLElement>('.pf-media-box')!;
    const b = box.getBoundingClientRect();
    const shape = [...getComputedStyle(box).clipPath.matchAll(/(-?[\d.]+)%\s+(-?[\d.]+)%/g)].map(
      (m) => [(Number(m[1]) / 100) * b.width, (Number(m[2]) / 100) * b.height] as const,
    );
    // Where the shape crosses the height y: its leftmost and rightmost edge there.
    const across = (y: number): readonly [number, number] => {
      if (shape.length === 0) return [0, b.width];
      const xs: number[] = [];
      for (let i = 0; i < shape.length; i += 1) {
        const [x1, y1] = shape[i]!;
        const [x2, y2] = shape[(i + 1) % shape.length]!;
        if ((y1 <= y && y < y2) || (y2 <= y && y < y1))
          xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
      return xs.length > 0 ? [Math.min(...xs), Math.max(...xs)] : [Infinity, -Infinity];
    };
    const range = document.createRange();
    range.selectNodeContents(label);
    for (const r of [...range.getClientRects()].filter((rect) => rect.width > 0)) {
      for (const y of [r.top - b.top, r.bottom - b.top - 0.01]) {
        const [left, right] = across(y);
        const clear = Math.min(r.left - b.left - left, right - (r.right - b.left));
        if (clear < 0) cut.push(`${clear.toFixed(1)}px at ${y.toFixed(1)}px down`);
      }
    }
  }
  return { past, cut };
};

/** What the reflow check's probe finds inside the case sheet, as it reads the page now. */
const reflowInSheet = async (page: Page) => {
  const problems = await inPage<{ rule: string; path: string; detail: string }[]>(page, {
    kind: 'reflow',
  });
  return page.evaluate(
    (all) =>
      all
        .filter((problem) => document.querySelector(problem.path)?.closest('.fx-case__sheet'))
        .map((problem) => `${problem.rule} ${problem.path}: ${problem.detail}`),
    problems,
  );
};

for (const { width, height } of [{ width: 320, height: 568 }, viewportSize(ROOT_TEXT.id)])
  for (const typography of TYPOGRAPHIES)
    test(
      `at ${width}x${height} under ${ROOT_TEXT.text * 100}% root text on ${typography}, the case sheet's parts stay inside its body and the window, and an unavailable picture's label inside its shape`,
      { annotation },
      async ({ page, baseURL }) => {
        await page.setViewportSize({ width, height });
        await page
          .context()
          .addCookies([{ name: APPEARANCE_COOKIE, value: `type=${typography}`, url: baseURL! }]);
        await page.goto('/work/project-name', { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready.then(() => true));
        await expect(page.locator('[data-appearance-boundary]').first()).toHaveAttribute(
          'data-typography',
          typography,
        );
        // The root text as the reflow check sets it (conditions.ts, reflowFindings).
        await page.evaluate(
          (scale) =>
            document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
          ROOT_TEXT.text,
        );
        await frames(page);
        await page.evaluate(() => document.fonts.ready.then(() => true));
        const read = await page.evaluate(sheet);
        expect(read.past, "parts of the case sheet past its body's edge").toEqual([]);
        expect(read.cut, 'lines of a label past the shape its box is clipped to').toEqual([]);
        expect(await reflowInSheet(page), "the reflow check's probe in the case sheet").toEqual([]);
      },
    );
