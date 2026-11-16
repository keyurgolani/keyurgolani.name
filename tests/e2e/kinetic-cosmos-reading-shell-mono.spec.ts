import { expect, test } from '../harness/fixtures';
import {
  annotation,
  arcStops,
  FIGURE,
  contrastFindings,
  described,
  kineticOptions,
  openHome,
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
