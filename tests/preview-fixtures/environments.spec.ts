import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Frame, Page, TestInfo } from '@playwright/test';
import { reportsDir } from '../../ci/lib/reports.mjs';
import { DEFAULT_SITE } from '../harness/app-server.mjs';
import { expect, test } from '../harness/fixtures';
import { ownerSecret } from '../harness/owner-secret.mjs';
import { ownerApp } from '../harness/profile-matrix';
import {
  environmentIn,
  frameElement,
  grantFrame,
  openPreview,
  stage,
} from '../harness/studio-preview';

// The preview's fixture renders (#7, Slice 4, item 10, and AC8), on a
// fixture host built with PREVIEW_FIXTURES=1, which registers
// fixture-environment: the fallback composition and fixture-environment in
// the owner's /studio/preview, at each width preset and under reduced
// motion, high contrast, more contrast, a failed enhancement, and no
// JavaScript, each kept as a screenshot. Then fixture-environment, which
// styles against nothing but the environment, against the same visitor
// environment the browser emulates: a preview's display mode, contrast, and
// motion change the document as the visitor's own setting would, and motion
// never goes above what the owner's system allows.

const secret = ownerSecret();
test.use({ appOptions: { ...ownerApp(secret.hash), fixtureHost: true } });

const PAGE = { type: 'route', description: '/studio/preview' };
const SCREENSHOTS = path.join(reportsDir(), 'preview-fixtures', 'screenshots');

/** The harness's site document, selecting `variant`. */
function siteSelecting(variant: string): string {
  const site = readFileSync(DEFAULT_SITE, 'utf8');
  if (!/^\s+variant: missing-variant$/m.test(site)) {
    throw new Error('The harness site no longer selects missing-variant.');
  }
  return site.replace(/^(\s+variant:) missing-variant$/m, `$1 ${variant}`);
}

const COMPOSITIONS = [
  // A selection no package registers renders the fallback composition.
  { id: 'fallback', variant: 'missing-variant' },
  { id: 'fixture-environment', variant: 'fixture-environment' },
] as const;

const select = (page: Page, name: string, value: string) =>
  page
    .getByRole('form', { name: 'Preview controls' })
    .getByRole('combobox', { name })
    .selectOption(value);

/** Keeps a screenshot of the frame as it stands, named for what it shows. */
async function keep(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  mkdirSync(SCREENSHOTS, { recursive: true });
  const file = path.join(SCREENSHOTS, `${name}.png`);
  await frameElement(page).screenshot({ path: file, animations: 'disabled' });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
}

/** What fixture-environment's styles come to in `frame`, which say the environment it renders under. */
const stylesIn = (frame: Frame) =>
  frame.evaluate(() => {
    const boundary = document.querySelector('[data-variant]');
    const header = document.querySelector('.fe-header');
    const motion = document.querySelector('.fe-motion');
    if (!boundary || !header || !motion) throw new Error('fixture-environment did not render.');
    const style = getComputedStyle(boundary);
    return {
      background: style.backgroundColor,
      color: style.color,
      rule: getComputedStyle(header).borderBlockEndWidth,
      animation: getComputedStyle(motion).animationName,
    };
  });

for (const composition of COMPOSITIONS) {
  test(
    `${composition.id} renders in a preview frame at every width, under reduced motion, high contrast, more contrast, a failed enhancement, and no JavaScript, and each render is kept (#7, Slice 4)`,
    { annotation: [PAGE] },
    async ({ page, app }, testInfo) => {
      test.setTimeout(120_000);
      const { frame } = await openPreview(
        page,
        app,
        secret.password,
        `Fixture ${composition.id} Person`,
        siteSelecting(composition.variant),
      );
      await expect(frame.locator('[data-variant]').first()).toHaveAttribute(
        'data-variant',
        composition.id,
      );
      if (composition.id === 'fallback') {
        await expect(frame.locator('[data-variant]').first()).toHaveAttribute(
          'data-requested-variant',
          'missing-variant',
        );
      } else {
        // Each render shows the page as it settles: hydrated, its enhancement mounted.
        await expect(frame.locator('.fe-enhanced')).toHaveCount(1);
      }
      const name = (environment: string) => `${composition.id}-${environment}`;
      for (const [width, environment] of [
        ['desktop', 'desktop'],
        ['tablet', 'tablet'],
        ['mobile', 'mobile'],
      ] as const) {
        await select(page, 'Width (simulated)', width);
        await expect(frameElement(page)).toHaveAttribute(
          'title',
          new RegExp(`${environment}`, 'i'),
        );
        await keep(page, testInfo, name(environment));
      }
      await select(page, 'Width (simulated)', 'desktop');

      await select(page, 'Motion', 'reduce');
      await expect.poll(() => environmentIn(frame)).toMatchObject({ motion: 'reduced' });
      await keep(page, testInfo, name('reduced-motion'));
      await select(page, 'Motion', 'system');

      await select(page, 'Display mode', 'high-contrast');
      await expect.poll(() => environmentIn(frame)).toMatchObject({ displayMode: 'high-contrast' });
      await keep(page, testInfo, name('high-contrast'));
      await select(page, 'Display mode', 'system');

      await select(page, 'Contrast', 'more');
      await expect.poll(() => environmentIn(frame)).toMatchObject({ contrast: 'more' });
      await keep(page, testInfo, name('increased-contrast'));
      await select(page, 'Contrast', 'system');

      // A failed enhancement: every enhancement throws in the frame's next document.
      await page.addInitScript(() => {
        (globalThis as { __portfolioFailEnhancements?: unknown }).__portfolioFailEnhancements =
          true;
      });
      await page.getByRole('button', { name: 'Refresh' }).click();
      await expect
        .poll(async () =>
          (await grantFrame(page))
            .evaluate(
              () =>
                (globalThis as { __portfolioFailEnhancements?: unknown })
                  .__portfolioFailEnhancements === true,
            )
            .catch(() => false),
        )
        .toBe(true);
      await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
      const failed = await grantFrame(page);
      await expect(failed.locator('.fe-enhanced')).toHaveCount(0);
      await keep(page, testInfo, name('failed-enhancement'));

      // No JavaScript: a frame of its own, sandboxed to run nothing.
      await select(page, 'JavaScript', 'off');
      await expect(frameElement(page)).toHaveAttribute('sandbox', '');
      await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
      await keep(page, testInfo, name('no-javascript'));
    },
  );
}

