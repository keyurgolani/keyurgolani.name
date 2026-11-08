import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { expectReadable } from '../variants/modes';
import { frames, load, printedLook } from './horizontal-cinema-model';

// Horizontal Cinema on paper with no fine pointer (RC1 6(a), the print look): #226's variants on CI Linux
// (run 42499933301, c322a7099) read print's "unreadable headings and navigation" on hidden-canary,
// missing-media, identity-only and large: `nav "StripList": no box`. With no fine pointer the page lays
// its scenes out top to bottom on paper (`data-fit='over'`), whose rule hides Strip | List, so the printed
// views have no box. Here, on identity-only (one of the four) at 1440 by 900 in a touch context, the page
// is held to read with no fine pointer, and then on paper: Strip and List print, as plain text dark on a
// light ground at 3:1 or more, the chapter sheet's button doesn't, and the variants' own print check
// (tests/variants/modes.ts, expectReadable) finds every heading and nav readable.

const FIXTURE = contractFixture('identity-only');
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
  hasTouch: true,
  isMobile: false,
});

test(
  'with no fine pointer, on paper Strip and List print dark on light, the chapter button does not, and every heading and nav reads (identity-only)',
  { annotation },
  async ({ page }) => {
    await load(page);
    // The context really has no fine pointer, as CI Linux's runner doesn't.
    expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches), 'a fine pointer').toBe(
      false,
    );
    await page.emulateMedia({ media: 'print' });
    await frames(page);
    await frames(page);
    const look = await printedLook(page);
    expect
      .soft(
        look.views.map(({ href, text }) => `${href} ${text}`),
        'Strip and List on paper, with no fine pointer',
      )
      .toEqual(['/ Strip', '/list List']);
    for (const view of look.views) {
      const said = `${view.href} "${view.text}": ${view.colour.css} on ${view.ground.element} ${view.ground.colour.css}, ${view.contrast}:1`;
      expect.soft(view.contrast, `${said}: 3:1 or more`).toBeGreaterThanOrEqual(3);
      expect
        .soft(view.ground.colour.luminance, `${said}: a light ground`)
        .toBeGreaterThanOrEqual(0.7);
    }
    expect.soft(look.controls, 'visible form controls on paper').toEqual([]);
    await expectReadable(page);
  },
);
