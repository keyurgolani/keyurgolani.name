import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { load, read } from './horizontal-cinema-model';

// Horizontal Cinema on a phone with short scenes (redesign): the
// identity-only contract fixture, whose title card and four chapter cards
// are each shorter than the window, so the page's foot comes before most
// of them reach its top. A direct link lands on its scene and keeps it,
// with the URL agreeing, through the settle a small scroll starts.

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
  'on a phone, a direct link to each chapter keeps the fragment it names through a small scroll',
  { annotation, tag },
  async ({ page }) => {
    await load(page);
    expect((await read(page)).layout).toBe('vertical');
    const { scenes } = await read(page);
    for (const chapter of ['prologue', 'origins', 'journey', 'craft', 'epilogue']) {
      const card = scenes.indexOf(`chapter-${chapter}`);
      expect(card, `chapter-${chapter} is a scene`).toBeGreaterThanOrEqual(0);
      await load(page, `/#chapter-${chapter}`);
      await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#chapter-${chapter}`);
      // A small scroll down stays on the chapter the link opened, and the URL isn't rewritten past it.
      await page.evaluate(() => window.scrollBy({ top: 40, behavior: 'instant' }));
      await page.waitForTimeout(1200);
      expect(await read(page)).toMatchObject({ current: card, hash: `#chapter-${chapter}` });
    }
  },
);
