import { expect, test } from '../harness/fixtures';
import {
  coalesceObserverDeliveries,
  completeThrough,
  deliveries,
  heldInThenOut,
  twoFrames,
  visitInTurn,
} from './observer-deliveries';

// Aurora Glass's sky rests while its opening is out of view and drifts while it shows, whatever the
// order its observer's entries arrive in. A page that goes back to the opening and away again
// before the observer's task runs delivers both entries in one call, oldest first; read from the
// first, the sky kept drifting away from the reader. Every observer's deliveries are coalesced here
// (observer-deliveries.ts), so that order is the one the page gets.

test.use({ appOptions: completeThrough('aurora-glass'), viewport: { width: 1440, height: 900 } });

test(
  "with the observers' entries delivered together, the sky rests once the opening has gone by, after a visit back to it",
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    await coalesceObserverDeliveries(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    const sky = page.locator('.ag');
    // While the opening shows, the sky drifts.
    await expect(sky).toHaveAttribute('data-ag-sky', 'drift');
    // Past it, the sky rests.
    await visitInTurn(page, ['bottom']);
    await expect(sky).toHaveAttribute('data-ag-sky', 'paused');
    // Back to the opening and past it again, a frame apart, inside one delivery.
    const from = await deliveries(page);
    await visitInTurn(page, ['.ag-opening', 'bottom']);
    await expect.poll(() => heldInThenOut(page, '.ag-opening', from)).toBe(true);
    await twoFrames(page);
    // The delivery held the opening in view and then out of it: the sky reads the latest.
    await expect(sky).toHaveAttribute('data-ag-sky', 'paused');
  },
);
