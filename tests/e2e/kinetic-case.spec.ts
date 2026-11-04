import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { loadHome } from '../harness/motion';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';

// Kinetic Cosmos P2 (redesign, stream E), on the complete contract
// fixture: a work's own page is the composition's, its title the one h1,
// its stops riding an orbit arc and landing, and the dock tracking the stop
// you're at; and the home outline's closed folds print open and work with
// no script.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const SLUG = 'project-name';

const SITE = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'kinetic-cosmos');
const SOURCE_FILES = Object.fromEntries(
  FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
);

test.use({
  appOptions: { portfolio: FIXTURE.files.portfolio, siteText: SITE, sourceFiles: SOURCE_FILES },
  viewport: { width: 1280, height: 800 },
});

/** The relative luminance of a computed color, rgb() or #rrggbb. */
function luminanceOf(color: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  const channels = hex
    ? [0, 2, 4].map((at) => Number.parseInt(hex[1]!.slice(at, at + 2), 16))
    : (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const [r = 0, g = 0, b = 0] = channels.map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test(
  "a work's own page: the composition's, its title the one h1, its stops landing, the dock on the stop",
  { annotation: [{ type: 'route', description: '/work/[slug]' }, READ_ONLY], tag: '@interaction' },
  async ({ page }) => {
    await page.goto(`/work/${SLUG}`);
    await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'kinetic-cosmos');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Project name');
    await expect(page.locator('.kc-case-stage')).toBeVisible();
    // Eight stops on the arc, each a link to its part.
    const stops = page.locator('.kc-flight .kc-arc__stop a');
    await expect(stops).toHaveCount(8);
    await page.getByRole('link', { name: 'The course it took' }).first().click();
    await expect(page.locator('[data-stop="decisions"]')).toBeInViewport();
    await expect(page.locator('table.kc-decisions')).toBeVisible();
    // Past the stage, the dock shows, and says which stop you're at.
    await expect(page.locator('.kc-dock')).toBeVisible();
    await expect(page.locator('.kc-dock__count')).toHaveText('Stop 5 of 8');
    // The arc marks the stop you're at.
    await expect(page.locator('.kc-flight a[aria-current="location"]')).toHaveText(
      'The course it took',
    );
    // The way back leads home.
    await page.locator('.kc-case-next__home a').click();
    await expect(page).toHaveURL(/\/$/);
  },
);

test(
  "a work's own page from 64rem: a hung stop the visitor follows is the dock's, not its row's first (review M1)",
  { annotation: [{ type: 'route', description: '/work/[slug]' }, READ_ONLY], tag: '@interaction' },
  async ({ page }) => {
    await page.goto(`/work/${SLUG}`);
    // The last three stops share one row at 1280: following the middle one lands on all three.
    await page.locator('.kc-flight a', { hasText: 'Where it landed' }).first().click();
    await expect(page.locator('[data-stop="outcomes"]')).toBeInViewport();
    await expect(page.locator('.kc-dock')).toBeVisible();
    await expect(page.locator('.kc-dock__count')).toHaveText('Stop 7 of 8');
    await expect(page.locator('.kc-flight a[aria-current="location"]')).toHaveText(
      'Where it landed',
    );
  },
);

test(
  "the home outline prints open: every closed fold's content is on the printed page",
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    await loadHome(page, '/');
    const closed = page.locator('details.kc-fold:not([open])');
    expect(await closed.count()).toBeGreaterThan(0);
    const inside = closed.first().locator(':scope > :not(summary)').first();
    await expect(inside).toBeHidden();
    await page.emulateMedia({ media: 'print' });
    await expect(inside).toBeVisible();
    // A dialog's content prints too: a talk's abstract and links, an offer's inclusions (M1).
    const dialogs = page.locator('dialog.kc-talk-dialog');
    expect(await dialogs.count()).toBeGreaterThan(0);
    await expect(dialogs.first()).toBeVisible();
    await expect(dialogs.first().locator('.kc-talk-dialog__head')).toBeHidden();
  },
);

