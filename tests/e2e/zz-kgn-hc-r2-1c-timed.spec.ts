// HC evidence only, not for merge (row 53 r2, 1c; each arm x10 at retries 0 for the fold's evidence): the timed
// stale-stage-event lever, 1c's second red-first, with the
// drop lever kept as the first and the lever off as the control, on #201's :96 test. Each run prints one
// "[kgn-stale]" line: from the text's return, every page and strip scroll write in call order with its caller
// frames, what the lever held and dispatched, and the end state.
// The levers (via addInitScript, before the page's scripts), armed at the text's return:
// - drop: the first page scroll event after a script's window.scrollTo (the refit's hold) is never delivered;
// - timed (#202's CI run 02): a strip write made before any page write since the arming (on a5055e196, follow()
//   inside pin()) has its stage scroll event held back from the controller (captured on the window,
//   stopImmediatePropagation), and so has the next window.scrollTo's page scroll event (the refit's hold). TIMED_MS
//   after that window.scrollTo returns, past the 150 ms settle that clears what the controller last wrote, a new
//   scroll event is dispatched on the stage, the strip still where the early write left it, and then one on the
//   page. With no such early write (1c), nothing is held or dispatched.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { expectAt, load, read } from './horizontal-cinema-model';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
/** The controller's settle, SETTLE_MS in controller.tsx: a move's settle runs this long after its last scroll. */
const SETTLE_MS = 150;
/** How long after the refit's hold the held stage event comes: the settle, plus a 50 ms margin for it to run. */
const TIMED_MS = SETTLE_MS + 50;
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

