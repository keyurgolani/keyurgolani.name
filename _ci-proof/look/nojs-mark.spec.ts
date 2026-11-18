import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// The CI proof's look (copied in, never committed): Aurora Glass's home with script off, at 1440 and
// 390, on the complete fixture. The no-script mark is read where the parser put it: its noscript's
// and its own box, where it sits in .ag, and how far .ag runs past its other children. Then the
// noscript's content moves into a stand-in div, as the quality runner's no-JavaScript rows do before
// axe, and the same is read again: the stand-in has no height and the page grows by nothing.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  javaScriptEnabled: false,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const read = () => {
  const ag = document.querySelector('.ag')!;
  const mark = document.querySelector('[data-ag-nojs]');
  const holder = mark?.parentElement ?? null;
  const children = [...ag.children];
  const others = children.filter((child) => child !== holder);
  const bottom = Math.max(...others.map((child) => child.getBoundingClientRect().bottom));
  const box = (el: Element | null | undefined) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 };
  };
  return {
    mark: Boolean(mark),
    holder: holder ? holder.tagName.toLowerCase() : null,
    index: holder ? children.indexOf(holder) + 1 : 0,
    of: children.length,
    holderBox: box(holder),
    markBox: box(mark),
    past: Math.round((ag.getBoundingClientRect().bottom - bottom) * 100) / 100,
    page: document.scrollingElement!.scrollHeight,
  };
};

for (const width of [1440, 390])
  test(`look: Aurora Glass's no-script mark with script off at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await page.goto('/', { waitUntil: 'load' });
    await expect(page.locator('[data-variant]').first()).toHaveAttribute(
      'data-variant',
      'aurora-glass',
    );
    const parsed = await page.evaluate(read);
    console.log(`look nojs-mark ${width} parsed: ${JSON.stringify(parsed)}`);
    expect(parsed.mark, 'the parser made the mark an element').toBe(true);
    await page.evaluate(() => {
      for (const noscript of [...document.querySelectorAll('noscript')]) {
        const stand = document.createElement('div');
        stand.setAttribute('data-quality-noscript', '');
        stand.append(...noscript.childNodes);
        noscript.replaceWith(stand);
      }
    });
    const revealed = await page.evaluate(read);
    console.log(`look nojs-mark ${width} revealed: ${JSON.stringify(revealed)}`);
    expect(revealed.holderBox?.h, 'the stand-in has no height').toBe(0);
    expect(revealed.page, 'the page grows by nothing').toBe(parsed.page);
    expect(revealed.past, 'nothing in .ag runs past its other children').toBe(parsed.past);
  });
