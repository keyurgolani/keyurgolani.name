import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Aurora Glass P2 in a browser (variants-10 brief §5.2; design gate item 8;
// the P2 approval): the home outline's folds open from a fragment, with
// script and with none, and all open in print; the live Index holds focus
// while it's open (keyboard containment). (The case page's phone order, on
// the sample's case with a cover: aurora-glass-p2-case-phone.spec.ts. Under a thick-ringed language,
// the capsule's band: aurora-glass-ring-*.spec.ts, one language a file, since
// a language is a server of its own.) On the complete fixture, under read-only.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

const siteText = (language?: string) => {
  const text = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass');
  return language ? text.replace(/designLanguage: .*/, `designLanguage: ${language}`) : text;
};
const app = (language?: string) => ({
  portfolio: FIXTURE.files.portfolio,
  siteText: siteText(language),
  sourceFiles: Object.fromEntries(
    FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
  ),
});

test.use({ viewport: { width: 1440, height: 900 }, appOptions: app() });

/** Each fold's section id, whether it's open, and whether its section's body shows. */
const folds = () =>
  [...document.querySelectorAll<HTMLDetailsElement>('details[data-ag-fold]')].map((fold) => {
    const frame = fold.querySelector<HTMLElement>(':scope > [id]')!;
    return {
      id: frame.id,
      open: fold.open,
      shows: frame.checkVisibility() && frame.getBoundingClientRect().height > 0,
    };
  });

/** Where the fold that holds `id` sits against the capsule: its summary's top and the capsule's bottom. */
const landing = (id: string) => {
  const summary = document.getElementById(id)!.closest('details')!.querySelector('summary')!;
  const capsule = document.querySelector('.ag-capsule')!;
  return {
    summaryTop: summary.getBoundingClientRect().top,
    capsuleBottom: capsule.getBoundingClientRect().bottom,
    inView: summary.getBoundingClientRect().bottom <= innerHeight,
  };
};

test(
  'the full record folds closed at the end of its band, each fold one heading in the outline',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const all = await page.evaluate(folds);
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const fold of all) expect(fold, fold.id).toMatchObject({ open: false, shows: false });
    for (const id of ['publications', 'talks', 'patents', 'experience'])
      expect(all.map((fold) => fold.id)).toContain(id);
    // Each summary is a heading (the section in heading navigation) and a count.
    const summary = page.locator('details[data-ag-fold]').filter({ has: page.locator('#talks') });
    await expect(summary.locator('summary h3')).toHaveText(/\S/);
    await expect(summary.locator('summary .ag-fold__count')).toHaveText(/\d/);
  },
);

test(
  'a fragment opens its fold and lands with the summary in view under the capsule',
  { annotation },
  async ({ page }) => {
    await page.goto('/#publications', { waitUntil: 'networkidle' });
    await expect
      .poll(async () => (await page.evaluate(folds)).find((fold) => fold.id === 'publications'))
      .toMatchObject({ open: true, shows: true });
    const where = await page.evaluate(landing, 'publications');
    expect(where.summaryTop).toBeGreaterThanOrEqual(where.capsuleBottom - 1);
    expect(where.inView).toBe(true);
    // An in-page link to another folded section opens that one too.
    await page.evaluate(() => (location.hash = '#talks'));
    await expect
      .poll(async () => (await page.evaluate(folds)).find((fold) => fold.id === 'talks'))
      .toMatchObject({ open: true, shows: true });
  },
);

