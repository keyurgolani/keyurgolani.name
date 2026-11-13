import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { readHeader } from './aurora-glass-capsule-fit';

// Row 150, Aurora Glass, the fix round (the coordinator's (a), (b) and (f), from the (iii) probe v3.2 and the motion-on
// pass): the header on the 15-pack read's tuple, platform-neutral/warm-parchment/<pack>/dark, script on, under
// reduced motion (contextOptions, checked in the page). The pins, each on the packs that showed it (a spec file a
// pack: each is a server of its own):
//   - (a) at 1440, root 100% and 200%, nothing in the capsule is cut, runs past it or into the ornament: the still
//     Pause's held note sat in the row and widened it (Accessible Reading's call and Index, Geometric Display's and
//     Technical Sans Mono's call, at 1440 under reduced motion);
//   - (b) at 320, root 100%, loading the page shifts nothing: the layout-shift entries' sum from the navigation on is
//     0, as at the base, where it read 0.1438 (the page's main moved from y 92 to 0 when the enhancement turned the
//     no-JS window sticky);
//   - (f) at root 100%, from 300 to 440 px in 4 px steps, the row's lines never go back up as the window widens (on
//     Humanist UI they went 2, 1, 2, 1 between 304 and 336), and at a turn that changes them the opening's first
//     line moves by the second line's height, within 1 px, and no more;
//   - (d) at 768, root 100% and 200%, with motion allowed and reduced, the chrome on two lines is never sticky, and
//     data-ag-rows says the lines it lays out (Multilingual System at 768 at 200% with motion allowed: the row
//     needed 693.7 px of the chrome's 693.6, the enhancement's half-pixel slack read it as one line, and it wrapped
//     stuck).

export type HeaderPack =
  | 'accessible-reading'
  | 'geometric-display'
  | 'technical-sans-mono'
  | 'humanist-ui'
  | 'multilingual-system';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

export function headerFitOptions(pack: HeaderPack) {
  return {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'aurora-glass')
      .replace(/designLanguage: .*/, 'designLanguage: platform-neutral')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, `typography: ${pack}`)
      .replace(/displayMode: .*/, 'displayMode: dark'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  };
}

const annotation = [{ type: 'route', description: '/' }];

const twoFrames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

async function open(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto('/', { waitUntil: 'networkidle' });
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced motion in the page',
  ).toBe(true);
  await expect(page.locator('.ag[data-ag-live]')).toHaveCount(1);
  await expect(page.locator('.ag-chrome[data-ag-rows]')).toHaveCount(1);
  await twoFrames(page);
}

/** The row's lines, its second line's height, and where the opening's first line sits in the document. */
const lines = (page: Page) =>
  page.evaluate(() => {
    const chrome = document.querySelector('.ag-chrome')!;
    const c = chrome.querySelector('.ag-capsule')!.getBoundingClientRect();
    const o = chrome.querySelector('.ag-ornament')!.getBoundingClientRect();
    const two = o.height > 0 && o.top >= c.bottom - 1;
    const first = document.querySelector('.ag-main h1, .ag-main h2, .ag-main p')!;
    return {
      lines: two ? 2 : 1,
      // The second line, the gap above it included: what it puts on the chrome's height.
      second: two ? o.bottom - c.bottom : 0,
      first: first.getBoundingClientRect().top + scrollY,
    };
  });

