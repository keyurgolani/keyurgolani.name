import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Row 150, Aurora Glass: the quality cells aurora-glass complete / on the accessible-reading type pack (every
// scheme and language that ran, 1440x900 default; B's r132 base slice on 8ea4d003a) record reflow/root-text at
// 1024x768 on the capsule's first link, the owner's name: "its own box clips it", 238x47 of content in a box
// 170-184 px wide. Accessible Reading's wide face (Verdana first) makes the name longer than the room the folded
// capsule leaves it, and the name ellipsizes, so a reader who enlarged the text loses part of it. Other type packs
// fit. At 1024 with the root text at 200%, as the root-text condition sets it (the root's font-size at 200%,
// important), on one of those cells' tuples, the name's own box holds all of it. One tuple a file: each is a server
// of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
/** The records' own path: the capsule nav's first link. */
const NAME =
  'html > body:nth-child(2) > div:nth-child(2) > div:nth-child(2) > header:nth-child(2) > nav:nth-child(1) > a:nth-child(1)';

test.use({
  viewport: { width: 1024, height: 768 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass')
      .replace(/designLanguage: .*/, 'designLanguage: minimal-flat')
      .replace(/colorScheme: .*/, 'colorScheme: control-room')
      .replace(/typography: .*/, 'typography: accessible-reading')
      .replace(/displayMode: .*/, 'displayMode: dark'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(
  "at 1024 with the root text at 200%, on Accessible Reading, the capsule's name link holds all of its name",
  { annotation: [{ type: 'route', description: '/' }] },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const name = page.locator(NAME);
    await expect(name).toHaveCount(1);
    await expect(name).toHaveClass(/ag-capsule__name/);
    await page.evaluate(() =>
      document.documentElement.style.setProperty('font-size', '200%', 'important'),
    );
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const read = await name.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        text: (el.textContent ?? '').trim(),
        family: s.fontFamily.split(',')[0]!.trim(),
        content: [el.scrollWidth, el.scrollHeight],
        box: [el.clientWidth, el.clientHeight],
      };
    });
    expect(read.family, 'the Accessible Reading face').toMatch(/Verdana/i);
    expect(
      read.content[0],
      `"${read.text}" fits its own box across (${read.content.join('x')} of content in ${read.box.join('x')})`,
    ).toBeLessThanOrEqual(read.box[0]!);
    expect(read.content[1], `"${read.text}" fits its own box down`).toBeLessThanOrEqual(
      read.box[1]!,
    );
  },
);