// A fragment for a record inside a folded section (a case page's close links
// home's records so) lands on the record itself, under the capsule, not on the
// fold's top (the code review's low 3): the fold opens, the record leads the window.
test(
  'a fragment for a record in a fold opens the fold and lands on the record',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // A record well below its fold's top, and a window's height or more clear of the page's end,
    // so the page can scroll it up to the capsule (the delta check's b): the last such record of
    // the fold holding the most, measured with that fold open, then closed again.
    const id = await page.evaluate(() => {
      const folds = [...document.querySelectorAll<HTMLDetailsElement>('details[data-ag-fold]')]
        .map((fold) => ({
          fold,
          records: [
            ...fold
              .querySelector<HTMLElement>(':scope > [id]')!
              .querySelectorAll<HTMLElement>('li[id], article[id]'),
          ],
        }))
        .sort((a, b) => b.records.length - a.records.length);
      for (const { fold, records } of folds) {
        if (records.length < 2) continue;
        fold.open = true;
        const end = document.documentElement.scrollHeight;
        const clear = records
          .slice(1)
          .filter(
            (record) => end - (record.getBoundingClientRect().top + scrollY) > innerHeight + 64,
          );
        fold.open = false;
        if (clear.length > 0) return clear.at(-1)!.id;
      }
      throw new Error('no record in a fold sits clear of the page end');
    });
    await page.goto(`/#${id}`, { waitUntil: 'networkidle' });
    await expect
      .poll(() =>
        page.evaluate((each) => document.getElementById(each)!.closest('details')!.open, id),
      )
      .toBe(true);
    await page.waitForTimeout(300);
    const where = await page.evaluate((each) => {
      const record = document.getElementById(each)!.getBoundingClientRect();
      const capsule = document.querySelector('.ag-capsule')!.getBoundingClientRect();
      return { top: record.top, capsuleBottom: capsule.bottom };
    }, id);
    expect(where.top, id).toBeGreaterThanOrEqual(where.capsuleBottom - 1);
    expect(where.top - where.capsuleBottom, id).toBeLessThan(64);
  },
);

test('print opens every fold, and closes them again after', { annotation }, async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  // The style's own path, where ::details-content exists: print media shows every fold's body.
  await page.emulateMedia({ media: 'print' });
  for (const fold of await page.evaluate(folds)) expect(fold.shows, fold.id).toBe(true);
  await page.emulateMedia({ media: 'screen' });
  for (const fold of await page.evaluate(folds)) expect(fold.shows, fold.id).toBe(false);
  // The enhancement's path, which emulateMedia doesn't reach (it fires no print events):
  // beforeprint opens each closed fold, afterprint closes the ones it opened (low 4).
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  for (const fold of await page.evaluate(folds)) expect(fold.open, fold.id).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  for (const fold of await page.evaluate(folds)) expect(fold.open, fold.id).toBe(false);
});

// On paper the capsule is the page's head with its destinations (lesson 9's print nav): at
// an A4 sheet's width, under 56rem, they still print (the code review's low 7).
// The delta design check (fea7a3110): on a phone the signature sheet hung over the pane's
// primary action. The action is whole on the first screen and nothing lies over it: the
// element at its centre, and at four points inside its pill (half its height in from each
// end, a few pixels in from its top and bottom), is the action itself.
test.describe('home at 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test(
    'the opening’s primary action shows whole on the first screen, under nothing',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const action = page.locator('.ag-id .ag-btn').first();
      await expect(action).toHaveCount(1);
      const where = await action.evaluate((cta) => {
        const box = cta.getBoundingClientRect();
        const end = box.height / 2;
        const inset = 4;
        const points = [
          [box.left + box.width / 2, box.top + box.height / 2],
          [box.left + end, box.top + inset],
          [box.right - end, box.top + inset],
          [box.left + end, box.bottom - inset],
          [box.right - end, box.bottom - inset],
        ];
        return {
          box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right },
          covered: points
            .filter(([x, y]) => {
              const hit = document.elementFromPoint(x!, y!);
              return !hit || !cta.contains(hit);
            })
            .map(
              ([x, y]) =>
                `${Math.round(x!)},${Math.round(y!)}: ${document.elementFromPoint(x!, y!)?.className ?? 'nothing'}`,
            ),
        };
      });
      expect(where.box.top).toBeGreaterThanOrEqual(0);
      expect(where.box.bottom).toBeLessThanOrEqual(844);
      expect(where.box.left).toBeGreaterThanOrEqual(0);
      expect(where.box.right).toBeLessThanOrEqual(390);
      expect(where.covered).toEqual([]);
    },
  );
  // The default recipe's 390 cell: the focused action's ring, its offset and width past the
  // pill, lies clear of the signature sheet below it (223 of 342 of its points showed).
  test(
    'the focused action’s ring lies clear of the signature sheet',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const action = page.locator('.ag-id .ag-btn').first();
      await action.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      const under = await action.evaluate((cta) => {
        const box = cta.getBoundingClientRect();
        const style = getComputedStyle(cta);
        const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth) / 2;
        const y = box.bottom + reach;
        return [box.left + box.height / 2, box.left + box.width / 2, box.right - box.height / 2]
          .map((x) => document.elementFromPoint(x, y))
          .filter((hit) => hit?.closest('.ag-sig'))
          .map((hit) => String(hit!.className));
      });
      expect(under).toEqual([]);
    },
  );
});

