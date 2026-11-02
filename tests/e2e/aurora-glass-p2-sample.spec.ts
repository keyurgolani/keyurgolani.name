import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';

// Aurora Glass P2 on the bundled sample, an app of its own (demo profile):
// - the case page on a phone (the approval's item 1), on postmortem-template-kit,
//   a case with a cover, so the cover's place is checked, not skipped (the code
//   review's low 4): below 48rem it reads title, standfirst and links, then the
//   cover sheet across the pane's foot, then the fact sheet, in source order as
//   on screen;
// - home's "More about" disclosures, which sit on a sheet whose title link
//   stretches over it: a click opens the disclosure and goes nowhere (the delta
//   check's 1).

const ROUTE = '/sample/work/postmortem-template-kit?variant=aurora-glass';
const HOME = '/sample?variant=aurora-glass';

test.use({
  viewport: { width: 390, height: 844 },
  // Aurora Glass is ready, so ?variant= serves it on the sample without the pending opt-in.
  appOptions: DEMO_APP,
});

test(
  'reads title, links, then the cover across the pane foot, then the fact sheet',
  {
    annotation: [
      { type: 'route', description: '/sample/work/postmortem-template-kit' },
      { type: 'profile', description: 'demo' },
    ],
  },
  async ({ page }) => {
    // The demo derives the sample's media after it starts, so a cold server serves the case
    // before its cover's renditions exist, and Aurora leaves an unready cover out: load again
    // until the cover is there, as editorial-evidence-plate.spec.ts and media.spec.ts wait.
    await expect
      .poll(
        async () => {
          await page.goto(ROUTE, { waitUntil: 'networkidle' });
          return page.locator('.ag-case__cover').count();
        },
        {
          message: `the case had no cover on ${ROUTE} within 20 s: the demo derives the sample's media after it starts, and the cover's renditions never arrived`,
          // Under the test's own 30 s, so this message is what reports.
          timeout: 20_000,
        },
      )
      .toBeGreaterThan(0);
    await expect(page.locator('.ag.ag--case')).toHaveCount(1);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('.ag-case__cover')).toHaveCount(1);
    const tops = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return {
        title: box('.ag-case h1').top,
        paneBottom: box('.ag-case__pane').bottom,
        cover: box('.ag-case__cover').top,
        facts: box('.ag-facts').top,
        // Source order: each follows the one before it in the document.
        inOrder: (() => {
          const [h1, cover, facts] = ['.ag-case h1', '.ag-case__cover', '.ag-facts'].map(
            (selector) => document.querySelector(selector)!,
          );
          const follows = (a: Element, b: Element) =>
            Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
          return follows(h1!, cover!) && follows(cover!, facts!);
        })(),
      };
    });
    expect(tops.title).toBeLessThan(tops.cover);
    // The cover crosses the pane's foot, and the fact sheet follows the cover.
    expect(tops.cover).toBeLessThan(tops.paneBottom);
    expect(tops.facts).toBeGreaterThan(tops.cover);
    expect(tops.facts).toBeGreaterThanOrEqual(tops.paneBottom);
    // Source order as on screen: the title, the cover, then the facts.
    expect(tops.inOrder).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
  },
);

test.describe('home at 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test(
    'a click on a sheet’s "More about" opens it there, and the sheet’s link takes no click',
    {
      annotation: [
        { type: 'route', description: '/sample' },
        { type: 'profile', description: 'demo' },
      ],
    },
    async ({ page }) => {
      await page.goto(HOME, { waitUntil: 'networkidle' });
      const more = page.locator('.ag-work details.ag-more').first();
      await expect(more).toHaveCount(1);
      await more.scrollIntoViewIfNeeded();
      const before = page.url();
      // A real click, at the summary's centre, where the stretched link's layer lies too.
      await more.locator('summary').click();
      await expect(more).toHaveJSProperty('open', true);
      await expect(more.locator('.ag-more__body')).toBeVisible();
      expect(page.url()).toBe(before);
    },
  );
});

// The design review's 1: at 320 the case title broke inside a word ("Postmorte / m"), in the
// recipe the review read (glassmorphism, aurora-meadow, screen-grotesque, whose display type is
// widest). Every word of the h1 stays on one line: a word's range has one line box.
const REVIEW_RECIPE = 'language=glassmorphism&scheme=aurora-meadow&type=screen-grotesque';
test.describe('the case page at 320', () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test(
    'no word of the case title breaks inside itself',
    {
      annotation: [
        { type: 'route', description: '/sample/work/postmortem-template-kit' },
        { type: 'profile', description: 'demo' },
      ],
    },
    async ({ page }) => {
      await page.goto(`${ROUTE}&${REVIEW_RECIPE}`, { waitUntil: 'networkidle' });
      const broken = await page.evaluate(() => {
        const h1 = document.querySelector('.ag-case h1')!;
        const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT);
        const split: string[] = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent ?? '';
          for (const match of text.matchAll(/\S+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index!);
            range.setEnd(node, match.index! + match[0].length);
            const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
            if (tops.size > 1) split.push(match[0]);
          }
        }
        return split;
      });
      expect(broken).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBe(0);
    },
  );
});
