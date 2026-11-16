import { expect, test } from '../harness/fixtures';
import { annotation, FORCED_CASES, fixtureIn, openForced, vanishedAmong } from './forced-backplate';

// Raw Grid under forced colours: its tabs, its emphasis sticker, its first action, its current
// destination and its pressed ticker keep the author's colours (forced-color-adjust: none), so no
// backplate is laid under their words, which read on their own dark ground. Each is judged in
// pixels against that ground (forced-backplate.ts), in both system palettes, at 1024 and 390.

test.use({ appOptions: fixtureIn('raw-grid') });

const ISLANDS = [
  '.rg-tab',
  '.rg-index__tab',
  ".rg-sticker[data-tone='emphasis']",
  '.rg-act:first-child',
  '.rg-head__dest[aria-current]',
  ".rg-ticker__toggle [aria-pressed='true']",
];

for (const at of FORCED_CASES.filter(({ route }) => route === '/')) {
  test(
    `under forced colours, in the ${at.palette} palette, at ${at.width}, home: Raw Grid's unadjusted islands keep their words readable on their own ground`,
    { annotation: annotation(at.route) },
    async ({ page }) => {
      await openForced(page, at);
      const { judged, vanished } = await vanishedAmong(page, ISLANDS);
      expect(judged, 'texts judged').toBeGreaterThan(0);
      expect(vanished, 'island words that vanish into their ground').toEqual([]);
    },
  );
}
