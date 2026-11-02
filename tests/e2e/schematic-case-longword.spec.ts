import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// A detail sheet whose title holds one long word (the P2 code review: at 320 the
// root's overflow-wrap still broke a longer word than "Postmortem" mid-word). The
// complete fixture's case-study work, titled "Internationalisation Playbook", in a
// copy of its own: the title's size never passes what its longest word allows.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const TITLE = 'Internationalisation Playbook';
const COPY = path.join(mkdtempSync(path.join(tmpdir(), 'sx-longword-')), 'portfolio.yml');
writeFileSync(
  COPY,
  readFileSync(FIXTURE.files.portfolio, 'utf8').replace('title: Project name', `title: ${TITLE}`),
);
const annotation = [
  { type: 'route', description: '/work/[slug]' },
  { type: 'profile', description: 'read-only' },
];

test.use({
  appOptions: {
    portfolio: COPY,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'schematic'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

test(
  'a long word in a detail sheet’s title holds one line at 320, 390 and 1440, never broken inside',
  { annotation },
  async ({ page }) => {
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/work/project-name', { waitUntil: 'networkidle' });
      await expect(page.locator('h1')).toHaveText(TITLE);
      const broken = await page.locator('h1').evaluate((h1) => {
        const text = h1.firstChild as Text;
        const out: string[] = [];
        let at = 0;
        for (const word of (text.textContent ?? '').split(' ')) {
          const range = document.createRange();
          range.setStart(text, at);
          range.setEnd(text, at + word.length);
          const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
          if (lines.size > 1) out.push(word);
          at += word.length + 1;
        }
        return out;
      });
      expect(broken, `${width}`).toEqual([]);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${width}`).toBeLessThanOrEqual(0);
    }
  },
);
