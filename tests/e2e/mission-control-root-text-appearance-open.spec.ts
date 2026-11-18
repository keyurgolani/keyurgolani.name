import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Mission Control on a phone at 320 and 390 with the root text at 200%, as a reader's own text size
// sets it: the home page with the status line's Appearance disclosure open is no wider than the
// window. The check names what runs past either edge, so a failure points at it. On the consulting
// contract fixture, where the open panel is widest, in its own tuple.

const FIXTURE = contractFixture('consulting');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  isMobile: true,
  hasTouch: true,
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'mission-control'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

/** What runs past either edge of the window, widest first: each element's path and box. */
const past = (page: Page) =>
  page.evaluate(() => {
    const html = document.documentElement;
    const edge = html.clientWidth;
    const path = (el: Element) => {
      const parts: string[] = [];
      for (
        let node: Element | null = el;
        node && node !== html && parts.length < 4;
        node = node.parentElement
      )
        parts.unshift(
          `${node.localName}${[...node.classList]
            .slice(0, 2)
            .map((c) => `.${c}`)
            .join('')}`,
        );
      return parts.join(' > ');
    };
    const inside = (r: DOMRect) => r.right <= edge + 0.5 && r.left >= -0.5;
    const out: { path: string; left: number; right: number; width: number }[] = [];
    for (const el of document.querySelectorAll('body *')) {
      // An icon's insides are its own svg's to clip: the svg stands for them.
      if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || inside(r)) continue;
      // Inside a scroller of its own, or a layer fixed to the window, it doesn't widen the page.
      let clipped = false;
      for (let node: Element | null = el; node && node !== html; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.position === 'fixed') {
          clipped = true;
          break;
        }
        if (node !== el && style.overflowX !== 'visible') {
          clipped = inside(node.getBoundingClientRect());
          break;
        }
      }
      if (!clipped)
        out.push({
          path: path(el),
          left: Math.round(r.left * 10) / 10,
          right: Math.round(r.right * 10) / 10,
          width: Math.round(r.width),
        });
    }
    out.sort((a, b) => b.width - a.width);
    return { scroll: html.scrollWidth, client: edge, past: out.slice(0, 12) };
  });

for (const [width, height] of [
  [320, 568],
  [390, 844],
] as const) {
  test(`at ${width} with the root text at 200%, the home page with its Appearance disclosure open doesn't scroll sideways`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() =>
      document.documentElement.style.setProperty('font-size', '200%', 'important'),
    );
    const appearance = page.locator('.mc-status__end details');
    await expect(appearance, 'the status line holds the Appearance disclosure').toHaveCount(1);
    await appearance.locator('summary').click();
    await expect(appearance).toHaveJSProperty('open', true);
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const read = await past(page);
    console.log(
      `mission control consulting ${width} 200% appearance open: ${JSON.stringify(read)}`,
    );
    expect(
      read.scroll,
      `the page is no wider than the window: ${JSON.stringify(read.past)}`,
    ).toBeLessThanOrEqual(read.client);
  });
}
