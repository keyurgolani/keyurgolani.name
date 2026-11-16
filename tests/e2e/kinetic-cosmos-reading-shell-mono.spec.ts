import { expect, test } from '../harness/fixtures';
import {
  annotation,
  arcStops,
  bodiesOffSize,
  FIGURE,
  contrastFindings,
  described,
  kineticOptions,
  openHome,
  planetBodies,
} from './kinetic-cosmos-reading';

// Kinetic Cosmos on Shell Mono (art-deco, forest-moss, dark), a wide monospace face, as its quality
// cells read it (kinetic-cosmos-reading.ts). At 1024 the orbit line's stops ride the arc in two tiers
// with no wrap, and the Record ring's labels, about a tenth of the line apart, overlap their
// neighbours and the line itself. The stats figure and its unit are set at fixed sizes on a planet
// sized by the figure's magnitude, so on a phone, and at 1024 and 1440 for the large figure, they
// reach past the planet's fill onto its rims.

test.use({
  appOptions: kineticOptions({
    language: 'art-deco',
    scheme: 'forest-moss',
    typography: 'shell-mono',
    mode: 'dark',
  }),
});

test(
  "at 1024, each of the Record ring's orbit-line labels reaches the text ratio against its worst background pixel",
  { annotation },
  async ({ page }) => {
    await openHome(page, { width: 1024, height: 768, row: 'default' });
    const stops = await arcStops(page, 'record');
    expect(stops.length, "the Record ring's stops").toBeGreaterThan(5);
    const failing = (await contrastFindings(page, stops)).filter((f) => f.rule === 'text');
    expect(described(failing), 'the labels under the text ratio').toEqual([]);
  },
);

test(
  'at 390, the stats figure and its unit reach the text ratio against their worst background pixel',
  { annotation },
  async ({ page }) => {
    await openHome(page, { width: 390, height: 844, row: 'default' });
    const failing = (await contrastFindings(page, FIGURE)).filter((f) => f.rule === 'text');
    expect(described(failing), 'the figure and its unit under the text ratio').toEqual([]);
  },
);

test(
  "under more contrast, at 1024, the Record ring's orbit-line labels, and at 390 the stats figure and its unit, reach the high-contrast text ratio",
  { annotation },
  async ({ page }) => {
    await openHome(page, { width: 1024, height: 768, row: 'contrast-more' });
    const stops = await arcStops(page, 'record');
    const labels = (await contrastFindings(page, stops)).filter(
      (f) => f.rule === 'high-contrast-text',
    );
    expect(described(labels), 'the labels under the high-contrast text ratio').toEqual([]);
    await openHome(page, { width: 390, height: 844, row: 'contrast-more' });
    const figure = (await contrastFindings(page, FIGURE)).filter(
      (f) => f.rule === 'high-contrast-text',
    );
    expect(described(figure), 'the figure and its unit under the ratio').toEqual([]);
  },
);

for (const [width, height] of [
  [1024, 768],
  [1440, 900],
] as const)
  test(
    `at ${width}, the stats figure reaches the large-text ratio against its worst background pixel`,
    { annotation },
    async ({ page }) => {
      await openHome(page, { width, height, row: 'default' });
      const failing = (await contrastFindings(page, FIGURE)).filter((f) => f.rule === 'large-text');
      expect(described(failing), 'the figure under the large-text ratio').toEqual([]);
    },
  );

for (const [width, height] of [
  [1024, 768],
  [1440, 900],
] as const)
  test(
    `under more contrast, at ${width}, the stats figure reaches the high-contrast large-text ratio`,
    { annotation },
    async ({ page }) => {
      await openHome(page, { width, height, row: 'contrast-more' });
      const failing = (await contrastFindings(page, FIGURE)).filter(
        (f) => f.rule === 'high-contrast-large-text',
      );
      expect(described(failing), 'the figure under the high-contrast large-text ratio').toEqual([]);
    },
  );

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
