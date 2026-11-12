import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { appFor } from './flux-shared';

// Flux's case page at 320x568: a picture that can't be shown keeps its "Image
// unavailable" label whole. The case pictures go two to a row at 320, 115px each, and the label
// wraps to about 79px; an 8:5 box that holds its ratio with its overflow hidden, 72px tall, cut
// the label's last line. Each unavailable box holds its label wholly: nothing scrolls inside it,
// and the label's foot is inside the box's; and the picture keeps to its column, so its label and
// its caption stay inside the window. Its own file, since a worker-scoped appOptions can't be set
// in a describe.

const annotation = [
  { type: 'route', description: '/work/project-name' },
  { type: 'profile', description: 'read-only' },
];

test.use({ appOptions: appFor(contractFixture('complete')) });

test(
  "at 320x568 an unavailable case picture's box holds its label whole, and keeps to its column",
  { annotation },
  async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/work/project-name', { waitUntil: 'networkidle' });
    const boxes = await page.evaluate(() =>
      [
        ...document.querySelectorAll('.fx-case__pictures .pf-figure--unavailable > .pf-media-box'),
      ].map((box) => {
        const label = box.querySelector('.pf-media-box__label');
        const caption = box.closest('figure')?.querySelector('figcaption');
        const b = box.getBoundingClientRect();
        const l = label?.getBoundingClientRect();
        const c = caption?.getBoundingClientRect();
        return {
          scrollHeight: box.scrollHeight,
          clientHeight: box.clientHeight,
          boxBottom: b.bottom,
          labelBottom: l ? l.bottom : null,
          // What runs furthest past either edge of the window: the box, its label, its caption.
          left: Math.min(b.left, l?.left ?? Infinity, c?.left ?? Infinity),
          right: Math.max(b.right, l?.right ?? -Infinity, c?.right ?? -Infinity),
          width: innerWidth,
        };
      }),
    );
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      expect(box.labelBottom).not.toBeNull();
      expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight);
      expect(box.labelBottom!).toBeLessThanOrEqual(box.boxBottom + 0.5);
      expect(box.left, 'inside the window').toBeGreaterThanOrEqual(-0.5);
      expect(box.right, 'inside the window').toBeLessThanOrEqual(box.width + 0.5);
    }
  },
);