test(
  "fixture-environment's display mode, contrast, and motion in a preview change the document as the same visitor setting would (#7, Slice 4, AC8)",
  { annotation: [PAGE] },
  async ({ page, app }) => {
    const { frame } = await openPreview(
      page,
      app,
      secret.password,
      'Environment Fixture Person',
      siteSelecting('fixture-environment'),
    );
    await expect(frame.locator('[data-variant="fixture-environment"]')).toHaveCount(1);
    // What the visitor's own settings give, with the preview's left at System.
    await page.emulateMedia({
      colorScheme: 'dark',
      contrast: 'more',
      reducedMotion: 'no-preference',
    });
    const visitorDarkMore = await stylesIn(frame);
    await page.emulateMedia({ colorScheme: 'light', contrast: 'no-preference' });
    const visitorLight = await stylesIn(frame);
    expect(visitorDarkMore.background).not.toBe(visitorLight.background);
    expect(visitorDarkMore.rule).toBe('3px');
    expect(visitorLight.rule).toBe('1px');
    expect(visitorLight.animation).toBe('fixture-environment-pulse');

    // The preview's own controls, with the visitor's settings at their defaults.
    await select(page, 'Display mode', 'dark');
    await select(page, 'Contrast', 'more');
    await expect
      .poll(() => environmentIn(frame))
      .toMatchObject({ displayMode: 'dark', contrast: 'more' });
    const previewDarkMore = await stylesIn(frame);
    expect(previewDarkMore.background).toBe(visitorDarkMore.background);
    expect(previewDarkMore.color).toBe(visitorDarkMore.color);
    expect(previewDarkMore.rule).toBe(visitorDarkMore.rule);

    // Light in the preview, though the visitor's system is dark: the light document.
    await page.emulateMedia({ colorScheme: 'dark' });
    await select(page, 'Display mode', 'light');
    await select(page, 'Contrast', 'system');
    await expect.poll(() => environmentIn(frame)).toMatchObject({ displayMode: 'light' });
    const previewLight = await stylesIn(frame);
    expect(previewLight.background).toBe(visitorLight.background);
    expect(previewLight.rule).toBe(visitorLight.rule);

    // Reduced motion in the preview stops what the visitor's reduced motion stops.
    await select(page, 'Motion', 'reduce');
    await expect.poll(() => environmentIn(frame)).toMatchObject({ motion: 'reduced' });
    expect((await stylesIn(frame)).animation).toBe('none');
    await select(page, 'Motion', 'system');
    await expect.poll(() => environmentIn(frame)).toMatchObject({ motion: 'full' });
    expect((await stylesIn(frame)).animation).toBe('fixture-environment-pulse');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect((await stylesIn(frame)).animation).toBe('none');
  },
);

test(
  "a preview never raises fixture-environment's motion above the owner's system: under reduced motion the control is off, reads Reduced by system, and the mark stays still (#7, Slice 4, AC8)",
  { annotation: [PAGE] },
  async ({ page, app }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { frame } = await openPreview(
      page,
      app,
      secret.password,
      'Still Fixture Person',
      siteSelecting('fixture-environment'),
    );
    const motion = page
      .getByRole('form', { name: 'Preview controls' })
      .getByRole('combobox', { name: 'Motion' });
    await expect(motion).toBeDisabled();
    await expect(motion).toHaveValue('reduce');
    await expect(motion).toHaveAccessibleDescription('Reduced by system');
    expect(await environmentIn(frame)).toMatchObject({ motion: 'reduced' });
    expect((await stylesIn(frame)).animation).toBe('none');
    // A display mode or contrast change moves nothing back up.
    await select(page, 'Display mode', 'dark');
    await expect
      .poll(() => environmentIn(frame))
      .toMatchObject({ displayMode: 'dark', motion: 'reduced' });
    expect((await stylesIn(frame)).animation).toBe('none');
  },
);

test(
  "enhancements off keeps fixture-environment's enhancement from mounting, and on, it mounts once the frame hydrates (#7, Slice 4, AC8)",
  { annotation: [PAGE] },
  async ({ page, app }) => {
    const { frame } = await openPreview(
      page,
      app,
      secret.password,
      'Enhanced Fixture Person',
      siteSelecting('fixture-environment'),
    );
    await expect(frame.locator('.fe-enhanced')).toHaveCount(1);
    await select(page, 'Enhancements', 'off');
    await expect
      .poll(async () => environmentIn(await grantFrame(page)))
      .toMatchObject({
        enhancement: 'off',
      });
    await expect(stage(page)).toHaveAttribute('data-phase', 'ready');
    const off = await grantFrame(page);
    await expect(off.locator('[data-variant="fixture-environment"]')).toHaveCount(1);
    await expect(off.locator('.fe-enhanced')).toHaveCount(0);
  },
);
