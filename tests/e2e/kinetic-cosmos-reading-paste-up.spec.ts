import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import {
  annotation,
  described,
  kineticOptions,
  openHome,
  ringFindingsOf,
  type Row,
} from './kinetic-cosmos-reading';

// Kinetic Cosmos on Paste-Up (letterpress, low-stimulus-warm, dark), a wide face, as its quality
// cells read it (kinetic-cosmos-reading.ts). Under forced colours the focus check reads less than
// 90% of a ring's centre line changing at 3:1 on the Record ring's orbit-line stops, the stage's
// first plate and the dock's links at 1024, and on a work's title and the dock's Index on a phone.

test.use({
  appOptions: kineticOptions({
    language: 'letterpress',
    scheme: 'low-stimulus-warm',
    typography: 'paste-up',
    mode: 'dark',
  }),
});

/** Each of `stops`' perimeter findings, by its text, focused by the keyboard one at a time. */
async function perimeters(page: Page, stops: Locator): Promise<string[]> {
  const failing: string[] = [];
  for (let i = 0; i < (await stops.count()); i += 1) {
    const stop = stops.nth(i);
    const text = ((await stop.textContent()) ?? '').trim();
    for (const line of described(
      (await ringFindingsOf(page, stop)).filter((f) => f.rule === 'perimeter'),
    ))
      failing.push(`"${text}" ${line}`);
  }
  return failing;
}

/** The dock, shown once the opening stage has gone by. */
async function dock(page: Page): Promise<Locator> {
  await page.locator('#kc--ring-record').scrollIntoViewIfNeeded();
  const bar = page.locator('.kc-dock');
  await expect(bar).toBeVisible();
  return bar;
}

test(
  "under forced colours, at 1024, the Record ring's orbit-line stops, the stage's first plate and the dock's links have rings the focus check passes on their perimeter",
  { annotation },
  async ({ page }) => {
    await openHome(page, { width: 1024, height: 768, row: 'forced-colors' });
    const plate = await perimeters(page, page.locator('.kc-plates .kc-plate__link').first());
    const stops = await perimeters(page, page.locator('#kc--ring-record .kc-arc__stop > a'));
    const bar = await dock(page);
    const docked = await perimeters(
      page,
      bar.locator(':is(.kc-dock__stop, .kc-index-trigger--dock)'),
    );
    expect({ plate, stops, docked }, 'the rings the perimeter fails').toEqual({
      plate: [],
      stops: [],
      docked: [],
    });
  },
);

for (const row of ['forced-colors', 'contrast-more'] as const satisfies readonly Row[])
  test(
    `at 390, ${row}, a work's title and the dock's Index have rings the focus check passes on their perimeter`,
    { annotation },
    async ({ page }) => {
      await openHome(page, { width: 390, height: 844, row });
      const title = await perimeters(page, page.locator('#project-name h4 a').first());
      const bar = await dock(page);
      const index = await perimeters(page, bar.locator('.kc-index-trigger--dock'));
      expect({ title, index }, 'the rings the perimeter fails').toEqual({ title: [], index: [] });
    },
  );
