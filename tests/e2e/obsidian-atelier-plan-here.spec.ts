import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Obsidian Atelier's plan, in the Index dialog and in the footer, marks the link to where the visitor
// is (aria-current="location", drawn as a dot before it), as the running head names the place, from
// the script's IntersectionObserver. Its first delivery came after a page's settle, so a shot at the
// page's top showed the Entrance's dot or didn't; and on a phone at the top it marked nothing at
// all on CI Linux, no place crossing the band it reads, so there the mark was whatever the page's
// scroll had last left: the variant shot of the engineering fixture on a phone differed by the dot
// alone between two runs of one tree. At rest at its top the plan marks the
// Entrance alone: with every observer's deliveries held back, unless the page still holds the settle
// (data-enhancement-pending, which shots and cells wait on); once they come; and back at the top
// after a trip to the page's foot. A hold lets go inside the settle's 10 s budget, delivery or none.
// On the engineering contract fixture, at 390 on phone emulation and at 1440.

const FIXTURE = contractFixture('engineering');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'obsidian-atelier'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const MARKED = '[data-oa-plan] a[aria-current="location"]';

const PENDING = '[data-enhancement-pending]';

/** The page at its top, loaded, fonts in and two frames drawn; with `settled`, nothing pending too. */
async function load(page: Page, { settled }: { settled: boolean }) {
  await page.goto('/', { waitUntil: 'networkidle' });
  await expect(page.locator('[data-variant]').first()).toHaveAttribute(
    'data-variant',
    'obsidian-atelier',
  );
  await page.evaluate(() => document.fonts.ready);
  if (settled) await expect(page.locator(PENDING)).toHaveCount(0);
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  expect(await page.evaluate(() => scrollY)).toBe(0);
}

const marks = (page: Page) =>
  page.locator(MARKED).evaluateAll((links) => links.map((link) => link.textContent?.trim() ?? ''));

/** Marks the Entrance's link alone, in every plan on the page. */
const entranceOnly = (links: readonly string[]) =>
  links.length > 0 && links.every((text) => text === 'Entrance');

const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

async function compare(page: Page) {
  // Held back: every observer's deliveries wait a minute, past the read.
  const held = await page.context().newPage();
  await held.addInitScript(() => {
    const Real = window.IntersectionObserver;
    window.IntersectionObserver = class extends Real {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super((entries, observer) => {
          setTimeout(() => callback(entries, observer), 60_000);
        }, options);
      }
    };
  });
  await load(held, { settled: false });
  const before = { pending: await held.locator(PENDING).count(), marks: await marks(held) };
  // Delivered: at rest at the top, then after a trip to the page's foot and back.
  await load(page, { settled: true });
  await frames(page);
  const delivered = await marks(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await frames(page);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await frames(page);
  await expect(page.locator(PENDING)).toHaveCount(0);
  await page.waitForTimeout(300);
  await frames(page);
  const back = await marks(page);
  const read = {
    // A page that holds the settle isn't read yet, by a shot or a cell.
    heldAtTheEntranceOrUnsettled: before.pending > 0 || entranceOnly(before.marks),
    deliveredAtTheEntrance: entranceOnly(delivered),
    backAtTheTopAtTheEntrance: entranceOnly(back),
  };
  expect(read, JSON.stringify({ before, delivered, back })).toEqual({
    heldAtTheEntranceOrUnsettled: true,
    deliveredAtTheEntrance: true,
    backAtTheTopAtTheEntrance: true,
  });
  // And a hold lets go inside the settle's budget, delivery or none.
  await expect(held.locator(PENDING)).toHaveCount(0, { timeout: 9_000 });
  await held.close();
}

test.describe('390', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test(
    "at 390 the plan marks where the page starts before the observer's first delivery, as after it",
    { annotation },
    async ({ page }) => {
      await compare(page);
    },
  );
});

test.describe('1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test(
    "at 1440 the plan marks where the page starts before the observer's first delivery, as after it",
    { annotation },
    async ({ page }) => {
      await compare(page);
    },
  );
});
