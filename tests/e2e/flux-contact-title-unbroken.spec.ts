import { test } from '../harness/fixtures';
import { appWithContactTitle, expectContactTitleFits } from './flux-shared';

// Flux with a 30-character contact title that has no break in it (code
// review, Flux P1 delta 2): at step 3 it's still wider than the tab at 320,
// so it breaks inside the word, never past the window's edge or over the
// sheet above. The complete fixture, under read-only.

const TITLE = 'Projektzusammenarbeitsanfragen';
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({ appOptions: appWithContactTitle(TITLE) });

for (const width of [320, 390]) {
  test(
    `at ${width}: a 30-character unbroken contact title fits its tab, past no edge and over no text`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await expectContactTitleFits(page, TITLE);
    },
  );
}
