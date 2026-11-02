import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Editorial Evidence's bare opening in a browser (EE-LANG P4, from P3's L-4): with no Pl. 1 there
// is no leader to make room for, so beside the head column the standfirst keeps its full step,
// --space-m, where the lead opening takes one off (editorial-evidence-plate.spec.ts); on two
// columns both keep --space-l. On the academic contract fixture, which has a standfirst, with its
// signature taken away, so nothing takes Pl. 1 and the opening is bare.

const fixture = contractFixture('academic');
const portfolio = readFileSync(fixture.files.portfolio, 'utf8');
const bare = portfolio.replace(/^signature: .*\n/m, '');
if (bare === portfolio || /^featured:/m.test(bare)) {
  throw new Error("The academic fixture's signature or featured line moved: update the bare copy.");
}

test.use({
  appOptions: {
    portfolio: fixture.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(fixture.files.site, 'utf8'), 'editorial-evidence'),
    sourceFiles: {
      ...Object.fromEntries(
        fixture.unitFiles.map((file) => [
          file,
          readFileSync(path.join(path.dirname(fixture.files.portfolio), file), 'utf8'),
        ]),
      ),
      // Written over the copied document, as the owner would edit it.
      'portfolio.yml': bare,
    },
  },
  viewport: { width: 1440, height: 900 },
});

for (const width of [1440, 1024]) {
  const step = width >= 1300 ? '--space-m' : '--space-l';
  test(
    `at ${width}, the bare opening's standfirst ends on ${step}`,
    {
      annotation: [
        { type: 'route', description: '/' },
        { type: 'profile', description: 'read-only' },
      ],
    },
    async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/', { waitUntil: 'load' });
      await expect(page.locator('[data-variant]')).toHaveAttribute(
        'data-variant',
        'editorial-evidence',
      );
      await expect(page.locator('.ee-opening')).toHaveClass(/\bee-opening--bare\b/);
      const foot = await page.locator('.ee-thesis__stand').evaluate((stand, token) => {
        // The token as a length here, on a probe beside the standfirst.
        const probe = document.createElement('div');
        probe.style.paddingBlockEnd = `var(${token})`;
        stand.parentElement!.append(probe);
        const want = parseFloat(getComputedStyle(probe).paddingBlockEnd);
        probe.remove();
        return { got: parseFloat(getComputedStyle(stand).paddingBlockEnd), want };
      }, step);
      expect(foot.want, `${step} resolves to a length`).toBeGreaterThan(0);
      expect(foot.got).toBeCloseTo(foot.want, 1);
    },
  );
}
