import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import {
  brokenWords,
  clearSplits,
  pastPage,
  plantSplits,
  splitPhrases,
  thinCells,
} from './raw-grid-probes';

// Raw Grid on the bundled sample, under the demo profile: its long labels and its case texts
// of several lines (raw-grid.spec.ts runs the complete fixture). No display or label word
// breaks inside itself or runs past its cell at any width; under 200% text on a phone a word
// may break, the net under the fit, but nothing runs past its cell or the page; and the case's
// texts fill the band they run across.

// The bundled sample under Raw Grid, the copy the design reviews read: its long labels
// (INFRASTRUCTURE, OBSERVABILITY, Keynote, February) and its case texts of several lines.
const SAMPLE_ANNOTATION = [
  { type: 'route', description: '/sample' },
  { type: 'profile', description: 'demo' },
];
/**
 * The faces the guard reads: Raw Grid's own recipe, the one the design review reads (paste-up's
 * display type at its tight leading), and the sample's default type (humanist).
 */
const RECIPES = [
  ['own', 'language=poster-press&scheme=poster-primaries&type=paste-up&mode=light'],
  ['default', 'language=platform-neutral&scheme=warm-parchment&type=humanist-ui&mode=light'],
] as const;
const HOME = '/sample?variant=raw-grid';
const CASE_PAGE = '/sample/work/postmortem-template-kit?variant=raw-grid';

/** Words past reviews found split, each of which the guard must have measured on home. */
const NAMED = [
  'reliability', // the engagement pair, "RELIABILIT/Y" at 320
  'postmortems', // the engagement pair, "POSTMORTE/MS" at 768
  'postmortem-', // the repo card, "POSTMORT/EM-" at 320
  'recordings,', // the album, ", VOL. 1" at 320
  'february', // the essay dates at 768
  'november',
  'cardamom', // the track title, "CARDAMO/M" at 768
];

/**
 * Words round 9 found split under 200% text, each of which the enlarged guard must have read at
 * that width, as the guard reads it there. A way out's name and its mark are one run where the
 * link flows as text (a page under 18rem: 390 and 320), so "mastodon↗", the word whose mark fell
 * to a line of its own at 320; at 1024 the link is a flex row and the mark its own box, which
 * can't split the word, so the word read there is "mastodon" (the planted case below holds the
 * guard to a mark on a line of its own).
 */
const namedEnlarged = (width: number) => [
  'anamika', // the header's name, at 390 and 320
  'infrastructure', // a Stack head, at 390 and 320
  width < 768 ? 'mastodon↗' : 'mastodon', // a way out
  'anthropology', // a focus item, at 320
  'repositories', // the fact sheet's term, at 1024
  'engagements', // a contents line, at 1024
];

// Raw Grid is ready, so /sample's ?variant= reaches it with no opt-in.
test.use({ appOptions: DEMO_APP });

