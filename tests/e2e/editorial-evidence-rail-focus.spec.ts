import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Editorial Evidence's chapter index beside the head column, from 81.25rem: folded under the
// opening, it sits low on the page, its first entry just under the window's foot at 1440 by 900.
// Tab into it brings that entry into the window, as Tab brings any stop there (2.4.7, 2.4.11),
// read at once, as a keyboard user sees it. On the complete fixture through Editorial Evidence on
// platform-neutral and warm-parchment, under Field Serif and Paste-Up, the types the [37] sweep
// found it under; the type is the visitor's to pick, so a cookie sets it.

/** The complete fixture through Editorial Evidence, its type the visitor's to pick. */
function serving() {
  const fixture = contractFixture('complete');
  const dir = path.dirname(fixture.files.portfolio);
  const site = fixtureSiteSelecting(readFileSync(fixture.files.site, 'utf8'), 'editorial-evidence')
    .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
    .replace(/displayMode: .*/, 'displayMode: system')
    .replace('\n  typography: locked\n', '\n  typography: selectable\n');
  if (/\n {2}typography: locked\n/.test(site)) {
    throw new Error("The complete fixture's visitor controls moved: update serving().");
  }
  return {
    portfolio: fixture.files.portfolio,
    siteText: site,
    sourceFiles: Object.fromEntries(
      fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

test.use({ appOptions: serving(), viewport: { width: 1440, height: 900 } });

for (const type of ['field-serif', 'paste-up']) {
  test(`under ${type} at 1440, the first Tab into the chapter index brings its entry into the window`, async ({
    page,
    app,
  }) => {
    await page.context().addCookies([
      {
        name: 'portfolio_appearance',
        value: new URLSearchParams({ type }).toString(),
        url: app.origin,
      },
    ]);
    await page.goto('/', { waitUntil: 'load' });
    const boundary = page.locator('[data-variant]').first();
    await expect(boundary).toHaveAttribute('data-variant', 'editorial-evidence');
    await expect(boundary).toHaveAttribute('data-color-scheme', 'warm-parchment');
    await expect(boundary).toHaveAttribute('data-typography', type);
    await page.evaluate(() => document.fonts.ready);
    // Tab from the top of the page until focus goes into the index.
    let entry: { text: string; top: number; bottom: number; window: number } | null = null;
    for (let press = 0; press < 120 && !entry; press += 1) {
      await page.keyboard.press('Tab');
      entry = await page.evaluate(() => {
        const stop = document.activeElement;
        if (!(stop instanceof HTMLElement) || !stop.closest('.ee-rail')) return null;
        const box = stop.getBoundingClientRect();
        return {
          text: stop.textContent?.trim() ?? '',
          top: box.top,
          bottom: box.bottom,
          window: innerHeight,
        };
      });
    }
    expect(entry, 'Tab reaches the chapter index').not.toBeNull();
    const { text, top, bottom, window } = entry!;
    expect(
      top,
      `"${text}", the index's first stop, starts inside the window`,
    ).toBeGreaterThanOrEqual(0);
    expect(bottom, `"${text}", the index's first stop, ends inside the window`).toBeLessThanOrEqual(
      window,
    );
  });
}
