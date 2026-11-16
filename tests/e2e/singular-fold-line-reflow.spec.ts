import { readFileSync } from 'node:fs';
import path from 'node:path';
import { viewportSize } from '../../quality/thresholds';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { reflowConditions } from '../quality/lib/a11y/conditions';
import { inPage } from '../quality/lib/a11y/probe';
import { expect, test } from '../harness/fixtures';

// Singular on platform-neutral, warm-parchment, accessible-reading and system, under the reflow
// check's 320 px condition: a closed record row's one line (the timeline's, the projects') ran past
// its own box, 216 px of content in 212, and the check read it as clipped. The reflow check's own
// probe, as it reads the page, finds nothing, and the page doesn't scroll sideways. It prints every
// closed row's line: its kind, its text, and its box and content widths.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
/** The reflow check's 320 px condition, from quality/thresholds.json. */
const NARROW = reflowConditions().find(
  (condition) => condition.rule === 'reflow' && condition.id.startsWith('320x'),
)!;

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'singular')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: accessible-reading')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: viewportSize(NARROW.id),
  isMobile: false,
  hasTouch: false,
});

test(
  "at 320 px on accessible-reading, Singular's closed record rows keep their one line inside its box, and the page doesn't scroll sideways",
  { annotation: [{ type: 'route', description: '/' }, READ_ONLY] },
  async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const boundary = page.locator('[data-variant]').first();
    await expect(boundary).toHaveAttribute('data-variant', 'singular');
    await expect(boundary).toHaveAttribute('data-typography', 'accessible-reading');
    await page.evaluate(() => document.fonts.ready);
    const lines = await page.evaluate(() =>
      [...document.querySelectorAll('.sg-fold:not([open]) > .sg-fold__sum > .sg-fold__line')].map(
        (line) => ({
          path: `${line.closest('[id]')?.id ?? '?'} ${line.className}`,
          text: (line.textContent ?? '').slice(0, 80),
          box: Math.round(line.getBoundingClientRect().width * 10) / 10,
          content: line.scrollWidth,
          clips: line.scrollWidth > line.clientWidth,
        }),
      ),
    );
    const problems = await inPage<{ rule: string; path: string; detail: string }[]>(page, {
      kind: 'reflow',
    });
    console.log(
      `singular fold line reflow ${NARROW.id}: lines ${JSON.stringify(lines)}; problems ${JSON.stringify(problems.slice(0, 8))}`,
    );
    expect(
      {
        problems: problems.map((problem) => `${problem.path}: ${problem.detail}`),
        sideways: await page.evaluate(
          () => document.scrollingElement!.scrollWidth > document.documentElement.clientWidth + 1,
        ),
      },
      "the reflow check's probe at 320 px",
    ).toEqual({ problems: [], sideways: false });
  },
);
