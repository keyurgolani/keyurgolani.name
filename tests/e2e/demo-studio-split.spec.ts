import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import { openTask } from '../harness/studio-tasks';
import { axeFor } from '../quality/lib/axe';

// Demo Studio's Appearance view as a split (owner direction, 2026-10-25;
// #9): the controls beside the frame, which follows each pick with no
// navigation and no Preview task, the /sample frame loading the new
// selection and /preview/local taking it over its channel, in the same
// document. The device widths and motion sit in the preview's toolbar;
// below 64rem a Controls and Preview switch shows one pane, and a press of
// Preview is all it takes to load and show the frame.

const DEMO = { type: 'profile', description: 'demo' };
const STUDIO = { type: 'route', description: '/studio' };

test.use({ appOptions: DEMO_APP });

const controlsPane = (page: Page) => page.getByRole('region', { name: 'Appearance controls' });
const previewPane = (page: Page) => page.getByRole('region', { name: 'Preview', exact: true });
const composition = (page: Page) => page.getByLabel('Composition', { exact: true });

async function open(page: Page): Promise<void> {
  const response = await page.goto('/studio');
  expect(response?.status()).toBe(200);
  await openTask(page, 'Appearance');
  await expect(page.getByRole('button', { name: 'Reset demo' })).toBeVisible();
}

/** A composition other than the one the panel shows. */
async function another(page: Page): Promise<string> {
  const current = await composition(page).inputValue();
  const values = await composition(page)
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const other = values.find((value) => value !== current);
  expect(other, 'the build offers a second composition').toBeDefined();
  return other!;
}

test(
  'the frame sits beside the controls and follows each pick, with no navigation and no Preview task',
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await open(page);
    await expect(
      page.getByRole('navigation', { name: 'Studio tasks' }).getByRole('link'),
    ).toHaveText(['Appearance', 'Content']);
    const [panel, pane] = await Promise.all([
      controlsPane(page).boundingBox(),
      previewPane(page).boundingBox(),
    ]);
    expect(
      panel && pane && panel.x + panel.width <= pane.x,
      'the preview beside the controls',
    ).toBe(true);
    const iframe = previewPane(page).locator('iframe');
    await expect(iframe).toHaveAttribute('src', /^\/sample\?/);
    let navigations = 0;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    for (let round = 0; round < 2; round += 1) {
      const next = await another(page);
      await composition(page).selectOption(next);
      await expect(iframe).toHaveAttribute('src', new RegExp(`[?&]variant=${next}(?:&|$)`));
      const frame = await (await iframe.elementHandle())?.contentFrame();
      await expect(frame!.locator('[data-variant]').first()).toHaveAttribute('data-variant', next);
    }
    // The URL follows in place, with replaceState: the page itself never navigates.
    expect(navigations).toBe(0);
    expect(new URL(page.url()).pathname).toBe('/studio');
  },
);

test(
  'an imported pair in /preview/local follows each pick over its channel, in the same frame document',
  { annotation: [STUDIO, DEMO, { type: 'route', description: '/preview/local' }] },
  async ({ page }) => {
    await page.goto('/studio?task=content');
    await page
      .locator('#studio-demo-import')
      .setInputFiles([
        fileURLToPath(new URL('../../portfolio.example.yml', import.meta.url)),
        fileURLToPath(new URL('../../site.example.yml', import.meta.url)),
      ]);
    await expect(page.locator('[data-source="local"]')).toHaveCount(1);
    await openTask(page, 'Appearance');
    const stage = previewPane(page).locator('[data-source="local"]');
    await expect(stage).toHaveAttribute('data-phase', 'ready');
    const iframe = stage.locator('iframe');
    const element = await iframe.elementHandle();
    const src = await iframe.getAttribute('src');
    const documents: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'document') documents.push(new URL(request.url()).pathname);
    });
    const next = await another(page);
    await composition(page).selectOption(next);
    const frame = await element!.contentFrame();
    await expect(frame!.locator('[data-variant]').first()).toHaveAttribute('data-variant', next);
    // The same element, nonce, and document: no reload.
    expect(await element!.evaluate((node) => node.isConnected)).toBe(true);
    expect(await iframe.getAttribute('src')).toBe(src);
    expect(documents).toEqual([]);
  },
);

