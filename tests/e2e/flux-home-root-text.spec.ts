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

// Flux's home page under 200% root text, as the reflow check sets it. A sheet's body is a grid of
// one track, and a child's least width widens that track: a listen's or a read's length, a short
// tube beside its minutes on one line, came to about 263px, so at 320 every part of the work and
// writing sheets ran that wide in a body of 176px and past the window, where the page's own clip
// hid it, and at 390 past its body. On every typography, asked for by the visitor's appearance
// cookie on a site that lets the visitor choose it (the page's boundary must render the one asked
// for), at 320, at 390 and at the reflow check's own viewport: no part of a sheet runs past its
// body, and the reflow check's probe finds nothing of a sheet outside the window.

const annotation = [
  { type: 'route', description: '/' },
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

/** Each part of a sheet's body that runs past the body's right edge (px). */
const sheets = () =>
  [...document.querySelectorAll<HTMLElement>('.fx-sheet .fx-sheet__body')].flatMap((body) => {
    const sheet = body.closest<HTMLElement>('.fx-sheet')!;
    const edge = body.getBoundingClientRect().right;
    return [...body.children]
      .map((child) => ({ child, over: child.getBoundingClientRect().right - edge }))
      .filter(({ over }) => over > 0.5)
      .map(
        ({ child, over }) =>
          `${sheet.id || sheet.className}: ${child.className || child.localName} ${over.toFixed(1)}px`,
      );
  });

/** What the reflow check's probe finds of a sheet outside the window, as it reads the page now. */
const outsideInSheets = async (page: Page) => {
  const problems = await inPage<{ rule: string; path: string; detail: string }[]>(page, {
    kind: 'reflow',
  });
  return page.evaluate(
    (all) =>
      all
        .filter(
          (problem) =>
            problem.rule === 'outside' &&
            document.querySelector(problem.path)?.closest('.fx-sheet'),
        )
        .map((problem) => `${problem.path}: ${problem.detail}`),
    problems,
  );
};

for (const { width, height } of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  viewportSize(ROOT_TEXT.id),
])
  for (const typography of TYPOGRAPHIES)
    test(
      `at ${width}x${height} under ${ROOT_TEXT.text * 100}% root text on ${typography}, every home sheet's parts stay inside its body and the window`,
      { annotation },
      async ({ page, baseURL }) => {
        await page.setViewportSize({ width, height });
        await page
          .context()
          .addCookies([{ name: APPEARANCE_COOKIE, value: `type=${typography}`, url: baseURL! }]);
        await page.goto('/', { waitUntil: 'networkidle' });
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
        expect(await page.evaluate(sheets), "parts of a home sheet past its body's edge").toEqual(
          [],
        );
        expect(await outsideInSheets(page), "the reflow check's probe outside the window").toEqual(
          [],
        );
      },
    );