test.describe('with no script', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'a closed row opens on a click, and a link that names its section shows it',
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }) => {
      await page.goto('/');
      const fold = page.locator('.kc-ring[data-ring="record"] section > details.kc-fold').first();
      const id = await fold.evaluate((details) => details.closest('section')!.id);
      const inside = fold.locator(':scope > :not(summary)').first();
      await expect(inside).toBeHidden();
      // A link to an ancestor of every fold, #main, opens none of them (T1).
      await page.goto('/#main');
      await expect(page.locator('details.kc-fold:not([open]) > :not(summary):visible')).toHaveCount(
        0,
      );
      await page.goto(`/#${id}`);
      await expect(inside).toBeVisible();
      await page.goto('/');
      await fold.locator(':scope > summary').click();
      await expect(inside).toBeVisible();
    },
  );
});

test(
  "a talk's abstract and links open in a dialog of their own, and Escape gives focus back",
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY], tag: '@interaction' },
  async ({ page }) => {
    await loadHome(page, '/');
    const more = page.locator('[data-evidence-type="talk"] .kc-object__more').first();
    // Talks close on home as a ring's tail: open the row that holds them first.
    const fold = page
      .locator('details.kc-fold:has([data-evidence-type="talk"] .kc-object__more)')
      .first();
    if ((await fold.count()) > 0 && (await fold.getAttribute('open')) === null) {
      await fold.locator(':scope > summary').click();
    }
    await more.click();
    const dialog = page.locator('dialog.kc-talk-dialog[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.kc-talk-dialog__title')).toHaveText('Talk title');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(more).toBeFocused();
    // Its Close button gives focus back too.
    await more.click();
    await dialog.locator('.kc-index__close').click();
    await expect(dialog).toHaveCount(0);
    await expect(more).toBeFocused();
  },
);

test(
  'what an offer includes opens in a dialog of its own, and Escape gives focus back',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY], tag: '@interaction' },
  async ({ page }) => {
    await loadHome(page, '/');
    const more = page.locator('.kc-offer .kc-object__more').first();
    test.skip((await more.count()) === 0, 'the fixture offers nothing with highlights');
    await more.click();
    const dialog = page.locator('dialog.kc-talk-dialog[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.kc-ruled li').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(more).toBeFocused();
  },
);

