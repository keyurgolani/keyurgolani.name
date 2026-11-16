import { expect, test } from '../harness/fixtures';
import {
  annotation,
  contrastFindings,
  described,
  FIGURE,
  kineticOptions,
  openHome,
  type Row,
} from './kinetic-cosmos-reading';

// Kinetic Cosmos on Field Serif (neobrutalist, high-contrast, dark) in its designed faces, as its quality cells
// read it (kinetic-cosmos-reading.ts). On a phone the stats planet's body is about 72 px across,
// and the figure and its unit, set as two lines on it, reach past its fill onto its rims.

test.use({
  appOptions: kineticOptions({
    language: 'neobrutalist',
    scheme: 'high-contrast',
    typography: 'field-serif',
    mode: 'dark',
  }),
});

for (const row of ['no-javascript'] as const satisfies readonly Row[])
  test(
    `at 390, ${row}, the stats figure and its unit reach the text ratio against their worst background pixel`,
    { annotation },
    async ({ page }) => {
      await openHome(page, { width: 390, height: 844, row });
      const failing = (await contrastFindings(page, FIGURE)).filter((f) => f.rule === 'text');
      expect(described(failing), 'the figure and its unit under the text ratio').toEqual([]);
    },
  );
