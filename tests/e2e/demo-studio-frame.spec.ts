import type { Page, Request } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import { openTask } from '../harness/studio-tasks';

// When Demo Studio's frame loads its document (#9, #11's TBT budget): the
// /sample document runs a Next runtime of its own on Studio's main thread,
// so the stage sets its src only once it comes on screen, and exactly once;
// after that, each new source, such as a pick or Reset demo, loads straight
// away. frame-gate.test.tsx has the same without a browser.

const DEMO = { type: 'profile', description: 'demo' };
const STUDIO = { type: 'route', description: '/studio' };

test.use({ appOptions: DEMO_APP });

/** The page's requests for /sample documents. */
function sampleLoads(page: Page): Request[] {
  const seen: Request[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'document' && new URL(request.url()).pathname === '/sample') {
      seen.push(request);
    }
  });
  return seen;
}

test(
  'below the fold the frame has no src and loads nothing, until its stage scrolls on screen, then loads once',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    // A short window, so the frame's stage starts more than a window's height below it.
    await page.setViewportSize({ width: 1280, height: 200 });
    const loads = sampleLoads(page);
    await page.goto('/studio?task=content');
    await openTask(page, 'Content');
    const frame = page.locator('iframe');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('title', /^Demo sample, /);
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(page.locator('.preview-surface__stage')).toHaveAttribute('aria-busy', 'true');
    const box = await page.locator('.preview-surface__stage').boundingBox();
    expect(box && box.y >= 400, 'the stage starts two windows down').toBe(true);
    // Time for an idle callback or a late effect: still nothing.
    await page.waitForTimeout(1500);
    expect(await frame.getAttribute('src')).toBeNull();
    expect(loads).toHaveLength(0);

    await page.locator('.preview-surface__stage').scrollIntoViewIfNeeded();
    await expect(frame).toHaveAttribute('src', /^\/sample\?/);
    await expect(page.locator('.preview-surface__stage')).toHaveAttribute('data-phase', 'ready');
    await page.mouse.wheel(0, -2000);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(500);
    expect(loads, 'one document, however often the stage shows').toHaveLength(1);
  },
);

test(
  'once loaded, a pick and Reset demo each swap the frame’s src at once, even off screen',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.goto('/studio');
    await openTask(page, 'Appearance');
    const frame = page.locator('iframe');
    await page.locator('.preview-surface__stage').scrollIntoViewIfNeeded();
    await expect(frame).toHaveAttribute('src', /^\/sample\?/);
    const first = await frame.getAttribute('src');

    // Back at the top, the stage off screen: the next source still loads.
    await page.evaluate(() => window.scrollTo(0, 0));
    const select = page.getByLabel('Composition', { exact: true });
    const own = await select.inputValue();
    const values = await select
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    const other = values.find((value) => value !== own);
    expect(other, 'the build offers a second composition').toBeDefined();
    await select.selectOption(other!);
    await expect(frame).toHaveAttribute('src', new RegExp(`variant=${other}`));

    await page.getByRole('button', { name: 'Reset demo' }).click();
    await expect(frame).toHaveAttribute('src', first!);
  },
);
