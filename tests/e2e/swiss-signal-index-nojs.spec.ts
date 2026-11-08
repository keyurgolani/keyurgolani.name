import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { keyboardFindings } from '../quality/lib/a11y/interaction';

// The quality cell swiss-signal complete /work/project-name × platform-neutral at 1440, 1024 and 390
// no-javascript, on the complete fixture under read-only (rc-preflight on 04dc5e378). With no script the
// page never goes live, and the Index is the contents list after main. Its links take Tab, so it must be
// a plain list, not a closed popover the page shows: the cell's keyboard walk (keyboardFindings) leaves a
// closed popover's links out of its tabbables, and ran out of presses inside the Index ("focus never left
// after 34 stops"). Home has the same markup, with enough stops before it to hide that. Aurora Glass's
// row 62 is the same shape. One language a file: each is a server of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = (route: string) => [
  { type: 'route', description: route },
  { type: 'profile', description: 'read-only' },
];

test.use({
  viewport: { width: 1440, height: 900 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'swiss-signal')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test.describe('with no script', () => {
  test.use({ javaScriptEnabled: false });

  for (const route of ['/work/project-name', '/'])
    test(
      `on ${route} the Index is a plain contents list, and Tab walks through it and off the page`,
      { annotation: annotation(route) },
      async ({ page }) => {
        await page.goto(route, { waitUntil: 'networkidle' });
        const index = page.locator('#ss--index');
        await expect(index).toBeVisible();
        expect(await index.getAttribute('popover')).toBeNull();
        expect(await keyboardFindings(page)).toEqual([]);
      },
    );
});
