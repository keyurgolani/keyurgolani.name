import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Mission Control on a phone at 320 with the root text at 200%, as a reader's own text size sets
// it: the home page is no wider than the window. The check names what runs past the window's
// edge, so a failure points at it. On the design contract fixture, in its own design language,
// colour scheme and typography, whose longer names and words the complete fixture doesn't have.

const FIXTURE = contractFixture('design');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 320, height: 568 },
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

/** What runs past the window's right edge, widest first: each element's path and right edge. */
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
    const out: { path: string; right: number; width: number; css: string }[] = [];
    for (const el of document.querySelectorAll('body *')) {
      // An icon's insides are its own svg's to clip: the svg stands for them.
      if (el instanceof SVGElement && !(el instanceof SVGSVGElement)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= edge + 0.5) continue;
      // Inside a scroller of its own, or a layer fixed to the window, it doesn't widen the page.
      let clipped = false;
      for (let node: Element | null = el; node && node !== html; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.position === 'fixed') {
          clipped = true;
          break;
        }
        if (node !== el && style.overflowX !== 'visible') {
          clipped = node.getBoundingClientRect().right <= edge + 0.5;
          break;
        }
      }
      if (!clipped)
        out.push({
          path: path(el),
          right: Math.round(r.right * 10) / 10,
          width: Math.round(r.width),
          css: (({ display, whiteSpace, position }) => `${display} ${whiteSpace} ${position}`)(
            getComputedStyle(el),
          ),
        });
    }
    out.sort((a, b) => b.right - a.right);
    return { scroll: html.scrollWidth, client: edge, past: out.slice(0, 12) };
  });

for (const route of ['/']) {
  test(
    `at 320 with the root text at 200%, the home page doesn't scroll sideways`,
    { annotation: [{ type: 'route', description: route }] },
    async ({ page }) => {
      await page.goto(route, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() =>
        document.documentElement.style.setProperty('font-size', '200%', 'important'),
      );
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const read = await past(page);
      console.log(`mission control design 320 200% ${route}: ${JSON.stringify(read)}`);
      expect(
        read.scroll,
        `the page is no wider than the window: ${JSON.stringify(read.past)}`,
      ).toBeLessThanOrEqual(read.client);
    },
  );
}
