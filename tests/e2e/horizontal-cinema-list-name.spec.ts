import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Horizontal Cinema's top line: the owner's name is a link home. On the strip, home is the page
// the reader is on, so the name and the Strip link carry aria-current="page". In the List view the
// List link does, and the name, a link to another page, doesn't, so a screen reader doesn't
// announce home as the page the reader is on. On the complete contract fixture.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 1440, height: 900 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const annotation = [{ type: 'route', description: '/' }];

test(
  'in the List view the List link is the current page, and the name, a link home, is not',
  { annotation },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const name = page.locator('.hc-chrome__name');
    const views = page.locator('.hc-chrome__views a');
    await expect(views).toHaveCount(2);
    // On the strip, home is the page the reader is on.
    await expect(name).toHaveAttribute('aria-current', 'page');
    await expect(views.nth(0)).toHaveAttribute('aria-current', 'page');
    const list = await views.nth(1).getAttribute('href');
    expect(list, 'the List link has a destination').toBeTruthy();
    await page.goto(list!, { waitUntil: 'networkidle' });
    await expect(page.locator('.hc')).toHaveAttribute('data-view', 'list');
    await expect(views.nth(1)).toHaveAttribute('aria-current', 'page');
    await expect(views.nth(0)).not.toHaveAttribute('aria-current', /.*/);
    await expect(name, 'the name, a link home, is not the current page').not.toHaveAttribute(
      'aria-current',
      /.*/,
    );
  },
);
