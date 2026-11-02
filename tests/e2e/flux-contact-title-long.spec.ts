import { test } from '../harness/fixtures';
import { appWithContactTitle, expectContactTitleFits } from './flux-shared';

// Flux with a 60-character contact title of ordinary words (code review,
// Flux P1 delta 2): Contact's tab slides to the start, its word shrinks to
// step 3 and then balances over as many lines as it needs, at 320 and 390,
// past no edge and over none of the sheet above. The complete fixture,
// under read-only.

const TITLE = "Let's talk about the reliability problem keeping you up late";
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({ appOptions: appWithContactTitle(TITLE) });

for (const width of [320, 390]) {
  test(
    `at ${width}: a 60-character contact title fits its tab, past no edge and over no text`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await expectContactTitleFits(page, TITLE);
    },
  );
}
