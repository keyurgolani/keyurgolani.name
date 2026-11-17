import { expect, test } from '../harness/fixtures';
import { FIXTURE_APP, openFixtures, ROUTE } from './fixture-page';

// A printed page is the record, not the visitor's controls: printed, with every disclosure open as
// a composition opens them before printing, no part of the Appearance controls paints, the page's
// own or a plate's (its scheme menu, its display mode choices, Reset to site default).

test.use({ appOptions: FIXTURE_APP });

test(
  "printed, the page leaves the visitor's Appearance controls off",
  { annotation: [ROUTE] },
  async ({ page }) => {
    await openFixtures(page);
    await page.emulateMedia({ media: 'print' });
    const painted = await page.evaluate(() => {
      window.dispatchEvent(new Event('beforeprint'));
      for (const details of document.querySelectorAll('details')) details.open = true;
      return [...document.querySelectorAll('[data-ui-slot="appearance-control"]')].map(
        (control) => control.getClientRects().length > 0,
      );
    });
    expect(painted.length, 'Appearance controls on the page').toBeGreaterThan(0);
    expect(painted.filter(Boolean).length, 'Appearance controls printed').toBe(0);
  },
);
