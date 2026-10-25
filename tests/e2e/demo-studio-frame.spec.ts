import { fileURLToPath } from 'node:url';
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
    // A short window, so the frame's stage starts more than two windows' height below it.
    await page.setViewportSize({ width: 1280, height: 150 });
    const loads = sampleLoads(page);
    await page.goto('/studio?task=content');
    // The task's own controls, without following a link that would scroll.
    await expect(page.getByRole('button', { name: 'Export setup' })).toBeVisible();
    const frame = page.locator('iframe');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('title', /^Demo sample, /);
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(page.locator('.preview-surface__stage')).toHaveAttribute('aria-busy', 'true');
    const box = await page.locator('.preview-surface__stage').boundingBox();
    expect(box && box.y >= 450, 'the stage starts three windows down').toBe(true);
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

test(
  'at a phone’s width the frame waits behind Show preview: no frame and no request, the import and export free, then one press loads it and moves focus',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const loads = sampleLoads(page);
    await page.goto('/studio?task=content');
    const ask = page.getByRole('button', { name: 'Show preview' });
    await expect(ask).toBeVisible();
    await expect(page.getByText('Tap to load the preview')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    // The import and export work before the preview is asked for.
    await expect(page.getByLabel('Import your portfolio and site documents')).toBeEnabled();
    await page.getByRole('button', { name: 'Export setup' }).click();
    await expect(page.getByRole('list', { name: 'Exported files' })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(loads).toHaveLength(0);

    // By keyboard: Tab reaches the button, with a ring, and Enter asks.
    for (
      let step = 0;
      step < 30 && !(await ask.evaluate((el) => el === document.activeElement));
      step += 1
    ) {
      await page.keyboard.press('Tab');
    }
    await expect(ask).toBeFocused();
    const ring = await ask.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(ring).not.toBe('none');
    // The sample's document held back, so the status shows while it loads.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) => url.pathname === '/sample',
      async (route) => {
        await held;
        await route.continue();
      },
    );
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toHaveText('Loading the preview…');
    release();
    const frame = page.locator('iframe');
    await expect(frame).toHaveAttribute('src', /^\/sample\?/);
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    // The mobile viewport, at a phone's width.
    await expect(frame).toHaveAttribute('title', /390 by 844$/);
    await expect(page.getByRole('group', { name: /^Demo sample, / })).toBeFocused();
    await expect(page.getByRole('status')).toHaveText('The preview has loaded.');
    expect(loads).toHaveLength(1);

    // Another task keeps it: no second ask.
    await openTask(page, 'Appearance');
    await expect(page.getByRole('button', { name: 'Show preview' })).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveAttribute('src', /^\/sample\?/);
  },
);

test(
  'at a phone’s width a press of Preview or a pick of what the frame shows loads it, with no Show preview',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/studio?task=appearance');
    await expect(page.getByRole('button', { name: 'Reset demo' })).toBeVisible();
    // The preview pane waits behind the split's switch, its frame unloaded.
    await expect(page.locator('iframe')).toHaveCount(0);
    await page
      .getByRole('group', { name: 'Show' })
      .getByRole('button', { name: 'Preview', exact: true })
      .click();
    await expect(page.locator('iframe')).toHaveAttribute('src', /^\/sample\?/);
    await expect(page.getByRole('button', { name: 'Show preview' })).toHaveCount(0);

    // A fresh visitor's first pick of a composition does the same, from the controls.
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/studio?task=appearance');
    await expect(page.getByRole('button', { name: 'Reset demo' })).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    const select = page.getByLabel('Composition', { exact: true });
    const own = await select.inputValue();
    const values = await select
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    await select.selectOption(values.find((value) => value !== own)!);
    await expect(page.locator('iframe')).toHaveAttribute('src', /^\/sample\?/);
    await expect(page.getByRole('button', { name: 'Show preview' })).toHaveCount(0);
  },
);

test(
  'at a phone’s width, after an import, Reset demo shows the sample’s frame, not the poster',
  { annotation: [STUDIO, DEMO, { type: 'route', description: '/preview/local' }] },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/studio?task=content');
    await page
      .locator('#studio-demo-import')
      .setInputFiles([
        fileURLToPath(new URL('../../portfolio.example.yml', import.meta.url)),
        fileURLToPath(new URL('../../site.example.yml', import.meta.url)),
      ]);
    await expect(page.locator('[data-source="local"]')).toHaveCount(1);
    await openTask(page, 'Appearance');
    await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
    await expect(page.locator('[data-source="local"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show preview' })).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveAttribute('src', /^\/sample\?/);
  },
);
