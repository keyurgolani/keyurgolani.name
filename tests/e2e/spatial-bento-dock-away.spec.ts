import { expect, test } from '../harness/fixtures';
import {
  coalesceObserverDeliveries,
  completeThrough,
  deliveries,
  heldInThenOut,
  twoFrames,
  visitInTurn,
} from './observer-deliveries';

// Spatial Bento's dock shows once the overview has scrolled away and hides while it shows,
// whatever the order its observer's entries arrive in. A page that goes back to the overview and
// away again before the observer's task runs delivers both entries in one call, oldest first; read
// from the first, the dock stayed hidden, and out of the tab order, past the overview. Every
// observer's deliveries are coalesced here (observer-deliveries.ts).

test.use({ appOptions: completeThrough('spatial-bento'), viewport: { width: 1440, height: 900 } });

test(
  "with the observers' entries delivered together, the dock shows once the overview has gone by, after a visit back to it",
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
  },
  async ({ page }) => {
    await coalesceObserverDeliveries(page);
    await page.goto('/', { waitUntil: 'networkidle' });
    const dock = page.locator('.sb-dock');
    // The dock's name is its overview's id with "-dock" after it.
    const overview = await dock.evaluate(
      (nav) => `#${CSS.escape(nav.getAttribute('aria-labelledby')!.replace(/-dock$/, ''))}`,
    );
    // While the overview shows, the dock is hidden.
    await expect(dock).toHaveAttribute('data-state', 'hidden');
    // Past it, the dock shows.
    await visitInTurn(page, ['bottom']);
    await expect(dock).toHaveAttribute('data-state', 'shown');
    // Back to the overview and past it again, a frame apart, inside one delivery.
    const from = await deliveries(page);
    await visitInTurn(page, ['top', 'bottom']);
    await expect.poll(() => heldInThenOut(page, overview, from)).toBe(true);
    await twoFrames(page);
    // The delivery held the overview in view and then out of it: the dock reads the latest.
    await expect(dock).toHaveAttribute('data-state', 'shown');
  },
);
