// HC evidence only, not for merge (row 53 r2): retries-0 copies of r2's pins, each x10, for the landing evidence.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { load, renderedLayout, brokenHeadingWords } from './horizontal-cinema-model';

const FIXTURE = contractFixture('long-text');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1024, height: 768 },
});

test.describe.configure({ retries: 0 });

for (let run = 1; run <= 10; run++) {
  test(
    `stacked at 1024 by 768 with the text at 200%, a long Japanese heading that wraps is not read as a word broken in two (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
    { annotation },
    async ({ page }) => {
      await page.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
          document.documentElement.style.setProperty('font-size', '200%', 'important');
        });
      });
      await load(page);
      test.info().annotations.push({ type: 'layout', description: await renderedLayout(page) });
      const heading = page.locator('.hc-track .hc-scene :is(h1, h2, h3, h4)', {
        hasText: '日本語のセクションと長い題名の見出し',
      });
      await expect(heading).toHaveCount(1);
      // It does wrap there: its text sits on more than one line.
      const lines = await heading.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return new Set(
          [...range.getClientRects()]
            .filter((box) => box.width > 0)
            .map((box) => Math.round(box.top)),
        ).size;
      });
      expect(lines).toBeGreaterThan(1);
      const scene = await heading.evaluate((element) => element.closest('.hc-scene')!.id);
      expect(
        (await brokenHeadingWords(page)).filter((word) => word.startsWith(`${scene}:`)),
      ).toEqual([]);
    },
  );
}