export function headerFit(
  pack: HeaderPack,
  pins: { wide?: boolean; load?: boolean; turns?: boolean; wrong?: boolean },
) {
  test.use({ appOptions: headerFitOptions(pack), contextOptions: { reducedMotion: 'reduce' } });

  if (pins.wide)
    for (const root of ['100%', '200%'])
      test(
        `at 1440 at ${root} root text on ${pack}, under reduced motion, nothing in the capsule is cut or runs into the ornament`,
        { annotation },
        async ({ page }) => {
          await open(page, 1440, 900);
          if (root !== '100%') {
            await page.evaluate(
              (r) => document.documentElement.style.setProperty('font-size', r, 'important'),
              root,
            );
            await twoFrames(page);
          }
          const read = await readHeader(page);
          console.log(
            `r150 fix ${pack} 1440 ${root}: chrome ${read.chromeEm.toFixed(2)}em, cut ${JSON.stringify(read.cut)}`,
          );
          expect(read.cut, `1440 at ${root}: nothing in the capsule is cut`).toEqual([]);
        },
      );

  if (pins.load)
    test(
      `at 320 on ${pack}, loading the page shifts nothing`,
      { annotation },
      async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Chromium alone has layout-shift entries');
        await open(page, 320, 640);
        await page.waitForTimeout(150);
        const shifts = await page.evaluate(() => {
          const o = new PerformanceObserver(() => undefined);
          o.observe({ type: 'layout-shift', buffered: true });
          const all = o.takeRecords() as unknown as {
            value: number;
            hadRecentInput: boolean;
            sources: { node: Node | null }[];
          }[];
          o.disconnect();
          return all
            .filter((e) => !e.hadRecentInput)
            .map((e) => ({
              value: e.value,
              nodes: e.sources.map((s) =>
                s.node instanceof Element
                  ? `${s.node.localName}${[...s.node.classList].map((k) => `.${k}`).join('')}`
                  : String(s.node?.nodeName ?? ''),
              ),
            }));
        });
        const sum = shifts.reduce((a, e) => a + e.value, 0);
        console.log(`r150 fix ${pack} 320 load: ${sum.toFixed(4)} ${JSON.stringify(shifts)}`);
        expect(shifts, 'the load shifts nothing').toEqual([]);
      },
    );

  if (pins.turns)
    test(
      `at root 100% on ${pack}, from 300 to 440 px the row's lines never go back up, and a turn moves the first line by its second line alone`,
      { annotation },
      async ({ page }) => {
        test.setTimeout(120_000);
        await open(page, 300, 800);
        const steps: { width: number; lines: number; second: number; first: number }[] = [];
        for (let width = 300; width <= 440; width += 4) {
          await page.setViewportSize({ width, height: 800 });
          await twoFrames(page);
          await page.waitForTimeout(60);
          steps.push({ width, ...(await lines(page)) });
        }
        const back: string[] = [];
        const moves: string[] = [];
        for (let i = 1; i < steps.length; i++) {
          const [p, s] = [steps[i - 1]!, steps[i]!];
          if (s.lines > p.lines) back.push(`${p.width} ${p.lines} -> ${s.width} ${s.lines}`);
          const moved = s.first - p.first;
          const allowed = s.lines === p.lines ? 0 : s.lines > p.lines ? s.second : -p.second;
          if (Math.abs(moved - allowed) > 1)
            moves.push(
              `${p.width} -> ${s.width} (${p.lines} -> ${s.lines} lines): the first line moved ${moved.toFixed(1)}px, its second line ${allowed.toFixed(1)}px`,
            );
        }
        console.log(
          `r150 fix ${pack} turns: ${JSON.stringify(steps.map((s) => [s.width, s.lines, Math.round(s.second), Math.round(s.first)]))}`,
        );
        expect(back, 'as the window widens, the row never takes more lines').toEqual([]);
        expect(moves, 'a turn moves the first line by its second line alone').toEqual([]);
      },
    );

  if (pins.wrong)
    for (const motion of ['no-preference', 'reduce'] as const)
      test(
        `at 768 on ${pack}, with motion ${motion === 'reduce' ? 'reduced' : 'allowed'}, the chrome on two lines is never sticky`,
        { annotation },
        async ({ page }) => {
          await page.emulateMedia({ reducedMotion: motion });
          const reads: string[] = [];
          for (const root of ['100%', '200%']) {
            await page.setViewportSize({ width: 768, height: 900 });
            await page.goto('/', { waitUntil: 'networkidle' });
            expect(
              await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
              "the page's reduced motion",
            ).toBe(motion === 'reduce');
            await expect(page.locator('.ag-chrome[data-ag-rows]')).toHaveCount(1);
            if (root !== '100%')
              await page.evaluate(
                (r) => document.documentElement.style.setProperty('font-size', r, 'important'),
                root,
              );
            await twoFrames(page);
            await page.waitForTimeout(150);
            await twoFrames(page);
            const at = await page.evaluate(() => {
              const chrome = document.querySelector<HTMLElement>('.ag-chrome')!;
              const c = chrome.querySelector('.ag-capsule')!.getBoundingClientRect();
              const o = chrome.querySelector('.ag-ornament')!.getBoundingClientRect();
              return {
                lines: o.height > 0 && o.top >= c.bottom - 1 ? 2 : 1,
                rows: chrome.dataset.agRows ?? null,
                position: getComputedStyle(chrome).position,
              };
            });
            console.log(`r150 fix ${pack} 768 ${root} ${motion}: ${JSON.stringify(at)}`);
            if (at.lines === 2 && at.position === 'sticky')
              reads.push(`${root}: two lines, sticky`);
            if (at.rows !== String(at.lines))
              reads.push(`${root}: data-ag-rows ${at.rows}, ${at.lines} lines`);
          }
          expect(reads, 'the chrome on two lines scrolls, and data-ag-rows says its lines').toEqual(
            [],
          );
        },
      );
}
