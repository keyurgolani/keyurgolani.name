import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Singular P2's case page in a browser (the plan's §3): a work's own page in the home's grammar, the
// stops Brief to Hindsight on alternating grounds, the last on the accent, each ending on one band
// that leads to the next stop, Hindsight's back to the portfolio's More work; the keys page stop to
// stop from a stop's heading; Contents lists the stops and the way back. On the complete fixture's
// case study (/work/project-name), under read-only.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/work/project-name' },
  { type: 'profile', description: 'read-only' },
];

const SITE_TEXT = fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'singular');
const APP = {
  portfolio: FIXTURE.files.portfolio,
  siteText: SITE_TEXT,
  sourceFiles: Object.fromEntries(
    FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
  ),
};

test.use({ viewport: { width: 1440, height: 900 }, appOptions: APP });

const CASE = '/work/project-name';

async function live(page: Page) {
  await page.goto(CASE, { waitUntil: 'networkidle' });
  await expect(page.locator('.sg--case[data-sg-live]')).toHaveCount(1);
}

test(
  'the stops, in order, on alternating grounds, the last on the accent, one h1',
  { annotation },
  async ({ page }) => {
    await live(page);
    expect(await page.locator('h1').count()).toBe(1);
    await expect(page.locator('h1')).toHaveText('Project name');
    const stops = await page.locator('.sg-panel').evaluateAll((all) =>
      all.map((p) => ({
        key: p.getAttribute('data-sg-panel'),
        ground: p.getAttribute('data-ground'),
      })),
    );
    expect(stops.map((s) => s.key)).toEqual([
      'case-brief',
      'case-exhibit',
      'case-problem',
      'case-choices',
      'case-result',
      'case-hindsight',
    ]);
    expect(stops.map((s) => s.ground)).toEqual([
      'canvas',
      'inverse',
      'canvas',
      'inverse',
      'canvas',
      'accent',
    ]);
    // The owner's words, each where the stop puts it.
    for (const text of [
      'Case study challenge.',
      'Case study context.',
      'Case study decision.',
      'Case study alternatives.',
      'Case study outcomes.',
      'Case study reflection.',
    ]) {
      await expect(page.locator('main').getByText(text, { exact: false }).first()).toBeVisible();
    }
    // Notes follows, in the record's grammar.
    await expect(page.locator('#sg-case-notes')).toHaveCount(1);
  },
);

test(
  'every band is one link to the next stop; Hindsight’s goes back to More work',
  { annotation },
  async ({ page }) => {
    await live(page);
    const bands = await page.locator('.sg-panel').evaluateAll((all) =>
      all.map((p) => {
        const links = [...p.querySelectorAll(':scope > .sg-band a')] as HTMLAnchorElement[];
        return {
          key: p.getAttribute('data-sg-panel'),
          n: links.length,
          href: links[0]?.getAttribute('href') ?? '',
        };
      }),
    );
    for (const [i, band] of bands.entries()) {
      expect(band.n, band.key!).toBe(1);
      if (i < bands.length - 1)
        expect(band.href).toBe(`#sg-case-${bands[i + 1]!.key!.replace('case-', '')}`);
    }
    expect(bands.at(-1)!.href).toMatch(/\/#sg-more-work$/);
    // Following a band lands focus on the incoming stop's heading.
    await page.locator('[data-sg-panel="case-brief"] .sg-band__go').click();
    await expect(page.locator('[data-sg-panel="case-exhibit"] [data-sg-heading]')).toBeFocused();
  },
);

test('the keys page stop to stop from a stop’s heading', { annotation }, async ({ page }) => {
  await live(page);
  await page.locator('h1').focus();
  await page.keyboard.press('PageDown');
  await expect(page.locator('[data-sg-panel="case-exhibit"] [data-sg-heading]')).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect(page.locator('[data-sg-panel="case-problem"] [data-sg-heading]')).toBeFocused();
  await page.keyboard.press('PageUp');
  await expect(page.locator('[data-sg-panel="case-exhibit"] [data-sg-heading]')).toBeFocused();
});

test(
  'Contents lists this case study’s stops, Notes, and the way back to the portfolio',
  { annotation },
  async ({ page }) => {
    await live(page);
    await page.getByRole('button', { name: 'Contents' }).click();
    const dialog = page.getByRole('dialog');
    const links = await dialog.locator('a').evaluateAll((all) =>
      // The stop's number is decoration (aria-hidden): the name is the words after it.
      all.map((a) => [
        (a.textContent ?? '').trim().replace(/^\d+/, ''),
        a.getAttribute('href') ?? '',
      ]),
    );
    expect(links.map(([text]) => text)).toEqual(
      expect.arrayContaining([
        'Brief',
        'Exhibit',
        'Problem',
        'Choices',
        'Result',
        'Hindsight',
        'Notes',
        'Back to the portfolio',
      ]),
    );
    expect(links.find(([text]) => text === 'Back to the portfolio')?.[1]).not.toContain('#sg-case');
  },
);
