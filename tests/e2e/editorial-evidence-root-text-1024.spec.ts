import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Row 98, Editorial Evidence: the quality cells editorial-evidence complete /work/project-name x platform-neutral
// (system, light, dark and high contrast) record reflow/root-text at 1024x768: with the root text at 200%, the
// case's fact sheet sets the work's bare URL as a flex item of .ee-links, whose min-content is the whole URL, so
// it runs to 1091 px and the page scrolls sideways. At 1024 with the root text at 200%, as the root-text
// condition sets it (conditions.ts: the root's font-size at 200%, important), the page is no wider than the
// window, and every link of the fact sheet ends inside it. One language a file: each is a server of its own.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 1024, height: 768 },
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

test(
  "at 1024 with the root text at 200%, a case doesn't scroll sideways and its fact sheet's links stay in the window",
  { annotation: [{ type: 'route', description: '/work/project-name' }] },
  async ({ page }) => {
    await page.goto('/work/project-name', { waitUntil: 'networkidle' });
    await expect(page.locator('.ee-links a').first()).toBeAttached();
    await page.evaluate(() =>
      document.documentElement.style.setProperty('font-size', '200%', 'important'),
    );
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const read = await page.evaluate(() => {
      const html = document.documentElement;
      return {
        scroll: html.scrollWidth,
        client: html.clientWidth,
        links: [...document.querySelectorAll('.ee-links a')].map((a) => {
          const r = a.getBoundingClientRect();
          return { text: (a.textContent ?? '').trim().slice(0, 40), right: r.right };
        }),
      };
    });
    for (const link of read.links)
      expect(link.right, `"${link.text}" ends inside the window`).toBeLessThanOrEqual(
        read.client + 0.5,
      );
    expect(read.scroll, 'the page is no wider than the window').toBeLessThanOrEqual(read.client);
  },
);
