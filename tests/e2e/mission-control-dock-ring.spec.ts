import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { frames } from '../quality/lib/a11y/interaction';

// Mission Control on a phone docks its rail at the window's foot. While keyboard focus is on the
// page the rail steps down out of the way, and it comes back when focus leaves, so a focused
// control whose ring reaches into the rail's band has that part of its ring covered the moment
// focus moves on, and the focus check, which compares the focused page with the blurred one, reads
// it there as no change. On CI Linux the experience record's organisation link stopped with its
// ring's foot 1.2 px into the band (Letterpress on Warm Parchment, under more contrast and forced
// colours): a browser scrolls a focused control into view only when it's out of view, and the
// link was already on screen, left there by the scroll to an earlier stop. Walked from the top of
// the home page by Tab, as the quality cells walk it, every stop on the page rings clear of the
// rail's band; and that link, set in view with its ring's foot in the band and reached by Tab
// from the stop before it, lands clear of it. On the complete contract fixture, 390 by 844, mobile
// and touch.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [{ type: 'route', description: '/' }];
const tag = '@interaction';
const LINK = '#experience-role-experience-organization > div:nth-child(2) > p:nth-child(2) > a';

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'mission-control')
      .replace(/designLanguage: .*/, 'designLanguage: letterpress')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const ROWS = [
  { label: 'under more contrast', contrast: 'more', forcedColors: 'none' },
  { label: 'under forced colours', contrast: 'no-preference', forcedColors: 'active' },
] as const;

for (const row of ROWS) {
  test(
    `on a phone ${row.label}, every stop Tab reaches on the home page rings clear of the docked rail's band`,
    { annotation, tag },
    async ({ page }) => {
      test.setTimeout(180_000);
      await page.emulateMedia({
        colorScheme: 'light',
        contrast: row.contrast,
        forcedColors: row.forcedColors,
      });
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('[data-variant]').first()).toHaveAttribute(
        'data-variant',
        'mission-control',
      );
      await page.mouse.move(0, 0);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo(0, 0);
      });
      const into: string[] = [];
      let stops = 0;
      let first: string | null = null;
      for (let press = 0; press < 600; press++) {
        await page.keyboard.press('Tab');
        await frames(page);
        const at = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const rail = document.querySelector('.mc-rail');
          const name = `${el.localName}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : ''} "${(el.textContent ?? '').trim().slice(0, 32)}"`;
          // The rail's own links ring over the rail, which they're on: they're not the page's.
          if (!rail || rail.contains(el)) return { name, inRail: true, over: 0 };
          const style = getComputedStyle(el);
          const reach =
            Number.parseFloat(style.outlineWidth) +
            Math.max(0, Number.parseFloat(style.outlineOffset));
          const band = innerHeight - (rail as HTMLElement).offsetHeight;
          const rects = [...el.getClientRects()];
          const bottom = Math.max(...rects.map((r) => r.bottom));
          const top = Math.min(...rects.map((r) => r.top));
          // Only a ring in view counts: one past the window's foot isn't drawn there either.
          const over =
            top - reach < innerHeight && bottom + reach > band ? bottom + reach - band : 0;
          return { name, inRail: false, over: Math.round(over * 10) / 10 };
        });
        if (!at) continue;
        if (first === null) first = at.name;
        else if (at.name === first) break;
        stops++;
        if (!at.inRail && at.over > 0)
          into.push(`${at.name}: its ring ${at.over} px into the band`);
      }
      expect(stops, 'Tab reached the page').toBeGreaterThan(20);
      expect(into, `of ${stops} stops`).toEqual([]);
    },
  );
}

test(
  "on a phone, Tab onto a stop already in view whose ring's foot lies in the docked rail's band lands it clear",
  { annotation, tag },
  async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', contrast: 'more' });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('[data-variant]').first()).toHaveAttribute(
      'data-variant',
      'mission-control',
    );
    await page.mouse.move(0, 0);
    // The link's foot 2 px into the band, its box wholly in the window, and the stop before it in
    // the tab order focused where it stands, without a scroll.
    const set = await page.evaluate((selector) => {
      const link = document.querySelector<HTMLElement>(selector);
      const rail = document.querySelector<HTMLElement>('.mc-rail');
      if (!link || !rail) return null;
      const band = innerHeight - rail.offsetHeight;
      window.scrollBy(0, link.getBoundingClientRect().bottom - (band + 2));
      const stops = [
        ...document.querySelectorAll<HTMLElement>(
          'a[href], button, summary, input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.getClientRects().length > 0 && !rail.contains(el));
      stops[stops.indexOf(link) - 1]?.focus({ preventScroll: true });
      const box = link.getBoundingClientRect();
      return { band, top: box.top, bottom: box.bottom, innerHeight };
    }, LINK);
    expect(set, 'the fixture has the link and the rail').not.toBeNull();
    expect(set!.bottom, 'the link starts in the band').toBeGreaterThan(set!.band);
    expect(set!.bottom, 'the link starts in the window').toBeLessThan(set!.innerHeight);
    await page.keyboard.press('Tab');
    await frames(page);
    const at = await page.evaluate((selector) => {
      const el = document.activeElement;
      const rail = document.querySelector<HTMLElement>('.mc-rail')!;
      const style = el ? getComputedStyle(el) : null;
      const reach = style
        ? Number.parseFloat(style.outlineWidth) +
          Math.max(0, Number.parseFloat(style.outlineOffset))
        : 0;
      const box = el?.getBoundingClientRect();
      return {
        onLink: !!el?.matches(selector),
        focusVisible: !!el?.matches(':focus-visible'),
        top: box ? Math.round((box.top - reach) * 10) / 10 : null,
        over: box
          ? Math.round((box.bottom + reach - (innerHeight - rail.offsetHeight)) * 10) / 10
          : null,
      };
    }, LINK);
    expect(at.onLink, 'Tab reached the link').toBe(true);
    expect(at.focusVisible, 'its ring shows').toBe(true);
    expect(at.over, "its ring's foot against the band's top").toBeLessThanOrEqual(0);
    expect(at.top, "its ring's top in the window").toBeGreaterThanOrEqual(0);
  },
);
