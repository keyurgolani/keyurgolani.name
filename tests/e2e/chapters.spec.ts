import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { SAMPLE_APP } from '../variants/target';

// Chapters on the sample as the demo serves it, in its recipe (letterpress,
// paper-ink, book-serif): the views are server pages that work without
// JavaScript and after a refresh, keep ?variant= on every link, and answer an
// unknown chapter with the contents and a noindex note; the page turn is
// opted in; and the P-0 review's five conditions hold in the browser.

const annotation = [
  { type: 'route', description: '/sample?variant=chapters' },
  { type: 'profile', description: 'demo' },
];

test.use({ appOptions: SAMPLE_APP });

const RECIPE = 'language=letterpress&scheme=paper-ink&type=book-serif&mode=light';
const CURRENT = '/sample/chapters/solstice-payments';
const at = (path: string) => `${path}?variant=chapters&${RECIPE}`;

async function open(page: Page, path: string, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  const response = await page.goto(at(path), { waitUntil: 'networkidle' });
  expect(response?.status()).toBe(200);
  await expect(page.locator('[data-variant="chapters"]')).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
}

/** Words in `selector` that the layout broke across two lines. */
const brokenWords = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const broken: string[] = [];
    for (const element of document.querySelectorAll(sel)) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        for (const match of (node.textContent ?? '').matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index!);
          range.setEnd(node, match.index! + match[0].length);
          if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) {
            broken.push(match[0]);
          }
        }
      }
    }
    return broken;
  }, selector);

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test(
    'home, a chapter, the back matter and the case study are server pages, linked with ?variant= kept',
    { annotation },
    async ({ page }) => {
      await open(page, '/sample');
      await expect(page.locator('h1')).toHaveCount(1);
      const chapterLink = page.locator('.toc__a').last();
      expect(await chapterLink.getAttribute('href')).toContain('variant=chapters');
      await chapterLink.click();
      await page.waitForLoadState('networkidle');
      expect(new URL(page.url()).pathname).toBe(CURRENT);
      await expect(page.locator('h1')).toContainText('Solstice Payments');
      await expect(page.locator('.op-num')).toHaveText('3');
      // A refresh lands on the same chapter.
      await page.reload({ waitUntil: 'networkidle' });
      await expect(page.locator('h1')).toContainText('Solstice Payments');
      // Under /sample a view carries no canonical link.
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      await page.locator('.ts__a--next').click();
      await page.waitForLoadState('networkidle');
      expect(new URL(page.url()).pathname).toBe('/sample/back-matter');
      await expect(page.locator('h1')).toContainText('Back matter');
      await expect(page.locator('.ix__terms li').first()).toBeVisible();
      await open(page, '/sample/work/postmortem-template-kit');
      await expect(page.locator('h1')).toHaveText('Postmortem Template Kit');
      await expect(page.locator('.cs-from a')).toContainText('Chapter 3');
    },
  );

  test(
    'an unknown chapter is the contents with its note, noindex',
    { annotation },
    async ({ page }) => {
      await open(page, '/sample/chapters/no-such-chapter');
      await expect(page.locator('.tp-notice')).toContainText('No chapter by that name.');
      await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    },
  );
});

test(
  'the page turn is opted in, its names held, and nothing moves under reduced motion',
  { annotation },
  async ({ page }) => {
    await open(page, CURRENT);
    const rules = await page.evaluate(() => {
      const out = { viewTransition: false, names: [] as string[] };
      for (const sheet of document.styleSheets) {
        let list: CSSRuleList;
        try {
          list = sheet.cssRules;
        } catch {
          continue;
        }
        const walk = (rules: CSSRuleList) => {
          for (const rule of rules) {
            if (rule.cssText.startsWith('@view-transition')) out.viewTransition = true;
            const name = /view-transition-name:\s*([a-z-]+)/.exec(rule.cssText)?.[1];
            if (name && name !== 'none') out.names.push(name);
            if ('cssRules' in rule) walk((rule as CSSGroupingRule).cssRules);
          }
        };
        walk(list);
      }
      return out;
    });
    expect(rules.viewTransition).toBe(true);
    expect([...new Set(rules.names)].sort()).toEqual([
      'chapters-edge',
      'chapters-mark',
      'chapters-place',
      'chapters-runhead',
    ]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.ts__a--prev').click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    const running = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === 'running').length,
    );
    expect(running).toBe(0);
  },
);

