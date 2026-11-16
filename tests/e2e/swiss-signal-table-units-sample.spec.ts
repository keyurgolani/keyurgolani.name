import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import { tableBreaks } from './swiss-signal-table-measure';

// On a phone at 100% text an end column holds a value with its unit: the bundled sample's writing
// table read "14 / min" in its Read column, on two lines, where "9 min" kept to one, once the end
// column could wrap. Swiss Signal on the sample (demo profile), as the sample's own shot serves it,
// every cell of every ruled table read with the records' folds open (swiss-signal-table-measure.ts
// says what is excused).

test.use({ viewport: { width: 390, height: 844 }, appOptions: DEMO_APP });

test(
  'on the sample at 390 with 100% text, every ruled table holds its words whole and its values with their units',
  {
    annotation: [
      { type: 'route', description: '/sample' },
      { type: 'profile', description: 'demo' },
    ],
  },
  async ({ page }) => {
    await page.goto('/sample?variant=swiss-signal', { waitUntil: 'networkidle' });
    await expect(page.locator('[data-variant]').first()).toHaveAttribute(
      'data-variant',
      'swiss-signal',
    );
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => {
      for (const details of document.querySelectorAll('details')) details.open = true;
    });
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const read = await tableBreaks(page);
    expect(read.tables, 'the page has its ruled tables').toBeGreaterThan(1);
    expect(read.read, 'the tables have words to read').toBeGreaterThan(20);
    expect({ words: read.words, units: read.units }).toEqual({ words: [], units: [] });
  },
);
