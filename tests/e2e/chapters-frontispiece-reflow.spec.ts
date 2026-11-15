import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { viewportSize } from '../../quality/thresholds';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { reflowConditions } from '../quality/lib/a11y/conditions';
import { frames } from '../quality/lib/a11y/interaction';
import { inPage } from '../quality/lib/a11y/probe';
import { expect, test } from '../harness/fixtures';

// Chapters on bauhaus-geometric, botanical-sage, accessible-reading and the high-contrast display
// mode, under the reflow check's root-text condition (1024x768, html at 200%): the frontispiece
// caption's date ran from 829 px to 1061 px in a 1024 px viewport, and the page scrolled sideways.
// The reflow check's own probe, as it reads the page, finds nothing at 100% or at 200% root text, and
// the page doesn't scroll sideways. It prints the caption's columns and the date's and its line's
// boxes at each.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
/** The reflow check's root-text condition, from quality/thresholds.json. */
const ROOT_TEXT = reflowConditions().find((condition) => condition.rule === 'root-text')!;
const DATE = '.fp__cap .fp__text time';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'chapters')
      .replace(/designLanguage: .*/, 'designLanguage: bauhaus-geometric')
      .replace(/colorScheme: .*/, 'colorScheme: botanical-sage')
      .replace(/typography: .*/, 'typography: accessible-reading')
      .replace(/displayMode: .*/, 'displayMode: high-contrast'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: viewportSize(ROOT_TEXT.id),
  isMobile: false,
  hasTouch: false,
});

/** The page's widths, the caption's columns, and the date's and its line's boxes, as they stand. */
const measure = (page: Page) =>
  page.evaluate((selector) => {
    const date = document.querySelector(selector);
    const box = (element: Element | null | undefined) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return [r.left, r.right, r.width].map(Math.round);
    };
    return {
      scrollWidth: document.scrollingElement!.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      rootFont: getComputedStyle(document.documentElement).fontSize,
      columns: getComputedStyle(document.querySelector('.fp__cap')!).gridTemplateColumns,
      date: box(date),
      dateText: date?.textContent ?? null,
      dateWhiteSpace: date ? getComputedStyle(date).whiteSpace : null,
      text: box(date?.closest('.fp__text')),
      page: box(date?.closest('.ch-page')),
    };
  }, DATE);

test(
  "at 200% root text on bauhaus-geometric, the frontispiece caption's date stays in the viewport, and the page doesn't scroll sideways",
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const boundary = page.locator('[data-variant]').first();
    await expect(boundary).toHaveAttribute('data-variant', 'chapters');
    await expect(boundary).toHaveAttribute('data-design-language', 'bauhaus-geometric');
    await expect(boundary).toHaveAttribute('data-display-mode', 'high-contrast');
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(DATE)).toHaveCount(1);
    const reads: Record<string, unknown> = {};
    for (const text of [1, ROOT_TEXT.text]) {
      // The root text as the reflow check sets it (conditions.ts, reflowFindings).
      await page.evaluate(
        (scale) =>
          document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
        text,
      );
      await frames(page);
      await page.evaluate(() => document.fonts.ready);
      const now = await measure(page);
      const problems = await inPage<{ rule: string; path: string; detail: string }[]>(page, {
        kind: 'reflow',
      });
      console.log(
        `chapters frontispiece reflow ${text * 100}%: ${JSON.stringify(now)}; problems ${JSON.stringify(problems.slice(0, 6))}`,
      );
      reads[`${text * 100}%`] = {
        problems: problems.map((problem) => `${problem.path}: ${problem.detail}`),
        sideways: now.scrollWidth > now.clientWidth + 1,
      };
    }
    expect(reads, "the reflow check's probe at 100% and 200% root text").toEqual({
      '100%': { problems: [], sideways: false },
      [`${ROOT_TEXT.text * 100}%`]: { problems: [], sideways: false },
    });
  },
);
