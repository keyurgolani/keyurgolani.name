import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { brokenHeadingWords, load, renderedLayout } from './horizontal-cinema-model';

// Horizontal Cinema on the long-text contract fixture, whose sections include one in Japanese
// (lang: ja). A line may break between any two characters of Japanese, so a heading of it that
// wraps hasn't broken inside a word.
//
// Where it wraps, measured (row 53 r2): the heading is set at 1rem, and its one-line advance is
// 15.21em in macOS's CJK fallback face, plain and with Arial for the Latin faces alike; Linux's
// Noto CJK sets each of its 18 glyphs at a full 1em, so it's no narrower there. The strip pins at
// 100% (and at 125% from 1280 wide), and whenever it pins, this heading sits on one line: at 1024
// by 768 its box is 342 px against a 243 px line. It wraps only stacked: at 1024 by 768 from 175%,
// and at 200% its box is 401.9 px against a 486.7 px line, two lines. So the pin runs there.
//
// Stacked, the fit has stood the strip down and no scene carries room (data-room), so this fixture
// can't show the in-strip claim that a wrapped Japanese heading opens no room for its scene, and
// this pin doesn't assert it. The strip's fit reads its words through chapters' WORD, whose unit
// pins (0bcd33e73) hold a run of Japanese, Thai or Korean to no word inside it.

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

test(
  'stacked at 1024 by 768 with the text at 200%, a long Japanese heading that wraps is not read as a word broken in two',
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
    expect((await brokenHeadingWords(page)).filter((word) => word.startsWith(`${scene}:`))).toEqual(
      [],
    );
  },
);
