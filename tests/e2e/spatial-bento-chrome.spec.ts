import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Spatial Bento's chrome on a phone (#16): the page never scrolls sideways
// at 320, the dock that holds the bottom edge once the overview has gone
// fits the width with every board in reach, and the Menu closes when a
// board or section is chosen from it, leaving the visitor there, focus on
// what they chose, rather than behind a modal still open. On the complete
// fixture, under read-only. The suite's Chromium has no WebGL, so the stage
// stays off and these are the page most phones get.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'spatial-bento'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  hasTouch: true,
  isMobile: true,
});

/** Scrolls the first board below the overview into view, and waits for the dock to show. */
async function showDock(page: Page) {
  await page.evaluate(() => {
    const boards = document.querySelectorAll('section.sb-board');
    const board = boards[Math.min(2, boards.length - 1)]!;
    scrollTo(0, board.getBoundingClientRect().top + scrollY);
  });
  await expect(page.locator('.sb-dock')).toHaveAttribute('data-state', 'shown');
}

for (const width of [320, 390]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test('nothing scrolls sideways', { annotation }, async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    });

    test(
      'the dock fits the width: the works, Contact and the Menu, the name and boards gone',
      { annotation },
      async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' });
        await showDock(page);
        await expect(page.locator('.sb-dock__name')).toBeHidden();
        await expect(page.locator('.sb-dock__boards')).toBeHidden();
        const cells = page.locator('.sb-dock__phone > li > *');
        await expect(cells).toHaveText(['Work', 'Contact', 'Menu']);
        for (const box of await cells.evaluateAll((all) =>
          all
            .map((cell) => cell.getBoundingClientRect())
            .map(({ left, right }) => ({ left, right })),
        )) {
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(width);
        }
      },
    );

    test(
      'from the foot, the dock’s Menu reaches a part of the full record, open',
      { annotation },
      async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' });
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await expect(page.locator('.sb-dock')).toHaveAttribute('data-state', 'shown');
        await page.locator('.sb-dock__phone [data-ui-slot="action"]').click();
        const dialog = page.locator('.sb-menu-slot dialog');
        await expect(dialog).toHaveJSProperty('open', true);
        // A section that sits in the full record, wherever its board is.
        const href = await page.evaluate(() => {
          const ids = new Set(
            [...document.querySelectorAll('details[data-record] > section[id]')].map(
              (part) => part.id,
            ),
          );
          const links = [...document.querySelectorAll<HTMLAnchorElement>('.sb-menu__sections a')];
          return links
            .map((link) => link.getAttribute('href')!)
            .find((ref) => ids.has(ref.slice(1)));
        });
        expect(href).toBeTruthy();
        await dialog.locator(`a[href="${href}"]`).click();
        await expect(dialog).toHaveJSProperty('open', false);
        const target = page.locator(href!);
        await expect(
          page.locator(`details[data-record]:has(> section[id="${href!.slice(1)}"])`),
        ).toHaveJSProperty('open', true);
        await expect(target).toBeInViewport();
      },
    );

    test(
      'a board chosen from the dock\u2019s Menu keeps its start in view, the tallest too',
      { annotation },
      async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' });
        await showDock(page);
        // The tallest board the Menu names: taller than the window above the dock.
        const href = await page.evaluate(() => {
          let best = '';
          let most = 0;
          for (const link of document.querySelectorAll<HTMLAnchorElement>('a.sb-menu__board')) {
            const ref = link.getAttribute('href')!;
            const height =
              document.getElementById(decodeURIComponent(ref.slice(1)))?.getBoundingClientRect()
                .height ?? 0;
            if (height > most) [best, most] = [ref, height];
          }
          return best;
        });
        expect(href).toBeTruthy();
        await page.locator('.sb-dock__phone [data-ui-slot="action"]').click();
        const dialog = page.locator('.sb-menu-slot dialog');
        await expect(dialog).toHaveJSProperty('open', true);
        await dialog.locator(`a[href="${href}"]`).click();
        await expect(dialog).toHaveJSProperty('open', false);
        await expect(page.locator(href)).toBeFocused();
        const seen = await page.evaluate((ref) => {
          const box = document
            .getElementById(decodeURIComponent(ref.slice(1)))!
            .getBoundingClientRect();
          return { top: box.top, height: box.height, window: innerHeight };
        }, href);
        expect(seen.height, JSON.stringify(seen)).toBeGreaterThan(seen.window);
        // Its start, its heading, is on screen, not scrolled past.
        expect(seen.top, JSON.stringify(seen)).toBeGreaterThanOrEqual(-1);
        expect(seen.top, JSON.stringify(seen)).toBeLessThan(seen.window);
      },
    );

    test(
      'a short stop that takes focus under the dock is lifted clear of it',
      { annotation },
      async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' });
        await showDock(page);
        // A link already in view, its foot under the dock's top.
        const path = await page.evaluate(() => {
          const dock = document.querySelector('.sb-dock')!.getBoundingClientRect();
          const link = [
            ...document.querySelectorAll<HTMLAnchorElement>('main section.sb-board a[href]'),
          ].find((each) => {
            const box = each.getBoundingClientRect();
            return box.height > 0 && box.height < dock.height && box.top > innerHeight;
          })!;
          link.dataset.sbProbe = '';
          scrollBy(0, link.getBoundingClientRect().bottom - dock.top - dock.height / 2);
          return '[data-sb-probe]';
        });
        const link = page.locator(path);
        const before = await page.evaluate(() => {
          const dock = document.querySelector('.sb-dock')!.getBoundingClientRect();
          const box = document.querySelector('[data-sb-probe]')!.getBoundingClientRect();
          return { bottom: box.bottom, dockTop: dock.top, window: innerHeight };
        });
        expect(before.bottom).toBeGreaterThan(before.dockTop);
        expect(before.bottom).toBeLessThanOrEqual(before.window);
        await expect(page.locator('.sb-dock')).toHaveAttribute('data-state', 'shown');
        await link.focus();
        const after = await page.evaluate(() => {
          const dock = document.querySelector('.sb-dock')!.getBoundingClientRect();
          const box = document.querySelector('[data-sb-probe]')!.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, dockTop: dock.top };
        });
        expect(after.bottom, JSON.stringify(after)).toBeLessThanOrEqual(after.dockTop);
        expect(after.top, JSON.stringify(after)).toBeGreaterThanOrEqual(0);
      },
    );

    test(
      'a section chosen from the Menu closes it and takes the visitor there',
      { annotation },
      async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' });
        const menu = page.locator('.sb-menu-slot [data-ui-slot="action"]').first();
        expect((await menu.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await menu.click();
        const dialog = page.locator('.sb-menu-slot dialog');
        await expect(dialog).toHaveJSProperty('open', true);
        // Close is the first thing in it a thumb can reach.
        await expect(dialog.locator('a:visible, button:visible').first()).toHaveText('Close');
        const link = dialog.locator('.sb-menu__sections a').first();
        const href = (await link.getAttribute('href'))!;
        await link.click();
        await expect(dialog).toHaveJSProperty('open', false);
        expect(new URL(page.url()).hash).toBe(href);
        const target = page.locator(href);
        await expect(target).toBeFocused();
        await expect(target).toBeInViewport();
      },
    );
  });
}

