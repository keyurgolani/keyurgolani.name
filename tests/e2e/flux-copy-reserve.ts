import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { optionalFaces, pinFaces } from '../harness/optional-faces';
import { expect, test } from '../harness/fixtures';

// What the flux-copy-reserve-*.spec.ts files share. On a phone under more contrast the dock at the
// foot stands taller than at its token, and taller on some languages than on others; its ring's
// reach differs by language too. A reader who walks the page by Tab from the top reaches the
// close's Copy email with it already in view, so the browser doesn't scroll to it, and its scroll
// margin never acts: it rests wherever the window's reserve at the foot (the root's scroll padding,
// the manifest's scrollReserve) lets it stand. That reserve must hold the dock and the ring, so the
// ring's foot clears the dock's top by 2px or more. One language a file, since each serves its own
// site.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

export function copyReserve(language: string) {
  test.use({
    appOptions: {
      portfolio: FIXTURE.files.portfolio,
      siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'flux')
        .replace(/designLanguage: .*/, `designLanguage: ${language}`)
        .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
        .replace(/typography: .*/, 'typography: humanist-ui')
        .replace(/displayMode: .*/, 'displayMode: system'),
      sourceFiles: Object.fromEntries(
        FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
      ),
    },
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test(
    `on ${language} at 390 under more contrast, the close's Copy email, reached by Tab from the top, rings clear of the dock`,
    {
      annotation: [
        { type: 'route', description: '/' },
        { type: 'profile', description: 'read-only' },
      ],
    },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference', contrast: 'more' });
      await pinFaces(page, await optionalFaces(page), 'designed');
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await expect(page.locator('.fx[data-fx-live]')).toHaveCount(1);
      const copy = page.locator('#contact [data-fx-copy]').first();
      await expect(copy).toHaveCount(1);
      // From the page's first control, Tab by Tab, as a reader walks the page.
      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
        document
          .querySelector<HTMLElement>('[data-ui-slot="skip-link"], a[href], button')
          ?.focus({ preventScroll: true });
      });
      for (let presses = 0; presses < 400; presses += 1) {
        await page.keyboard.press('Tab');
        if (await copy.evaluate((el) => el === document.activeElement)) break;
      }
      await expect(copy, 'Copy email has focus').toBeFocused();
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const rest = await copy.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const reach =
          (Number.parseFloat(style.outlineOffset) || 0) +
          (Number.parseFloat(style.outlineWidth) || 0);
        const dock = document.querySelector<HTMLElement>('.fx-bar')!.getBoundingClientRect();
        return { bottom: box.bottom, reach, dockTop: dock.top, dockHeight: dock.height };
      });
      const clear = rest.dockTop - (rest.bottom + rest.reach);
      console.log(
        `flux copy reserve ${language}: box bottom ${rest.bottom.toFixed(1)}, ring reach ${rest.reach}, dock ${rest.dockHeight.toFixed(1)} from ${rest.dockTop.toFixed(1)}, clear ${clear.toFixed(1)}px`,
      );
      expect(clear, "the ring's foot above the dock's top").toBeGreaterThanOrEqual(2);
    },
  );
}