test(
  "the toolbar's device widths set the frame's layout width, scaled to fit and never cropped",
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await open(page);
    const iframe = previewPane(page).locator('iframe');
    await expect(iframe).toHaveAttribute('src', /^\/sample\?/);
    const widths = previewPane(page).getByRole('group', { name: 'Device width' });
    for (const [name, width] of [
      ['Tablet 1024 by 768', 1024],
      ['Mobile 390 by 844', 390],
      ['Desktop 1440 by 900', 1440],
    ] as const) {
      const button = widths.getByRole('button', { name, exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(iframe).toHaveAttribute('title', new RegExp(`${name}$`));
      await expect(iframe).toHaveCSS('width', `${width}px`);
      const stage = previewPane(page).locator('.preview-surface__stage');
      const [frame, room] = await Promise.all([iframe.boundingBox(), stage.boundingBox()]);
      expect(frame && room, name).toBeTruthy();
      expect(frame!.width, name).toBeLessThanOrEqual(Math.min(width, room!.width) + 1);
      expect(frame!.x + frame!.width, name).toBeLessThanOrEqual(room!.x + room!.width + 1);
      expect(frame!.y + frame!.height, name).toBeLessThanOrEqual(room!.y + room!.height + 1);
    }
    // Motion stays with the preview.
    await expect(previewPane(page).getByLabel('Motion', { exact: true })).toBeVisible();
  },
);

for (const width of [390, 800]) {
  test(
    `at ${width}px a press of Preview shows the frame, loaded, and moves focus to it; Controls goes back`,
    { annotation: [STUDIO, DEMO] },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await open(page);
      const show = page.getByRole('group', { name: 'Show' });
      await expect(controlsPane(page)).toBeVisible();
      await expect(previewPane(page)).toBeHidden();
      await show.getByRole('button', { name: 'Preview', exact: true }).click();
      await expect(previewPane(page)).toBeVisible();
      await expect(previewPane(page)).toBeFocused();
      await expect(controlsPane(page)).toBeHidden();
      // One press: no Show preview after it.
      await expect(page.getByRole('button', { name: 'Show preview' })).toHaveCount(0);
      const iframe = previewPane(page).locator('iframe');
      await expect(iframe).toHaveAttribute('src', /^\/sample\?/);
      await expect(previewPane(page).locator('.preview-surface__stage')).toHaveAttribute(
        'data-phase',
        'ready',
      );
      await expect(iframe).toBeVisible();
      expect((await axeFor(page).exclude('iframe').analyze()).violations).toEqual([]);
      await show.getByRole('button', { name: 'Controls', exact: true }).click();
      await expect(controlsPane(page)).toBeFocused();
      await expect(previewPane(page)).toBeHidden();
    },
  );
}

test(
  "the split's Studio chrome passes axe, every control keeps its label, and the frame its name",
  { annotation: [STUDIO, DEMO] },
  async ({ page }) => {
    await open(page);
    await expect(previewPane(page).locator('iframe')).toHaveAttribute('src', /^\/sample\?/);
    expect((await axeFor(page).exclude('iframe').analyze()).violations).toEqual([]);
    await expect(previewPane(page).locator('iframe')).toHaveAttribute('title', /^Demo sample, /);
    for (const label of [
      'Composition',
      'Design language',
      'Color scheme',
      'Typography',
      'Display mode',
    ]) {
      await expect(controlsPane(page).getByLabel(label, { exact: true })).toBeVisible();
    }
    // Tab order: the panel's last control, then the toolbar's first.
    await page.getByRole('button', { name: 'Reset demo' }).focus();
    await page.keyboard.press('Tab');
    await expect(
      previewPane(page).getByRole('button', { name: 'Desktop 1440 by 900', exact: true }),
    ).toBeFocused();
  },
);