test.describe('the bundled sample', () => {
  // The guard (the gate on splits): every display, label, title and link word on home and the
  // case, at every width, in Raw Grid's own recipe and the default type, whole and in its cell,
  // every short call to action on one line, and the words past reviews found split measured.
  for (const width of [1440, 1200, 1024, 768, 390, 320]) {
    test.describe(`at ${width}px`, () => {
      test.use({
        viewport: { width, height: 900 },
        // Settled: no sticker still slapping on while the words are measured.
        contextOptions: { reducedMotion: 'reduce' },
        ...(width < 768 ? { hasTouch: true, isMobile: true } : {}),
      });

      for (const [recipe, query] of RECIPES) {
        test(
          `whole words, ${recipe} recipe: no word breaks inside itself or runs past its cell, no call to action takes two lines`,
          { annotation: SAMPLE_ANNOTATION },
          async ({ page }) => {
            for (const route of [HOME, CASE_PAGE]) {
              await page.goto(`${route}&${query}`, { waitUntil: 'networkidle' });
              await expect(page.locator('[data-variant]')).toHaveAttribute(
                'data-variant',
                'raw-grid',
              );
              await page.evaluate(() => document.fonts.ready);
              const scan = await page.evaluate(brokenWords, { breaks: true });
              if (route === HOME) {
                for (const word of NAMED) expect(scan.measured, `read ${word}`).toContain(word);
                await expect(page.locator('.rg-ink__big')).toHaveText(/^email me$/i);
              }
              expect(scan.found, route).toEqual([]);
              expect(await page.evaluate(splitPhrases), route).toEqual([]);
            }
          },
        );
      }
    });
  }

  // The guard's own check: in Raw Grid's faces at tight leading, it catches each kind of split.
  test.describe('at 1024px, planted splits', () => {
    test.use({
      viewport: { width: 1024, height: 900 },
      contextOptions: { reducedMotion: 'reduce' },
    });

    test(
      'whole words, the guard itself: a mid-word break, a hyphen, a comma, a closing quote and a link’s mark starting a line, and a phrase on two lines each fail',
      { annotation: SAMPLE_ANNOTATION },
      async ({ page }) => {
        await page.goto(`${HOME}&${RECIPES[0][1]}`, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(plantSplits);
        const scan = await page.evaluate(brokenWords, { breaks: true });
        const phrases = await page.evaluate(splitPhrases);
        await page.evaluate(clearSplits);
        for (const split of [
          'INFRASTRUCTURE',
          'POSTMORTEM-',
          'RECORDINGS,',
          'engineer”',
          'MASTODON↗',
        ])
          expect(scan.found, split).toContainEqual(
            expect.stringMatching(`^${split} in .*: on two lines$`),
          );
        expect(phrases).toContainEqual(expect.stringMatching(/^Email me in rg-btn: on two lines$/));
      },
    );
  });

  // Under 200% text on a phone, and at 1024 as the quality cell sets it (the fact sheet's terms
  // and figures, the contents' counts), in both recipes, every display, label, title and link
  // word stays whole and in its cell (the fit sizes it by its cell, design r5 P0-2), nothing runs
  // past the page (WCAG 1.4.4, 1.4.10), and the header's name keeps clear of the Index (r5 P1-1).
  for (const width of [1024, 390, 320]) {
    test.describe(`at ${width}px with 200% text`, () => {
      test.use({
        viewport: { width, height: 900 },
        ...(width < 768 ? { hasTouch: true, isMobile: true } : {}),
        contextOptions: { reducedMotion: 'reduce' },
      });

      for (const [recipe, query] of RECIPES) {
        test(
          `whole words, ${recipe} recipe: no word breaks inside itself or runs past its cell, and nothing scrolls sideways`,
          { annotation: SAMPLE_ANNOTATION },
          async ({ page }) => {
            for (const route of [HOME, CASE_PAGE]) {
              await page.goto(`${route}&${query}`, { waitUntil: 'networkidle' });
              await page.addStyleTag({ content: ':root { font-size: 200% !important; }' });
              await page.evaluate(() => document.fonts.ready);
              const scan = await page.evaluate(brokenWords, { breaks: true });
              if (route === HOME)
                for (const word of namedEnlarged(width))
                  expect(scan.measured, `read ${word}`).toContain(word);
              expect(scan.found, route).toEqual([]);
              expect(await page.evaluate(pastPage), route).toEqual([]);
              const [name, index] = await page.evaluate(() =>
                ['.rg-head__name a', '.rg-head__index'].map((selector) => {
                  const box = document.querySelector(selector)!.getBoundingClientRect();
                  return { left: box.left, right: box.right };
                }),
              );
              expect(name!.right, `${route}: the name clear of the Index`).toBeLessThanOrEqual(
                index!.left + 1,
              );
            }
          },
        );
      }
    });
  }

  // An episode's date and its length never print over each other: on one line a gap of half an
  // em at least, or the length wraps under the date (design r5 P0-1).
  for (const width of [390, 320]) {
    test.describe(`at ${width}px, the episodes`, () => {
      test.use({ viewport: { width, height: 900 }, hasTouch: true, isMobile: true });

      for (const [recipe, query] of RECIPES) {
        test(
          `${recipe} recipe: a date and its length never overlap`,
          { annotation: SAMPLE_ANNOTATION },
          async ({ page }) => {
            await page.goto(`${HOME}&${query}`, { waitUntil: 'networkidle' });
            await page.evaluate(() => document.fonts.ready);
            const rows = await page.locator('.rg-table--episodes tbody tr').evaluateAll((trs) =>
              trs.map((tr) => {
                const [date, length] = [...tr.querySelectorAll('td.rg-t-date')].map((td) =>
                  td.getBoundingClientRect(),
                );
                if (!date || !length) return null;
                const em = parseFloat(getComputedStyle(tr.querySelector('td.rg-t-date')!).fontSize);
                const sameLine = length.top < date.bottom - 1 && date.top < length.bottom - 1;
                return { sameLine, gap: length.left - date.right, em };
              }),
            );
            test.skip(rows.filter(Boolean).length === 0, 'no episodes with a date and a length');
            for (const row of rows.filter(Boolean))
              if (row!.sameLine) expect(row!.gap).toBeGreaterThanOrEqual(row!.em / 2);
          },
        );
      }
    });
  }

  // At a laptop's width the header's tabs keep each count inside its tab (design r5 P1-2), and
  // under 200% text at 1024 the destinations give way to the Index.
  for (const [width, text] of [
    [1200, 1],
    [1280, 1],
    [1024, 2],
  ] as const) {
    test.describe(`at ${width}px${text > 1 ? ' with 200% text' : ''}, the header`, () => {
      test.use({ viewport: { width, height: 900 }, contextOptions: { reducedMotion: 'reduce' } });

      for (const [recipe, query] of RECIPES) {
        test(
          `${recipe} recipe: every count sits inside its tab`,
          { annotation: SAMPLE_ANNOTATION },
          async ({ page }) => {
            await page.goto(`${HOME}&${query}`, { waitUntil: 'networkidle' });
            if (text > 1)
              await page.addStyleTag({ content: ':root { font-size: 200% !important; }' });
            await page.evaluate(() => document.fonts.ready);
            const outside = await page.locator('.rg-head__dest').evaluateAll((tabs) =>
              tabs
                .filter((tab) => tab.getClientRects().length > 0)
                .flatMap((tab) => {
                  const box = tab.getBoundingClientRect();
                  const count = tab.querySelector('.rg-count')!.getBoundingClientRect();
                  return count.left < box.left - 0.5 || count.right > box.right + 0.5
                    ? [
                        `${tab.textContent}: ${Math.round(count.right)} past ${Math.round(box.right)}`,
                      ]
                    : [];
                }),
            );
            expect(outside).toEqual([]);
            expect((await page.evaluate(brokenWords, { breaks: false })).found).toEqual([]);
          },
        );
      }
    });
  }

  // The press itself is in raw-grid.spec.ts: the sample's one work with a page of its own is its
  // signature, pinned in the opening, so no card here opens a page of the site.
  test.describe('at 1440px, the cards with a title link', () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test(
      'nothing between a card’s title link and the card boxes the link’s overlay',
      { annotation: SAMPLE_ANNOTATION },
      async ({ page }) => {
        await page.goto(HOME, { waitUntil: 'networkidle' });
        const cards = page.locator('.rg-card:has(a.rg-stretch)');
        expect(await cards.count()).toBeGreaterThan(0);
        // Nothing between the link and its card makes a box for the link's overlay but the card:
        // a container, a position, containment or a transform would shrink it off the cover.
        const trapped = await cards.evaluateAll((all) =>
          all.flatMap((card) => {
            const link = card.querySelector('a.rg-stretch')!;
            const traps: string[] = [];
            for (let at = link.parentElement; at && at !== card; at = at.parentElement) {
              const style = getComputedStyle(at);
              if (
                style.containerType !== 'normal' ||
                style.position !== 'static' ||
                style.contain !== 'none' ||
                style.transform !== 'none'
              )
                traps.push(`${link.textContent}: ${at.className}`);
            }
            return traps;
          }),
        );
        expect(trapped).toEqual([]);
      },
    );
  });

  test.describe('at 1280px', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test(
      'the case’s texts of several lines fill the band they run across',
      { annotation: SAMPLE_ANNOTATION },
      async ({ page }) => {
        await page.goto(CASE_PAGE, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        expect(await page.evaluate(thinCells)).toEqual([]);
      },
    );
  });
});
