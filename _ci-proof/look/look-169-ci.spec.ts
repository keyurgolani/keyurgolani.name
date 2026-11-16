// Look shots for one CI read (laid in by the proof kit, never in a head's tree): Horizontal Cinema's bar Next links in
// Bauhaus Geometric and Humanist UI, focused and then blurred, around the link: 'Next: Chapter II, Origins'
// (no pixel changed in the cells) and 'Next: Chapter III, Journey' (too few changed pixels at 3:1), in Low
// Stimulus Warm's dark at 1440 by default and under forced colors and at 1024 under more contrast, and in Warm Parchment
// on the system's light under more contrast at 1024. Each link is focused from the keyboard's modality
// (Shift, then focus), so it matches :focus-visible as a Tab would.
// Out: $PROOF_LOOK_OUT/<setting>-<chapter>-<focused|blurred>.png, the link and 24 px round it.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { sweepSiteText } from '../quality/lib/server';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: sweepSiteText(
      fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    ),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  colorScheme: 'light',
});

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

async function looks(page: Page, origin: string, name: string, scheme: string, mode: string) {
  const out = process.env.PROOF_LOOK_OUT ?? '';
  expect(out, 'PROOF_LOOK_OUT').not.toBe('');
  mkdirSync(out, { recursive: true });
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams({
        language: 'bauhaus-geometric',
        scheme,
        type: 'humanist-ui',
        mode,
      }).toString(),
      url: origin,
    },
  ]);
  await page.goto('/', { waitUntil: 'networkidle' });
  const boundary = page.locator('[data-appearance-boundary]').first();
  await expect(boundary).toHaveAttribute('data-design-language', 'bauhaus-geometric');
  await expect(boundary).toHaveAttribute('data-color-scheme', scheme);
  await expect(boundary).toHaveAttribute('data-display-mode', mode);
  await page.evaluate(() => document.fonts.ready);
  for (const [chapter, text] of [
    ['ii', 'Next: Chapter II, Origins'],
    ['iii', 'Next: Chapter III, Journey'],
  ] as const) {
    const link = page.locator('.hc-bar__next', { hasText: text }).first();
    await expect(link).toHaveCount(1);
    await page.keyboard.press('Shift');
    await link.focus();
    await page.waitForTimeout(400);
    await frames(page);
    const box = (await link.boundingBox())!;
    const vp = page.viewportSize()!;
    const x = Math.max(0, box.x - 24);
    const y = Math.max(0, box.y - 24);
    const clip = {
      x,
      y,
      width: Math.min(vp.width - x, box.width + 48),
      height: Math.min(vp.height - y, box.height + 48),
    };
    const shoot = async (state: string) => {
      const shot = path.join(out, `${name}-${chapter}-${state}.png`);
      await page.screenshot({
        path: shot,
        clip,
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
      });
    };
    await shoot('focused');
    await link.evaluate((el) => (el as HTMLElement).blur());
    await frames(page);
    await shoot('blurred');
  }
}

test.describe('1440 default', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('look 1440 default low-stimulus-warm dark', async ({ page, app }) => {
    await looks(page, app.origin, '1440-default-lsw-dark', 'low-stimulus-warm', 'dark');
  });
});

test.describe('1440 forced colors', () => {
  test.use({ viewport: { width: 1440, height: 900 }, contextOptions: { forcedColors: 'active' } });
  test('look 1440 forced low-stimulus-warm dark', async ({ page, app }) => {
    await looks(page, app.origin, '1440-forced-lsw-dark', 'low-stimulus-warm', 'dark');
  });
});

test.describe('1024 more contrast', () => {
  test.use({ viewport: { width: 1024, height: 768 }, contextOptions: { contrast: 'more' } });
  test('look 1024 more low-stimulus-warm dark', async ({ page, app }) => {
    await looks(page, app.origin, '1024-more-lsw-dark', 'low-stimulus-warm', 'dark');
  });
  test('look 1024 more warm-parchment system', async ({ page, app }) => {
    await looks(page, app.origin, '1024-more-wp-system', 'warm-parchment', 'system');
  });
});
