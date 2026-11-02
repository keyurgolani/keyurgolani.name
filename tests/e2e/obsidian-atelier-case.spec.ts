import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Obsidian Atelier's own case page and the long page's aids (redesign,
// stream C, P2), on the complete contract fixture: the case bar's stops
// are named by plate and land below it, marking where the visitor is; no
// full-width band leaves its far side empty, on home or the case, wide or
// narrow (no dead space), the halls' summaries and their whole record
// opened included; nothing scrolls sideways at 320; past five windows the
// running head stays as a plate beside Index; and a first load at a place
// inside a closed fold opens it and lands focus there.

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
const tag = '@interaction';
const CASE = '/work/project-name';

test.use({ appOptions: serving('complete'), viewport: { width: 1440, height: 900 } });

async function load(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: 'load' });
  await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'obsidian-atelier');
  await expect(page.locator('.oa-chrome')).toHaveAttribute('data-oa-script', '');
}

/** Full-width bands whose content stops short of 70% of their width, and which kinds were measured. */
const deadSpace = (page: Page) =>
  page.evaluate(() => {
    const found: string[] = [];
    const measured = new Set<string>();
    // The halls' folds open, so the whole record and the whole practice are measured too.
    for (const fold of document.querySelectorAll<HTMLDetailsElement>('details.oa-whole'))
      fold.open = true;
    const selector = [
      '.oa-installation',
      '.oa-case__row',
      '.oa-backmatter',
      '.oa-intro',
      '.oa-hall__lead',
      '.oa-whole__main',
      '.oa-gallery__main > *',
      '.oa-bay',
    ].join(', ');
    for (const box of document.querySelectorAll<HTMLElement>(selector)) {
      const r = box.getBoundingClientRect();
      if (r.width < innerWidth * 0.6 || r.height === 0) continue;
      const kind = [...box.classList].find((name) => selector.includes(`.${name}`));
      measured.add(kind ?? box.className);
      let right = r.left;
      for (const child of box.querySelectorAll('*')) {
        const c = child.getBoundingClientRect();
        if (c.width > 0 && c.height > 0) right = Math.max(right, c.right);
      }
      const share = (right - r.left) / r.width;
      if (share < 0.7) found.push(`${box.className} ${Math.round(share * 100)}%`);
    }
    return { found, measured: [...measured] };
  });

test(
  "the case bar's stops are named by plate, land clear of it, and mark where the visitor is",
  { annotation: [{ type: 'route', description: CASE }, READ_ONLY], tag },
  async ({ page }) => {
    await load(page, CASE);
    await expect(page.locator('h1')).toHaveCount(1);
    const stops = page.locator('[data-oa-stops] a');
    const names = await stops.allTextContents();
    expect(names.length).toBeGreaterThan(1);
    for (const name of names) {
      expect(name).toMatch(/^(Installation view|Plate \d+, (the|a) \w+|Reflection wall)$/);
    }
    // A plate's stop lands its row below the stuck bar, and the bar marks it.
    const plate = stops.filter({ hasText: /^Plate / }).first();
    expect(await plate.count(), "the fixture's case has a plate").toBeGreaterThan(0);
    await plate.click();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const bar = document.querySelector('.oa-casebar')!.getBoundingClientRect();
          const target = document.getElementById(location.hash.slice(1));
          return target ? Math.round(target.getBoundingClientRect().top - bar.bottom) : -1;
        }),
      )
      .toBeGreaterThanOrEqual(0);
    await expect(plate).toHaveAttribute('aria-current', 'location');
  },
);

for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(
    `no full-width band leaves its far side empty, on home and the case, at ${width}`,
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY], tag },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      for (const route of ['/', CASE]) {
        await load(page, route);
        const { found, measured } = await deadSpace(page);
        // Each kind of band the page has is measured, not the bays alone.
        const kinds =
          route === '/'
            ? ['oa-intro', 'oa-hall__lead', 'oa-whole__main']
            : ['oa-installation', 'oa-case__row', 'oa-backmatter'];
        for (const kind of kinds) expect(measured, `${route}: ${kind} measured`).toContain(kind);
        expect(found, route).toEqual([]);
      }
    },
  );
}

test(
  'at 320 neither page scrolls sideways',
  { annotation: [{ type: 'route', description: CASE }, READ_ONLY], tag },
  async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    for (const route of ['/', CASE]) {
      await load(page, route);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
        route,
      ).toBeLessThanOrEqual(320);
    }
  },
);

for (const width of [1440, 1024]) {
  test(
    `a wall room on either side hangs its work and label on its own wall, inside the window, at ${width} and at 200% text`,
    { annotation: [{ type: 'route', description: '/' }, READ_ONLY], tag },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const text of [1, 2]) {
        await load(page, '/');
        if (text !== 1)
          await page.evaluate(
            (scale) =>
              document.documentElement.style.setProperty(
                'font-size',
                `${scale * 100}%`,
                'important',
              ),
            text,
          );
        const rooms = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('.oa-room--wall')].map((room) => {
            const box = (selector: string) => room.querySelector(selector)!.getBoundingClientRect();
            const [wall, hang, label] = [box('.oa-room__wall'), box('.oa-hang'), box('.oa-label')];
            return {
              room: `${room.id} (${room.dataset.side})`,
              // The hang lies on its wall, and the label ends inside the window.
              hangOnWall: hang.left >= wall.left - 1 && hang.right <= wall.right + 1,
              labelPastWindow: Math.round(label.right - document.documentElement.clientWidth),
              labelWidth: Math.round(label.width),
              labelReads: room.querySelector<HTMLElement>('.oa-label')!.scrollWidth,
            };
          }),
        );
        expect(rooms.map((room) => room.room.replace(/.* /, '')).sort()).toContain('(end)');
        for (const room of rooms) {
          const at = `${room.room} at ${width}, ${text * 100}% text`;
          expect(room.hangOnWall, `${at}: the hang on its wall`).toBe(true);
          expect(room.labelPastWindow, `${at}: the label's end`).toBeLessThanOrEqual(0);
          expect(room.labelReads, `${at}: the label's words`).toBeLessThanOrEqual(
            room.labelWidth + 1,
          );
        }
      }
    },
  );
}

