// HC evidence only, not for merge (row 53 r2): #201's one CI red, zz-kgn-hc-r2-pins-complete.spec.ts:96, the same
// test x20 at retries 0 with a scroll recorder, so CI's own failing runs carry their write sequence. Each run
// prints one "[kgn-96probe]" line to stdout (pass or fail): from the root's text back at its own size, every page
// and strip scroll write a script made (target and method, values, the page's place, current, the caller and the
// code around it), and the frames where the page, the strip, the pin or current changed, scripted or not.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { expectAt, load, read } from './horizontal-cinema-model';

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

/** In the page before its scripts: every scroll write a script makes, window or element, with its caller. */
function recordWrites(): void {
  const w = window as unknown as { __kgnWrites: unknown[] };
  w.__kgnWrites = [];
  const who = () =>
    (new Error().stack ?? '')
      .split('\n')
      .slice(3, 8)
      .map((l) => l.trim().replace(/https?:\/\/[^/]+/, ''));
  const name = (target: unknown) =>
    target === window
      ? 'window'
      : target instanceof Element
        ? `${target.tagName.toLowerCase()}.${[...target.classList].join('.')}`
        : String(target);
  const record = (target: unknown, write: string, args: string) =>
    w.__kgnWrites.push({
      at: performance.now(),
      write: `${name(target)}.${write}`,
      args: args.slice(0, 90),
      y: scrollY,
      current: [...document.querySelectorAll('.hc-minimap__blocks i')].findIndex((b) =>
        b.hasAttribute('data-now'),
      ),
      who: who(),
    });
  for (const [owner, method] of [
    [window, 'scrollTo'],
    [window, 'scrollBy'],
    [window, 'scroll'],
    [Element.prototype, 'scrollTo'],
    [Element.prototype, 'scrollBy'],
    [Element.prototype, 'scroll'],
    [Element.prototype, 'scrollIntoView'],
  ] as const) {
    const original = (owner as unknown as Record<string, (...a: unknown[]) => unknown>)[method]!;
    (owner as unknown as Record<string, unknown>)[method] = function (
      this: unknown,
      ...args: unknown[]
    ) {
      record(this, method, JSON.stringify(args));
      return original.apply(this, args);
    };
  }
  for (const prop of ['scrollLeft', 'scrollTop'] as const) {
    const own = Object.getOwnPropertyDescriptor(Element.prototype, prop)!;
    Object.defineProperty(Element.prototype, prop, {
      get() {
        return own.get!.call(this);
      },
      set(value: number) {
        record(this, `${prop}=`, String(value));
        own.set!.call(this, value);
      },
      configurable: true,
    });
  }
}

/** From now on, in the page: per frame (when anything changes) scrollY, the stage's scrollLeft and travel, the
 * pin, the layout, current; every window and stage scroll (scripted or the browser's own), the em sentinel's
 * resize, the shell's attribute changes, the root's font size changes. */
async function startLog(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __kgnLog: unknown[];
      __kgnWrites: unknown[];
      __kgnSeen: number;
    };
    w.__kgnLog = [];
    w.__kgnSeen = w.__kgnWrites.length;
    const t0 = performance.now();
    const stage = document.querySelector<HTMLElement>('.hc-stage')!;
    const shell = document.querySelector<HTMLElement>('.hc-shell')!;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const state = () => ({
      y: r1(scrollY),
      left: r1(stage.scrollLeft),
      travel: stage.scrollWidth - stage.clientWidth,
      pin: shell.style.getPropertyValue('--layout-pin-length'),
      fit: shell.getAttribute('data-fit'),
      pinned: shell.hasAttribute('data-pin'),
      current: [...document.querySelectorAll('.hc-minimap__blocks i')].findIndex((b) =>
        b.hasAttribute('data-now'),
      ),
      font: getComputedStyle(document.documentElement).fontSize,
    });
    let last = '';
    const snap = (why: string) => {
      const s = state();
      const scripted = w.__kgnWrites.length > w.__kgnSeen;
      w.__kgnSeen = w.__kgnWrites.length;
      w.__kgnLog.push({ t: r1(performance.now() - t0), why, scripted, ...s });
      last = JSON.stringify(s);
    };
    addEventListener('scroll', () => snap('window scroll'), { passive: true });
    stage.addEventListener('scroll', () => snap('stage scroll'), { passive: true });
    for (const type of ['scrollend', 'scrollsnapchange'])
      stage.addEventListener(type, () => snap(`stage ${type}`), { passive: true });
    new MutationObserver(() => snap('shell attributes')).observe(shell, {
      attributes: true,
      attributeFilter: ['style', 'data-pin', 'data-fit'],
    });
    new MutationObserver(() => snap('root style')).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    });
    const em = document.querySelector('.hc-shell__em');
    if (em) new ResizeObserver(() => snap('em resize (probe)')).observe(em);
    const frame = () => {
      if (JSON.stringify(state()) !== last) snap('frame');
      requestAnimationFrame(frame);
    };
    snap('start');
    requestAnimationFrame(frame);
    (w as unknown as { __kgnT0: number }).__kgnT0 = t0;
  });
}

async function dumpLog(page: Page, title: string, status: string) {
  const row = await page
    .evaluate(async () => {
      const w = window as unknown as {
        __kgnLog: { t: number; why: string; font?: string }[];
        __kgnWrites: { at: number; who: string[] }[];
        __kgnT0: number;
      };
      // From the root's text back at its own size: the last root style change to 16px.
      const backs = w.__kgnLog.filter((row) => row.why === 'root style' && row.font === '16px');
      const from = backs.length ? backs[backs.length - 1]!.t - 50 : 0;
      const writes = w.__kgnWrites
        .map((one) => ({ ...one, at: Math.round((one.at - w.__kgnT0) * 10) / 10 }))
        .filter((one) => one.at >= from);
      // The code around each caller, read from its own chunk, so a minified name says which function it is.
      const sources = new Map<string, string>();
      const around = async (frame: string | undefined) => {
        const m = frame?.match(/(\/_next\/[^\s)]+):(\d+):(\d+)/);
        if (!m) return '';
        const [, url, line, col] = m;
        if (!sources.has(url!))
          sources.set(
            url!,
            await fetch(url!)
              .then((r) => r.text())
              .catch(() => ''),
          );
        const text = (sources.get(url!) ?? '').split('\n')[Number(line) - 1] ?? '';
        return text.slice(Math.max(0, Number(col) - 90), Number(col) + 30);
      };
      const withCode = [];
      for (const one of writes) withCode.push({ ...one, code: await around(one.who[1]) });
      return { writes: withCode, log: w.__kgnLog.filter((row) => row.t >= from) };
    })
    .catch((error: unknown) => ({ error: String(error) }));
  console.log(`[kgn-96probe] ${JSON.stringify({ title, status, ...row })}`);
}

for (let run = 1; run <= 20; run++) {
  test(
    `a larger text size fits the strip again at once, top to bottom where its scenes no longer fit (zz-kgn x20 run ${String(run).padStart(2, '0')})`,
    { annotation, tag },
    async ({ page }, testInfo) => {
      await page.addInitScript(recordWrites);
      await load(page);
      await startLog(page);
      let failed = false;
      try {
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
        await page.evaluate(() => document.documentElement.style.removeProperty('font-size'));
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
      } catch (error) {
        failed = true;
        throw error;
      } finally {
        await dumpLog(page, testInfo.title, failed ? 'failed' : 'passed');
      }
    },
  );
}
