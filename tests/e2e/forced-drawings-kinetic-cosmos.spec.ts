import { expect, test } from '../harness/fixtures';
import { annotation, drawingsAmong, FORCED_CASES, fixtureIn, openForced } from './forced-backplate';

// Kinetic Cosmos under forced colours: its stages lay the scheme's text colour as their ground and
// draw in their ink, the orrery's orbits and bodies, the opening's first action's pill, the
// signature's pill and the Index's and the band's rules. Forced colours lay a backplate under
// words, not under drawings, so each drawing must hold on the stage's ground by itself. Each is
// judged in pixels with the page's words hidden (forced-backplate.ts), in both system palettes, at
// 1024 and 390.

test.use({ appOptions: fixtureIn('kinetic-cosmos') });

const DRAWINGS = [
  '.kc-orrery',
  '.kc-opening__actions .kc-button--bright',
  '.kc-signature-label',
  '.kc-masthead .kc-index-trigger',
  '.kc-band',
];

for (const at of FORCED_CASES.filter(({ route }) => route === '/')) {
  test(
    `under forced colours, in the ${at.palette} palette, at ${at.width}, home: the stages' drawings, the orrery, the pills and the rules, hold on their ground`,
    { annotation: annotation(at.route) },
    async ({ page }) => {
      await openForced(page, at);
      const { judged, lost } = await drawingsAmong(page, DRAWINGS);
      expect(judged, 'drawings judged').toBeGreaterThan(0);
      expect(lost, 'drawings lost on their ground').toEqual([]);
    },
  );
}
