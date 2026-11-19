// Probe (scratch, never committed): horizontal-cinema-below-strip-text-size.spec.ts's foot case
// and full-record case at 1440 by 900 on the complete fixture, as the spec runs them, at the CPU
// rate PROBE_RATE (CDP throttling, 1 by default), PROBE_REPS times each. Each run logs every page
// scroll (scrollY, the page's height, the 1rem sentinel's width, the pin's length, the shell's fit
// and pin), every scroll of the strip's stage (its scrollLeft), every resize, every scrollTo and
// scrollBy on the window or an element and every scrollLeft/scrollTop write (with the caller's
// first stack frames), and each step the test takes, with where the watched box is after it.
// Out: <case>-r<rate>-<n>[-FAIL].json and probe-<side>.jsonl under $PROOF_LOOK_OUT or $PROBE_OUT.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { test } from '../harness/fixtures';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
// CPU rates and runs at each, for both cases: 1x 10, 4x 10, 6x 6 unless PROBE_RATES says
// otherwise ("rate:reps,..."). On CI the reads go to $PROOF_LOOK_OUT (side $PROOF_LOOK_SIDE).
const PLAN = (process.env.PROBE_RATES ?? '1:10,4:10,6:6')
  .split(',')
  .map((p) => p.split(':').map(Number) as [number, number]);
const SIDE = process.env.PROOF_LOOK_SIDE ?? process.env.PROBE_SIDE ?? 'local';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'horizontal-cinema'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

type Logged = { __log: unknown[] };

const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 400))),
      ),
  );

const boxOf = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const r = document.querySelector(s)!.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, scrollY, height: innerHeight };
  }, selector);

const mark = (page: Page, what: string) =>
  page.evaluate((what) => {
    (window as unknown as Logged).__log.push({
      at: Math.round(performance.now()),
      mark: what,
      y: Math.round(scrollY),
    });
  }, what);

const LINE = 120;
for (const CASE of ['record', 'foot'] as const)
  for (const [RATE, REPS] of PLAN)
    for (let n = 1; n <= REPS; n++)
      test(`probe 289 ${CASE} r${RATE} ${n}`, async ({ page }) => {
        test.setTimeout(120_000);
        const out = process.env.PROOF_LOOK_OUT || process.env.PROBE_OUT || test.info().outputPath();
        mkdirSync(out, { recursive: true });
        await page.addInitScript(() => {
          const w = window as unknown as Logged;
          w.__log = [];
          const now = () => Math.round(performance.now() * 10) / 10;
          const state = () => {
            const shell = document.querySelector<HTMLElement>('.hc-shell');
            return {
              y: Math.round(scrollY),
              h: document.documentElement.scrollHeight,
              em: document.querySelector('.hc-shell__em')?.getBoundingClientRect().width,
              pin: shell?.style.getPropertyValue('--layout-pin-length'),
              fit: shell?.dataset.fit,
              pinned: shell?.hasAttribute('data-pin'),
            };
          };
          const who = () =>
            (new Error().stack ?? '')
              .split('\n')
              .slice(3, 6)
              .map((l) =>
                l
                  .trim()
                  .replace(/https?:\/\/[^/]+/, '')
                  .slice(0, 120),
              );
          const tag = (t: unknown) =>
            t === window
              ? 'window'
              : t instanceof Element
                ? `${t.localName}.${[...t.classList].slice(0, 1).join('')}`
                : String(t);
          for (const [proto, name] of [
            [window, 'scrollTo'],
            [window, 'scrollBy'],
            [Element.prototype, 'scrollTo'],
            [Element.prototype, 'scrollBy'],
            [Element.prototype, 'scrollIntoView'],
          ] as const) {
            const target = proto as unknown as Record<string, (...a: unknown[]) => void>;
            const orig = target[name]!;
            target[name] = function (this: unknown, ...args: unknown[]) {
              const was = Math.round(scrollY);
              orig.apply(this, args);
              w.__log.push({
                at: now(),
                write: name,
                on: tag(this),
                args: JSON.stringify(args),
                was,
                by: who(),
                ...state(),
              });
            };
          }
          for (const prop of ['scrollLeft', 'scrollTop'] as const) {
            const d = Object.getOwnPropertyDescriptor(Element.prototype, prop)!;
            Object.defineProperty(Element.prototype, prop, {
              ...d,
              set(this: Element, v: number) {
                const was = d.get!.call(this);
                d.set!.call(this, v);
                w.__log.push({
                  at: now(),
                  write: prop,
                  on: tag(this),
                  v,
                  was,
                  now: d.get!.call(this),
                  by: who(),
                  ...state(),
                });
              },
            });
          }
          addEventListener(
            'scroll',
            (event) => {
              if (event.target === document || event.target === window)
                w.__log.push({ at: now(), scroll: 1, ...state() });
              else if (event.target instanceof Element && event.target.matches('.hc-stage'))
                w.__log.push({ at: now(), stage: Math.round(event.target.scrollLeft), ...state() });
            },
            true,
          );
          addEventListener('resize', () => w.__log.push({ at: now(), resize: 1, ...state() }));
        });
        if (RATE > 1) {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/', { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        if (CASE === 'foot')
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        else
          await page.evaluate((line) => {
            const record = document.querySelector('.hc-record')!;
            window.scrollTo(0, scrollY + record.getBoundingClientRect().top - line);
          }, LINE);
        await settle(page);
        const watched = CASE === 'foot' ? '.hc-credits__head' : '.hc-record';
        const before = await boxOf(page, watched);
        const steps: unknown[] = [];
        let ok = true;
        for (const size of ['112.5%', null]) {
          await mark(page, `text ${size ?? 'back'}`);
          await page.evaluate((to) => {
            const root = document.documentElement.style;
            if (to) root.setProperty('font-size', to, 'important');
            else root.removeProperty('font-size');
          }, size);
          await settle(page);
          await settle(page);
          const after = await boxOf(page, watched);
          const held =
            CASE === 'foot'
              ? after.top >= 0 && after.top < after.height && Math.abs(after.top - before.top) <= 48
              : after.top <= LINE + 1 &&
                after.bottom > LINE &&
                Math.abs(after.top - before.top) <= 48;
          ok &&= held;
          steps.push({ size: size ?? 'back', after, held });
        }
        const log = await page.evaluate(() => (window as unknown as Logged).__log);
        const name = `${CASE}-r${RATE}-${n}${ok ? '' : '-FAIL'}`;
        writeFileSync(
          path.join(out, `${name}.json`),
          `${JSON.stringify({ side: SIDE, case: CASE, rate: RATE, n, before, steps, ok, log }, null, 1)}\n`,
        );
        // One JSON line a read: the run's verdict, then each logged event, tagged with the run.
        const run = { side: SIDE, case: CASE, rate: RATE, n };
        const lines = [
          JSON.stringify({ ...run, before, steps, ok }),
          ...log.map((e) => JSON.stringify({ ...run, ...(e as object) })),
        ];
        appendFileSync(path.join(out, `probe-${SIDE}.jsonl`), `${lines.join('\n')}\n`);
        console.log(`probe-289 ${JSON.stringify({ ...run, ok, steps })}`);
      });
