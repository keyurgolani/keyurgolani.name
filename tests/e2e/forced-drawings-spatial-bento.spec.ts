import { expect, test } from '../harness/fixtures';
import { annotation, drawingsAmong, FORCED_CASES, fixtureIn, openForced } from './forced-backplate';

// Spatial Bento under forced colours: its inverse and accent tiles draw in their ink, the reach
// tile's mark, a ghost button's edge, a list's rules and a bar. Forced colours lay a backplate
// under words, not under drawings, so each drawing must hold on the tile's ground by itself. Each
// is judged in pixels with the page's words hidden (forced-backplate.ts), in both system palettes,
// at 1024 and 390.

test.use({ appOptions: fixtureIn('spatial-bento') });

const DRAWINGS = [
  '.sb-reach__mark',
  '.sb-tile--accent .sb-btn--ghost',
  '.sb-tile--inverse .sb-btn--ghost',
  '.sb-tile--inverse .sb-ruled',
  '.sb-tile--inverse .sb-ev',
  '.sb-tile--inverse .sb-bar',
];

for (const at of FORCED_CASES.filter(({ route }) => route === '/')) {
  test(
    `under forced colours, in the ${at.palette} palette, at ${at.width}, home: the inverse and accent tiles' drawings hold on their ground`,
    { annotation: annotation(at.route) },
    async ({ page }) => {
      await openForced(page, at);
      const { judged, lost } = await drawingsAmong(page, DRAWINGS);
      expect(judged, 'drawings judged').toBeGreaterThan(0);
      expect(lost, 'drawings lost on their ground').toEqual([]);
    },
  );
}
