import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { appFor } from './flux-shared';

// A case page's crumb, the home sheet's word over the title and what the work is beside it, wraps
// onto a second line at a phone's width. A focused link's ring reaches its outline-offset plus its
// outline-width past the link's box. Where the second line began at the link's foot, its text lay
// inside that reach: under forced colors the line's text plate covered the ring's foot (at 390x844
// with the Linux fonts, 2 of the foot's 39 points at 3:1). Each line the crumb wraps onto starts at
// least a ring's reach and 1px below the link's box. At 320 the crumb wraps with any fonts; at 390
// it does with some. Its own file, since a worker-scoped appOptions can't be set in a describe.

const annotation = [
  { type: 'route', description: '/work/project-name' },
  { type: 'profile', description: 'read-only' },
];

test.use({ appOptions: appFor(contractFixture('complete')) });

for (const [width, height, wraps] of [
  [320, 568, true],
  [390, 844, false],
] as const) {
  test(
    `at ${width}x${height}: each line the case crumb wraps onto clears its link's focus ring by 1px`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/work/project-name', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      // A Tab first, so a link focused from script after it matches :focus-visible.
      await page.keyboard.press('Tab');
      const read = await page.evaluate(() => {
        const crumb = document.querySelector<HTMLElement>('.fx-case__crumb')!;
        const link = crumb.querySelector<HTMLElement>(':scope > a')!;
        link.focus({ preventScroll: true });
        const style = getComputedStyle(link);
        const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
        const visible = link.matches(':focus-visible');
        const box = link.getBoundingClientRect();
        const foot = box.bottom;
        // Every item of the crumb on a line below the link's, its top under the link's middle.
        const below = [...crumb.children]
          .filter((item) => item !== link && item.getClientRects().length > 0)
          .map((item) => ({
            text: item.textContent?.trim().slice(0, 32) ?? '',
            top: item.getBoundingClientRect().top,
          }))
          .filter((item) => item.top > (box.top + box.bottom) / 2);
        link.blur();
        return { reach, visible, foot, below };
      });
      expect(read.visible, 'the crumb link matches :focus-visible').toBe(true);
      expect(read.reach, 'its ring').toBeGreaterThan(0);
      if (wraps) expect(read.below.length, `the crumb wraps at ${width}`).toBeGreaterThan(0);
      for (const item of read.below) {
        expect(
          item.top - read.foot,
          `${item.text}: its line under the link`,
        ).toBeGreaterThanOrEqual(read.reach + 1);
      }
    },
  );
}
