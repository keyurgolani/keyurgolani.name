// HC evidence only, not for merge (row 93): a retries-0 copy of P3b, x10, for the landing evidence (it is not among r2's pins'
// copies). Its steps and assertions as tests/e2e/horizontal-cinema.spec.ts has them; onSixKept as r2's pins' copy has it.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { read, expectAt, load, frames, sceneOffset } from './horizontal-cinema-model';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const READ_ONLY = { type: 'profile', description: 'read-only' };
const annotation = [{ type: 'route', description: '/' }, READ_ONLY];
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 1440, height: 900 },
});

test.describe.configure({ retries: 0 });

/**
 * The pinned strip's reader on scene 6, by Next (focus on the bar, not in a scene), and a check that a
 * refit keeps them there: scene 6 current and its start within 1 px of where it was (row 53 r2, 1b).
 */
async function onSixKept(page: Page) {
  await load(page);
  expect(await read(page)).toMatchObject({ layout: 'horizontal', pinned: true });
  const next = page.getByRole('button', { name: 'Next scene' });
  for (let at = 1; at <= 6; at++) {
    await next.click();
    await expectAt(page, at);
  }
  const before = await sceneOffset(page, 6);
  return async (step: string) => {
    await expect
      .poll(
        async () => {
          const { layout, pinned, current } = await read(page);
          return { layout, pinned, current };
        },
        { message: step, timeout: 1000 },
      )
      .toEqual({ layout: 'horizontal', pinned: true, current: 6 });
    expect(
      Math.abs((await sceneOffset(page, 6)) - before),
      `${step}: the scene's place`,
    ).toBeLessThanOrEqual(1);
  };
}

for (let run = 1; run <= 10; run++) {
  test(
    `a reader on a scene of the pinned strip keeps it, in the same place, through a text size and back (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
    { annotation, tag },
    async ({ page }) => {
      const keeps = await onSixKept(page);
      // The root's text a step larger and back, as a reader's own setting does: the sentinel refits at once.
      await page.evaluate(() =>
        document.documentElement.style.setProperty('font-size', '112.5%', 'important'),
      );
      await frames(page);
      await frames(page);
      await keeps('the text at 112.5%');
      await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
      await frames(page);
      await frames(page);
      await keeps('the text back at its own size');
    },
  );
}
