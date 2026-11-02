import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { axeFor } from '../quality/lib/axe';
import { expect, test } from '../harness/fixtures';

// Swiss Signal's home (variants-10 brief §5.1) on the bundled sample, on its
// own packs: the Index sheet opens and closes by Escape, an outside click, a
// link, and Shift+Tab out, with motion and under reduced motion; the narrow
// part marker follows the reader under reduced motion (S6); with no
// JavaScript the Index is a plain link to a contents list and nothing is left
// open over a section; print keeps the table rules; the tables pass axe; and
// at 390 stars and forks keep cells of their own (SS-M3).

const REPO = new URL('../../', import.meta.url);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const tag = '@interaction';

/** The bundled sample as an owner's own: read-only refuses the sample's name, title, and share image. */
function ownedSample(): string {
  const sample = readFileSync(fileURLToPath(new URL('portfolio.example.yml', REPO)), 'utf8');
  const owned = sample
    .replace('\n  name: Anamika Devi\n', '\n  name: Rowan Swiss\n')
    .replace(/\n {2}title: Anamika Devi[^\n]*\n/, '\n  title: Rowan Swiss, portfolio\n')
    .replace('\n  ogImage:\n    asset: og-image\n', '\n');
  if (/\n {2}name: Anamika Devi\n|\n {2}title: Anamika Devi|\n {2}ogImage:/.test(owned)) {
    throw new Error("The sample's identity moved: update ownedSample().");
  }
  return owned;
}

/** The example site, selecting Swiss Signal on its own packs. */
function swissSite(): string {
  const site = readFileSync(fileURLToPath(new URL('site.example.yml', REPO)), 'utf8');
  const selected = site
    .replace('\n  variant: editorial-evidence\n', '\n  variant: swiss-signal\n')
    .replace('\n  designLanguage: platform-neutral\n', '\n  designLanguage: international-grid\n')
    .replace('\n  colorScheme: warm-parchment\n', '\n  colorScheme: signal-paper\n')
    .replace('\n  typography: humanist-ui\n', '\n  typography: swiss-grotesque\n');
  if (!selected.includes('\n  variant: swiss-signal\n') || !selected.includes('swiss-grotesque')) {
    throw new Error("The example site's appearance moved: update swissSite().");
  }
  return selected;
}

test.use({
  appOptions: {
    portfolio: null,
    siteText: swissSite(),
    sourceFiles: {
      'portfolio.yml': ownedSample(),
      'snapshots/github.json': readFileSync(new URL('snapshots/github.json', REPO), 'utf8'),
    },
  },
  viewport: { width: 1440, height: 900 },
});

const SHEET = '#ss--index';
const isOpen = (page: Page) =>
  page.locator(SHEET).evaluate((sheet) => sheet.matches(':popover-open'));

async function load(page: Page) {
  await page.goto('/');
  await expect(page.locator('[data-variant]')).toHaveAttribute('data-variant', 'swiss-signal');
}

/** The page once the Position controller has run: the Index is its popover's button. */
async function loadLive(page: Page) {
  await load(page);
  await expect(page.locator('.ss')).toHaveAttribute('data-ss-live', '');
}

/** The Index, open, its button saying so. */
async function openIndex(page: Page) {
  const button = page.getByRole('button', { name: 'Index' });
  await button.click();
  await expect.poll(() => isOpen(page)).toBe(true);
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(button).toHaveAttribute('data-open', '');
}

async function closesEveryWay(page: Page) {
  const button = page.getByRole('button', { name: 'Index' });

  // Escape: closed, and focus back on the button.
  await openIndex(page);
  await page.keyboard.press('Escape');
  await expect.poll(() => isOpen(page)).toBe(false);
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(button).not.toHaveAttribute('data-open', '');

  // An outside click: on the masthead's location cell, which the sheet never covers.
  await openIndex(page);
  await page.locator('.ss-masthead__cell').click();
  await expect.poll(() => isOpen(page)).toBe(false);

  // A link in the sheet: closed, and the section is where the URL says.
  await openIndex(page);
  const link = page.locator(`${SHEET} .ss-index__part a`).first();
  const hash = (await link.getAttribute('href'))!.replace(/^[^#]*/, '');
  await link.click();
  await expect.poll(() => isOpen(page)).toBe(false);
  expect(new URL(page.url()).hash).toBe(hash);

  // Shift+Tab off the button: focus leaves the sheet and its button, so it closes.
  await page.evaluate(() => window.scrollTo(0, 0));
  await openIndex(page);
  await button.focus();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => isOpen(page)).toBe(false);

  // Tab past the sheet's last link: focus leaves it, so it closes, and focus goes back to its button.
  await page.evaluate(() => window.scrollTo(0, 0));
  await openIndex(page);
  await page.locator(`${SHEET} :is(a, button):visible`).last().focus();
  await expect.poll(() => isOpen(page)).toBe(true);
  await page.keyboard.press('Tab');
  await expect.poll(() => isOpen(page)).toBe(false);
  await expect(button).toBeFocused();

  // Focus going to the browser's own chrome: a blur with nowhere to go closes it.
  await openIndex(page);
  await page.locator(`${SHEET} a`).first().focus();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect.poll(() => isOpen(page)).toBe(false);
}

test(
  "opening the Index from the keyboard moves focus into its sheet, to its first link, and Escape gives it back to the button (the overlay's containment)",
  { annotation, tag },
  async ({ page }) => {
    await loadLive(page);
    const button = page.getByRole('button', { name: 'Index' });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => isOpen(page)).toBe(true);
    await expect(page.locator(`${SHEET} a[href]`).first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect
      .poll(() =>
        page.evaluate(
          (sel) => !!document.querySelector(sel)?.contains(document.activeElement),
          SHEET,
        ),
      )
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => isOpen(page)).toBe(false);
    await expect(button).toBeFocused();
  },
);

