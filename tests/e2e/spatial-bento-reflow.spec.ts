import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { viewportSize } from '../../quality/thresholds';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { reflowConditions } from '../quality/lib/a11y/conditions';
import { frames } from '../quality/lib/a11y/interaction';
import { expect, test } from '../harness/fixtures';

// Spatial Bento's live stage under 200% root text: the reflow check's root-text condition, 1024x768
// with html at 200%, makes the stage's plane column 0 px wide, and the stage's canvas must go with
// it. A SpatialCanvas that watched its canvas, whose px size R3F writes once it has measured it,
// kept the width it had at 100%, and the page scrolled sideways (1066 to 1067 px of content in
// 1024 px on CI Linux). On the complete fixture, under read-only, the stage live on SwiftShader,
// software WebGL, as spatial-stage.spec.ts runs it. A stage that never goes live fails the test:
// nothing here is skipped.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
/** The reflow check's root-text condition, from quality/thresholds.json. */
const ROOT_TEXT = reflowConditions().find((condition) => condition.rule === 'root-text')!;

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'spatial-bento'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: viewportSize(ROOT_TEXT.id),
  isMobile: false,
  hasTouch: false,
  launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
});

/** The page's width and content width, and the stage's still and canvas, as they stand. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const right = (selector: string) =>
      document.querySelector(selector)?.getBoundingClientRect().right ?? null;
    return {
      scrollWidth: document.scrollingElement!.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      columns: getComputedStyle(document.querySelector('.sb-stage__body')!).gridTemplateColumns,
      still: right('.sb-still'),
      canvas: right('.sb-still canvas[data-spatial-canvas]'),
    };
  });

test(
  "at 200% root text, the live stage's canvas narrows with its column, and the page doesn't scroll sideways",
  { annotation },
  async ({ page }) => {
    await page.goto('/');
    // Live, as the stage draws: its slot running, the still marked live, and its one canvas.
    // No WebGL, or a stage that never draws, fails here, by name: this pin is about the live
    // stage, so it never passes, or skips, without one.
    const live =
      'the stage went live (SwiftShader WebGL): .sb-still[data-stage="live"] and its one canvas';
    await expect
      .poll(() => page.locator('.sb-stage').getAttribute('data-stage-reason'), {
        message: `${live}: its slot's data-stage-reason is "running"`,
        timeout: 20_000,
      })
      .toBe('running');
    await expect(page.locator('.sb-still[data-stage="live"]'), live).toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(page.locator('.sb-still canvas[data-spatial-canvas]'), live).toHaveCount(1);
    const before = await measure(page);
    expect(before.scrollWidth).toBeLessThanOrEqual(before.clientWidth + 1);
    // The root text as the reflow check sets it (conditions.ts, reflowFindings).
    await page.evaluate(
      (scale) =>
        document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
      ROOT_TEXT.text,
    );
    await frames(page);
    // The condition took: the plane column gave way to nothing, so a board's name keeps its line.
    await expect.poll(async () => (await measure(page)).columns).toMatch(/ 0px$/);
    await expect
      .poll(async () => {
        const now = await measure(page);
        return {
          sideways: now.scrollWidth > now.clientWidth + 1,
          past: (now.canvas ?? 0) > (now.still ?? 0) + 1,
        };
      })
      .toEqual({ sideways: false, past: false });
  },
);
