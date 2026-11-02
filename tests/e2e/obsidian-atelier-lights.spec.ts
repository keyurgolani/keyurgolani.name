import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Obsidian Atelier's gallery lights (redesign, stream C), on the large
// contract fixture, whose wall hangs several linked works. Focusing a work's
// caption lights the wall the way pointing at it does: the same objects go
// out of the light, the same one stays in it.

/** The app options that serve a contract fixture through Atelier. */
function serving(name: string) {
  const fixture = contractFixture(name);
  const dir = path.dirname(fixture.files.portfolio);
  return {
    portfolio: fixture.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(fixture.files.site, 'utf8'), 'obsidian-atelier'),
    sourceFiles: Object.fromEntries(
      fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const tag = '@interaction';

test.use({ appOptions: serving('large'), viewport: { width: 1440, height: 900 } });

async function load(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' });
  await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'obsidian-atelier');
}

test(
  'a work focused from the keyboard lights the wall as pointing at it does',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const works = page.locator('.oa-bays .oa-work:has(.oa-caption__link)');
    expect(await works.count()).toBeGreaterThan(1);
    const lit = works.first();
    const state = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.oa-bays .oa-work')].map((work) => {
          const object = work.querySelector<HTMLElement>('.oa-work__object, .oa-print');
          const image = work.querySelector('img');
          return {
            shadow: object ? getComputedStyle(object).boxShadow : '',
            // The lift: the lit object raised off the wall.
            lift: object ? getComputedStyle(object).translate : '',
            ground: object ? getComputedStyle(object).backgroundColor : '',
            image: image
              ? `${getComputedStyle(image).filter} ${getComputedStyle(image).opacity}`
              : '',
          };
        }),
      );
    const unlit = await state();
    // Keyboard focus: into the caption link from the one before it, so the browser shows focus.
    await lit.locator('.oa-caption__link').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(lit.locator('.oa-caption__link')).toBeFocused();
    await page.waitForTimeout(1200);
    const focused = await state();
    expect(focused).not.toEqual(unlit);
    // Pointing at it instead, with focus elsewhere, gives the same wall.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await lit.hover();
    await page.waitForTimeout(1200);
    expect(await state()).toEqual(focused);
  },
);