test(
  'the Index closes by Escape, an outside click, a link, Shift+Tab out, Tab past its end, and a blur',
  { annotation, tag },
  async ({ page }) => {
    await loadLive(page);
    // Motion allowed: the runtime is active on the page's root.
    await expect(page.locator('.ss')).toHaveAttribute('data-kit-runtime', 'active');
    await closesEveryWay(page);
  },
);

test(
  'printing opens every disclosure, and closes them after',
  { annotation, tag },
  async ({ page }) => {
    await loadLive(page);
    const closed = page.locator('.ss details:not([open])');
    const before = await closed.count();
    expect(before).toBeGreaterThan(0);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await expect(closed).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(closed).toHaveCount(before);
  },
);

test.describe('under reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test(
    'the Index closes every way, and the narrow marker names the part being read (S4, S6)',
    { annotation, tag },
    async ({ page }) => {
      await loadLive(page);
      // The runtime holds the root static: never active, so the settle never runs,
      // while the behaviour is live (data-ss-live) all the same.
      const root = page.locator('.ss');
      await expect(root).toHaveAttribute('data-activity', 'paused');
      await expect(root).not.toHaveAttribute('data-kit-runtime', /.*/);
      await closesEveryWay(page);
      const parts = page.locator('.ss-part[data-part]');
      const total = await parts.count();
      expect(total).toBeGreaterThan(1);
      // On the desktop too, beside the name (design review P0 N2), then on a phone.
      for (const [width, height, nth] of [
        [1440, 900, 2],
        [390, 844, 1],
      ] as const) {
        await page.setViewportSize({ width, height });
        const part = parts.nth(nth);
        await part.evaluate((each) => each.scrollIntoView({ block: 'start', behavior: 'instant' }));
        const position = await part.getAttribute('data-position');
        await expect(page.locator('#ss--where')).toHaveText(`(Part ${position} of ${total})`);
        await expect(page.locator('#ss--where')).toBeVisible();
      }
    },
  );
});

test.describe('with no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'the Index is a link to a contents list, and following a section leaves nothing open over it',
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      await expect(page.getByRole('button', { name: 'Index' })).toBeHidden();
      const index = page.locator('.ss-index__link');
      await expect(index).toBeVisible();
      await index.click();
      await expect(page.locator(SHEET)).toBeInViewport();
      const link = page.locator(`${SHEET} .ss-index__list a`).nth(2);
      const id = (await link.getAttribute('href'))!.replace(/^[^#]*#/, '');
      await link.click();
      const target = page.locator(`[id="${id}"]`);
      await expect(target).toBeInViewport();
      // The sticky masthead doesn't cover where it landed, and no sheet sits over it.
      const covered = await target.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + 8, Math.max(box.top, 0) + 8);
        return top?.closest('.ss-index__sheet, .ss-masthead') !== null;
      });
      expect(covered).toBe(false);
    },
  );
});

