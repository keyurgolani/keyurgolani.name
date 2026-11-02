import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { APPEARANCE_COOKIE } from '../quality/lib/sweep';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Singular's checks in a browser (variants-10 brief §5.7, step 9): the
// pager's keys page only while a panel's heading has focus, and never at
// window level; an in-page action lands focus on the incoming panel's
// heading; snap is proximity by default and off under reduced motion and
// on a phone; a panel already on screen never animates, and the reveals
// hold their start with fill: backwards; every band stands on the other of
// paper and ink (SG-M2); on a phone the counter takes its own line over a
// full-width action of 44 px or more (SG-M3) and nothing scrolls sideways;
// Contents opens over the page, and a link in it closes it and lands; and
// the rail's labels show on focus. On the complete fixture, under
// read-only.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

const SITE_TEXT = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'singular');
const APP = {
  portfolio: FIXTURE.files.portfolio,
  siteText: SITE_TEXT,
  sourceFiles: Object.fromEntries(
    FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
  ),
};

test.use({ viewport: { width: 1440, height: 900 }, appOptions: APP });

/** The page once the pager has run. */
async function live(page: Page) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('.sg[data-sg-live]')).toHaveCount(1);
}

/**
 * What sticks out past the window's right edge: the innermost such elements
 * (none of their children stick out too), each with its width and right
 * edge, so a failure names the culprit and not its ancestors.
 */
