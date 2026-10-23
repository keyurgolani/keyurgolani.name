import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { focusFindings } from './lib/a11y/interaction';
import { killSwitches, MOTION_SAMPLER, osWinsFindings } from './lib/a11y/motion';
import { inPage, type Active } from './lib/a11y/probe';
import { NOT_FOUND_PATH } from './lib/state-fixtures';
import { qualityWeb } from './lib/env';
import { expect, test } from './fixtures';

// The motion checks that run once a build, on the harness project's server
// (#11, Slice 2, item 10, and the owner's [31]):
//
// - OS reduced motion wins: on #19's primitives page, every presentation
//   boundary told motion is full and enhancement is on (a preview's
//   override; the site's respect-os and the visitor's default allow no
//   more), under OS reduce, with and without JavaScript. Reduced motion
//   holds, and the boundaries' motion tokens are the reduced ones.
// - The compiled-CSS audit: no stylesheet the quality build compiled, the
//   host's or a pack's, has a universal !important motion kill switch.
// - The host's focus ring (apps/web/src/app/experience-base.css): on a phone,
//   where Chromium's own ring is under 3:1, a page's skip link and the 404
//   page's first link ring in currentColor, and a variant's own focus style,
//   which is unlayered, wins over it.

const PRIMITIVES = { type: 'route', description: '/_fixtures/appearance' };
const READ_ONLY = { type: 'profile', description: 'read-only' };

test.describe('under OS reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });
  for (const javaScriptEnabled of [true, false]) {
    test.describe(javaScriptEnabled ? 'with JavaScript' : 'without JavaScript', () => {
      test.use({ javaScriptEnabled });
      test(
        'OS reduced motion wins over the site, the visitor, and a preview',
        { annotation: [PRIMITIVES, READ_ONLY] },
        async ({ page }) => {
          await page.addInitScript(MOTION_SAMPLER);
          const response = await page.goto('/_fixtures/appearance', { waitUntil: 'load' });
          expect(response?.status()).toBe(200);
          expect(await osWinsFindings(page)).toEqual([]);
        },
      );
    });
  }
});

/** Every .css file under `dir`, recursively; none for a missing directory. */
function cssFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.css'))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

test(
  'no compiled stylesheet kills motion with a universal !important rule',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  () => {
    const web = qualityWeb();
    const files = [
      ...cssFiles(path.join(web, '.next', 'static')),
      ...cssFiles(path.join(web, 'public', '_portfolio')),
    ];
    // An empty build would pass anything.
    expect(files.length, 'the quality build compiled stylesheets').toBeGreaterThan(0);
    const found = files.flatMap((file) =>
      killSwitches(readFileSync(file, 'utf8')).map(
        ({ selector, declaration }) =>
          `${path.relative(web, file)}: ${selector} { ${declaration} }`,
      ),
    );
    expect(found).toEqual([]);
  },
);

test.describe("the host's focus ring on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  /** The style of the outline the focused element draws. */
  const outline = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const style = getComputedStyle(document.activeElement!);
      return {
        style: style.outlineStyle,
        width: style.outlineWidth,
        color: style.outlineColor,
        text: style.color,
      };
    });

  for (const [route, status, first] of [
    ['/', 200, 'the skip link'],
    [NOT_FOUND_PATH, 404, 'the first link'],
  ] as const) {
    test(
      `${first} on ${route} rings in its own color, at 3:1 or more`,
      { annotation: [{ type: 'route', description: route }, READ_ONLY] },
      async ({ page }) => {
        expect((await page.goto(route))?.status()).toBe(status);
        await page.keyboard.press('Tab');
        const active = await inPage<Active>(page, { kind: 'active' });
        expect(active.none).toBe(false);
        if (route === '/') {
          expect(await page.evaluate(() => document.activeElement?.className)).toBe(
            'host-skip-link',
          );
        }
        const ring = await outline(page);
        expect(ring).toEqual({ style: 'solid', width: '2px', color: ring.text, text: ring.text });
        expect(await focusFindings(page, active)).toEqual([]);
      },
    );
  }

  test(
    "a variant's own focus style, unlayered, wins over the host's",
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => {
        const style = document.createElement('style');
        style.textContent = '[data-variant] :focus-visible { outline: 3px dashed rgb(1, 2, 3); }';
        document.head.append(style);
      });
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      expect(await outline(page)).toMatchObject({
        style: 'dashed',
        width: '3px',
        color: 'rgb(1, 2, 3)',
      });
    },
  );
});