test(
  'print keeps the table rules as borders on paper',
  { annotation, tag },
  async ({ page }, testInfo) => {
    await loadLive(page);
    await page.emulateMedia({ media: 'print' });
    const rules = await page
      .locator('.ss-table')
      .first()
      .evaluate((table) => {
        const cell = table.querySelector('tbody td')!;
        const head = table.querySelector('thead th')!;
        const of = (element: Element) => {
          const style = getComputedStyle(element);
          return { style: style.borderBlockEndStyle, width: parseFloat(style.borderBlockEndWidth) };
        };
        return { cell: of(cell), head: of(head) };
      });
    expect(rules.cell.style).toBe('solid');
    expect(rules.cell.width).toBeGreaterThan(0);
    expect(rules.head.style).toBe('solid');
    expect(rules.head.width).toBeGreaterThan(rules.cell.width - 0.01);
    // At an A4 page's content width (210 mm less the default margins, 718 px),
    // no table outgrows its page: its addresses break at their separators.
    await page.setViewportSize({ width: 718, height: 1000 });
    const wide = await page.locator('.ss-table').evaluateAll((tables) =>
      tables
        .filter((table) => table.getClientRects().length > 0)
        .map((table) => ({
          caption: table.querySelector('caption')?.textContent?.trim() ?? '?',
          over: table.scrollWidth - (table.parentElement?.clientWidth ?? 718),
          right: Math.round(table.getBoundingClientRect().right),
        }))
        .filter((table) => table.over > 1 || table.right > 718),
    );
    expect(wide).toEqual([]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await testInfo.attach('swiss-print-1440', {
      body: await page.pdf({ format: 'A4', printBackground: false }),
      contentType: 'application/pdf',
    });
  },
);

test('the tables pass axe', { annotation, tag }, async ({ page }) => {
  await load(page);
  const tables = await page.locator('.ss-table').count();
  expect(tables).toBeGreaterThan(3);
  const results = await axeFor(page).include('.ss-table').analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('stars and forks keep cells of their own (SS-M3)', { annotation, tag }, async ({ page }) => {
    await page.goto('/#on-github');
    await expect(page.locator('.ss')).toHaveAttribute('data-ss-live', '');
    await expect(page.locator('details[data-ss-fold]:has(#on-github)')).toHaveAttribute('open', '');
    const table = page.locator('table.ss-table', { has: page.locator('th', { hasText: 'Forks' }) });
    await table.scrollIntoViewIfNeeded();
    const boxes = await table.evaluate((element) => {
      const columns = [...element.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
      const stars = columns.indexOf('Stars');
      const forks = columns.indexOf('Forks');
      return [...element.querySelectorAll('tr')].map((row) => {
        const cells = row.querySelectorAll('th, td');
        const a = cells[stars]!.getBoundingClientRect();
        const b = cells[forks]!.getBoundingClientRect();
        const ink = (cell: Element) => {
          const range = document.createRange();
          range.selectNodeContents(cell);
          const r = range.getBoundingClientRect();
          return { left: r.left, right: r.right };
        };
        return {
          cellsApart: a.right <= b.left + 0.5 || b.right <= a.left + 0.5,
          inkApart: ink(cells[stars]!).right <= ink(cells[forks]!).left + 0.5,
          widths: [a.width, b.width],
        };
      });
    });
    expect(boxes.length).toBeGreaterThan(1);
    for (const row of boxes) {
      expect(row.cellsApart).toBe(true);
      expect(row.inkApart).toBe(true);
      expect(Math.min(...row.widths)).toBeGreaterThan(0);
    }
  });
});

// The home outline (design gate item 8): the full record folds behind closed native disclosures.
const FOLDED = 'publications';
const foldOf = (page: Page, id: string) => page.locator(`details[data-ss-fold]:has([id="${id}"])`);

/** Where a fold's summary sits against the sticky masthead: below it, and on screen. */
const landing = (page: Page, id: string) =>
  foldOf(page, id).evaluate((fold) => {
    const summary = fold.querySelector(':scope > summary')!.getBoundingClientRect();
    const masthead = document.querySelector('.ss-masthead')!.getBoundingClientRect();
    return {
      open: (fold as HTMLDetailsElement).open,
      below: summary.top >= masthead.bottom - 0.5,
      onScreen: summary.bottom <= window.innerHeight,
    };
  });

/** Where the next Tab goes from where the page landed: into the fold, or on past it, never back. */
async function tabsOnFrom(page: Page, id: string) {
  await page.keyboard.press('Tab');
  return foldOf(page, id).evaluate((fold) => {
    const active = document.activeElement;
    if (!active || active === document.body) return false;
    return (
      fold.contains(active) ||
      Boolean(fold.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  });
}

test(
  'a fragment link opens the fold that holds its section',
  { annotation, tag },
  async ({ page }) => {
    await loadLive(page);
    const fold = foldOf(page, FOLDED);
    await expect(fold).not.toHaveAttribute('open', '');
    // Closed, the fold's name is a heading all the same, and its summary reads as
    // "Publications, 2 papers", the first item left to the content (review 5).
    await expect(page.getByRole('heading', { level: 3, name: 'Publications' })).toBeVisible();
    // The heading is a block, so the name computation puts a space before the comma.
    await expect(fold.locator(':scope > summary')).toHaveAccessibleName(
      /^Publications ?, 2 papers$/,
    );
    // From the Index: the sheet's row for the section opens its fold and lands on it.
    await openIndex(page);
    await page.locator(`${SHEET} .ss-index__list a[href$="#${FOLDED}"]`).click();
    await expect(fold).toHaveAttribute('open', '');
    await expect(page.locator(`[id="${FOLDED}"]`)).toBeInViewport();
    await expect.poll(() => landing(page, FOLDED)).toMatchObject({ below: true, onScreen: true });
  },
);

test(
  "arriving on a fragment, in a fresh page, lands with the fold's summary below the masthead and focus inside",
  { annotation, tag },
  async ({ context }) => {
    // A real arrival, not a same-document navigation. Chromium opens the fold
    // itself and scrolls to the target, which leaves the summary under the
    // masthead: only Position's reveal brings the summary into view. The next
    // Tab goes on from the opened section, never back to the top.
    for (const [hash, fold] of [
      [FOLDED, FOLDED],
      ['probabilistic-model-checking-of-eventually-consistent-stores', FOLDED],
      ['looking', 'looking'],
    ] as const) {
      const fresh = await context.newPage();
      await fresh.goto(`/#${hash}`);
      await expect(fresh.locator('.ss')).toHaveAttribute('data-ss-live', '');
      await expect
        .poll(() => landing(fresh, fold))
        .toEqual({ open: true, below: true, onScreen: true });
      expect(await tabsOnFrom(fresh, fold)).toBe(true);
      await fresh.close();
    }
  },
);

/**
 * Arrive on a section inside a fold, then close the fold by its summary: it
 * closes, its content leaves the screen, and it stays closed (no rule or
 * script holds it open for its :target). Finding 2 of the confirmation review.
 */
async function closesAfterArrival(page: Page) {
  await page.goto('/#patents');
  const fold = foldOf(page, 'patents');
  await expect(fold).toHaveAttribute('open', '');
  await fold.locator(':scope > summary').click();
  const state = () =>
    fold.evaluate((details) => ({
      open: (details as HTMLDetailsElement).open,
      shown: [...details.children]
        .filter((child) => child.tagName !== 'SUMMARY')
        .some((child) => child.checkVisibility()),
    }));
  await expect.poll(state).toEqual({ open: false, shown: false });
  await page.waitForTimeout(600);
  expect(await state()).toEqual({ open: false, shown: false });
}

/** Scroll a page by wheel and wait for it to settle; its resting scrollY. */
async function scrollBy(page: Page, dy: number): Promise<number> {
  await page.mouse.wheel(0, dy);
  let last = -1;
  await expect
    .poll(async () => {
      const y = await page.evaluate(() => Math.round(window.scrollY));
      const still = y === last;
      last = y;
      return still;
    })
    .toBe(true);
  return last;
}

/** After the page settles, its scrollY and how it was reached. */
const restored = (page: Page) =>
  page.evaluate(() => ({
    type: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type,
    y: Math.round(window.scrollY),
  }));

/** The reader's place: scrollY, whether a fold is open, and where its section's top is on screen. */
const placeIn = (page: Page, id: string) =>
  page.evaluate((id) => {
    const target = document.getElementById(id)!;
    const fold = target.closest('details[data-ss-fold]') as HTMLDetailsElement;
    return {
      y: Math.round(window.scrollY),
      open: fold.open,
      top: Math.round(target.getBoundingClientRect().top),
    };
  }, id);

/** Arrive on #patents in a fresh page, then read on into and past its fold. */
async function readIntoPatents(page: Page) {
  await page.goto('/#patents');
  await expect(page.locator('.ss')).toHaveAttribute('data-ss-live', '');
  await expect.poll(() => landing(page, 'patents')).toMatchObject({ open: true, below: true });
  const landed = await page.evaluate(() => Math.round(window.scrollY));
  await scrollBy(page, 400);
  const place = await placeIn(page, 'patents');
  // Inside the fold or below it: its section's top is above the screen's top.
  expect(place.y).toBeGreaterThan(landed + 300);
  expect(place.top).toBeLessThan(0);
  return place;
}

/** The place after a return, against the one the reader left: within 2px, the fold open. */
function samePlace(
  after: { y: number; open: boolean; top: number },
  before: { y: number; open: boolean; top: number },
) {
  expect(after.open).toBe(true);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(2);
}

test(
  'Back and Forward within the page keep the place each entry had, within 2px: a traversal lands nothing',
  { annotation, tag },
  async ({ context }) => {
    // Index to #patents, read 1,500px down, Index to #awards, then Back and Forward.
    const fresh = await context.newPage();
    await fresh.goto('/');
    await expect(fresh.locator('.ss')).toHaveAttribute('data-ss-live', '');
    const viaIndex = async (id: string) => {
      await openIndex(fresh);
      await fresh.locator(`${SHEET} .ss-index__list a[href$="#${id}"]`).click();
      await expect(foldOf(fresh, id)).toHaveAttribute('open', '');
      await expect.poll(() => landing(fresh, id)).toMatchObject({ below: true, onScreen: true });
    };
    await viaIndex('patents');
    const atPatents = await fresh.evaluate(() => Math.round(window.scrollY));
    await scrollBy(fresh, 1500);
    const read = await placeIn(fresh, 'patents');
    expect(read.y).toBeGreaterThan(atPatents + 1000);
    const height = () =>
      foldOf(fresh, 'awards').evaluate((fold) => Math.round(fold.getBoundingClientRect().height));
    const shut = await height();
    await viaIndex('awards');
    await scrollBy(fresh, 0);
    const atAwards = await placeIn(fresh, 'awards');
    expect(Math.abs(atAwards.y - read.y)).toBeGreaterThan(300);
    const settled = async (id: string) => {
      await fresh.waitForTimeout(400);
      return placeIn(fresh, id);
    };
    await fresh.goBack();
    await expect(fresh).toHaveURL(/#patents$/);
    const back = await settled('patents');
    // The lines the reader left are where they were on screen, within 2px.
    expect(Math.abs(back.top - read.top)).toBeLessThanOrEqual(2);
    // scrollY is theirs, within 2px, plus the height #awards, open now and
    // above them, added when it opened.
    const added = (await height()) - shut;
    expect(added).toBeGreaterThan(0);
    expect(Math.abs(back.y - (read.y + added))).toBeLessThanOrEqual(2);
    await fresh.goForward();
    await expect(fresh).toHaveURL(/#awards$/);
    const forward = await settled('awards');
    expect(Math.abs(forward.y - atAwards.y)).toBeLessThanOrEqual(2);
    expect(Math.abs(forward.top - atAwards.top)).toBeLessThanOrEqual(2);
    await fresh.close();
  },
);

/**
 * The line at the middle of the screen, marked so a return can find it, and where it sits on
 * screen. Each mark is an attribute of its own, so when the middle of the screen holds the same
 * element at two places (a tall row, read twice), the second mark doesn't take the first's.
 */
async function markLine(page: Page, mark: string) {
  return page.evaluate((mark) => {
    const line = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    line?.setAttribute(`data-e2e-line-${mark}`, '');
    return Math.round(line?.getBoundingClientRect().top ?? Number.NaN);
  }, mark);
}
const lineTop = (page: Page, mark: string) =>
  page
    .locator(`[data-e2e-line-${mark}]`)
    .evaluate((line) => Math.round(line.getBoundingClientRect().top));

test(
  'Back and Forward keep the place of an entry whose fragment names no fold, or that has none, within 2px',
  { annotation, tag },
  async ({ context }) => {
    // The page with no fragment, read 1,200px down; Index to the first part,
    // a row that doesn't fold, read 1,500px on; Index to #awards; then Back twice.
    const fresh = await context.newPage();
    await fresh.goto('/');
    await expect(fresh.locator('.ss')).toHaveAttribute('data-ss-live', '');
    await fresh.waitForLoadState('load');
    await scrollBy(fresh, 1200);
    const atTop = await markLine(fresh, 'top');
    await openIndex(fresh);
    const part = fresh.locator(`${SHEET} .ss-index__part a`).first();
    const hash = (await part.getAttribute('href'))!.replace(/^[^#]*/, '');
    await part.click();
    await expect(fresh).toHaveURL(new RegExp(`${hash}$`));
    await scrollBy(fresh, 0);
    await scrollBy(fresh, 1500);
    const atPart = await markLine(fresh, 'part');
    await openIndex(fresh);
    await fresh.locator(`${SHEET} .ss-index__list a[href$="#awards"]`).click();
    await expect(foldOf(fresh, 'awards')).toHaveAttribute('open', '');
    await scrollBy(fresh, 0);
    await fresh.goBack();
    await expect(fresh).toHaveURL(new RegExp(`${hash}$`));
    await fresh.waitForTimeout(400);
    // The lines the reader left in the part are where they were on screen.
    expect(Math.abs((await lineTop(fresh, 'part')) - atPart)).toBeLessThanOrEqual(2);
    await fresh.goBack();
    await expect(fresh).toHaveURL(/\/$/);
    await fresh.waitForTimeout(400);
    expect(Math.abs((await lineTop(fresh, 'top')) - atTop)).toBeLessThanOrEqual(2);
    await fresh.close();
  },
);

test(
  'a reload mid-fold keeps the place the reader scrolled to, within 2px, the fold open: neither mount nor load lands the fragment',
  { annotation, tag },
  async ({ context }) => {
    const fresh = await context.newPage();
    const before = await readIntoPatents(fresh);
    await fresh.reload();
    await expect(fresh.locator('.ss')).toHaveAttribute('data-ss-live', '');
    await fresh.waitForLoadState('load');
    await fresh.waitForTimeout(400);
    expect((await restored(fresh)).type).toBe('reload');
    samePlace(await placeIn(fresh, 'patents'), before);
    await fresh.close();
  },
);

test(
  'going back to the page keeps the place the reader left in the fold, within 2px, the fold open',
  { annotation, tag },
  async ({ context }) => {
    const fresh = await context.newPage();
    const before = await readIntoPatents(fresh);
    // Away to the case study, then back.
    await fresh.goto(CASE);
    await expect(fresh.locator('.ss.ss--case')).toBeVisible();
    await fresh.goBack();
    await expect(fresh.locator('.ss:not(.ss--case)')).toHaveAttribute('data-ss-live', '');
    await fresh.waitForLoadState('load');
    await fresh.waitForTimeout(400);
    expect((await restored(fresh)).type).toBe('back_forward');
    samePlace(await placeIn(fresh, 'patents'), before);
    await fresh.close();
  },
);

test(
  'a reader who scrolls before the script runs keeps their place: mount lands nothing',
  { annotation, tag },
  async ({ context }) => {
    // Hold the scripts back, so the page is read before Position mounts.
    const fresh = await context.newPage();
    await fresh.route('**/*', async (route) => {
      if (route.request().resourceType() === 'script') {
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
      await route.continue();
    });
    await fresh.goto('/#patents', { waitUntil: 'domcontentloaded' });
    expect(await fresh.locator('.ss').getAttribute('data-ss-live')).toBeNull();
    await fresh.mouse.wheel(0, -100000);
    await expect.poll(() => fresh.evaluate(() => Math.round(window.scrollY))).toBe(0);
    await expect(fresh.locator('.ss')).toHaveAttribute('data-ss-live', '', { timeout: 15_000 });
    await fresh.waitForLoadState('load');
    await fresh.waitForTimeout(400);
    expect(await fresh.evaluate(() => Math.round(window.scrollY))).toBe(0);
    await fresh.close();
  },
);

/** Whether the fragment's target sits at its scroll margin, in its opened fold. */
const atMargin = (page: Page, id: string) =>
  page.evaluate((name) => {
    const target = document.getElementById(name)!;
    const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const open = Boolean(target.closest<HTMLDetailsElement>('details[data-ss-fold]')?.open);
    return open && Math.abs(target.getBoundingClientRect().top - margin) < 2;
  }, id);

/**
 * An arrival on #patents read before Position mounts, off its margin, as under load when the
 * engine's own fragment scroll settles after mount: the scripts held 2.5 s, and load (the images and
 * fonts) held well after mount; the engine's scroll lands the target at its margin, and the page is
 * then moved off it by script, no wheel, key or press. Gives the offset at the margin.
 */
async function arriveOffMargin(page: Page) {
  await page.route('**/*', async (route) => {
    const type = route.request().resourceType();
    if (type === 'script') await new Promise((resolve) => setTimeout(resolve, 2500));
    if (type === 'image' || type === 'font')
      await new Promise((resolve) => setTimeout(resolve, 8000));
    await route.continue();
  });
  await page.goto('/#patents', { waitUntil: 'domcontentloaded' });
  expect(await page.locator('.ss').getAttribute('data-ss-live')).toBeNull();
  await expect.poll(() => atMargin(page, 'patents')).toBe(true);
  const margin = await page.evaluate(() => Math.round(window.scrollY));
  await page.evaluate(() => window.scrollBy(0, 40));
  await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(margin + 40);
  await expect(page.locator('.ss')).toHaveAttribute('data-ss-live', '', { timeout: 15_000 });
  expect(await page.evaluate(() => document.readyState)).not.toBe('complete');
  return margin;
}

test(
  "the engine's fragment scroll settling after mount still lands: mount's reading off the margin is held, not the reader's",
  { annotation, tag },
  async ({ context }) => {
    const fresh = await context.newPage();
    const margin = await arriveOffMargin(fresh);
    // The engine's settling scroll, after mount and before load: a scroll with no input.
    await fresh.evaluate((y) => window.scrollTo(0, y), margin);
    await expect.poll(() => landing(fresh, 'patents')).toMatchObject({ open: true, below: true });
    expect(await fresh.evaluate(() => document.readyState)).not.toBe('complete');
    await fresh.close();
  },
);

test(
  "during the hold the reader's input decides for them: a wheel, then a scroll to the margin, lands nothing",
  { annotation, tag },
  async ({ context }) => {
    const fresh = await context.newPage();
    const margin = await arriveOffMargin(fresh);
    await fresh.mouse.move(720, 450);
    await fresh.mouse.wheel(0, 10);
    await expect.poll(() => fresh.evaluate(() => Math.round(window.scrollY))).toBe(margin + 50);
    await fresh.evaluate((y) => window.scrollTo(0, y), margin);
    await fresh.waitForLoadState('load');
    await fresh.waitForTimeout(400);
    expect(await fresh.evaluate(() => Math.round(window.scrollY))).toBe(margin);
    expect(await landing(fresh, 'patents')).toMatchObject({ open: true, below: false });
    await fresh.close();
  },
);

test(
  'a scroll with no wheel or key before load (a scrollbar, assistive tech) counts as the reader moving',
  { annotation, tag },
  async ({ context }) => {
    const fresh = await context.newPage();
    await fresh.route('**/*', async (route) => {
      if (['image', 'font'].includes(route.request().resourceType())) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      await route.continue();
    });
    await fresh.goto('/#patents', { waitUntil: 'domcontentloaded' });
    await expect(fresh.locator('.ss')).toHaveAttribute('data-ss-live', '');
    await expect.poll(() => landing(fresh, 'patents')).toMatchObject({ below: true });
    await fresh.evaluate(() => window.scrollTo(0, 0));
    expect(await fresh.evaluate(() => document.readyState)).not.toBe('complete');
    await fresh.waitForLoadState('load');
    await fresh.waitForTimeout(400);
    expect(await fresh.evaluate(() => Math.round(window.scrollY))).toBe(0);
    await fresh.close();
  },
);

test(
  "a reader who moves before load keeps their place: load doesn't land the fragment again",
  { annotation, tag },
  async ({ context }) => {
    // Load comes well after the page is live.
    const fresh = await context.newPage();
    // Hold the page's images and fonts (by resource type, whatever their URLs),
    // which the load event waits for.
    await fresh.route('**/*', async (route) => {
      if (['image', 'font'].includes(route.request().resourceType())) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      await route.continue();
    });
    await fresh.goto('/#patents', { waitUntil: 'domcontentloaded' });
    await expect(fresh.locator('.ss')).toHaveAttribute('data-ss-live', '');
    // Before load: the reader scrolls back up and opens the Index.
    await fresh.mouse.wheel(0, -100000);
    await openIndex(fresh);
    const before = await fresh.evaluate(() => ({
      ready: document.readyState,
      y: Math.round(window.scrollY),
    }));
    expect(before.ready).not.toBe('complete');
    await fresh.waitForLoadState('load');
    await fresh.waitForTimeout(400);
    // Still where they were, the Index still open over it.
    expect(Math.round(await fresh.evaluate(() => window.scrollY))).toBe(before.y);
    expect(await isOpen(fresh)).toBe(true);
    await fresh.close();
  },
);

test(
  'closing a fold after arriving on it closes it, with the script',
  { annotation, tag },
  async ({ page }) => {
    await closesAfterArrival(page);
  },
);

test(
  "the script opens a fold where the engine didn't: a hash set without navigating",
  { annotation, tag },
  async ({ page }) => {
    // replaceState changes the hash with no navigation, so no engine opens
    // anything; the hashchange that follows is Position's alone to answer.
    await loadLive(page);
    await expect(foldOf(page, 'patents')).not.toHaveAttribute('open', '');
    await page.evaluate(() => {
      history.replaceState(null, '', '#patents');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await expect(foldOf(page, 'patents')).toHaveAttribute('open', '');
    await expect
      .poll(() => landing(page, 'patents'))
      .toMatchObject({ below: true, onScreen: true });
    // No navigation set a focus start here: the script did, in the opened section.
    expect(await tabsOnFrom(page, 'patents')).toBe(true);
  },
);

test(
  'a malformed fragment leaves the page live: the Index still opens and closes',
  { annotation, tag },
  async ({ context }) => {
    const fresh = await context.newPage();
    const errors: string[] = [];
    fresh.on('pageerror', (error) => errors.push(error.message));
    await fresh.goto('/#%E0%A4');
    await expect(fresh.locator('.ss')).toHaveAttribute('data-ss-live', '');
    await openIndex(fresh);
    expect(errors).toEqual([]);
    await fresh.close();
  },
);

test.describe('the outline with no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'the folds ship closed and open from their fragment',
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      const folds = page.locator('details[data-ss-fold]');
      expect(await folds.count()).toBeGreaterThan(5);
      await expect(page.locator('details[data-ss-fold][open]')).toHaveCount(0);
      // A native summary opens it with no script at all.
      await foldOf(page, FOLDED).locator(':scope > summary').click();
      await expect(foldOf(page, FOLDED)).toHaveAttribute('open', '');
      // Arrive on a section inside a fold (the engine opens it), then close it: it closes.
      await closesAfterArrival(page);
    },
  );

  test(
    'print opens every disclosure: the folds, the archive, the abstracts',
    { annotation, tag },
    async ({ page }) => {
      await load(page);
      await page.emulateMedia({ media: 'print' });
      const measure = () =>
        page.locator('.ss details').evaluateAll((all) =>
          // Swiss's own disclosures: one print takes off the page with its slot
          // (the host's Appearance control) isn't a disclosure left shut.
          all
            .filter((details) => details.getClientRects().length > 0)
            .map((details) => {
              // Rendered, not merely laid out: a shut disclosure's content is
              // content-visibility hidden, which layout queries still measure.
              const content = [...details.children].filter((child) => child.tagName !== 'SUMMARY');
              const shown = content.length > 0 && content.every((child) => child.checkVisibility());
              const where = details.closest('[id]')?.id ?? '-';
              const summary = details.querySelector('summary')?.textContent?.trim().slice(0, 30);
              return { kind: `${details.className || 'details'} in ${where}: ${summary}`, shown };
            }),
        );
      expect((await measure()).length).toBeGreaterThan(15);
      // Not one closed disclosure keeps its content off the page.
      await expect.poll(async () => (await measure()).filter((each) => !each.shown)).toEqual([]);
      // And on screen they were shut: the check can tell.
      await page.emulateMedia({ media: 'screen' });
      expect((await measure()).filter((each) => !each.shown).length).toBeGreaterThan(15);
    },
  );
});

// The case study (component 19).
const CASE = '/work/postmortem-template-kit';

test(
  "the case study is Swiss's own page, its parts numbered and its way back home",
  { annotation, tag },
  async ({ page }) => {
    await page.goto(CASE);
    await expect(page.locator('.ss.ss--case')).toBeVisible();
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('h1 .ss-poster__text')).toHaveText('Postmortem Template Kit');
    const rows = page.locator('.ss-spec__row');
    expect(await rows.count()).toBeGreaterThan(3);
    await expect(page.locator('.ss-spec table caption')).toHaveText('Decisions');
    // The crumb and the way back both go home, to the section the work sits in.
    const crumb = page.locator('.ss-crumb a');
    const back = (await crumb.getAttribute('href'))!;
    expect(back).toMatch(/^\/#/);
    await expect(page.locator('.ss-next__link')).toBeVisible();
    // Next sits on the page's column lines at 1440 (lead A's condition): the lead
    // in columns 1 to 3, the link starting on column 4's line, on the same row.
    // A container on .ss-next turned its subgrid to none and stacked all three.
    const next = await page.locator('.ss-next').evaluate((nav) => {
      const frame = nav.parentElement!;
      const style = getComputedStyle(frame);
      const tracks = style.gridTemplateColumns.split(' ').map(parseFloat);
      const gap = parseFloat(style.columnGap) || 0;
      const start = frame.getBoundingClientRect().left + parseFloat(style.paddingLeft);
      const line = (n: number) =>
        start + tracks.slice(0, n - 1).reduce((sum, track) => sum + track + gap, 0);
      const lead = nav.querySelector('.ss-next__lead')!.getBoundingClientRect();
      const link = nav.querySelector('.ss-next__link')!.getBoundingClientRect();
      return {
        columns: tracks.length,
        leadOnColumn1: Math.abs(lead.left - line(1)) <= 1,
        leadWithin3: lead.right <= line(4) - gap + 1,
        linkOnColumn4: Math.abs(link.left - line(4)) <= 1,
        sameRow: link.top < lead.bottom,
      };
    });
    expect(next).toEqual({
      columns: 12,
      leadOnColumn1: true,
      leadWithin3: true,
      linkOnColumn4: true,
      sameRow: true,
    });
    const results = await axeFor(page).include('.ss').analyze();
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    await crumb.click();
    await expect
      .poll(() => {
        const url = new URL(page.url());
        return `${url.pathname}${url.hash}`;
      })
      .toBe(back);
  },
);

test(
  'the case study prints as a résumé page, its rules on paper',
  { annotation, tag },
  async ({ page }, testInfo) => {
    await page.goto(CASE);
    await page.emulateMedia({ media: 'print' });
    const rule = await page
      .locator('.ss-spec table tbody td')
      .first()
      .evaluate((cell) => {
        const style = getComputedStyle(cell);
        return { style: style.borderBlockEndStyle, width: parseFloat(style.borderBlockEndWidth) };
      });
    expect(rule.style).toBe('solid');
    expect(rule.width).toBeGreaterThan(0);
    await expect(page.locator('.ss-index, .ss-colophon__control').first()).toBeHidden();
    await testInfo.attach('swiss-case-print-1440', {
      body: await page.pdf({ format: 'A4', printBackground: false }),
      contentType: 'application/pdf',
    });
  },
);
