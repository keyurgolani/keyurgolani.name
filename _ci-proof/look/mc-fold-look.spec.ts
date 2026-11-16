import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';

// Mission Control's folded panels at 1024 in one design language, PROOF_LOOK_LANGUAGE, on its scheme,
// PROOF_LOOK_SCHEME, dark, Neutral UI, by default and under forced colours: each panel's bar band
// shot (the first three) at rest closed, at rest open, and with its bar focused from the keyboard. Beside the rest
// shots, a JSON of each bar's text rects, the next element's box and the panel's box, all relative to
// the panel, so the two sides compare within 0.5 px. Each file goes to PROOF_LOOK_OUT.

const OUT = process.env.PROOF_LOOK_OUT ?? 'reports/proof-look';
const LANGUAGE = process.env.PROOF_LOOK_LANGUAGE ?? 'blueprint';
const SCHEME = process.env.PROOF_LOOK_SCHEME ?? 'low-stimulus-warm';
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  viewport: { width: 1024, height: 768 },
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'mission-control')
      .replace(/designLanguage: .*/, `designLanguage: ${LANGUAGE}`)
      .replace(/typography: .*/, 'typography: neutral-ui')
      .replace(/displayMode: .*/, 'displayMode: dark'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

for (const [colours, forcedColors] of [
  ['default', 'none'],
  ['forced', 'active'],
] as const) {
  for (const state of ['closed', 'open', 'focused'] as const) {
    test(`Mission Control's folded bars in ${LANGUAGE}, ${colours}, ${state}`, async ({
      page,
      app,
    }) => {
      await page.emulateMedia({ forcedColors });
      await page.context().addCookies([
        {
          name: 'portfolio_appearance',
          value: new URLSearchParams({ scheme: SCHEME, mode: 'dark' }).toString(),
          url: app.origin,
        },
      ]);
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const bars = page.locator('.mc-panel--fold > details.mc-fold > summary');
      const count = await bars.count();
      expect(count, 'folded panels').toBeGreaterThan(0);
      if (state === 'open')
        for (let i = 0; i < count; i++)
          await bars.nth(i).evaluate((s) => ((s.parentElement as HTMLDetailsElement).open = true));
      await page.mouse.move(0, 0);
      await settle(page);
      mkdirSync(OUT, { recursive: true });
      const read: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const bar = bars.nth(i);
        await bar.scrollIntoViewIfNeeded();
        if (state === 'focused') {
          await page.keyboard.press('Shift');
          await bar.focus();
          await settle(page);
        }
        read.push(
          await bar.evaluate((s) => {
            const r = (b: DOMRect) =>
              [b.left, b.top, b.right, b.bottom].map((v) => Math.round(v * 100) / 100);
            const panel = s.closest('.mc-panel')!.getBoundingClientRect();
            const rel = (b: DOMRect) =>
              r(new DOMRect(b.left - panel.left, b.top - panel.top, b.width, b.height));
            const texts: number[][] = [];
            const walker = document.createTreeWalker(s, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              if (!(n.textContent ?? '').trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(n);
              for (const b of range.getClientRects()) texts.push(rel(b));
            }
            const next = s.nextElementSibling?.getBoundingClientRect();
            return {
              panel: [panel.width, panel.height].map((v) => Math.round(v * 100) / 100),
              texts,
              after: next ? rel(next) : null,
            };
          }),
        );
        // The first three bars are shot; every bar's rects go in the JSON.
        if (i >= 3) continue;
        const box = await bar.evaluate((s) => {
          const p = s.closest('.mc-panel')!.getBoundingClientRect();
          const b = s.getBoundingClientRect();
          return {
            x: p.left - 10,
            y: p.top - 10,
            width: p.width + 20,
            height: b.bottom - p.top + 20,
          };
        });
        await page.screenshot({
          path: path.join(OUT, `fold-${LANGUAGE}-${colours}-${state}-${i + 1}.png`),
          clip: box,
          animations: 'disabled',
          caret: 'hide',
        });
      }
      if (state !== 'focused')
        writeFileSync(
          path.join(OUT, `fold-${LANGUAGE}-${colours}-${state}.json`),
          JSON.stringify(read, null, 1),
        );
    });
  }
}