test(
  'on a phone each checklist entry keeps its number in a box as wide as the number reads',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY], tag },
  async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page, '/');
    const numbers = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.oa-checktable tbody .oa-checktable__no')]
        .filter((cell) => cell.checkVisibility())
        .map((cell) => ({
          row: cell.closest('tr')?.id ?? '',
          width: Math.round(cell.getBoundingClientRect().width * 10) / 10,
          reads: cell.scrollWidth,
        })),
    );
    expect(numbers.length).toBeGreaterThanOrEqual(2);
    // The table's 1% shrink-to-fit width is a table cell's; in the phone's grid row it's a sliver.
    // scrollWidth is whole pixels, so a pixel's rounding is allowed.
    for (const number of numbers)
      expect(
        number.width,
        `${number.row}: ${number.width}px for ${number.reads}px`,
      ).toBeGreaterThanOrEqual(number.reads - 1);
  },
);

test(
  'past five windows the running head stays in the window as a plate beside Index',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY], tag },
  async ({ page }) => {
    await load(page, '/');
    const chrome = page.locator('.oa-chrome');
    await expect(chrome).not.toHaveAttribute('data-oa-deep', '');
    const deep = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight * 7);
    test.skip(!deep, 'the fixture is shorter than seven windows');
    // Step down, so a place crosses the band past the fifth window.
    for (let step = 1; step <= 7; step++) {
      await page.evaluate((y) => window.scrollTo(0, y), step * 900);
      await page.waitForTimeout(150);
    }
    await expect(chrome).toHaveAttribute('data-oa-deep', '');
    const here = page.locator('.oa-chrome__here');
    await expect(here).toBeInViewport();
    expect(await here.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(150);
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect(chrome).not.toHaveAttribute('data-oa-deep', '');
  },
);

test(
  'a first load at a place inside a closed fold opens it and lands focus there',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY], tag },
  async ({ page }) => {
    await load(page, '/');
    // A place the whole record holds, closed on the server.
    const id = await page.evaluate(
      () => document.querySelector('details.oa-whole:not([open]) [id]')?.id ?? null,
    );
    expect(id, 'the fixture folds part of its record').not.toBeNull();
    // A real first load at that fragment, in a fresh page.
    const fresh = await page.context().newPage();
    await fresh.goto(`/#${id}`, { waitUntil: 'load' });
    await expect(fresh.locator('.oa-chrome')).toHaveAttribute('data-oa-script', '');
    const place = fresh.locator(`[id="${id}"]`);
    await expect(place).toBeVisible();
    await expect(place).toBeFocused();
    await expect(place).toBeInViewport();
    expect(await place.evaluate((el) => el.closest('details.oa-whole')?.hasAttribute('open'))).toBe(
      true,
    );
    await fresh.close();
  },
);

for (const [route, words] of [
  ['/', '.oa-gallery--record .oa-hall__lead p'],
  [CASE, '.oa-case__text p'],
] as const) {
  test(
    `a click on the words leaves ${route} where it is, and the next Tab doesn't jump`,
    { annotation: [{ type: 'route', description: route }, READ_ONLY], tag },
    async ({ page }) => {
      await load(page, route);
      const text = page.locator(words).first();
      await text.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 40));
      await page.waitForTimeout(300);
      const before = await page.evaluate(() => window.scrollY);
      await text.click();
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => window.scrollY)).toBe(before);
      // The main took no focus from the click, so the keyboard goes on from the words.
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('MAIN');
      // The next Tab goes on from the words, not back to the top: the control after them, in view.
      await page.keyboard.press('Tab');
      await page.waitForTimeout(400);
      const next = await page.evaluate((selector) => {
        const clicked = document.querySelector(selector)!;
        const active = document.activeElement!;
        const r = active.getBoundingClientRect();
        return {
          after: Boolean(
            clicked.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING,
          ),
          top: r.top,
          bottom: r.bottom,
        };
      }, words);
      expect(next.after, 'the Tab after the click goes on from the words').toBe(true);
      expect(next.bottom).toBeGreaterThan(0);
      expect(next.top).toBeLessThan(900);
    },
  );
}

test(
  'the skip link moves focus into the main',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY], tag },
  async ({ page }) => {
    await load(page, '/');
    await page.keyboard.press('Tab');
    const skip = page.locator('[data-ui-slot="skip-link"]');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.closest('main') !== null))
      .toBe(true);
    // The page stays where the jump put it.
    const landed = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.scrollY)).toBe(landed);
    // The hash path too: from further down, going to the main's fragment lands in it again.
    const id = await page.evaluate(() => document.querySelector('main')!.id);
    await page.evaluate(() => window.scrollTo(0, 3000));
    await page.evaluate(() => document.querySelector<HTMLElement>('.oa-chrome__mark')?.focus());
    await page.evaluate(() => {
      window.location.hash = '';
    });
    await page.evaluate((target) => {
      window.location.hash = target;
    }, id);
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('MAIN');
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(3000);
  },
);

test(
  'a fragment that is not valid percent-encoding renders home, not the error screen',
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY], tag },
  async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/#%E0%A4%A', { waitUntil: 'load' });
    await expect(page.locator('.oa-chrome')).toHaveAttribute('data-oa-script', '');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.oa-gallery--record')).toBeVisible();
    expect(errors).toEqual([]);
  },
);
