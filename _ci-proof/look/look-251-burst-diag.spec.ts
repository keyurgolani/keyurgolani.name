// Look read for one CI run (laid in by the proof kit, never in a head's tree): Horizontal Cinema's
// pinned strip on the complete contract fixture at 1440 by 900, the sideways-kept spec's resize-burst
// case run 20 times, each with its events logged. From scene 6, one real resize to 860 opens a burst
// that synthetic resizes hold open until the strip has scrolled and 200 ms more, with one sideways
// wheel over the stage inside it. Logged: every wheel, resize and scroll event with its timeStamp and
// the clock at its handler, every scrollTo the page makes, and where the reader ends.
// Out: $PROOF_LOOK_OUT/burst-<n>.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { expectAt, frames, load, read } from './horizontal-cinema-model';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const RUNS = 20;

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

type Logged = { __log: unknown[]; __on: boolean; __hcBurst: Promise<void>; __hcSwiped: boolean };

async function logEvents(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Logged;
    w.__log = [];
    w.__on = false;
    const now = () => Math.round(performance.now() * 10) / 10;
    const ts = (event: Event) => Math.round(event.timeStamp * 10) / 10;
    const who = (el: unknown) =>
      el === window || el === document
        ? 'page'
        : (el as Element).classList?.contains('hc-stage')
          ? 'stage'
          : 'other';
    for (const [proto, name] of [
      [window, 'scrollTo'],
      [Element.prototype, 'scrollTo'],
      [window, 'scrollBy'],
    ] as const) {
      const target = proto as unknown as Record<string, (...a: unknown[]) => void>;
      const orig = target[name]!;
      target[name] = function (this: unknown, ...args: unknown[]) {
        if (w.__on)
          w.__log.push({ at: now(), write: `${who(this)}.${name}`, args: JSON.stringify(args) });
        return orig.apply(this, args);
      };
    }
    addEventListener(
      'scroll',
      (event) => {
        if (!w.__on) return;
        const stage = document.querySelector('.hc-stage');
        w.__log.push({
          at: now(),
          ts: ts(event),
          scroll: who(event.target),
          y: Math.round(scrollY),
          left: Math.round(Math.abs(stage?.scrollLeft ?? 0)),
        });
      },
      true,
    );
    for (const type of ['wheel', 'resize'] as const)
      addEventListener(
        type,
        (event) => {
          if (!w.__on) return;
          w.__log.push({
            at: now(),
            ts: ts(event),
            [type]:
              type === 'wheel'
                ? [(event as WheelEvent).deltaX, (event as WheelEvent).deltaY]
                : event.isTrusted,
            h: innerHeight,
          });
        },
        { capture: true, passive: true },
      );
  });
}

/** Waits until nothing has scrolled for 600 ms and two frames have drawn (as the spec does). */
async function settled(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((done) => {
        let timer = setTimeout(finish, 600);
        function finish() {
          removeEventListener('scroll', reset, true);
          requestAnimationFrame(() => requestAnimationFrame(() => done()));
        }
        function reset() {
          clearTimeout(timer);
          timer = setTimeout(finish, 600);
        }
        addEventListener('scroll', reset, true);
      }),
  );
}

for (let n = 1; n <= RUNS; n++) {
  test(`look burst diag ${n}`, { tag: '@interaction' }, async ({ page }) => {
    const out = process.env.PROOF_LOOK_OUT ?? '';
    expect(out, 'PROOF_LOOK_OUT').not.toBe('');
    mkdirSync(out, { recursive: true });
    await logEvents(page);
    await load(page);
    expect(await read(page)).toMatchObject({ layout: 'horizontal', pinned: true });
    const next = page.getByRole('button', { name: 'Next scene' });
    for (let at = 1; at <= 6; at++) {
      await next.click();
      await expectAt(page, at);
    }
    await page.evaluate(() => {
      const w = window as unknown as Logged;
      w.__on = true;
      w.__hcSwiped = false;
      const stage = document.querySelector('.hc-stage')!;
      stage.addEventListener('scroll', () => (w.__hcSwiped = true), { once: true });
      w.__hcBurst = new Promise<void>((started) => {
        addEventListener(
          'resize',
          () => {
            started();
            let after = 0;
            const beat = setInterval(() => {
              if (w.__hcSwiped) after += 40;
              if (after > 200) clearInterval(beat);
              else dispatchEvent(new Event('resize'));
            }, 40);
          },
          { once: true },
        );
      });
    });
    await page.setViewportSize({ width: 1440, height: 860 });
    await page.evaluate(() => (window as unknown as Logged).__hcBurst);
    const box = (await page.locator('.hc-stage').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(Math.round(box.width * 1.5), 0);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Logged).__hcSwiped))
      .toBe(true);
    await page.waitForTimeout(600);
    await frames(page);
    await settled(page);
    const end = await read(page);
    const log = await page.evaluate(() => (window as unknown as Logged).__log);
    writeFileSync(
      path.join(out, `burst-${n}.json`),
      `${JSON.stringify({ end: { current: end.current, pinned: end.pinned, along: end.along, scrollY: end.scrollY }, log }, null, 1)}\n`,
    );
  });
}
