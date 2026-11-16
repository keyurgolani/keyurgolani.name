import { expect, test } from '../harness/fixtures';
import {
  annotation,
  arcStops,
  contrastFindings,
  described,
  FIGURE,
  kineticOptions,
  openHome,
  ringFindingsOf,
  type Row,
} from './kinetic-cosmos-reading';

// Kinetic Cosmos on Accessible Reading (paper-tactile, paper-ink, dark), a wide face at a large
// size, as its quality cells read it (kinetic-cosmos-reading.ts). Under more contrast every border
// role is the text's own colour, so a label that crowds a neighbour or the orbit line, or a figure
// that reaches its planet's rim, reads 1:1 there.

test.use({
  appOptions: kineticOptions({
    language: 'paper-tactile',
    scheme: 'paper-ink',
    typography: 'accessible-reading',
    mode: 'dark',
  }),
});

test(
  "under more contrast, at 1024, the Record ring's orbit-line labels, and at 390 the stats figure and its unit, reach the high-contrast text ratio",
  { annotation },
  async ({ page }) => {
    await openHome(page, { width: 1024, height: 768, row: 'contrast-more' });
    const stops = await arcStops(page, 'record');
    expect(stops.length, "the Record ring's stops").toBeGreaterThan(5);
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

for (const row of ['default', 'contrast-more'] as const satisfies readonly Row[])
  test(
    `at 1024, ${row}, the stage's first plate, focused by the keyboard, has a ring the focus check passes on its contrast`,
    { annotation },
    async ({ page }) => {
      await openHome(page, { width: 1024, height: 768, row });
      const plate = page.locator('.kc-plates .kc-plate__link').first();
      const failing = (await ringFindingsOf(page, plate)).filter((f) => f.rule === 'contrast');
      expect(described(failing), "the plate's ring under 3:1").toEqual([]);
    },
  );
