import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { parse, stringify } from 'yaml';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Shell on the long-text fixture on a phone (variants-10 brief §5.6): a long
// name, a word with no break in it, long titles and long links all wrap or
// end inside the window, the page no wider than it, on home and on a case
// page whose slug, title, tags and tools run long (P2: the SLUG(N) head, the
// h1, the name(N) references and the tag line). On a failure the message
// names the outermost boxes that reach past the window's edge.

const FIXTURE = contractFixture('long-text');
const DIR = path.dirname(FIXTURE.files.portfolio);
const SITE = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'shell');
const SOURCE_FILES = Object.fromEntries(
  FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
);

/** The essay with the sentence-long title, given its own page: its id as its slug, 64 characters. */
const LONG = 'an-essay-title-that-is-a-whole-sentence-long-because-some-essays';
const UNBROKEN = 'Unbreakablewordthatrunsonandonwithnoplacetobreakitatallanywhereinit';

function withCase(): string {
  const doc = parse(readFileSync(FIXTURE.files.portfolio, 'utf8')) as {
    works: { id: string; [key: string]: unknown }[];
  };
  const work = doc.works.find(({ id }) => id === LONG);
  if (!work) throw new Error(`long-text has no ${LONG}`);
  Object.assign(work, {
    slug: LONG,
    tags: [UNBROKEN.toLowerCase(), 'essays'],
    tools: [UNBROKEN],
    caseStudy: { challenge: `${UNBROKEN} as the first word of the challenge.` },
  });
  // A second essay shares its tag, so SEE ALSO names it by its own long name.
  const twin = doc.works.find(({ id }) => id === 'the-same-title-2');
  if (twin) twin.tags = [UNBROKEN.toLowerCase()];
  // One fixed folder, rewritten by each load with the same text, so runs don't pile up in /tmp.
  const dir = path.join(tmpdir(), 'kgn-shell-long-case');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'portfolio.yml');
  // Written aside and renamed in, so a worker never copies a half-written file.
  writeFileSync(`${file}.${process.pid}`, stringify(doc));
  renameSync(`${file}.${process.pid}`, file);
  return file;
}

// One server for the file (a worker's app options can't change inside it): the long-text
// fixture with that essay's page, which home lists as any other work.
test.use({
  appOptions: { portfolio: withCase(), siteText: SITE, sourceFiles: SOURCE_FILES },
  viewport: { width: 390, height: 844 },
});

/** The outermost boxes past the window's edge, and the page's own width against it. */
function overflow(page: Page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const past = (el: Element) => el.getBoundingClientRect().right > width + 0.5;
    const describe = (el: Element) => {
      const box = el.getBoundingClientRect();
      const name = `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().split(/\s+/).join('.')}` : ''}`;
      return `${name} [${Math.round(box.left)}..${Math.round(box.right)}] "${(el.textContent ?? '').trim().slice(0, 40)}"`;
    };
    // A box inside a clipping or scrolling ancestor that ends inside the window is that
    // ancestor's to show (an ellipsis, a scroller), not past the window.
    const held = (el: Element) => {
      for (let at = el.parentElement; at; at = at.parentElement) {
        if (getComputedStyle(at).overflowX !== 'visible') return !past(at);
      }
      return false;
    };
    // The outermost boxes past the edge whose parent sits inside it, fixed ones included:
    // a fixed bar's overflow never widens the page, so the page's width alone can't see it.
    const offenders = [...document.body.querySelectorAll('*')].filter(
      (el) => past(el) && el.parentElement !== null && !past(el.parentElement) && !held(el),
    );
    // When nothing outermost is past the edge but the page still scrolls sideways, the boxes
    // reaching furthest name the cause.
    const furthest = [...document.body.querySelectorAll('*')]
      .filter(past)
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
      .slice(0, 8)
      .map(describe);
    return {
      scroll: document.documentElement.scrollWidth,
      width,
      offenders: offenders.slice(0, 12).map(describe),
      furthest,
    };
  });
}

test.describe('a case page', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test(
    'at 320, a long slug, title, tag and tool never push the page wider than the window',
    {
      annotation: [
        { type: 'route', description: '/work/[slug]' },
        { type: 'profile', description: 'read-only' },
      ],
      tag: '@interaction',
    },
    async ({ page }) => {
      await page.goto(`/work/${LONG}`);
      await expect(page.locator('[data-variant="shell"]').first()).toBeVisible();
      await expect(page.locator('h1.sh-man__title')).toHaveCount(1);
      await expect(page.locator('.sh-man__run').first()).toContainText(`${LONG.toUpperCase()}(7)`);
      await expect(page.locator('[data-man="see-also"]')).toHaveCount(1);
      const report = await overflow(page);
      expect(
        report.scroll,
        [...report.offenders, '(furthest)', ...report.furthest].join('\n'),
      ).toBeLessThanOrEqual(report.width);
      expect(report.offenders).toEqual([]);
    },
  );
});

test(
  'on a phone, long text never pushes the page wider than the window',
  {
    annotation: [
      { type: 'route', description: '/' },
      { type: 'profile', description: 'read-only' },
    ],
    tag: '@interaction',
  },
  async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-variant="shell"]').first()).toBeVisible();
    const report = await overflow(page);
    expect(report.scroll, report.offenders.join('\n')).toBeLessThanOrEqual(report.width);
    expect(report.offenders).toEqual([]);
  },
);