// focus-inverse reads 3.5:1 or more on text-primary in every set (FOCUS_INVERSE_TARGETS), so in
// light and in dark, where the stages invert to cream, each ring in the dialog is whole. The
// complete fixture publishes light, on ink-and-paper, which no pack registers, and lets a visitor
// pick the scheme and the mode: each run picks warm-parchment, the scheme KC's quality cells
// render, in its mode, as the visitor control's cookie does, and reads back the set it rendered:
// dark text on the light set, light text, the cream the inverse ground takes, on the dark one.
for (const mode of ['light', 'dark'] as const) {
  test.describe(`in ${mode}`, () => {
    test.use({ colorScheme: mode });

    test(
      "a talk's dialog, open on the stages' ink, is K-2's inverse surface: each control in it rings in the scheme's focus-inverse, a whole 2px ring changed at 3:1",
      { annotation: [{ type: 'route', description: '/' }, READ_ONLY], tag: '@interaction' },
      async ({ page, app }) => {
        await page.context().addCookies([
          {
            name: 'portfolio_appearance',
            value: `scheme=warm-parchment&mode=${mode}`,
            url: app.origin,
          },
        ]);
        await loadHome(page, '/');
        await expect(page.locator('[data-color-scheme]').first()).toHaveAttribute(
          'data-color-scheme',
          'warm-parchment',
        );
        await expect(page.locator('[data-display-mode]').first()).toHaveAttribute(
          'data-display-mode',
          mode,
        );
        const fold = page
          .locator('details.kc-fold:has([data-evidence-type="talk"] .kc-object__more)')
          .first();
        if ((await fold.count()) > 0 && (await fold.getAttribute('open')) === null) {
          await fold.locator(':scope > summary').click();
        }
        // From the keyboard, so each ring inside is :focus-visible.
        await page.locator('[data-evidence-type="talk"] .kc-object__more').first().focus();
        await page.keyboard.press('Enter');
        const dialog = page.locator('dialog.kc-talk-dialog[open]');
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('data-ui-surface', 'inverse');
        // The set it rendered: text-primary, the inverse ground, dark in light and light in dark.
        const text = await dialog.evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--color-text-primary'),
        );
        if (mode === 'dark') expect(luminanceOf(text)).toBeGreaterThan(0.5);
        else expect(luminanceOf(text)).toBeLessThan(0.1);
        const focusInverse = await dialog.evaluate((element) => {
          const probe = document.createElement('span');
          probe.style.color = 'var(--color-focus-inverse)';
          element.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        });
        // Each stop inside the modal once, as Tab cycles them.
        const seen = new Set<string>();
        for (let press = 0; press < 8; press++) {
          const active = await inPage<Active>(page, { kind: 'active' });
          if (active.none || seen.has(active.path)) break;
          seen.add(active.path);
          expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
            true,
          );
          expect(
            await page.evaluate(() => getComputedStyle(document.activeElement!).outlineColor),
          ).toBe(focusInverse);
          // Shown, changed at 3:1, and over a whole 2px ring: no finding, the perimeter's included.
          expect(await focusFindings(page, active)).toEqual([]);
          await page.keyboard.press('Tab');
        }
        expect(seen.size).toBeGreaterThan(1);
      },
    );
  });
}

test.describe("a talk's dialog with no script", () => {
  test.use({ javaScriptEnabled: false });

  test(
    "reads inline in the page's ink, and is no inverse surface",
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
    async ({ page }) => {
      await page.goto('/');
      const dialog = page.locator('dialog.kc-talk-dialog').first();
      await expect(dialog).not.toHaveAttribute('data-ui-surface', /./);
      expect(await dialog.evaluate((element) => getComputedStyle(element).position)).toBe('static');
    },
  );
});

test(
  "a work's own page: every stop's label on the arc stays in the viewport, at 100% and 200% root text",
  { annotation: [{ type: 'route', description: '/work/[slug]' }, READ_ONLY] },
  async ({ page }) => {
    // From 64rem the flight arc runs the window's width and its last stop sits at 0.92 of it: under
    // the quality root-text condition (200% at 1024) its label ran past the window's edge (795px to
    // 1089px in 1024), and under a wider font (Ubuntu's, through the font proxy) at 100% too. The
    // label now moves back along the arc as far as it must; its dot stays where it is.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const [width, height, scale] of [
      [1024, 768, 1],
      [1440, 900, 1],
      [1024, 768, 2],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/work/${SLUG}`, { waitUntil: 'networkidle' });
      await page.evaluate(
        (at) =>
          document.documentElement.style.setProperty('font-size', `${at * 100}%`, 'important'),
        scale,
      );
      const stops = await page.locator('.kc-flight .kc-arc__stop a').evaluateAll((links) =>
        links.map((link) => {
          const box = link.getBoundingClientRect();
          return { name: link.textContent?.trim() ?? '', start: box.left, end: box.right };
        }),
      );
      expect(stops.length, `${width} at ${scale * 100}%: the arc's stops`).toBe(8);
      const view = await page.evaluate(() => document.documentElement.clientWidth);
      for (const stop of stops) {
        const at = `${width} at ${scale * 100}% text, "${stop.name}"`;
        expect(stop.start, `${at}: its start in view`).toBeGreaterThanOrEqual(0);
        expect(stop.end, `${at}: its end in view`).toBeLessThanOrEqual(view);
      }
    }
  },
);
