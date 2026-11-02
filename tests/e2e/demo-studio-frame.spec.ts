import { fileURLToPath } from 'node:url';
import type { Page, Request } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import { checkedIn, DEMO_FRAME, openTask, optionsIn, pick, picker } from '../harness/studio-tasks';

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
  'until its stage is on screen the frame has no src and loads nothing, then it loads once, however often the stage shows',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    // Content is the split now (DEM-1), whose stage is on the first screen at every size, so no
    // layout holds it below the fold any more. The gate is still the stage's, through the
    // page's own IntersectionObserver: this one reports the stage off screen until the test
    // says it came on, and lets every other target through to the browser's.
    await page.addInitScript(() => {
      // Plain functions and a closure: an init script runs as its own source text, so it
      // carries none of the class-field helpers a compiled class would call.
      const Real = window.IntersectionObserver;
      const held: { report: (on: boolean) => void; rootMargin: string }[] = [];
      function Held(
        this: IntersectionObserver,
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        const real = new Real(callback, options);
        const observer = Object.create(real) as IntersectionObserver;
        observer.observe = (target: Element) => {
          if (!target.matches('.preview-surface__stage')) return real.observe(target);
          const report = (on: boolean) =>
            callback(
              [{ isIntersecting: on, target } as unknown as IntersectionObserverEntry],
              observer,
            );
          held.push({ report, rootMargin: options?.rootMargin ?? '' });
          queueMicrotask(() => report(false));
        };
        observer.unobserve = (target: Element) => real.unobserve(target);
        observer.disconnect = () => real.disconnect();
        observer.takeRecords = () => real.takeRecords();
        return observer;
      }
      Object.assign(window, {
        IntersectionObserver: Held,
        kgnStage: {
          margins: () => held.map((each) => each.rootMargin),
          show: () => held.forEach((each) => each.report(true)),
        },
      });
    });
    type Stage = { margins(): string[]; show(): void };
    const loads = sampleLoads(page);
    await page.goto('/studio?task=content');
    // The task's own controls, without following a link.
    await expect(page.getByRole('button', { name: 'Export setup' })).toBeVisible();
    const frame = page.locator(DEMO_FRAME);
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('title', /^Demo sample, /);
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(page.locator('.preview-surface__stage')).toHaveAttribute('aria-busy', 'true');
    // The stage watched near the window, within two windows' height below it.
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { kgnStage: Stage }).kgnStage.margins()),
      )
      .toEqual(['0px 0px 200% 0px']);
    // Time for an idle callback or a late effect: still nothing.
    await page.waitForTimeout(1500);
    expect(await frame.getAttribute('src')).toBeNull();
    expect(loads).toHaveLength(0);

    await page.evaluate(() => (window as unknown as { kgnStage: Stage }).kgnStage.show());
    await expect(frame).toHaveAttribute('src', /^\/sample\?/);
    await expect(page.locator('.preview-surface__stage')).toHaveAttribute('data-phase', 'ready');
    await page.evaluate(() => (window as unknown as { kgnStage: Stage }).kgnStage.show());
    await page.waitForTimeout(500);
    expect(loads, 'one document, however often the stage shows').toHaveLength(1);
  },
);

test(
  "Content's stage is on the first screen, beside the rail, and loads on its own with nothing pressed",
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const loads = sampleLoads(page);
    await page.goto('/studio?task=content');
    const stage = page.locator('.preview-surface__stage');
    const box = await stage.boundingBox();
    expect(box && box.y < 720 && box.x > 0, 'the stage starts on the first screen').toBe(true);
    await expect(page.locator(DEMO_FRAME)).toHaveAttribute('src', /^\/sample\?/);
    await expect(stage).toHaveAttribute('data-phase', 'ready');
    expect(loads).toHaveLength(1);
  },
);

test(
  'once loaded, a pick and Reset demo each swap the frame’s src at once, even off screen',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.goto('/studio');
    await openTask(page, 'Appearance');
    const frame = page.locator(DEMO_FRAME);
    await page.locator('.preview-surface__stage').scrollIntoViewIfNeeded();
    await expect(frame).toHaveAttribute('src', /^\/sample\?/);
    const first = await frame.getAttribute('src');

    // Back at the top, the stage off screen: the next source still loads.
    await page.evaluate(() => window.scrollTo(0, 0));
    const group = picker(page, 'Composition');
    const own = await checkedIn(group);
    const other = (await optionsIn(group)).find((value) => value !== own);
    expect(other, 'the build offers a second composition').toBeDefined();
    await pick(group, other!);
    await expect(frame).toHaveAttribute('src', new RegExp(`variant=${other}`));

    await page.getByRole('button', { name: 'Reset demo' }).click();
    // The same source, in a new document with a channel nonce of its own (DEM-2).
    const source = first!.replace(/#nonce=[A-Za-z0-9_-]{22}$/, '');
    expect(source).not.toBe(first);
    await expect(frame).toHaveAttribute(
      'src',
      new RegExp(`^${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}#nonce=[A-Za-z0-9_-]{22}$`),
    );
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
    const frame = page.locator(DEMO_FRAME);
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
    await expect(page.locator(DEMO_FRAME)).toHaveAttribute('src', /^\/sample\?/);
  },
);

test(
  'at a phone’s width the preview stays on the top of the screen behind Show preview, and a pick in the sheet below loads it',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/studio?task=appearance');
    await expect(
      page.getByRole('button', { name: 'Reset demo', includeHidden: true }).first(),
    ).toBeAttached();
    // The preview keeps the top of the screen, its frame waiting to be asked for; no Controls and Preview tabs.
    const ask = page.getByRole('button', { name: 'Show preview' });
    await expect(ask).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Preview', exact: true })).toHaveCount(0);
    const box = await ask.boundingBox();
    expect(box && box.y < 844 * 0.6, 'the poster on the top of the screen').toBe(true);
    // A fresh visitor's first pick of a composition, in the sheet's Composition tab, loads it.
    const group = picker(page, 'Composition');
    const own = await checkedIn(group);
    const other = (await optionsIn(group)).find((value) => value !== own);
    await pick(group, other!);
    await expect(page.locator(DEMO_FRAME)).toHaveAttribute('src', /^\/sample\?/);
    await expect(ask).toHaveCount(0);
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
    // At a phone's width Reset demo sits in the top bar's menu.
    await page.getByRole('button', { name: /^More:/ }).click();
    await page.getByRole('button', { name: 'Reset demo', exact: true }).click();
    await expect(page.locator('[data-source="local"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Show preview' })).toHaveCount(0);
    await expect(page.locator(DEMO_FRAME)).toHaveAttribute('src', /^\/sample\?/);
  },
);