/** In the page before its scripts: the levers (see the head). */
function levers(settleMs: number): void {
  const lever = {
    mode: 'off',
    armed: false,
    holdNext: false,
    held: 0,
    from: 0,
    stageBeforeHold: false,
    pageWritten: false,
    synthetic: [] as number[],
    swallowed: [] as number[],
    pageHeld: false,
    delay: 0,
    armedAt: 0,
    settleFires: [] as number[],
    redispatchAt: -1,
  };
  (window as unknown as { __kgnLever: typeof lever }).__kgnLever = lever;
  const again = new WeakSet<Event>();
  // The settle's timer (a SETTLE_MS timeout) firing, by time: where the settle clears what the controller last wrote.
  const timeout = window.setTimeout.bind(window) as (...args: unknown[]) => number;
  (window as unknown as { setTimeout: (...args: unknown[]) => number }).setTimeout = (
    handler: unknown,
    ms?: unknown,
    ...rest: unknown[]
  ) => {
    if (ms === settleMs && typeof handler === 'function') {
      const run = handler as (...a: unknown[]) => unknown;
      return timeout(
        (...a: unknown[]) => {
          lever.settleFires.push(performance.now());
          return run(...a);
        },
        ms,
        ...rest,
      );
    }
    return timeout(handler, ms, ...rest);
  };
  const count = () => (window as unknown as { __kgnWrites?: unknown[] }).__kgnWrites?.length ?? -1;
  const stage = () => document.querySelector<HTMLElement>('.hc-stage');
  const elementScrollTo = Element.prototype.scrollTo;
  Element.prototype.scrollTo = function (this: Element, ...args: unknown[]) {
    if (lever.armed && lever.mode === 'timed' && !lever.pageWritten && this === stage())
      lever.stageBeforeHold = true;
    return (elementScrollTo as (...a: unknown[]) => void).apply(this, args);
  } as typeof Element.prototype.scrollTo;
  const scrollTo = window.scrollTo.bind(window) as (...args: unknown[]) => void;
  (window as unknown as { scrollTo: (...args: unknown[]) => void }).scrollTo = (
    ...args: unknown[]
  ) => {
    if (lever.armed && lever.mode === 'drop') lever.holdNext = true;
    scrollTo(...args);
    if (lever.armed && lever.mode === 'timed' && !lever.pageWritten) {
      lever.pageWritten = true;
      const target = stage();
      if (lever.stageBeforeHold && target)
        setTimeout(() => {
          // The stage's own event, late, past the settle: the strip still where the early write left it.
          const late = new Event('scroll');
          again.add(late);
          lever.redispatchAt = performance.now();
          lever.synthetic.push(count());
          target.dispatchEvent(late);
          // Then the page's, held since the hold's write.
          const page = new Event('scroll', { bubbles: true });
          again.add(page);
          lever.synthetic.push(count());
          document.dispatchEvent(page);
        }, lever.delay);
    }
  };
  addEventListener(
    'scroll',
    (event) => {
      if (again.has(event)) return;
      if (lever.mode === 'drop' && lever.holdNext && event.target === document) {
        lever.holdNext = false;
        lever.armed = false;
        lever.held++;
        event.stopImmediatePropagation();
        return;
      }
      if (lever.mode !== 'timed' || !lever.stageBeforeHold) return;
      if (lever.swallowed.length === 0 && event.target === stage()) {
        // The early strip write's own event, held back until the timed dispatch.
        lever.swallowed.push(count());
        lever.held++;
        event.stopImmediatePropagation();
      } else if (lever.pageWritten && !lever.pageHeld && event.target === document) {
        // The hold's page scroll event, held back until after the stage's.
        lever.pageHeld = true;
        lever.held++;
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
}

/** In the page before its scripts: every page and strip scroll write a script makes, with its caller frames. */
function recordWrites(): void {
  const writes: { write: string; args: string; y: number; left: number; who: string[] }[] = [];
  (window as unknown as { __kgnWrites: typeof writes }).__kgnWrites = writes;
  const who = () =>
    (new Error().stack ?? '')
      .split('\n')
      .slice(3, 9)
      .map((l) => l.trim().replace(/https?:\/\/[^/]+/, ''));
  const name = (target: unknown) =>
    target === window
      ? 'window'
      : target instanceof Element
        ? `${target.tagName.toLowerCase()}.${[...target.classList].join('.')}`
        : String(target);
  const left = () => document.querySelector<HTMLElement>('.hc-stage')?.scrollLeft ?? -1;
  const own = window as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const method of ['scrollTo', 'scrollBy', 'scroll']) {
    const original = own[method]!.bind(window);
    own[method] = (...args: unknown[]) => {
      writes.push({
        write: `window.${method}`,
        args: JSON.stringify(args),
        y: scrollY,
        left: left(),
        who: who(),
      });
      return original(...args);
    };
  }
  const proto = Element.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const method of ['scrollTo', 'scrollBy', 'scroll', 'scrollIntoView']) {
    const original = proto[method]!;
    proto[method] = function (this: Element, ...args: unknown[]) {
      writes.push({
        write: `${name(this)}.${method}`,
        args: JSON.stringify(args),
        y: scrollY,
        left: left(),
        who: who(),
      });
      return original.apply(this, args);
    };
  }
}

// Every lever run, pass or fail: the writes since the arming in call order, what the lever did, the end state.
test.afterEach(async ({ page }, testInfo) => {
  const row = await page
    .evaluate(() => {
      const w = window as unknown as {
        __kgnLever?: {
          mode: string;
          from: number;
          held: number;
          stageBeforeHold: boolean;
          synthetic: number[];
          swallowed: number[];
          pageHeld: boolean;
          armedAt: number;
          settleFires: number[];
          redispatchAt: number;
        };
        __kgnWrites?: unknown[];
      };
      const l = w.__kgnLever;
      const stage = document.querySelector<HTMLElement>('.hc-stage');
      return {
        lever: l
          ? {
              mode: l.mode,
              held: l.held,
              stageBeforeHold: l.stageBeforeHold,
              synthetic: l.synthetic,
              swallowed: l.swallowed,
              pageHeld: l.pageHeld,
              // Times from the arming, in ms; the gap is the re-dispatch less the last settle before it.
              settleFires: l.settleFires
                .filter((t) => t >= l.armedAt)
                .map((t) => Math.round((t - l.armedAt) * 10) / 10),
              redispatchAt:
                l.redispatchAt < 0 ? null : Math.round((l.redispatchAt - l.armedAt) * 10) / 10,
              gap: (() => {
                const before = l.settleFires.filter(
                  (t) => t >= l.armedAt && l.redispatchAt >= 0 && t <= l.redispatchAt,
                );
                return before.length
                  ? Math.round((l.redispatchAt - before[before.length - 1]!) * 10) / 10
                  : null;
              })(),
            }
          : null,
        writes: (w.__kgnWrites ?? []).slice(l?.from ?? 0),
        end: {
          y: Math.round(scrollY),
          left: Math.round(stage?.scrollLeft ?? -1),
          current: [...document.querySelectorAll('.hc-minimap__blocks i')].findIndex((b) =>
            b.hasAttribute('data-now'),
          ),
        },
      };
    })
    .catch((error: unknown) => ({ error: String(error) }));
  console.log(
    `[kgn-stale] ${JSON.stringify({ title: testInfo.title.slice(testInfo.title.indexOf('(lever')), status: testInfo.status, ...row })}`,
  );
});

for (const lever of ['off', 'drop', 'timed'] as const) {
  for (let run = 1; run <= 10; run++) {
    test(
      `a larger text size fits the strip again at once, top to bottom where its scenes no longer fit (lever ${lever}) (zz-kgn x10 run ${String(run).padStart(2, '0')})`,
      { annotation, tag },
      async ({ page }) => {
        await page.addInitScript(recordWrites);
        await page.addInitScript(levers, SETTLE_MS);
        await load(page);
        expect(await read(page)).toMatchObject({ layout: 'horizontal', pinned: true });
        // The reader is on scene 6, a link in it focused: the change keeps them there, both ways.
        const next = page.getByRole('button', { name: 'Next scene' });
        for (let at = 1; at <= 6; at++) {
          await next.click();
          await expectAt(page, at);
        }
        const { scenes } = await read(page);
        const link = page.locator(`#${scenes[6]} a[href]`).first();
        await link.focus();
        const keeps = async () => {
          await expect.poll(async () => (await read(page)).current, { timeout: 1000 }).toBe(6);
          await expect(link).toBeFocused();
          await expect(link).toBeInViewport();
        };
        // The root's text doubled, as a reader's own setting does, with no resize of the window.
        await page.evaluate(() =>
          document.documentElement.style.setProperty('font-size', '200%', 'important'),
        );
        await expect
          .poll(
            async () => {
              const { layout, pinned, fit } = await read(page);
              return { layout, pinned, fit };
            },
            { timeout: 1000 },
          )
          .toEqual({ layout: 'vertical', pinned: false, fit: 'over' });
        // Top to bottom, scene 6 is at the top, still current, and the focused link is on screen.
        await keeps();
        const top = await page
          .locator(`#${scenes[6]}`)
          .evaluate((scene) => scene.getBoundingClientRect().top);
        expect(top).toBeGreaterThanOrEqual(-1);
        expect(top).toBeLessThanOrEqual(await page.evaluate(() => window.innerHeight * 0.3));
        // And back: at its own size the strip shows and pins again.
        // The lever: from here, the first page scroll event after a script's window.scrollTo (the refit's
        // hold) is held back from the page's listeners, then dispatched 50 ms on, or never (CI's missed
        // catch-up, #201's :96). Off: nothing is held.
        await page.evaluate(
          ([lever, timed]) => {
            const l = (window as unknown as { __kgnLever: { mode: string; armed: boolean } })
              .__kgnLever;
            l.mode = lever;
            l.armed = lever !== 'off';
            (l as unknown as { delay: number }).delay = timed;
            (l as unknown as { armedAt: number }).armedAt = performance.now();
            (l as unknown as { from: number }).from = (
              window as unknown as { __kgnWrites: unknown[] }
            ).__kgnWrites.length;
            document.documentElement.style.removeProperty('font-size');
          },
          [lever, TIMED_MS] as const,
        );
        await expect
          .poll(
            async () => {
              const { layout, pinned, fit } = await read(page);
              return { layout, pinned, fit };
            },
            { timeout: 1000 },
          )
          .toEqual({ layout: 'horizontal', pinned: true, fit: null });
        // Pinned again on scene 6, the link still focused and on screen.
        await expectAt(page, 6);
        await keeps();
      },
    );
  }
}
