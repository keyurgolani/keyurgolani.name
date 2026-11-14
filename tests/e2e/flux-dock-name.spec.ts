import { AxeBuilder } from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { appFor } from './flux-shared';

// Flux's phone dock on the long-text fixture: the owner's name tab never cuts the name on a
// line. A name wider than its tab wraps onto a second line, and only a name longer than two lines
// ends in an ellipsis there. The link is the name's, in every state: where it shows, its
// accessible name is the whole name; where there's no room for it, it goes whole, out of the
// accessibility tree and the tab order, so the dock never holds a link without a name. At
// 320x568 and 390x844, at default and 200% root text, at the opening and with a sheet being read,
// with script on and off; with script, axe's link rules pass on the dock in each state. Each check
// is soft, so every state's verdict, axe's included, is on record however the first one goes. Its
// own file, since a worker-scoped appOptions can't be set in a describe.

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

const fixture = contractFixture('long-text');
test.use({ appOptions: appFor(fixture) });

const LINK = '#fx--bar .fx-tab--name';

/** The name tab's words as shown: each one's text, its box and its content, and its lines. */
const nameTab = () =>
  [...document.querySelectorAll<HTMLElement>('#fx--bar .fx-tab--name .fx-tab__word')]
    .filter((word) => {
      if (word.getClientRects().length === 0) return false;
      for (let el: Element | null = word; el; el = el.parentElement)
        if (getComputedStyle(el).visibility === 'hidden') return false;
      return true;
    })
    .map((word) => {
      const range = document.createRange();
      range.selectNodeContents(word);
      const tops = [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.bottom <= word.getBoundingClientRect().bottom + 1)
        .map((rect) => Math.round(rect.top));
      return {
        text: word.textContent?.trim() ?? '',
        clientWidth: word.clientWidth,
        scrollWidth: word.scrollWidth,
        clientHeight: word.clientHeight,
        scrollHeight: word.scrollHeight,
        lines: new Set(tops).size,
      };
    });

async function expectDockName(page: Page, state: string, name: string, axe: boolean) {
  for (const word of await page.evaluate(nameTab)) {
    const at = `${state}: "${word.text}"`;
    expect.soft(word.text, `${at} is the whole name in the page`).toBe(name);
    expect
      .soft(word.scrollWidth, `${at} never runs past its tab on a line`)
      .toBeLessThanOrEqual(word.clientWidth);
    expect.soft(word.lines, `${at} takes at most two lines`).toBeLessThanOrEqual(2);
    if (word.scrollHeight > word.clientHeight + 1)
      expect.soft(word.lines, `${at} is cut only on its second line`).toBe(2);
  }
  const link = page.locator(LINK);
  if (await link.isVisible()) {
    await expect
      .soft(link, `${state}: the link's accessible name is the whole name`)
      .toHaveAccessibleName(name);
  } else {
    // Gone whole: no box, nothing to focus, so no link without a name.
    const gone = await link.evaluate((el) => {
      (el as HTMLElement).focus({ preventScroll: true });
      const focused = document.activeElement === el;
      (el as HTMLElement).blur();
      return { boxes: el.getClientRects().length, focused };
    });
    expect.soft(gone, `${state}: a name with no room leaves no link behind`).toEqual({
      boxes: 0,
      focused: false,
    });
  }
  if (axe) {
    const results = await new AxeBuilder({ page })
      .withRules(['link-name', 'aria-hidden-focus'])
      .include('#fx--bar')
      .analyze();
    expect
      .soft(
        results.violations.flatMap((rule) =>
          rule.nodes.map((node) => `${rule.id}: ${node.target}`),
        ),
        `${state}: axe's link rules on the dock`,
      )
      .toEqual([]);
  }
}

const cases = [
  [320, 568, 1],
  [390, 844, 1],
  [320, 568, 2],
  [390, 844, 2],
] as const;

async function walk(page: Page, width: number, height: number, text: number, axe: boolean) {
  await page.setViewportSize({ width, height });
  await page.goto('/', { waitUntil: 'networkidle' });
  if (text !== 1)
    await page.evaluate(
      (scale) =>
        document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important'),
      text,
    );
  await page.waitForTimeout(300);
  const name = await page
    .locator(`${LINK} .fx-tab__word`)
    .evaluate((word) => word.textContent?.trim() ?? '');
  expect(name, 'the fixture names the owner at length').toMatch(/^\S+ \S{40,}$/);
  await expectDockName(page, 'opening', name, axe);
  // A sheet being read: with script, the dock shows its destination beside the name.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  await page.waitForTimeout(300);
  await expectDockName(page, 'reading', name, axe);
}

for (const [width, height, text] of cases)
  test(
    `at ${width}x${height}, root text ${text * 100}%: the dock's name tab wraps the owner's name before it cuts it, and its link is the whole name or none`,
    { annotation },
    async ({ page }) => {
      await walk(page, width, height, text, true);
    },
  );

test.describe('with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });
  for (const [width, height, text] of cases)
    test(
      `at ${width}x${height}, root text ${text * 100}%, no script: the dock's name tab wraps the owner's name before it cuts it, and its link is the whole name or none`,
      { annotation },
      async ({ page }) => {
        await walk(page, width, height, text, false);
      },
    );
});
