import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../../tests/harness/fixtures';

// Evidence only, never merged: terra-field on the complete fixture, its home and its case page, light
// and dark, at 1440x900, with the browser's scrollbars shown (headless hides them unless asked),
// as CI's Linux Chromium draws them: a classic bar, its track painted. At the top, scrolled a
// third of the way, then with the visitor's Appearance control open. One viewport shot each, the
// art behind the root's bar with the bar hidden, and what the browser computes for the root's
// and the boundary's scrollbar and accent, and the boundary's roles, beside it. LOOK_OUT names
// the dir.

const COMPOSITION = 'terra-field';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
// The site follows the system's mode, so the emulated dark is the page's (the fixture sets light).
const SELECTED = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), COMPOSITION);
const SITE = SELECTED.replace(/\n {2}displayMode: light\n/, '\n  displayMode: system\n');
if (SITE === SELECTED)
  throw new Error("The complete fixture's site no longer sets displayMode: light.");
test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: SITE,
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
});

const OUT = process.env.LOOK_OUT ?? 'look';

async function capture(page: Page, stem: string) {
  const read = await page.evaluate(() => {
    const boundary = document.querySelector('[data-appearance-boundary="document"]');
    // The scheme's roles as the boundary resolves them, for the thumb's contrast.
    const probe = document.createElement('i');
    boundary?.append(probe);
    const role = (name: string) => {
      probe.style.color = `var(--color-${name})`;
      return getComputedStyle(probe).color;
    };
    const roles = boundary
      ? {
          borderStrong: role('border-strong'),
          textPrimary: role('text-primary'),
          canvas: role('canvas'),
        }
      : null;
    probe.remove();
    return {
      root: getComputedStyle(document.documentElement).scrollbarColor,
      boundary: boundary ? getComputedStyle(boundary).scrollbarColor : null,
      accent: boundary ? getComputedStyle(boundary).accentColor : null,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      roles,
      scrollY,
      width: innerWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  writeFileSync(`${stem}.json`, JSON.stringify(read, null, 1));
  await page.screenshot({ path: `${stem}.png` });
  // What lies behind the root's bar, the bar hidden for the shot: an overlay thumb sits on it.
  const { width, height } = page.viewportSize()!;
  const hide = await page.addStyleTag({
    content:
      'html { scrollbar-width: none !important; } html::-webkit-scrollbar { display: none; }',
  });
  await page.waitForTimeout(100);
  await page.screenshot({
    path: `${stem}-art.png`,
    clip: { x: width - 16, y: 0, width: 16, height },
  });
  await hide.evaluate((el) => (el as Element).remove());
}

for (const route of ['/', '/work/project-name']) {
  for (const [width, height] of [[1440, 900]] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`look: ${COMPOSITION} ${route} at ${width}x${height}, ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
        await page.setViewportSize({ width, height });
        const response = await page.goto(route, { waitUntil: 'networkidle' });
        expect(response?.status()).toBe(200);
        mkdirSync(OUT, { recursive: true });
        const name = `${COMPOSITION}${route === '/' ? '-home' : '-case'}-${width}-${scheme}`;
        await page.waitForTimeout(400);
        await capture(page, path.join(OUT, `${name}-top`));
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 3));
        await page.waitForTimeout(400);
        await capture(page, path.join(OUT, `${name}-scrolled`));
        const control = page.locator('[data-visitor-control-slot] summary').first();
        if (await control.count()) {
          await control.scrollIntoViewIfNeeded();
          await control.click();
          await page.waitForTimeout(300);
          await capture(page, path.join(OUT, `${name}-appearance`));
        }
      });
    }
  }
}
