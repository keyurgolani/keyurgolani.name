// HC evidence only, not for merge (row 53 r2, 1c): retries-0 copies of 1c's pin, both arms, each x10, for the
// fold's evidence (41887141). The test and its two in-page helpers verbatim from horizontal-cinema.spec.ts.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { expectAt, frames, load, read } from './horizontal-cinema-model';

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
 * In the page before its scripts, a lever for the refit's pin (row 53 r2, 1c): once armed, the first
 * page scroll event after a script's window.scrollTo (the refit's hold) is held back from every other
 * listener, and dispatched again 50 ms on ('delay') or never ('drop'), as CI's run once missed it (#201).
 */
function holdBack(): void {
  const lever = { mode: 'off', armed: false, holdNext: false, held: 0 };
  (window as unknown as { __kgnLever: typeof lever }).__kgnLever = lever;
  const scrollTo = window.scrollTo.bind(window) as (...args: unknown[]) => void;
  (window as unknown as { scrollTo: (...args: unknown[]) => void }).scrollTo = (
    ...args: unknown[]
  ) => {
    if (lever.armed) lever.holdNext = true;
    scrollTo(...args);
  };
  const again = new WeakSet<Event>();
  addEventListener(
    'scroll',
    (event) => {
      if (again.has(event) || !lever.holdNext || event.target !== document) return;
      lever.holdNext = false;
      lever.armed = false;
      lever.held++;
      event.stopImmediatePropagation();
      if (lever.mode === 'delay')
        setTimeout(() => {
          const later = new Event('scroll', { bubbles: true });
          again.add(later);
          document.dispatchEvent(later);
        }, 50);
    },
    { capture: true },
  );
}

/** In the page before its scripts: every page and strip scroll write a script makes, with its time. */
function recordWrites(): void {
  const writes: { at: number; write: string; args: string }[] = [];
  (window as unknown as { __kgnWrites: typeof writes }).__kgnWrites = writes;
  const name = (target: unknown) =>
    target === window
      ? 'window'
      : target instanceof Element
        ? `${target.tagName.toLowerCase()}.${[...target.classList].join('.')}`
        : String(target);
  const own = window as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const method of ['scrollTo', 'scrollBy', 'scroll']) {
    const original = own[method]!.bind(window);
    own[method] = (...args: unknown[]) => {
      writes.push({ at: performance.now(), write: `window.${method}`, args: JSON.stringify(args) });
      return original(...args);
    };
  }
  const proto = Element.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const method of ['scrollTo', 'scrollBy', 'scroll', 'scrollIntoView']) {
    const original = proto[method]!;
    proto[method] = function (this: Element, ...args: unknown[]) {
      writes.push({
        at: performance.now(),
        write: `${name(this)}.${method}`,
        args: JSON.stringify(args),
      });
      return original.apply(this, args);
    };
  }
  const left = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft')!;
  Object.defineProperty(Element.prototype, 'scrollLeft', {
    get() {
      return left.get!.call(this);
    },
    set(value: number) {
      writes.push({
        at: performance.now(),
        write: `${name(this)}.scrollLeft=`,
        args: String(value),
      });
      left.set!.call(this, value);
    },
    configurable: true,
  });
}

// A pinned reader on scene 6, a link in it focused, the text at 200% (top to bottom) and back (pinned again,
// the scene's place along the strip moved): the refit brings the strip to the scene once, after the page is
// back where the reader was, not from wherever the browser carried the page as the pin came back; so even
// with the page's own scroll event after the hold lost, the strip shows scene 6 (row 53 r2, 1c; #201's :96).
// The link is focused so the refit holds scene 6 by focus: with no scene focused it holds the scene the page
// reads, row 93's path, which P3b pins.
for (const pinLever of ['no lever', 'drop lever'] as const) {
  for (let run = 1; run <= 10; run++) {
    test(
      `a refit that moves the reader's scene has the strip follow to it once, after the page (${pinLever}) (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
      { annotation, tag },
      async ({ page }) => {
        await page.addInitScript(recordWrites);
        await page.addInitScript(holdBack);
        await load(page);
        const next = page.getByRole('button', { name: 'Next scene' });
        for (let at = 1; at <= 6; at++) {
          await next.click();
          await expectAt(page, at);
        }
        // As :96 does: a link in scene 6 focused, so the refit holds scene 6 by focus, not by the page's
        // reading of it (a reader with focus on the bar lands on scene 5 there, on a5055e196 and on 1c
        // alike, c-hc-r2-1c-lever: a separate finding, not this pin's).
        const { scenes } = await read(page);
        await page.locator(`#${scenes[6]} a[href]`).first().focus();
        const layout = async () => {
          const { layout, pinned, fit } = await read(page);
          return { layout, pinned, fit };
        };
        await page.evaluate(() =>
          document.documentElement.style.setProperty('font-size', '200%', 'important'),
        );
        await expect
          .poll(layout, { timeout: 1000 })
          .toEqual({ layout: 'vertical', pinned: false, fit: 'over' });
        await frames(page);
        await page.waitForTimeout(300);
        // The text back at its own size: the strip pins again, and scene 6's place along it moves.
        const from = await page.evaluate((pinLever) => {
          const n = (window as unknown as { __kgnWrites: unknown[] }).__kgnWrites.length;
          const l = (window as unknown as { __kgnLever: { mode: string; armed: boolean } })
            .__kgnLever;
          l.mode = pinLever === 'drop lever' ? 'drop' : 'off';
          l.armed = pinLever === 'drop lever';
          document.documentElement.style.removeProperty('font-size');
          return n;
        }, pinLever);
        await expect
          .poll(layout, { timeout: 1000 })
          .toEqual({ layout: 'horizontal', pinned: true, fit: null });
        await expectAt(page, 6);
        await page.waitForTimeout(300);
        const writes = await page.evaluate(
          (from) =>
            (
              window as unknown as { __kgnWrites: { at: number; write: string; args: string }[] }
            ).__kgnWrites.slice(from),
          from,
        );
        const strip = writes.filter((one) => one.write.startsWith('div.hc-stage.'));
        const moves = writes.filter((one) => one.write.startsWith('window.'));
        expect(moves.length, 'page writes').toBeGreaterThanOrEqual(1);
        expect(
          strip.map((one) => one.args),
          'strip writes',
        ).toHaveLength(1);
        // In call order, not by time: both come in the same task, often within the clock's 0.1 ms.
        expect(
          writes.indexOf(strip[0]!),
          'the strip write comes after the page write',
        ).toBeGreaterThan(writes.indexOf(moves[0]!));
        const now = await read(page);
        const to = Number((JSON.parse(strip[0]!.args) as { left: number }[])[0]!.left);
        expect(
          Math.abs(to - now.along),
          'the strip lands where it shows scene 6',
        ).toBeLessThanOrEqual(1);
      },
    );
  }
}
