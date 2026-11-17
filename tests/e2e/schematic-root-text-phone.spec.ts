import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { annotation, openTuple, servingSchematic, type Tuple } from './schematic-tuples';

// Schematic with the root text at 200% on a phone (390 and 320), set as the quality cells'
// root-text condition sets it (the root's font-size at 200%, important, after the page loads):
// the page is no wider than the window, on home and on a case. The cells read 200% text at 1024
// only, where the cover's title block and the foot were fixed before; on a phone the page
// scrolled sideways. The complete fixture on the cells' tuple; what runs past the window's right
// edge is in the message.

test.use({ appOptions: servingSchematic() });

const TUPLE: Tuple = 'platform-neutral/warm-parchment/humanist-ui/system';

/** The page's width against the window, and what runs past its right edge, deepest first. */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const html = document.documentElement;
    const client = html.clientWidth;
    const past = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > client + 0.5 && el.checkVisibility();
      })
      .filter((el, _, all) => !all.some((other) => other !== el && el.contains(other)))
      .slice(0, 8)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/) : [];
        const name = [el.localName, ...classes.filter(Boolean)].join('.');
        return `${name} ${Math.round(r.left)}..${Math.round(r.right)}`;
      });
    return { scroll: html.scrollWidth, client, past };
  });

for (const [width, height] of [
  [390, 844],
  [320, 568],
] as const)
  test.describe(`at ${width}`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });
    for (const [name, route] of [
      ['the home page', '/'],
      ['a case', '/work/project-name'],
    ] as const)
      test(
        `with the root text at 200% at ${width}, ${name} doesn't scroll sideways`,
        {
          annotation: [
            ...annotation.filter((a) => a.type !== 'route'),
            { type: 'route', description: route },
          ],
        },
        async ({ page, app }) => {
          await openTuple(page, app.origin, TUPLE, route);
          await page.evaluate(() =>
            document.documentElement.style.setProperty('font-size', '200%', 'important'),
          );
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
          const read = await sideways(page);
          expect(
            read.scroll,
            `the page is no wider than the screen; past it: ${read.past.join('; ')}`,
          ).toBeLessThanOrEqual(read.client);
        },
      );
  });
