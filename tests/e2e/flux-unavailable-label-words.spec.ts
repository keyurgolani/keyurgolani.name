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

// Flux's case page on a phone: a picture that can't be shown labels its box "Image unavailable",
// and each word of the label sits whole on one line, never broken inside it. At 320 the case
// pictures go two to a row, 115px each, and the box's padding left the label 79px, narrower than
// "unavailable" at body size, so the page's own break-anywhere split it ("unavailabl / e"). Every
// typography is read at 320, asked for by the visitor's appearance cookie on a site that lets the
// visitor choose it (the page's boundary must render the one asked for), and the fixture's own at
// 390. Each word's text is read by its own range, which takes one line box when the word is whole.
// Each line of the label also sits inside the shape the box is clipped to, and the reflow check's
// probe finds nothing in the case pictures. Under 200% root text, at the reflow check's own
// viewport, a word may wrap inside, as the page's break-anywhere lets it, but no line leaves the
// shape and the probe finds nothing there either.

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
 * Each unavailable case picture's label: each word, with the lines it takes, and each line, with
 * how far it sits inside the box's clip shape at its top and foot (px; under 0 the shape cuts it).
 */
const labels = () =>
  [
    ...document.querySelectorAll('.fx-case__pictures .pf-figure--unavailable .pf-media-box__label'),
  ].map((label) => {
    const box = label.closest<HTMLElement>('.pf-media-box')!;
    const b = box.getBoundingClientRect();
    const shape = [...getComputedStyle(box).clipPath.matchAll(/(-?[\d.]+)%\s+(-?[\d.]+)%/g)].map(
      (m) => [(Number(m[1]) / 100) * b.width, (Number(m[2]) / 100) * b.height] as const,
    );
    // Where the shape crosses the height y: its leftmost and rightmost edge there.
    const across = (y: number): readonly [number, number] | null => {
      const xs: number[] = [];
      for (let i = 0; i < shape.length; i += 1) {
        const [x1, y1] = shape[i]!;
        const [x2, y2] = shape[(i + 1) % shape.length]!;
        if ((y1 <= y && y < y2) || (y2 <= y && y < y1))
          xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
      }
      return xs.length > 0 ? [Math.min(...xs), Math.max(...xs)] : null;
    };
    const words: { word: string; lines: number }[] = [];
    const lines = new Map<number, { left: number; right: number; top: number; bottom: number }>();
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (const match of (node.textContent ?? '').matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        words.push({ word: match[0], lines: new Set(rects.map((r) => Math.round(r.top))).size });
        for (const r of rects) {
          const key = Math.round(r.top);
          const line = lines.get(key);
          lines.set(key, {
            left: Math.min(line?.left ?? Infinity, r.left - b.left),
            right: Math.max(line?.right ?? -Infinity, r.right - b.left),
            top: Math.min(line?.top ?? Infinity, r.top - b.top),
            bottom: Math.max(line?.bottom ?? -Infinity, r.bottom - b.top),
          });
        }
      }
    }
    const inside = [...lines.values()].map((line) =>
      // With no clip shape the box's own edges stand in for it.
      Math.min(
        ...[line.top, line.bottom - 0.01].map((y) => {
          const edges = shape.length > 0 ? across(y) : ([0, b.width] as const);
          return edges ? Math.min(line.left - edges[0], edges[1] - line.right) : -Infinity;
        }),
      ),
    );
    return { box: Math.round(b.width), words, inside };
  });

/** What the reflow check's probe finds inside the case pictures, as it reads the page now. */
const reflowInPictures = async (page: Page) => {
  const problems = await inPage<{ rule: string; path: string; detail: string }[]>(page, {
    kind: 'reflow',
  });
  return page.evaluate(
    (all) =>
      all
        .filter((problem) =>
          document.querySelector(problem.path)?.closest('.fx-case__pictures, .pf-media-box'),
        )
        .map((problem) => `${problem.rule} ${problem.path}: ${problem.detail}`),
    problems,
  );
};

const open = async (page: Page, baseURL: string, typography: string | null, rootText = 1) => {
  if (typography)
    await page
      .context()
      .addCookies([{ name: APPEARANCE_COOKIE, value: `type=${typography}`, url: baseURL }]);
  await page.goto('/work/project-name', { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  if (typography)
    await expect(page.locator('[data-appearance-boundary]').first()).toHaveAttribute(
      'data-typography',
      typography,
    );
  if (rootText !== 1) {
    // The root text as the reflow check sets it (conditions.ts, reflowFindings).
    await page.evaluate(
      (scale) =>
        document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
      rootText,
    );
    await frames(page);
    await page.evaluate(() => document.fonts.ready.then(() => true));
  }
  const read = await page.evaluate(labels);
  expect(read.length, 'an unavailable picture with its label').toBeGreaterThan(0);
  const cut = read.flatMap((label) =>
    label.inside.filter((clear) => clear < 0).map((clear) => `${clear.toFixed(1)}px`),
  );
  expect(cut, 'lines of a label past the shape its box is clipped to').toEqual([]);
  expect(await reflowInPictures(page), "the reflow check's probe in the case pictures").toEqual([]);
  return read;
};

const cases: { width: number; height: number; typography: string | null }[] = [
  ...TYPOGRAPHIES.map((typography) => ({ width: 320, height: 568, typography })),
  { width: 390, height: 844, typography: null },
];

for (const { width, height, typography } of cases)
  test(
    `at ${width}x${height}${typography ? ` on ${typography}` : ''}, each word of an unavailable case picture's label sits whole on one line, inside its shape`,
    { annotation },
    async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height });
      const read = await open(page, baseURL!, typography);
      const broken = read.flatMap((label) =>
        label.words
          .filter((word) => word.lines !== 1)
          .map((word) => `"${word.word}" ${word.lines} lines in ${label.box}px`),
      );
      expect(broken, `words on more than one line: ${broken.join(', ')}`).toEqual([]);
    },
  );

const ROOT_TEXT_VIEW = viewportSize(ROOT_TEXT.id);

for (const typography of TYPOGRAPHIES)
  test(
    `at ${ROOT_TEXT_VIEW.width}x${ROOT_TEXT_VIEW.height} under ${ROOT_TEXT.text * 100}% root text on ${typography}, an unavailable case picture's label stays inside its shape, and the reflow check finds nothing there`,
    { annotation },
    async ({ page, baseURL }) => {
      await page.setViewportSize({ ...ROOT_TEXT_VIEW });
      await open(page, baseURL!, typography, ROOT_TEXT.text);
    },
  );
