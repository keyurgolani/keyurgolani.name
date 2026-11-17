import { expect, test } from '../harness/fixtures';
import {
  coalesceObserverDeliveries,
  completeThrough,
  deliveries,
  heldInThenOut,
  twoFrames,
  visitInTurn,
} from './observer-deliveries';

// Singular's bar docks its name into the page's h1 while the h1 shows and shows it again once the
// h1 has gone by, whatever the order its observer's entries arrive in. A page that goes back to
// the h1 and away again before the observer's task runs delivers both entries in one call, oldest
// first; read from the first, the name stayed docked into an h1 out of view, and the bar named no
// one. Every observer's deliveries are coalesced here (observer-deliveries.ts).

test.use({ appOptions: completeThrough('singular'), viewport: { width: 1440, height: 900 } });

test(
  "with the observers' entries delivered together, the bar shows the name once the h1 has gone by, after a visit back to it",
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    await coalesceObserverDeliveries(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    const bar = page.locator('.sg-bar');
    // While the h1 shows, the name is docked into it.
    await expect(bar).toHaveAttribute('data-sg-name', 'docked');
    // Past it, the bar shows the name.
    await visitInTurn(page, ['bottom']);
    await expect(bar).toHaveAttribute('data-sg-name', 'shown');
    // Back to the h1 and past it again, a frame apart, inside one delivery.
    const from = await deliveries(page);
    await visitInTurn(page, ['top', 'bottom']);
    await expect.poll(() => heldInThenOut(page, 'h1', from)).toBe(true);
    await twoFrames(page);
    // The delivery held the h1 in view and then out of it: the bar reads the latest.
    await expect(bar).toHaveAttribute('data-sg-name', 'shown');
  },
);
