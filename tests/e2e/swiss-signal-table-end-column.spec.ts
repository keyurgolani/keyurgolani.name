import { expect, test } from '../harness/fixtures';
import { tableBreaks } from './swiss-signal-table-measure';
import { annotation, openTuple, servingSwissSignal, type Tuple } from './swiss-signal-tuples';

// A ruled table's narrowest columns hold their words whole at any text size, and an end column holds
// a value with its unit. At 1440 with 200% root text a table's frame holds about 41.6rem, past the
// width where the tables take their phone rows, and the episodes' end columns, a twelfth each, were
// narrower than their own words: "Length" and "Listen" broke a letter or two a line under Accessible
// Reading. Every cell of every ruled table on the page is read, with the records' folds open, as a
// reader opens them (swiss-signal-table-measure.ts says what is excused).

test.use({ appOptions: servingSwissSignal() });

const TUPLE: Tuple = 'memphis/neon-city/accessible-reading/dark';

test(
  `under ${TUPLE} at 1440 with 200% root text, every ruled table's columns hold their words whole`,
  { annotation },
  async ({ page, app }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openTuple(page, app.origin, TUPLE);
    await page.evaluate(() => {
      for (const details of document.querySelectorAll('details')) details.open = true;
      document.documentElement.style.setProperty('font-size', '200%', 'important');
    });
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const read = await tableBreaks(page);
    expect(read.tables, 'the page has its ruled tables').toBeGreaterThan(3);
    expect(read.read, 'the tables have words to read').toBeGreaterThan(20);
    expect({ words: read.words, units: read.units }).toEqual({ words: [], units: [] });
  },
);
