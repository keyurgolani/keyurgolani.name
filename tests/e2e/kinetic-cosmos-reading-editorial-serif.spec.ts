import { expect, test } from '../harness/fixtures';
import {
  annotation,
  bodiesOffSize,
  kineticOptions,
  openHome,
  planetBodies,
} from './kinetic-cosmos-reading';

// Kinetic Cosmos on Editorial Serif (platform-neutral, warm-parchment, light), a narrow face, as its
// quality cells read it (kinetic-cosmos-reading.ts): each planet's body encodes its figure's
// magnitude, so it keeps that size whatever its figure's face.

test.use({
  appOptions: kineticOptions({
    language: 'platform-neutral',
    scheme: 'warm-parchment',
    typography: 'editorial-serif',
    mode: 'light',
  }),
});

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [390, 844],
] as const)
  test(
    `at ${width}, every planet is the size its figure's magnitude gives, round, and never smaller than a lesser one`,
    { annotation },
    async ({ page }) => {
      await openHome(page, { width, height, row: 'default' });
      const bodies = await planetBodies(page);
      expect(bodies.length, 'the planets').toBeGreaterThan(0);
      expect(bodiesOffSize(bodies), 'the bodies off their size').toEqual([]);
    },
  );
