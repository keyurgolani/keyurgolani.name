// A CI read (laid in by the proof kit, never in a head's tree): Obsidian Atelier's home on the
// missing-media contract fixture in Warm Parchment, light, at 390 on phone emulation, at the default
// text size and with the root text at 200%. For each it writes how wide the page lays out and why:
// the page's widths, and for every grid band of the page (the chrome, the main's bands) its box, its
// computed column tracks and column gap, their sum, and its children's boxes; the chrome's top-row
// parts; and the platform lengths behind the grid. And a shot of the window's top.
// Self-contained: it imports only the harness and the contract fixtures.
// Out: $PROOF_LOOK_OUT/390-<100|200>.json and .png.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

const FIXTURE = contractFixture('missing-media');
const DIR = path.dirname(FIXTURE.files.portfolio);
test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(
      readFileSync(FIXTURE.files.site, 'utf8'),
      'obsidian-atelier',
    ).replace(/colorScheme: .*/, 'colorScheme: warm-parchment'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

function read(page: Page) {
  return page.evaluate(() => {
    const r = (n: number) => Math.round(n * 10) / 10;
    const label = (el: Element) =>
      `${el.localName}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''}`;
    const box = (el: Element) => {
      const b = el.getBoundingClientRect();
      return [r(b.left), r(b.top), r(b.right), r(b.bottom)];
    };
    const px = (v: string) =>
      v
        .split(/\s+/)
        .map((each) => Number.parseFloat(each))
        .filter((n) => Number.isFinite(n));
    const root = document.querySelector('[data-variant="obsidian-atelier"]')!;
    const grids = [...root.querySelectorAll<HTMLElement>('*')]
      .filter((el) => getComputedStyle(el).display === 'grid')
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => {
        const cs = getComputedStyle(el);
        const tracks = px(cs.gridTemplateColumns);
        const gap = Number.parseFloat(cs.columnGap) || 0;
        return {
          el: label(el),
          box: box(el),
          tracks: cs.gridTemplateColumns.slice(0, 200),
          trackCount: tracks.length,
          trackSum: r(tracks.reduce((a, b) => a + b, 0)),
          columnGap: cs.columnGap,
          gapsSum: r(gap * Math.max(0, tracks.length - 1)),
          paddingInline: `${cs.paddingLeft} ${cs.paddingRight}`,
          minWidth: cs.minWidth,
          widestChild: [...el.children]
            .map((child) => ({ el: label(child), right: r(child.getBoundingClientRect().right) }))
            .sort((a, b) => b.right - a.right)[0],
        };
      })
      .filter((each) => each.trackCount > 1)
      .sort((a, b) => b.box[2]! - a.box[2]!)
      .slice(0, 16);
    const chrome = document.querySelector('.oa-chrome');
    const row = chrome
      ? [...chrome.querySelectorAll(':scope > *, :scope > * > *')]
          .filter((el) => el.getBoundingClientRect().width > 0)
          .slice(0, 16)
          .map((el) => ({ el: label(el), box: box(el) }))
      : [];
    const probe = (name: string) => {
      const el = document.createElement('div');
      el.style.inlineSize = `var(${name})`;
      el.style.position = 'absolute';
      root.append(el);
      const w = el.getBoundingClientRect().width;
      el.remove();
      return r(w);
    };
    const rootStyle = getComputedStyle(root);
    return {
      pageWide: document.scrollingElement!.scrollWidth,
      innerWidth,
      clientWidth: document.documentElement.clientWidth,
      rootFontSize: getComputedStyle(document.documentElement).fontSize,
      lengths: {
        gutter: probe('--layout-grid-gutter'),
        margin: probe('--layout-grid-margin'),
        track: probe('--layout-track'),
        widthPage: probe('--layout-width-page'),
        gridColumns: rootStyle.getPropertyValue('--layout-grid-columns').trim(),
      },
      grids,
      chrome: row,
    };
  });
}

for (const size of ['100', '200'] as const) {
  test(`read the page's width at 390 with the root text at ${size}%`, async ({ page, app }) => {
    const out = process.env.PROOF_LOOK_OUT ?? '';
    expect(out, 'PROOF_LOOK_OUT').not.toBe('');
    mkdirSync(out, { recursive: true });
    await page.context().addCookies([
      {
        name: 'portfolio_appearance',
        value: new URLSearchParams({ scheme: 'warm-parchment', mode: 'light' }).toString(),
        url: app.origin,
      },
    ]);
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-variant]').first()).toHaveAttribute(
      'data-variant',
      'obsidian-atelier',
    );
    if (size === '200')
      await page.evaluate(() =>
        document.documentElement.style.setProperty('font-size', '200%', 'important'),
      );
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    writeFileSync(
      path.join(out, `390-${size}.json`),
      `${JSON.stringify(await read(page), null, 2)}\n`,
    );
    const width = await page.evaluate(() => innerWidth);
    await page.screenshot({
      path: path.join(out, `390-${size}.png`),
      clip: { x: 0, y: 0, width, height: 560 },
      animations: 'disabled',
      caret: 'hide',
    });
  });
}
