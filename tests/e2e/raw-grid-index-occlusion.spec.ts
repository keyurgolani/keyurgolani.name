import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { keyboardFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { loadForPass } from '../quality/lib/run-cell';
import { sweepSiteText } from '../quality/lib/server';

// Raw Grid ends in an index of the site, a grid of columns of links. In Cyberpunk, Liquid Dusk and
// Accessible Reading, dark, at 1440, the quality cell's keyboard walk found two of the index's links
// obscured when they took focus: the point at each one's centre hit a part of the header's row,
// which sticks to the top of the window, not the link, though the link is drawn clear of the row.
// Loaded as the cell loads it, settled with its enhancements mounted, and walked from the keyboard
// as it walks it, with the occlusion check at each stop, no stop on the page is obscured. On the complete contract fixture,
// the packs and mode by the visitor's cookie, guarded on the page's outermost boundary.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

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

test(
  "at 1440 in Liquid Dusk's dark in Accessible Reading, no stop the keyboard reaches is obscured",
  { annotation, tag },
  async ({ page, app }) => {
    test.setTimeout(240_000);
    await page.context().addCookies([
      {
        name: 'portfolio_appearance',
        value: new URLSearchParams(PACKS).toString(),
        url: app.origin,
      },
    ]);
    // As the quality cell loads it: settled, with its enhancements mounted.
    const loaded = await loadForPass(page, '/');
    expect(
      { settled: loaded.settled, enhanced: loaded.enhanced },
      `the page settles with its enhancements: ${loaded.held ?? ''}`,
    ).toEqual({ settled: true, enhanced: true });
    const boundary = page.locator('[data-appearance-boundary]').first();
    await expect(boundary).toHaveAttribute('data-design-language', PACKS.language);
    await expect(boundary).toHaveAttribute('data-color-scheme', PACKS.scheme);
    await expect(boundary).toHaveAttribute('data-typography', PACKS.type);
    await expect(boundary).toHaveAttribute('data-display-mode', PACKS.mode);
    expect(await boundary.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
    await page.evaluate(() => document.fonts.ready);
    const findings = (await keyboardFindings(page, { occlusion: true })).filter(
      (finding) => finding.gate === 'occlusion',
    );
    // The first few again, Tabbed to from the page's top: where each rests, what its centre hits,
    // and the header's box and the window's scroll then.
    const rests: unknown[] = [];
    for (const finding of findings.slice(0, 3)) {
      const link = page.locator(finding.path!).first();
      await page.mouse.move(0, 0);
      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
        window.scrollTo(0, 0);
      });
      let presses = 0;
      while (presses < 600 && !(await link.evaluate((el) => el === document.activeElement))) {
        await page.keyboard.press('Tab');
        presses += 1;
      }
      const active = await inPage<Active>(page, { kind: 'active' });
      rests.push({
        path: finding.path,
        presses,
        box: active.box,
        hit: active.hit,
        layers: active.layers.slice(0, 4),
        page: await page.evaluate(() => {
          const head = document.querySelector('.rg-head')?.getBoundingClientRect();
          const el = document.activeElement as HTMLElement;
          return {
            scroll: [scrollX, Math.round(scrollY)],
            height: document.documentElement.scrollHeight,
            head: head ? [head.top, head.bottom].map((n) => Math.round(n)) : null,
            scrollMarginTop: getComputedStyle(el).scrollMarginTop,
            stickyOffset: getComputedStyle(el).getPropertyValue('--layout-sticky-offset'),
            // Every layer at the link's centre, top first: its box, how it's placed, and its
            // pseudo-elements' insets, so a part reaching past what it paints shows.
            stack: (() => {
              const b = el.getBoundingClientRect();
              const r = (n: number) => Math.round(n * 10) / 10;
              return document
                .elementsFromPoint(b.left + b.width / 2, b.top + b.height / 2)
                .slice(0, 6)
                .map((layer) => {
                  const s = getComputedStyle(layer);
                  const lb = layer.getBoundingClientRect();
                  const pseudo = (which: '::before' | '::after') => {
                    const p = getComputedStyle(layer, which);
                    return p.content === 'none' || p.content === 'normal'
                      ? null
                      : `${p.position} inset ${p.inset} size ${p.width}x${p.height}`;
                  };
                  return {
                    el: `${layer.localName}.${typeof layer.className === 'string' ? layer.className.split(/\s+/).join('.') : ''}`,
                    box: [r(lb.left), r(lb.top), r(lb.right), r(lb.bottom)],
                    style: `${s.display} ${s.position} z ${s.zIndex} pad ${s.padding} lh ${s.lineHeight} transform ${s.transform} overflow ${s.overflow}`,
                    before: pseudo('::before'),
                    after: pseudo('::after'),
                  };
                });
            })(),
          };
        }),
      });
    }
    expect(
      findings.map((finding) => `${finding.path}: ${finding.actual}`),
      `no stop is obscured: ${JSON.stringify(rests)}`,
    ).toEqual([]);
  },
);