// M3: from 1024 up the overview's DOM is the phone's (the hero, then Selected
// work), while its rows set Contents beside the hero and the works under it.
// reading-flow makes Tab follow the rows.
for (const width of [1440, 1100, 800]) {
  test.describe(`the field at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 }, isMobile: false, hasTouch: false });

    test(
      'Tab follows its rows: the hero, Contents, then the works',
      { annotation },
      async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' });
        const seen: string[] = [];
        // Every stop until focus leaves the overview for the first board.
        for (let press = 0; press < 80; press += 1) {
          await page.keyboard.press('Tab');
          const area = await page.evaluate(() => {
            const at = document.activeElement;
            if (at?.closest('section.sb-board')) return 'boards';
            return at?.closest('[data-area]')?.getAttribute('data-area') ?? 'other';
          });
          if (area === 'boards') break;
          if (seen.at(-1) !== area) seen.push(area);
        }
        const order = seen.filter((area) => area !== 'other');
        expect(order.indexOf('contents')).toBeGreaterThan(order.indexOf('hero'));
        expect(order).toContain('lead');
        expect(order.indexOf('lead')).toBeGreaterThan(order.indexOf('contents'));
        expect(order.lastIndexOf('reach')).toBeGreaterThan(order.indexOf('lead'));
      },
    );
  });
}

// Design gate 8: home keeps the full record behind closed native disclosures
// in the Record board's one archive tile. Each opens from a fragment link,
// prints open, and works with no script.
test.describe('the full record', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

  /** The first archived section's id. */
  const firstPart = (page: Page) =>
    page.locator('details[data-record] > section[data-section-id]').first().getAttribute('id');
  const openCount = (page: Page) =>
    page
      .locator('details[data-record]')
      .evaluateAll((all) => all.filter((fold) => (fold as HTMLDetailsElement).open).length);

  test('every part is closed on arrival', { annotation }, async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    expect(await page.locator('details[data-record]').count()).toBeGreaterThan(0);
    expect(await openCount(page)).toBe(0);
  });

  test(
    'a fragment link opens the part that holds its section',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const id = (await firstPart(page))!;
      await page.goto(`/#${id}`, { waitUntil: 'networkidle' });
      const fold = page.locator(`details[data-record]:has(> section[id="${id}"])`);
      await expect(fold).toHaveJSProperty('open', true);
      await expect(page.locator(`[id="${id}"]`)).toBeInViewport();
    },
  );

  test('it prints open', { annotation }, async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => dispatchEvent(new Event('beforeprint')));
    const shut = await page
      .locator('details[data-record] > section[data-section-id]')
      .evaluateAll(
        (parts) => parts.filter((part) => part.getBoundingClientRect().height === 0).length,
      );
    expect(shut).toBe(0);
    await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({ media: 'screen' });
    expect(await openCount(page)).toBe(0);
  });

  test.describe('with no script', () => {
    test.use({ javaScriptEnabled: false });

    test('a summary opens and closes its part', { annotation }, async ({ page }) => {
      await page.goto('/', { waitUntil: 'load' });
      const fold = page.locator('details[data-record]').first();
      await expect(fold).toHaveJSProperty('open', false);
      await fold.locator('> summary').click();
      await expect(fold).toHaveJSProperty('open', true);
      await expect(fold.locator('> section')).toBeVisible();
      await fold.locator('> summary').click();
      await expect(fold).toHaveJSProperty('open', false);
    });

    test('a fragment link still lands on its part', { annotation }, async ({ page }) => {
      await page.goto('/', { waitUntil: 'load' });
      const id = (await firstPart(page))!;
      await page.goto(`/#${id}`, { waitUntil: 'load' });
      await expect(
        page.locator(`details[data-record]:has(> section[id="${id}"])`),
      ).toHaveJSProperty('open', true);
    });
  });
});

