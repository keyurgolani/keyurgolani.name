import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Row 97, Editorial Evidence: the quality cells editorial-evidence complete /work/project-name x platform-neutral,
// every display mode at 390, 1024 and 1440, record focus perimeter and contrast on the back matter's links, an
// address each set breakable (Breakable: each part of it, its slash with it, one unit). The parts were inline
// blocks, taller than the link's own box (2 to 2.7 px at 1024), so the link's ring went round them and not round
// the box the check measures it on (D's EE T1c, 36 reads). Every part of an address in a link lies inside the
// link's own box, top and bottom, so its ring is the link's. One language a file: each is a server of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'editorial-evidence')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

for (const [width, height, mobile] of [
  [390, 844, true],
  [1024, 768, false],
  [1440, 900, false],
] as const)
  test.describe(`at ${width}`, () => {
    test.use({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
    test(
      `at ${width}, every part of an address in a link lies inside the link's own box`,
      { annotation: [{ type: 'route', description: '/work/project-name' }] },
      async ({ page }) => {
        await page.goto('/work/project-name', { waitUntil: 'networkidle' });
        const read = await page.evaluate(() =>
          [...document.querySelectorAll('a .ee-url__part')].map((part) => {
            const link = part.closest('a')!;
            const lines = [...link.getClientRects()];
            const p = part.getBoundingClientRect();
            // The link's line box that holds the part: the one it overlaps most.
            const own = lines.reduce((best, r) =>
              Math.min(r.bottom, p.bottom) - Math.max(r.top, p.top) >
              Math.min(best.bottom, p.bottom) - Math.max(best.top, p.top)
                ? r
                : best,
            );
            return {
              text: (part.textContent ?? '').trim(),
              link: (link.textContent ?? '').trim().slice(0, 40),
              part: [p.top, p.bottom],
              box: [own.top, own.bottom],
            };
          }),
        );
        expect(read.length, 'the case has addresses set breakable in links').toBeGreaterThan(0);
        for (const each of read) {
          expect(
            each.part[0],
            `"${each.text}" of "${each.link}" starts inside its link's box (${each.box.join('-')})`,
          ).toBeGreaterThanOrEqual(each.box[0]! - 0.5);
          expect(
            each.part[1],
            `"${each.text}" of "${each.link}" ends inside its link's box (${each.box.join('-')})`,
          ).toBeLessThanOrEqual(each.box[1]! + 0.5);
        }
      },
    );
  });