test.describe('printed on A4', () => {
  test.use({ viewport: { width: 794, height: 1123 } });
  test('the capsule keeps its destinations on the page', { annotation }, async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.emulateMedia({ media: 'print' });
    const destinations = page.locator('.ag-capsule .ag-capsule__dest');
    await expect(destinations).toBeVisible();
    expect(await destinations.locator('a').count()).toBeGreaterThanOrEqual(3);
    await page.emulateMedia({ media: 'screen' });
    await expect(destinations).toBeHidden();
  });
});

// The default recipe's print cells (the quality inventory): on paper every authored field
// prints, at a desk width and at a phone's: the Index as the page's contents with its heading
// and the section titles, the signature's back-reference, and at 390 the band sub-navs and the
// capsule's destinations, which only the screen cuts.
for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  test.describe(`printed at ${width}`, () => {
    test.use({ viewport: { width, height } });
    test(
      'every authored field prints: the Index, the back-reference, the section titles',
      { annotation },
      async ({ page }) => {
        await page.goto('/', { waitUntil: 'networkidle' });
        await page.emulateMedia({ media: 'print' });
        await expect(page.locator('.ag-index')).toBeVisible();
        await expect(page.locator('.ag-index__title')).toHaveText(/Index/);
        expect(await page.locator('.ag-index__sections a').count()).toBeGreaterThan(5);
        await expect(page.locator('.ag-index__sections a').first()).toBeVisible();
        await expect(page.locator('.ag-backref').first()).toBeVisible();
        await expect(page.locator('.ag-band__nav').first()).toBeVisible();
        await expect(page.locator('.ag-capsule .ag-capsule__dest')).toBeVisible();
        await expect(page.locator('.ag-capsule .ag-capsule__index--plain')).toBeVisible();
        // No control a sheet can't press prints, Pause among them, and nothing casts a shadow.
        await expect(page.locator('.ag-capsule button:visible')).toHaveCount(0);
        const shadows = await page.evaluate(() =>
          ['.ag-capsule', '.ag-id .ag-btn', '.ag-sig']
            .map((selector) => document.querySelector(selector))
            .filter((el): el is Element => el !== null)
            .map((el) => getComputedStyle(el).boxShadow),
        );
        expect(shadows).toEqual(['none', 'none', 'none']);
        // The head fits the sheet (the 390 print cell): it wraps rather than run the name off
        // one edge and the Index off the other, and the link prints its paper word alone.
        const fit = await page.locator('.ag-capsule').evaluate((capsule) => {
          const page = document.documentElement.clientWidth;
          const rect = capsule.getBoundingClientRect();
          const kids = [...capsule.children]
            .map((kid) => kid.getBoundingClientRect())
            .filter((box) => box.width > 0);
          return {
            inside: rect.left >= 0 && rect.right <= page,
            kids: kids.every((box) => box.left >= rect.left - 1 && box.right <= rect.right + 1),
            scroll: document.documentElement.scrollWidth <= page,
          };
        });
        expect(fit).toEqual({ inside: true, kids: true, scroll: true });
        const plain = page.locator('.ag-capsule .ag-capsule__index--plain');
        await expect(plain).toHaveAccessibleName(/^Index$/);
        await expect(plain.locator('.ag-narrow')).toBeHidden();
        await expect(plain.locator('.ag-wide')).toBeVisible();
      },
    );
  });
}