// The code review's F1 and F2: a malformed fragment is no target, never a
// crash; the case page's focus contract (the h1 on arrival from the field,
// not at a part's hash; Escape and the way back land on the tile's link);
// a fragment opens only its own fold; and nothing animates under reduce.
test.describe('the field and its case pages, by keyboard and fragment', () => {
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

  /** Opens the first case page from its tile on the field; its path. */
  async function openCase(page: Page) {
    await page.goto('/', { waitUntil: 'networkidle' });
    const link = page.locator('.sb-overview a[href*="/work/"]').first();
    const href = (await link.getAttribute('href'))!;
    await link.click();
    await page.waitForURL(/\/work\//);
    await page.waitForLoadState('networkidle');
    return new URL(href, page.url()).pathname;
  }

  /** The path the focused link goes to. */
  const focusedPath = (page: Page) =>
    page.evaluate(() => {
      const href = (document.activeElement as HTMLAnchorElement | null)?.href ?? '';
      return href === '' ? '' : new URL(href).pathname;
    });

  for (const hash of ['%', '%E0%A4%A', '100%']) {
    test(
      `home at the malformed fragment #${hash} still renders the field`,
      { annotation },
      async ({ page }) => {
        await page.goto(`/#${hash}`, { waitUntil: 'networkidle' });
        await expect(page.locator('section.sb-board').first()).toBeVisible();
        await expect(page.getByText('Something went wrong')).toHaveCount(0);
      },
    );
  }

  test(
    'opened from its tile, a case page has focus on its h1',
    { annotation },
    async ({ page }) => {
      await openCase(page);
      await expect(page.locator('h1')).toBeFocused();
    },
  );

  test(
    'opened at one of its parts, it keeps that place: the h1 isn\u2019t focused',
    { annotation },
    async ({ page }) => {
      const path = await openCase(page);
      const part = (await page.locator('.sb-sheet [id]').nth(1).getAttribute('id'))!;
      // A fresh document, opened from the field by a link, so its referrer is this site.
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate((href) => {
        const link = document.createElement('a');
        link.href = href;
        link.id = 'sb-e2e-part';
        link.textContent = 'part';
        document.body.append(link);
      }, `${path}#${part}`);
      // Every focus() the case page calls, by tag: the check rests on the page never focusing
      // its h1 here, not on the order the browser's fragment scroll and hydration run in (R1).
      await page.addInitScript(() => {
        const focused: string[] = [];
        Object.assign(window, { sbFocused: focused });
        const focus = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
          focused.push(this.tagName.toLowerCase());
          return focus.call(this, options);
        };
      });
      await page.locator('#sb-e2e-part').click();
      await page.waitForURL((url) => url.pathname === path);
      await page.waitForLoadState('networkidle');
      // Hydrated: React holds the h1, so the case page's focus effect has had its turn.
      await expect
        .poll(() =>
          page.evaluate(() =>
            Object.keys(document.querySelector('h1')!).some((key) => key.startsWith('__react')),
          ),
        )
        .toBe(true);
      expect(await page.evaluate(() => document.referrer)).not.toBe('');
      expect(new URL(page.url()).hash).toBe(`#${part}`);
      await expect(page.locator(`[id="${part}"]`)).toBeInViewport();
      await expect(page.locator('h1')).not.toBeFocused();
      expect(
        await page.evaluate(() => (window as unknown as { sbFocused: string[] }).sbFocused),
      ).not.toContain('h1');
    },
  );

  test(
    'loaded straight, from outside the site, the case page keeps the browser\u2019s start: no ring on the h1',
    { annotation },
    async ({ page }) => {
      const path = await openCase(page);
      const fresh = await page.context().newPage();
      await fresh.goto(path, { waitUntil: 'networkidle' });
      expect(await fresh.evaluate(() => document.referrer)).toBe('');
      await expect(fresh.locator('h1')).toHaveCount(1);
      await expect(fresh.locator('h1')).not.toBeFocused();
      await fresh.close();
    },
  );

  test(
    'Escape closes the sheet onto the tile\u2019s link to it',
    { annotation },
    async ({ page }) => {
      const path = await openCase(page);
      await page.keyboard.press('Escape');
      await page.waitForURL((url) => !url.pathname.startsWith('/work/'));
      await page.waitForLoadState('networkidle');
      await expect.poll(() => focusedPath(page)).toBe(path);
    },
  );

  // RC1 row 92: the hint's words are true only once the sheet listens, so the server sends none
  // of them, and the live page, with a keyboard's fine pointer, shows them marked script-only.
  test(
    'listening, under a fine pointer, the sheet shows its Escape hint, which the server never sent',
    { annotation },
    async ({ page }) => {
      const path = await openCase(page);
      const served = await (await page.request.get(new URL(path, page.url()).href)).text();
      expect(served).toContain('sb-case__back');
      expect(served).not.toContain('sb-case__esc');
      expect(served).not.toContain('Press <kbd>Esc');
      expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true);
      const hint = page.locator('.sb-case__nav p.sb-case__esc');
      await expect(hint).toBeVisible();
      await expect(hint).toHaveText('Press Esc to close. The field keeps your place.');
      await expect(hint).toHaveAttribute('data-script-only', '');
      await expect(hint.locator('kbd')).toHaveText('Esc');
      // It names the control that does the same without a script: Back to the field.
      const back = await hint.getAttribute('data-key-hint-for');
      expect(back).toBeTruthy();
      expect(
        await page.evaluate(
          (id) => document.getElementById(id)?.matches('a.sb-case__back[href]') ?? false,
          back!,
        ),
      ).toBe(true);
      // One element holds that id, live and as served.
      expect(
        await page.evaluate((id) => document.querySelectorAll(`[id="${id}"]`).length, back!),
      ).toBe(1);
      expect(served.split(` id="${back}"`).length - 1).toBe(1);
      await expect(page.locator('.sb-case__back')).toBeVisible();
    },
  );

  test(
    'Back to the field lands on the tile\u2019s link to the sheet',
    { annotation },
    async ({ page }) => {
      const path = await openCase(page);
      await page.locator('.sb-case__back').click();
      await page.waitForURL((url) => !url.pathname.startsWith('/work/'));
      await page.waitForLoadState('networkidle');
      await expect.poll(() => focusedPath(page)).toBe(path);
    },
  );

  test(
    'a fragment opens its own fold of the full record and no other',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const ids = await page
        .locator('details[data-record] > section[data-section-id]')
        .evaluateAll((all) => all.map((each) => each.id));
      expect(ids.length).toBeGreaterThan(1);
      await page.goto(`/#${ids[1]}`, { waitUntil: 'networkidle' });
      const open = await page
        .locator('details[data-record]')
        .evaluateAll((all) =>
          all
            .filter((fold) => (fold as HTMLDetailsElement).open)
            .map((fold) => fold.querySelector('section')?.id),
        );
      expect(open).toEqual([ids[1]]);
    },
  );

  /**
   * Pins the document timeline's reading, as the settle sees it at hydration,
   * and counts the reads: the settle reads it in every case before it decides,
   * so a read is the witness that it ran (R2).
   */
  const pinTimeline = (page: Page, at: number) =>
    page.addInitScript((ms) => {
      const reads = { count: 0 };
      Object.assign(window, { sbTimelineReads: reads });
      Object.defineProperty(DocumentTimeline.prototype, 'currentTime', {
        get: () => {
          reads.count += 1;
          return ms;
        },
      });
    }, at);

  /**
   * The load's animations: every Element.animate() call the page makes on a
   * tile of the overview's band, with its duration, however short, and the
   * most running at once at any frame. The page samples itself on each frame
   * for the first 1.6 s: a sample taken from outside, at commit, forces a
   * style pass before the head's stylesheets load, which starts the kit
   * controls' 100 ms color transitions no visitor's frame ever shows.
   */
  async function animationsThroughLoad(page: Page) {
    await page.addInitScript(() => {
      const calls: number[] = [];
      const seen = { most: 0 };
      // Every aria-busy the overview sets or clears, in order.
      const busy: (string | null)[] = [];
      Object.assign(window, { sbSettleCalls: calls, sbAnimations: seen, sbBusy: busy });
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.target instanceof Element && record.target.matches('.sb-overview')) {
            busy.push(record.target.getAttribute('aria-busy'));
          }
        }
      }).observe(document, { attributes: true, subtree: true, attributeFilter: ['aria-busy'] });
      const start = performance.now();
      const sample = () => {
        seen.most = Math.max(seen.most, document.getAnimations().length);
        if (performance.now() - start < 1600) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (
        this: Element,
        ...args: Parameters<Element['animate']>
      ) {
        const options = args[1];
        if (this.closest('.sb-band')) {
          calls.push(typeof options === 'number' ? options : Number(options?.duration));
        }
        return animate.apply(this, args);
      };
    });
    await page.goto('/', { waitUntil: 'commit' });
    await page.waitForTimeout(1600);
    await page.waitForLoadState('networkidle');
    // The settle has read the timeline, so it ran and decided before the calls are read.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { sbTimelineReads?: { count: number } }).sbTimelineReads?.count ??
            0,
        ),
      )
      .toBeGreaterThan(0);
    // Nothing is still busy once the settle is over (or never ran).
    await expect
      .poll(() => page.evaluate(() => document.querySelectorAll('[aria-busy="true"]').length))
      .toBe(0);
    const { calls, most, busy } = await page.evaluate(() => {
      const seen = window as unknown as {
        sbSettleCalls: number[];
        sbAnimations: { most: number };
        sbBusy: (string | null)[];
      };
      return { calls: seen.sbSettleCalls, most: seen.sbAnimations.most, busy: seen.sbBusy };
    });
    return { most, calls, busy };
  }

  test.describe('under the system\u2019s reduced motion', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });

    test(
      'nothing animates through the load: the settle never starts',
      { annotation },
      async ({ page }) => {
        await pinTimeline(page, 0);
        const { most, calls, busy } = await animationsThroughLoad(page);
        expect(calls).toEqual([]);
        expect(most).toBe(0);
        // Nothing settles, so the field never says it's busy.
        expect(busy).toEqual([]);
      },
    );
  });

  test.describe('where motion is welcome', () => {
    test.use({ contextOptions: { reducedMotion: 'no-preference' } });

    test(
      'the settle plays on an early hydration, each tile for the scene slot\u2019s length',
      { annotation },
      async ({ page }) => {
        await pinTimeline(page, 0);
        const { calls, busy } = await animationsThroughLoad(page);
        expect(calls.length).toBeGreaterThan(0);
        // The field is busy while its tiles rise, then clears once they've landed.
        expect(busy).toEqual(['true', null]);
        const scene = await page.evaluate(() => {
          const probe = document.createElement('span');
          probe.style.transitionDuration = 'var(--motion-scene)';
          document.querySelector("[data-variant='spatial-bento']")!.append(probe);
          const value = getComputedStyle(probe).transitionDuration.split(',')[0]!.trim();
          probe.remove();
          return value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
        });
        expect(scene).toBeGreaterThan(0);
        expect([...new Set(calls)]).toEqual([scene]);
      },
    );

    test(
      'a late hydration doesn\u2019t settle a field already on screen',
      { annotation },
      async ({ page }) => {
        await pinTimeline(page, 10_000);
        expect((await animationsThroughLoad(page)).calls).toEqual([]);
      },
    );
  });
});
