import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Aurora Glass on the long-text fixture at phone widths: with every fold open, no line of text
// runs past its card (a pane, a lite or a sheet) or past the window's edges, where .ag's clip
// would cut it. Text inside a box that scrolls sideways is the scroller's and is left out, as is
// text hidden for assistive technology. Its own file, since a worker-scoped appOptions can't be
// set in a describe.

const FIXTURE = contractFixture('long-text');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

/** Every line of text past its card or the window, as `<text> in <element>: <left>..<right> (<what>)`. */
const textPastItsCard = () => {
  const width = document.documentElement.clientWidth;
  const root = document.querySelector('.ag')!;
  const name = (el: Element) =>
    `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : ''}`;
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    const parent = node.parentElement;
    if (!text || !parent) continue;
    if (parent.closest('.ag-hidden, [hidden], [aria-hidden="true"]')) continue;
    if (parent.closest('[data-visitor-control-slot] details:not([open])')) continue;
    let shown = true;
    for (let el: Element | null = parent; el && el !== root; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.overflowX === 'auto' ||
        style.overflowX === 'scroll'
      ) {
        shown = false;
        break;
      }
    }
    if (!shown) continue;
    const card = parent.closest('.ag-pane, .ag-lite, .ag-sheet');
    const edge = card?.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width < 1) continue;
      const what: string[] = [];
      if (rect.right > width + 0.5 || rect.left < -0.5) what.push('past the window');
      if (edge && (rect.right > edge.right + 0.5 || rect.left < edge.left - 0.5))
        what.push(`past ${name(card!)} ${Math.round(edge.left)}..${Math.round(edge.right)}`);
      if (what.length)
        out.push(
          `${text.slice(0, 40)} in ${name(parent)}: ${Math.round(rect.left)}..${Math.round(rect.right)} (${what.join(', ')})`,
        );
    }
  }
  return out;
};

for (const width of [320, 390, 414])
  test(`at ${width}: no line of text runs past its card or the window's edges`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    await expect(page.locator('[data-variant]').first()).toHaveAttribute(
      'data-variant',
      'aurora-glass',
    );
    await page.evaluate(() =>
      document.querySelectorAll('.ag details').forEach((fold) => {
        if (!fold.closest('[data-visitor-control-slot]')) (fold as HTMLDetailsElement).open = true;
      }),
    );
    expect(await page.evaluate(textPastItsCard)).toEqual([]);
  });
