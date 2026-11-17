// Probe for Kinetic Cosmos's dock (not for commit), run as a look on CI Linux at the base and the head:
// the failing reading spec's own steps at 390 (Paste-Up on Letterpress, low-stimulus-warm, dark):
// openHome, the focus check on a work's title (ringFindingsOf: scroll, focus, Shift+Tab, Tab, the
// perimeter read), then #kc--ring-record scrolled into view, and the dock waited for up to 5 s. Every
// IntersectionObserver passes its deliveries through unchanged and logs each one that holds the
// stage: which observer, its root margin, the stage's entries in order. Per run: whether and when the
// dock showed, the stage's box, a fresh observer's read, the dock's hidden state, and whether any
// delivery held the stage both in and out of view. JSON to $PROOF_LOOK_OUT and stdout ("dockprobe ").
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { kineticOptions, openHome, ringFindingsOf, type Row } from './kinetic-cosmos-reading';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
test.use({
  appOptions: kineticOptions({
    language: 'letterpress',
    scheme: 'low-stimulus-warm',
    typography: 'paste-up',
    mode: 'dark',
  }),
});
test.describe.configure({ timeout: 90_000 });

const RUNS: readonly { row: Row; times: number }[] = [
  { row: 'forced-colors', times: 8 },
  { row: 'contrast-more', times: 8 },
  { row: 'default', times: 4 },
];

interface Logged {
  observer: number;
  margin: string;
  at: number;
  stage: boolean[];
}

declare global {
  interface Window {
    __stageDeliveries?: Logged[];
    __NativeIntersectionObserver?: typeof IntersectionObserver;
  }
}

const state = (page: Page) =>
  page.evaluate(async () => {
    const stage = document.getElementById('kc--stage');
    const dock = document.querySelector<HTMLElement>('.kc-dock');
    const box = stage?.getBoundingClientRect();
    const Native = window.__NativeIntersectionObserver ?? IntersectionObserver;
    const fresh = stage
      ? await new Promise<{ isIntersecting: boolean; ratio: number }>((done) => {
          const observer = new Native(([entry]) => {
            observer.disconnect();
            done({
              isIntersecting: entry!.isIntersecting,
              ratio: Math.round(entry!.intersectionRatio * 1000) / 1000,
            });
          });
          observer.observe(stage);
        })
      : null;
    return {
      scrollY: Math.round(scrollY),
      box: box ? { top: Math.round(box.top), bottom: Math.round(box.bottom) } : null,
      fresh,
      dock: dock ? { hidden: dock.hidden, current: dock.dataset.current ?? null } : null,
      deliveries: window.__stageDeliveries ?? [],
    };
  });

for (const { row, times } of RUNS)
  for (let run = 1; run <= times; run += 1)
    test(`dockprobe ${row} ${run}`, async ({ page }) => {
      await page.addInitScript(() => {
        const Native = window.IntersectionObserver;
        window.__NativeIntersectionObserver = Native;
        let count = 0;
        window.IntersectionObserver = class extends Native {
          constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
            const id = (count += 1);
            super((entries, observer) => {
              const stage = entries
                .filter((entry) => entry.target.id === 'kc--stage')
                .map((entry) => entry.isIntersecting);
              if (stage.length > 0)
                (window.__stageDeliveries ??= []).push({
                  observer: id,
                  margin: options?.rootMargin ?? '',
                  at: Math.round(performance.now()),
                  stage,
                });
              callback(entries, observer);
            }, options);
          }
        };
      });
      await openHome(page, { width: 390, height: 844, row });
      await ringFindingsOf(page, page.locator('#project-name h4 a').first());
      const afterFocus = await state(page);
      const start = Date.now();
      await page.locator('#kc--ring-record').scrollIntoViewIfNeeded();
      let shownAfterMs: number | null = null;
      while (Date.now() - start < 5_000) {
        if (await page.locator('.kc-dock').isVisible()) {
          shownAfterMs = Date.now() - start;
          break;
        }
        await page.waitForTimeout(50);
      }
      const after = await state(page);
      const mixed = after.deliveries.filter(
        (delivery) => delivery.stage.length > 1 && delivery.stage[0] !== delivery.stage.at(-1),
      );
      const out = { row, run, shownAfterMs, afterFocus, after, mixed };
      writeFileSync(path.join(OUT, `${row}-${run}.json`), JSON.stringify(out, null, 1));
      console.log(
        `dockprobe ${row} ${run} shown=${shownAfterMs} hidden=${after.dock?.hidden} fresh=${after.fresh?.isIntersecting} mixed=${JSON.stringify(mixed)}`,
      );
      expect(after.dock, 'the dock is on the page').not.toBeNull();
    });
