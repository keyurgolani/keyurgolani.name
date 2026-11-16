// Look for Swiss Signal's rise hold (not for commit): the sample's selected index at 1440, shot as
// the variant shots take it (whole page, images eager and decoded, animations disabled) and
// clipped to the section, at rest and at settle with every observer's delivery held back 800 ms.
// PNGs under $PROOF_LOOK_OUT. The same bytes run at the landing tip and at the fix.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { watchEnhancements } from '../quality/lib/a11y/conditions';
import { SAMPLE_APP } from '../variants/target';
import { expect, test } from '../harness/fixtures';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
const DELAY_MS = 800;
mkdirSync(OUT, { recursive: true });
test.use({ appOptions: SAMPLE_APP, viewport: { width: 1440, height: 900 } });
test.describe.configure({ timeout: 180_000 });

const derived = (log: string) =>
  readFileSync(log, 'utf8')
    .split('\n')
    .some((line) => line.startsWith('{') && line.includes('"event":"media.startup.derived"'));

async function shoot(page: Page, stem: string) {
  await page.evaluate(async () => {
    for (const image of document.images) image.loading = 'eager';
    await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
  });
  const box = await page
    .locator('.ss-sel')
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: 0,
        y: Math.max(0, Math.round(r.top + scrollY)),
        width: innerWidth,
        height: Math.round(r.height),
      };
    });
  await page.screenshot({
    path: path.join(OUT, `${stem}.png`),
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    clip: box,
  });
  writeFileSync(path.join(OUT, `${stem}.json`), JSON.stringify(box));
}

for (const held of [false, true])
  test(`swiss sample selected index ${held ? 'at settle, deliveries held' : 'at rest'}`, async ({
    page,
    app,
  }) => {
    await expect.poll(() => derived(app.log), { timeout: 60_000 }).toBe(true);
    if (held)
      await page.addInitScript((delay) => {
        const Native = window.IntersectionObserver;
        window.IntersectionObserver = class extends Native {
          constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
            super(
              (entries, observer) => window.setTimeout(() => callback(entries, observer), delay),
              options,
            );
          }
        };
      }, DELAY_MS);
    const watch = watchEnhancements(page);
    try {
      await page.goto('/sample?variant=swiss-signal');
      await expect(page.locator('[data-variant="swiss-signal"]')).toHaveCount(1);
      expect(await watch.settled()).toBe(true);
      if (!held) await page.waitForTimeout(DELAY_MS * 3 + 2_000);
      await shoot(page, held ? 'held-at-settle' : 'rest');
    } finally {
      watch.stop();
    }
  });