function sticksOut() {
  const edge = document.documentElement.clientWidth + 1;
  const out = (el: Element) => el.getBoundingClientRect().right > edge;
  return [...document.querySelectorAll('body *')]
    .filter((el) => out(el) && ![...el.children].some(out))
    .slice(0, 8)
    .map((el) => {
      const box = el.getBoundingClientRect();
      const name = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}`;
      return `${name} w${Math.round(box.width)} r${Math.round(box.right)}`;
    });
}

const focusedId = (page: Page) => page.evaluate(() => document.activeElement?.id ?? '');

test(
  'the keys page only from a panel heading, never at window level',
  { annotation },
  async ({ page }) => {
    await live(page);
    // With focus on nothing in particular, ArrowDown is the browser's own scroll: no heading takes focus.
    await page.locator('body').click({ position: { x: 4, y: 450 } });
    await page.keyboard.press('ArrowDown');
    expect(
      await page.evaluate(() => document.activeElement?.closest('[data-sg-heading]') ?? null),
    ).toBeNull();
    // From a band's link, PageDown stays the browser's: focus stays on the link.
    await page.evaluate(() => window.scrollTo(0, 0));
    const go = page.locator('[data-sg-panel="who"] .sg-band__go');
    await go.focus();
    await page.keyboard.press('PageDown');
    await expect(go).toBeFocused();
    // From panel 1's heading, PageDown moves to panel 2's heading and brings it to the top.
    await page.evaluate(() => window.scrollTo(0, 0));
    const h1 = page.locator('h1');
    await h1.focus();
    await page.keyboard.press('PageDown');
    const second = page.locator('[data-sg-panel="best"] [data-sg-heading]');
    await expect(second).toBeFocused();
    await expect
      .poll(() =>
        page
          .locator('[data-sg-panel="best"]')
          .evaluate((el) => Math.round(el.getBoundingClientRect().top)),
      )
      .toBeLessThan(8);
    // PageUp goes back; with a modifier the key is the browser's.
    await page.keyboard.press('PageUp');
    await expect(h1).toBeFocused();
    await page.keyboard.press('Shift+ArrowDown');
    await expect(h1).toBeFocused();
  },
);

test(
  'an in-page action lands focus on the incoming panel’s heading',
  { annotation },
  async ({ page }) => {
    await live(page);
    await page.locator('[data-sg-panel="who"] .sg-band__go').click();
    await expect(page.locator('[data-sg-panel="best"] [data-sg-heading]')).toBeFocused();
    expect(await focusedId(page)).toMatch(/sg-best-work--h$/);
    // A rail stop does the same.
    await page.locator('.sg-rail a[data-sg-rail="contact"]').click();
    await expect(page.locator('[data-sg-panel="contact"] [data-sg-heading]')).toBeFocused();
  },
);

test(
  'Enter on a band follows it, and focus lands on the incoming heading',
  { annotation },
  async ({ page }) => {
    await live(page);
    await page.locator('[data-sg-panel="who"] .sg-band__go').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-sg-panel="best"] [data-sg-heading]')).toBeFocused();
    expect(new URL(page.url()).hash).toMatch(/sg-best-work$/);
  },
);

// `y proximity` serialises as `y`: proximity is the default strictness.
const PROXIMITY = /^y(?: proximity)?$/;

test.describe('motion allowed', () => {
  test(
    'snap is proximity, and only panels that enter later reveal, holding their start',
    { annotation },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await live(page);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.style.scrollSnapType))
        .toMatch(PROXIMITY);
      // Panel 1 was on screen at load: nothing on it animates.
      expect(
        await page
          .locator('[data-sg-panel="who"]')
          .evaluate((el) => el.getAnimations({ subtree: true }).length),
      ).toBe(0);
      const more = page.locator('[data-sg-panel="more"]');
      await more.scrollIntoViewIfNeeded();
      const fills = () =>
        more.evaluate((el) =>
          el
            .getAnimations({ subtree: true })
            .map((a) => (a.effect as KeyframeEffect).getTiming().fill),
        );
      await expect.poll(async () => (await fills()).length).toBeGreaterThan(0);
      expect(new Set(await fills())).toEqual(new Set(['backwards']));
    },
  );
});

test.describe('motion allowed, focus', () => {
  test(
    'focus that enters a revealed panel and leaves it never replays the reveal (code review P1-2)',
    { annotation },
    async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await live(page);
      const more = page.locator('[data-sg-panel="more"]');
      const running = () => more.evaluate((el) => el.getAnimations({ subtree: true }).length);
      await more.scrollIntoViewIfNeeded();
      await expect(more).toHaveAttribute('data-sg-enter', '');
      // The reveal runs, then ends.
      await expect.poll(running, { timeout: 10_000 }).toBe(0);
      const link = more.locator('a[href]').first();
      await link.focus();
      await expect(more).not.toHaveAttribute('data-sg-enter', '');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.waitForTimeout(150);
      expect(await running()).toBe(0);
      await expect(more).not.toHaveAttribute('data-sg-enter', '');
    },
  );
});

test.describe('reduced motion', () => {
  test('no snap and no reveal', { annotation }, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await live(page);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.documentElement.style.scrollSnapType)).toBe('none');
    await page.locator('[data-sg-panel="more"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  });
});

test(
  'every band stands on the other of paper and ink (SG-M2), and is one link',
  { annotation },
  async ({ page }) => {
    await live(page);
    const rows = await page.locator('.sg-panel').evaluateAll((panels) =>
      panels.map((panel) => {
        const band = panel.querySelector('.sg-band')!;
        return {
          panel: getComputedStyle(panel).backgroundColor,
          band: getComputedStyle(band).backgroundColor,
          links: band.querySelectorAll('a').length,
          height: band.getBoundingClientRect().height,
          width: band.getBoundingClientRect().width,
        };
      }),
    );
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows) {
      expect(row.band).not.toBe(row.panel);
      expect(row.links).toBe(1);
      // The report's 64 px Fitts bar, across the whole width.
      expect(row.height).toBeGreaterThanOrEqual(56);
      expect(row.width).toBeGreaterThanOrEqual(1400);
    }
    // The band's link covers the band: its click target is the band's box.
    const hit = await page.locator('[data-sg-panel="who"] .sg-band').evaluate((band) => {
      const box = band.getBoundingClientRect();
      const at = document.elementFromPoint(box.left + 24, box.top + box.height / 2);
      return at?.closest('a')?.className ?? '';
    });
    expect(hit).toContain('sg-band__go');
  },
);

test(
  'Contents opens over the page, and a link in it closes it and lands',
  { annotation },
  async ({ page }) => {
    await live(page);
    await page.getByRole('button', { name: 'Contents' }).click();
    const dialog = page.getByRole('dialog', { name: 'Contents' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('link').nth(2).click();
    await expect(dialog).toBeHidden();
    expect(await focusedId(page)).not.toBe('');
  },
);

test(
  'the rail’s labels show on focus, and every stop is 44 px',
  { annotation },
  async ({ page }) => {
    await live(page);
    const stops = page.locator('.sg-rail a');
    const sizes = await stops.evaluateAll((links) =>
      links.map((a) => a.getBoundingClientRect().height),
    );
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(44);
    await page.keyboard.press('Tab');
    await stops.first().focus();
    // Shown, not just laid out: the label fades in, so its opacity is the test.
    const label = stops.first().locator('.sg-rail__label');
    await expect(label).toBeVisible();
    await expect.poll(() => label.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  },
);

for (const mode of ['light', 'dark'] as const) {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(
      `the skip link shows over the bar when it takes focus, its text at 4.5:1, at ${size.width} in ${mode}`,
      { annotation },
      async ({ page }) => {
        await page.setViewportSize(size);
        await live(page);
        if (mode === 'dark') {
          // The visitor's preference cookie, with the page's own packs and the dark mode.
          const boundary = page.locator('[data-appearance-boundary="document"]');
          const value = new URLSearchParams({
            language: (await boundary.getAttribute('data-design-language'))!,
            scheme: (await boundary.getAttribute('data-color-scheme'))!,
            type: (await boundary.getAttribute('data-typography'))!,
            mode: 'dark',
          }).toString();
          await page.context().addCookies([{ name: APPEARANCE_COOKIE, value, url: page.url() }]);
          await live(page);
          await expect(boundary).toHaveAttribute('data-display-mode', 'dark');
        }
        await page.keyboard.press('Tab');
        const skip = page.locator('[data-ui-slot="skip-link"]');
        await expect(skip).toBeFocused();
        // What's painted at its centre is the link itself, not the bar over it, and its text reads on its fill.
        const hit = await skip.evaluate((link) => {
          const box = link.getBoundingClientRect();
          const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          // The text's contrast on the link's own fill, both painted to sRGB on a canvas, so any colour syntax reads.
          const style = getComputedStyle(link);
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
          const lum = (color: string) => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((v) => {
              const c = v / 255;
              return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
          };
          const [fg, bg] = [lum(style.color), lum(style.backgroundColor)];
          return {
            width: box.width,
            height: box.height,
            covered: top !== link && !link.contains(top),
            // What shows there instead, for a failure to name: a covering element, or none when it's out of view.
            over: top
              ? `${top.tagName.toLowerCase()}.${top.className}`
              : `nothing at y ${Math.round(box.y)}`,
            contrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
          };
        });
        expect(hit.width).toBeGreaterThan(40);
        expect(hit.height).toBeGreaterThan(20);
        expect(hit.covered, hit.over).toBe(false);
        expect(hit.contrast).toBeGreaterThanOrEqual(4.5);
      },
    );
  }
}

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('nothing scrolls sideways', { annotation }, async ({ page }) => {
    await live(page);
    // A failure names what sticks out.
    const wide = await page.evaluate(sticksOut);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
      `wider than the window: ${wide.join('; ')}`,
    ).toBeLessThanOrEqual(390);
  });

  test(
    'each More work row is one target of 44 px or more, corner to corner',
    { annotation },
    async ({ page }) => {
      await live(page);
      const rows = page.locator('.sg-more__row');
      expect(await rows.count()).toBeGreaterThan(0);
      for (const row of await rows.all()) {
        const hit = await row.evaluate((el) => {
          // Mid-window, clear of the pinned bar and strip.
          el.scrollIntoView({ block: 'center' });
          const box = el.getBoundingClientRect();
          const link = el.querySelector('a');
          const at = (x: number, y: number) => {
            const top = document.elementFromPoint(x, y);
            return !!link && !!top && (top === link || link.contains(top));
          };
          return {
            height: box.height,
            link: !!link,
            corners: [
              at(box.left + 4, box.top + 4),
              at(box.right - 4, box.top + 4),
              at(box.left + 4, box.bottom - 4),
              at(box.right - 4, box.bottom - 4),
            ],
          };
        });
        if (!hit.link) continue;
        expect(hit.height).toBeGreaterThanOrEqual(44);
        // The title's link covers its whole row, so the anchor's own line box isn't the target.
        expect(hit.corners).toEqual([true, true, true, true]);
      }
    },
  );

  test(
    'each panel ends before the next begins: its own ground under its band',
    { annotation },
    async ({ page }) => {
      await live(page);
      const panels = await page.locator('.sg-panel').evaluateAll((all) =>
        all.map((panel) => {
          const band = panel.querySelector(':scope > .sg-band')!;
          return {
            gap: panel.getBoundingClientRect().bottom - band.getBoundingClientRect().bottom,
            panel: getComputedStyle(panel).backgroundColor,
            band: getComputedStyle(band).backgroundColor,
          };
        }),
      );
      expect(panels.length).toBeGreaterThan(1);
      for (const { gap, panel, band } of panels) {
        // The band shares its ground with the next panel, so the gap is what parts them.
        expect(gap).toBeGreaterThanOrEqual(12);
        expect(panel).not.toBe(band);
      }
    },
  );

  test(
    'the counter on its own line over a full-width action of 44 px or more (SG-M3)',
    { annotation },
    async ({ page }) => {
      await live(page);
      const bands = await page.locator('.sg-band').evaluateAll((all) =>
        all.map((band) => {
          const count = band.querySelector('.sg-band__count')!.getBoundingClientRect();
          const go = band.querySelector('.sg-band__go')?.getBoundingClientRect();
          const label = band.querySelector('.sg-band__label')?.getBoundingClientRect();
          return { count, go, label };
        }),
      );
      for (const { count, go, label } of bands) {
        expect(go).toBeTruthy();
        expect(go!.height).toBeGreaterThanOrEqual(44);
        expect(go!.width).toBeGreaterThanOrEqual(300);
        expect(count.bottom).toBeLessThanOrEqual(go!.top + 1);
        // The label keeps to two lines at most: never "See the / work" squeezed beside the counter.
        expect(label!.height).toBeLessThan(count.height * 6);
      }
      expect(await page.evaluate(() => document.documentElement.style.scrollSnapType)).toBe('none');
      // The phone's chrome: the name and Contents, the rail away.
      await expect(page.locator('.sg-rail')).toBeHidden();
      await expect(page.locator('.sg-bar__email')).toBeHidden();
    },
  );
});
