// Look shots for one CI proof (laid in by the proof kit, never in a head's tree): Raw Grid's home on
// the complete contract fixture in Cyberpunk, Liquid Dusk and Accessible Reading, dark, at 1440,
// loaded and settled as the quality cell loads it. For the index's ABOUT and CONTACT column
// headings: the page scrolled so the index row's top rests 10px under the window's top, as the
// cell's walk had it, focus on the link before the heading, then one Tab. The shot is the window's
// top after the Tab; beside it, the heading's box, what its centre hits, the scroll before and
// after the Tab and the root's scroll-padding.
// Out: $PROOF_LOOK_OUT/1440-dark-about.png, 1440-dark-contact.png and 1440-dark-tab.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { loadForPass } from '../quality/lib/run-cell';
import { sweepSiteText } from '../quality/lib/server';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: sweepSiteText(
      fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'raw-grid'),
    ),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});

const PACKS = {
  language: 'cyberpunk',
  scheme: 'liquid-dusk',
  type: 'accessible-reading',
  mode: 'dark',
} as const;

const HEADINGS = [
  { name: 'about', path: '#rg--index > ul:nth-child(2) > li:nth-child(4) > a:nth-child(1)' },
  { name: 'contact', path: '#rg--index > ul:nth-child(2) > li:nth-child(5) > a:nth-child(1)' },
] as const;

test('look 1440 dark index headings reached by Tab under the header row', async ({ page, app }) => {
  test.setTimeout(180_000);
  const out = process.env.PROOF_LOOK_OUT ?? '';
  expect(out, 'PROOF_LOOK_OUT').not.toBe('');
  mkdirSync(out, { recursive: true });
  await page.context().addCookies([
    {
      name: 'portfolio_appearance',
      value: new URLSearchParams(PACKS).toString(),
      url: app.origin,
    },
  ]);
  const loaded = await loadForPass(page, '/');
  expect({ settled: loaded.settled, enhanced: loaded.enhanced }).toEqual({
    settled: true,
    enhanced: true,
  });
  const boundary = page.locator('[data-appearance-boundary]').first();
  await expect(boundary).toHaveAttribute('data-design-language', PACKS.language);
  await expect(boundary).toHaveAttribute('data-display-mode', PACKS.mode);
  await page.evaluate(() => document.fonts.ready);
  const reads: unknown[] = [];
  for (const heading of HEADINGS) {
    // The index row's top 10px under the window's top, focus on the link before the heading.
    const before = await page.evaluate((selector) => {
      const link = document.querySelector<HTMLElement>(selector)!;
      const focusable = [...document.querySelectorAll<HTMLElement>('a[href], button')].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      const previous = focusable[focusable.indexOf(link) - 1]!;
      const top = link.getBoundingClientRect().top + scrollY;
      scrollTo({ left: 0, top: top - 10, behavior: 'instant' });
      previous.focus({ preventScroll: true });
      return { scrollY: Math.round(scrollY), previous: (previous.textContent ?? '').trim() };
    }, heading.path);
    await page.keyboard.press('Tab');
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const read = await page.evaluate(
      ({ selector, name }) => {
        const r = (n: number) => Math.round(n * 10) / 10;
        const link = document.querySelector<HTMLElement>(selector)!;
        const b = link.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        const head = document.querySelector('.rg-head')?.getBoundingClientRect();
        const label = (el: Element | null) =>
          el
            ? `${el.localName}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`
            : 'nothing';
        return {
          name,
          focused: document.activeElement === link,
          box: [r(b.left), r(b.top), r(b.right), r(b.bottom)],
          hits: hit === link || link.contains(hit) ? 'itself' : label(hit),
          head: head ? [r(head.top), r(head.bottom)] : null,
          scrollYAfter: Math.round(scrollY),
          rootScrollPaddingTop: getComputedStyle(document.documentElement).scrollPaddingTop,
          linkScrollMarginTop: getComputedStyle(link).scrollMarginTop,
        };
      },
      { selector: heading.path, name: heading.name },
    );
    reads.push({ ...read, before });
    await page.screenshot({
      path: path.join(out, `1440-dark-${heading.name}.png`),
      clip: { x: 0, y: 0, width: 1440, height: 360 },
      animations: 'disabled',
      caret: 'hide',
    });
  }
  writeFileSync(path.join(out, '1440-dark-tab.json'), `${JSON.stringify(reads, null, 2)}\n`);
});