// The default recipe's forced-colors cells: forced colors drop background images, so the
// frosted surfaces would show the sky's photograph through them; the sky goes and every
// surface is opaque, so a ring is drawn on the canvas.
test(
  'under forced colors the sky goes and the frosted surfaces are opaque',
  { annotation },
  async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('.ag-sky')).toBeHidden();
    const fills = await page.evaluate(() =>
      ['.ag-capsule', '.ag-id', '.ag-band__pane .ag-lite', '.ag-call']
        .map((selector) => document.querySelector(selector))
        .filter((el): el is Element => el !== null)
        .map((el) => getComputedStyle(el).backgroundColor),
    );
    expect(fills.length).toBeGreaterThan(1);
    for (const fill of fills) expect(fill).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    // An accent action reads: its words' colour isn't its fill's.
    const action = await page
      .locator('.ag-id .ag-btn')
      .first()
      .evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
    expect(action[0]).not.toBe(action[1]);
  },
);

// The default recipe's reflow cells: at 320 nothing in the capsule or a fold's summary clips
// its own words, and at 1024 with the root text doubled the capsule stays inside the page.
test.describe('reflowed to 320', () => {
  test.use({ viewport: { width: 320, height: 568 } });
  test('the capsule and the folds clip no words', { annotation }, async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.ag-capsule *, .ag-fold__summary *')]
        .filter(
          (el) => el.getClientRects().length > 0 && getComputedStyle(el).position !== 'absolute',
        )
        .filter(
          (el) =>
            el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible',
        )
        .map((el) => `${el.className}: ${el.scrollWidth} in ${el.clientWidth}`),
    );
    expect(clipped).toEqual([]);
  });
  // D's delta check: one name for the button, its word kept on screen beside the name.
  test(
    'the Menu button has one name, Menu, and its word shows',
    { annotation },
    async ({ page }) => {
      await page.goto('/', { waitUntil: 'networkidle' });
      const menu = page.locator('.ag-capsule__index--live');
      await expect(menu).toHaveAccessibleName('Menu');
      await expect(menu.locator('.ag-narrow')).toBeVisible();
      expect(
        await menu.locator('.ag-narrow').evaluate((el) => el.getBoundingClientRect().width),
      ).toBeGreaterThan(10);
    },
  );
});

test.describe('with the root text doubled at 1024', () => {
  test.use({ viewport: { width: 1024, height: 768 } });
  test('the capsule stays inside the page', { annotation }, async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
    const over = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.ag-capsule, .ag-capsule *')]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => el.getBoundingClientRect())
        .filter((box) => box.right > innerWidth + 1)
        .map((box) => Math.round(box.right)),
    );
    expect(over).toEqual([]);
  });
});

test.describe('with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });
  test('a fragment still shows its folded section', { annotation }, async ({ page }) => {
    await page.goto('/#patents', { waitUntil: 'networkidle' });
    const fold = (await page.evaluate(folds)).find((each) => each.id === 'patents');
    expect(fold?.shows).toBe(true);
    await expect(page.locator('[id="patents"]')).toBeInViewport();
    // Chromium opens a fold for its fragment by itself; an engine that doesn't leaves it closed.
    // Closed so, the target still shows, by the :has(:target) rule alone (low 4).
    await page.evaluate(() =>
      document.getElementById('patents')!.closest('details')!.removeAttribute('open'),
    );
    const closed = (await page.evaluate(folds)).find((each) => each.id === 'patents');
    expect(closed).toMatchObject({ open: false, shows: true });
  });
});

test(
  'the open Index holds focus: in on opening, Tab wraps inside, Escape gives it back',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const button = page.locator('.ag-capsule__index--live');
    await button.focus();
    await page.keyboard.press('Enter');
    const index = page.locator('.ag-index');
    await expect.poll(() => index.evaluate((el) => el.matches(':popover-open'))).toBe(true);
    const inside = () => index.evaluate((el) => el.contains(document.activeElement));
    await expect.poll(inside).toBe(true);
    const stops = await index.locator('button:not([hidden]), a[href]').count();
    for (let press = 0; press < stops + 2; press++) {
      await page.keyboard.press('Tab');
      expect(await inside(), `Tab ${press + 1}`).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await inside()).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => index.evaluate((el) => el.matches(':popover-open'))).toBe(false);
    await expect(button).toBeFocused();
  },
);
