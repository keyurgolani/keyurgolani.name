import { expect, test } from '../harness/fixtures';
import {
  coalesceObserverDeliveries,
  completeThrough,
  deliveries,
  heldInThenOut,
  twoFrames,
  visitInTurn,
} from './observer-deliveries';

// Flux marks the page scrolled (data-fx-scrolled), and so gives the bar its strip, once the page's
// first pixel is out of view, whatever the order its observer's entries arrive in. A page that
// goes back to the top and down again before the observer's task runs delivers both entries in
// one call, oldest first; read from the first, the page read as at its top and the bar lost its
// strip over the page. Every observer's deliveries are coalesced here (observer-deliveries.ts).

test.use({ appOptions: completeThrough('flux'), viewport: { width: 1440, height: 900 } });

test(
  "with the observers' entries delivered together, the page reads as scrolled once its top has gone by, after a visit back to it",
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    await coalesceObserverDeliveries(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    const root = page.locator('.fx[data-fx-live]');
    // At the top, the page isn't scrolled.
    await expect(root).not.toHaveAttribute('data-fx-scrolled');
    // Down the page, it is.
    await visitInTurn(page, ['bottom']);
    await expect(root).toHaveAttribute('data-fx-scrolled');
    // Back to the top and down again, a frame apart, inside one delivery.
    const from = await deliveries(page);
    await visitInTurn(page, ['top', 'bottom']);
    await expect.poll(() => heldInThenOut(page, '.fx-top', from)).toBe(true);
    await twoFrames(page);
    // The delivery held the top in view and then out of it: the page reads the latest.
    await expect(root).toHaveAttribute('data-fx-scrolled');
  },
);