test(
  'C1 and C3: the author line, the span and the preface lead are in a face that exists; Now, as of is not monospace',
  { annotation },
  async ({ page }) => {
    await open(page, '/sample');
    for (const selector of ['.tp-author', '.pf__lead']) {
      const style = await page.locator(selector).evaluate((el) => {
        const s = getComputedStyle(el);
        return { weight: s.fontWeight, family: s.fontFamily };
      });
      expect(style.family, selector).not.toContain('Fraunces');
      expect(style.weight, selector).toBe('400');
    }
    await open(page, CURRENT);
    const span = await page.locator('.op-span').evaluate((el) => getComputedStyle(el).fontFamily);
    expect(span).not.toContain('Fraunces');
    const asOf = await page.locator('.cl__asof').evaluate((el) => getComputedStyle(el).fontFamily);
    expect(asOf).not.toMatch(/mono|Menlo|SFMono/i);
  },
);

test(
  'C2: dates, read times, the imprint and the fact sheet never break at 1440 and 390',
  { annotation },
  async ({ page }) => {
    for (const width of [1440, 390]) {
      await open(page, '/sample', width, width === 390 ? 844 : 900);
      expect(await brokenWords(page, '.tp-who, .tp-proof, .ch-date')).toEqual([]);
      await open(page, CURRENT, width, width === 390 ? 844 : 900);
      expect(await brokenWords(page, '.ch-date, .ch-nobreak, .ch-facts dd, .op-map li')).toEqual(
        [],
      );
      const facts = await page
        .locator('.ch-facts dd')
        .first()
        .evaluate((el) => {
          const rects = [...el.getClientRects()];
          return rects.length;
        });
      expect(facts).toBe(1);
    }
  },
);

test(
  'C4: at 390 the chapter running head shows Write beside Contents, and Write lands on the colophon',
  { annotation },
  async ({ page }) => {
    await open(page, CURRENT, 390, 844);
    const recto = page.locator('.ch-runhead__recto');
    await expect(recto.getByRole('link', { name: 'Contents' })).toBeVisible();
    const write = recto.getByRole('link', { name: /^Write/ });
    await expect(write).toBeVisible();
    await write.click();
    await expect(page.locator('#ch--colophon')).toBeInViewport();
  },
);

test('C5: page numbers sit on the baseline of their row', { annotation }, async ({ page }) => {
  await open(page, CURRENT);
  const offsets = await page.locator('.op-map li').evaluateAll((rows) =>
    rows.map((row) => {
      const link = row.querySelector('a')!;
      const page = row.querySelector('.op-map__pg')!;
      const base = (el: Element) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()];
        return rects[0]!.bottom;
      };
      // Bottoms of the first line boxes: equal font sizes give equal descents.
      return Math.abs(base(link) - base(page));
    }),
  );
  for (const offset of offsets) expect(offset).toBeLessThan(2.5);
});

test('no view scrolls sideways from 320 to 1920', { annotation }, async ({ page }) => {
  for (const path of [
    '/sample',
    CURRENT,
    '/sample/chapters/mosaic-search',
    '/sample/back-matter',
    '/sample/work/postmortem-template-kit',
  ]) {
    for (const width of [320, 390, 1024, 1920]) {
      await open(page, path, width, 900);
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(wide, `${path} at ${width}`).toBeLessThanOrEqual(0);
    }
  }
});

test(
  "the fore-edge takes keyboard focus and shows each segment's label plate",
  { annotation },
  async ({ page }) => {
    await open(page, CURRENT);
    const segment = page.locator('.ch-edge__seg a').nth(1);
    await segment.focus();
    await expect(segment).toBeFocused();
    await expect(segment.locator('.ch-edge__label')).toHaveCSS('opacity', '1');
  },
);

