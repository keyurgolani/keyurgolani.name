import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { anchor, CHAPTERS, expectCurrent, load, read } from './horizontal-cinema-model';

// Horizontal Cinema on a phone with short chapters (#17): the identity-only
// contract fixture, whose four empty chapters are each shorter than the
// window, so the page's foot comes before most of them reach its top. A
// step or a direct link lands on its chapter and keeps it, with the URL and
// focus agreeing, through the settle a small scroll starts.

const SHORT = contractFixture('identity-only');
const SHORT_DIR = path.dirname(SHORT.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: SHORT.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(SHORT.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      SHORT.unitFiles.map((file) => [file, readFileSync(path.join(SHORT_DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test(
  'on a phone, empty chapters keep the chapter a step or a link lands on, and the URL agrees',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    const next = page.getByRole('button', { name: 'Next chapter' });
    for (const chapter of CHAPTERS.slice(1)) {
      await next.dispatchEvent('click');
      await expectCurrent(page, chapter);
      // Long enough for a late settle to have moved it, had it been going to.
      await page.waitForTimeout(1200);
      expect(await read(page)).toMatchObject({
        current: anchor(chapter),
        hash: anchor(chapter),
        focus: `hc--title-${chapter}`,
      });
    }
    for (const chapter of CHAPTERS) {
      await load(page, `/${anchor(chapter)}`);
      await expectCurrent(page, chapter);
      // A small scroll down stays in the chapter the link opened.
      await page.evaluate(() => window.scrollBy({ top: 40, behavior: 'instant' }));
      await page.waitForTimeout(1200);
      expect(await read(page)).toMatchObject({ current: anchor(chapter), hash: anchor(chapter) });
    }
  },
);
