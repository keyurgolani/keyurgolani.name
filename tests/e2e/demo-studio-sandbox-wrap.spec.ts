import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { DEMO_APP } from '../harness/profile-matrix';
import { inPage } from '../quality/lib/a11y/probe';

// RC2 row 110 (the #211 key, demo-studio content /studio?task=content, system: reflow root-text
// `@1024x768 #studio-main > section:nth-child(3) > div:nth-child(2) > div:nth-child(5) >
// div:nth-child(2) > p:nth-child(1)`, 640 to 1200 px). The bottom bar's sandbox line, "Demo
// sandbox. Only you can see these changes." (p.studio-split__sandbox), keeps
// `white-space: nowrap`. At 1024 px with the root text at 200% the 64-to-80rem rail,
// min(var(--studio-rail), 18.5rem), is rem-sized, so the stage's column is about 432 px. The line
// runs past it to about 1200 px, under `.studio-split { overflow: hidden }`. At 200% the line
// wraps and fits its column, and the harness's reflow probe finds nothing on it. At 100% it stays
// one line, as it was.

const ANNOTATION = [
  { type: 'route', description: '/studio' },
  { type: 'profile', description: 'demo' },
];

test.use({ appOptions: DEMO_APP });

/** Opens Demo Studio's Content at 1024x768 and waits for its rail and the bottom bar's line. */
async function openContent(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1024, height: 768 });
  const response = await page.goto('/studio?task=content');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('region', { name: 'Export and import', exact: true })).toBeVisible();
  await expect(page.locator('.studio-split__bottom .studio-split__sandbox')).toBeVisible();
}

/** The root text at `scale` (as the reflow root-text condition sets it), then two frames. */
async function rootText(page: Page, scale: number): Promise<void> {
  await page.evaluate((each) => {
    document.documentElement.style.setProperty('font-size', `${each * 100}%`, 'important');
  }, scale);
  await page.evaluate(
    () =>
      new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))),
  );
}

/** The sandbox line as it lays out: its lines, its box and its column's, and its overflow. */
const sandbox = (page: Page) =>
  page.locator('.studio-split__bottom .studio-split__sandbox').evaluate((line) => {
    const range = document.createRange();
    range.selectNodeContents(line);
    const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
    const box = line.getBoundingClientRect();
    const column = line.closest('.studio-split__bottom-stage')!.getBoundingClientRect();
    const split = document.querySelector('.studio-split')!;
    return {
      lines: tops.size,
      right: Math.round(Math.max(box.right, ...[...range.getClientRects()].map((r) => r.right))),
      columnRight: Math.round(column.right),
      overflows: line.scrollWidth > line.clientWidth + 1,
      splitOverflows: split.scrollWidth > split.clientWidth + 1,
    };
  });

test(
  "the bottom bar's sandbox line wraps and fits its column at 1024x768 with the root text at 200%",
  { annotation: ANNOTATION },
  async ({ page }) => {
    await openContent(page);
    await rootText(page, 2);
    const at200 = await sandbox(page);
    expect(at200.right, 'the line ends inside its column').toBeLessThanOrEqual(at200.columnRight);
    expect(at200.overflows, 'nothing of the line past its own box').toBe(false);
    expect(at200.splitOverflows, 'nothing past the split').toBe(false);
    expect(at200.lines, 'it wraps').toBeGreaterThan(1);
    // As the quality cell reads it: the harness's reflow probe finds nothing on the line.
    const problems = await inPage<{ rule: string; path: string; detail: string }[]>(page, {
      kind: 'reflow',
    });
    const onLine = await page.evaluate(
      (each) =>
        each.filter((problem) =>
          document.querySelector(problem.path)?.closest('.studio-split__sandbox'),
        ),
      problems,
    );
    expect(onLine).toEqual([]);
  },
);

test(
  "the bottom bar's sandbox line stays one line at 1024x768 with the root text at 100%",
  { annotation: ANNOTATION },
  async ({ page }) => {
    await openContent(page);
    await rootText(page, 1);
    const at100 = await sandbox(page);
    expect(at100.lines, 'one line, as it was').toBe(1);
    expect(at100.right).toBeLessThanOrEqual(at100.columnRight);
  },
);