test(
  'P1-4: the running head sits on the page grid, and on a phone the place label stops short of Contents',
  { annotation },
  async ({ page }) => {
    for (const width of [1440, 1024]) {
      await open(page, CURRENT, width, 900);
      const x = await page.evaluate(() => {
        const links = [...document.querySelectorAll('.ch-runhead__recto a')];
        const first = links[0]!.getBoundingClientRect();
        const last = links.at(-1)!.getBoundingClientRect();
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const recto = box('.ch-spread--opener .ch-page--recto .ch-page__in');
        const verso = box('.ch-spread--opener .ch-page--verso .ch-page__in');
        return {
          first: first.left,
          last: last.right,
          start: recto.left,
          end: recto.right,
          name: box('.ch-runhead__name').left,
          verso: verso.left,
        };
      });
      expect(Math.abs(x.first - x.start), `${width}: Contents on the recto's text`).toBeLessThan(
        1.5,
      );
      expect(x.last, `${width}: the last link inside the recto's text`).toBeLessThanOrEqual(
        x.end + 1,
      );
      expect(Math.abs(x.name - x.verso), `${width}: the name on the verso's text`).toBeLessThan(
        1.5,
      );
    }
    for (const width of [390, 320]) {
      await open(page, CURRENT, width, 844);
      const gap = await page.evaluate(() => {
        const here = document.querySelector('.ch-runhead__here')!.getBoundingClientRect();
        const contents = document.querySelector('.ch-runhead__recto a')!.getBoundingClientRect();
        return contents.left - here.right;
      });
      expect(gap, `${width}: the label stops short of Contents`).toBeGreaterThanOrEqual(8);
    }
  },
);

test(
  'C2: the proof list and the highlights run the width of their page',
  { annotation },
  async ({ page }) => {
    await open(page, '/sample');
    const proof = await page.evaluate(() => {
      const list = document.querySelector('.tp-proof')!.getBoundingClientRect();
      const band = document.querySelector('.tp-band__r')!.getBoundingClientRect();
      return list.width / band.width;
    });
    expect(proof).toBeGreaterThan(0.95);
    await open(page, CURRENT);
    const highlights = await page.evaluate(() => {
      const list = document.querySelector('.op-hl')!.getBoundingClientRect();
      const text = document.querySelector('.op-text')!.getBoundingClientRect();
      return list.width / text.width;
    });
    expect(highlights).toBeGreaterThan(0.95);
    expect(await brokenWords(page, '.op-hl .ch-nobreak')).toEqual([]);
  },
);

test(
  "P1-6: on a phone, each part's locator is the page number printed below it",
  { annotation },
  async ({ page }) => {
    for (const width of [390, 320]) {
      await open(page, CURRENT, width, 844);
      expect(await page.locator('.op-map li').count(), `${width}: parts to check`).toBeGreaterThan(
        0,
      );
      const misplaced = await page.evaluate(() => {
        const shown = (el: Element) => getComputedStyle(el).display !== 'none';
        const wrong: string[] = [];
        for (const item of document.querySelectorAll('.op-map li')) {
          const link = item.querySelector('a')!;
          const cited = Number(item.querySelector('.op-map__pg')!.textContent);
          const part = document.getElementById(decodeURIComponent(link.hash.slice(1)))!;
          const head = part.querySelector('h1, h2, h3') ?? part;
          const top = head.getBoundingClientRect().top;
          // The first folio printed below the part's heading, inside its spread.
          const below = [...part.querySelectorAll('.ch-folio')]
            .filter((folio) => shown(folio) && folio.getBoundingClientRect().top >= top)
            .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
          const [from, to = from] = (below?.textContent ?? '').split('–').map(Number);
          if (!(cited >= from! && cited <= to!)) {
            wrong.push(`${link.textContent}: cited ${cited}, printed ${below?.textContent}`);
          }
        }
        return wrong;
      });
      expect(misplaced, `${width}`).toEqual([]);
    }
  },
);
