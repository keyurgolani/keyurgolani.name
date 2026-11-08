import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { frames, load, printedLook, printedRail } from './horizontal-cinema-model';

// Horizontal Cinema on paper (RC1 6(a), the print look), on the complete contract fixture at 1440 by 900: the rail
// prints as the five chapters in reading order and none of the scrubber's buttons does; Strip and List print as plain
// text, dark on a light ground at 3:1 or more, unfilled, on one line; no visible form control prints; nothing of a
// summary that only toggles prints (its marker, its chevron, its Show or Hide words); and each rail label with years
// keeps them apart (0.25em or another line). The look's checks are soft, so a run names every one that fails.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

/** The complete fixture: its chapters carry years, so the label check applies. */
const YEARS = true;

test(
  'on paper the rail prints its five chapters in reading order, Strip and List print, and no scrubber button does (complete)',
  { annotation },
  async ({ page }) => {
    await load(page);
    await page.emulateMedia({ media: 'print' });
    await frames(page);
    await frames(page);
    const printed = await printedRail(page);
    expect(printed.rail, 'the rail on paper').toEqual(
      printed.rail.map(({ href }) => ({ href, shown: true })),
    );
    expect(printed.rail.length, 'the rail on paper: five chapters').toBe(5);
    expect
      .soft(
        printed.views.filter(({ shown }) => shown).map(({ href }) => href),
        'Strip and List on paper',
      )
      .toEqual(['/', '/list']);
    expect.soft(printed.buttons, "the scrubber's buttons on paper").toBe(0);
    const look = await printedLook(page);
    // 1. Strip and List: plain text, dark on a light ground, 3:1 or more, unfilled, on one line.
    const WORDS: Record<string, string> = { '/': 'Strip', '/list': 'List' };
    expect
      .soft(
        look.views.map(({ href }) => href),
        'the views on paper',
      )
      .toEqual(['/', '/list']);
    for (const view of look.views) {
      const said = `${view.href} "${view.text}": ${view.colour.css} (${view.colour.rgb.join(', ')}, L ${view.colour.luminance}) on ${view.ground.element} ${view.ground.colour.css} (${view.ground.colour.rgb.join(', ')}, L ${view.ground.colour.luminance}), ${view.contrast}:1`;
      expect.soft(view.text, `${said}: its words`).toBe(WORDS[view.href]);
      expect.soft(view.contrast, `${said}: 3:1 or more`).toBeGreaterThanOrEqual(3);
      expect
        .soft(view.ground.colour.luminance, `${said}: a light ground`)
        .toBeGreaterThanOrEqual(0.7);
      expect
        .soft(view.colour.luminance, `${said}: darker than its ground`)
        .toBeLessThan(view.ground.colour.luminance);
      expect.soft(view.paint, `${said}: no fill, border or shadow`).toEqual([]);
    }
    if (look.views.length === 2)
      expect
        .soft(
          Math.abs(look.views[0]!.top - look.views[1]!.top),
          `the views on one line: tops ${look.views.map(({ top }) => top).join(' and ')}`,
        )
        .toBeLessThanOrEqual(2);
    // 2. Nothing interactive prints: no visible form control, and nothing of a summary that only toggles.
    expect.soft(look.controls, 'visible form controls on paper').toEqual([]);
    for (const summary of look.summaries) {
      const said = `${summary.element} "${summary.text}"`;
      if (summary.onlyToggle)
        expect.soft(summary.shown, `${said}: toggle words alone, shown`).toBe(false);
      if (!summary.shown) continue;
      expect
        .soft(
          summary.marker.display !== 'list-item' ||
            ['none', '""', "''"].includes(summary.marker.content),
          `${said}: its marker (display ${summary.marker.display}, ::marker content ${summary.marker.content})`,
        )
        .toBe(true);
      expect.soft(summary.svgs, `${said}: a chevron shown`).toBe(0);
      expect.soft(summary.toggles, `${said}: toggle words shown`).toEqual([]);
    }
    // 2b. No full-record section prints its title twice: its summary's name over its body's own heading of the same words.
    const same = (a: string, b: string) =>
      a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();
    expect.soft(look.records.length, 'full-record sections on paper').toBeGreaterThan(0);
    for (const record of look.records)
      expect
        .soft(
          record.summaryShown && record.headingShown && same(record.name, record.heading ?? ''),
          `"${record.name}": its summary (shown ${record.summaryShown}) over its own heading "${record.heading}" (shown ${record.headingShown})`,
        )
        .toBe(false);
    // 3. Each rail label keeps its years apart: 0.25em of their font size, or another line.
    const withYears = look.labels.filter(({ years }) => years !== null);
    if (YEARS) {
      expect.soft(withYears.length, 'rail labels with years').toBeGreaterThan(0);
      for (const label of withYears.filter(({ yearsShown }) => yearsShown))
        expect
          .soft(
            label.otherLine || label.gap >= label.need,
            `"${label.label}" and "${label.years}": ${label.gap}px apart, ${label.need}px needed, another line ${label.otherLine}`,
          )
          .toBe(true);
    } else {
      test.info().annotations.push({
        type: 'vacuous',
        description: 'the label and years check: the sparse fixture has no chapter with years',
      });
      expect.soft(withYears.length, 'rail labels with years (none on sparse)').toBe(0);
    }
  },
);
