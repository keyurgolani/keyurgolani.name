import { test } from '../harness/fixtures';
import { appWithContactTitle, expectContactTitleFits } from './flux-shared';

// Flux with a Japanese contact title (code review, Flux P1 delta 2): about
// an em a character, so its tab sizes it from that width, and it wraps
// between characters at step 3, past no edge and over none of the sheet
// above. The complete fixture, under read-only.

const TITLE = 'お気軽にお問い合わせください';
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({ appOptions: appWithContactTitle(TITLE) });

for (const width of [320, 390]) {
  test(
    `at ${width}: a Japanese contact title fits its tab, past no edge and over no text`,
    { annotation },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await expectContactTitleFits(page, TITLE);
    },
  );
}
