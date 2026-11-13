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
//   - at root 100%, from 300 to 440 px in 1 px steps, the row's lines never go back up as the window widens (on
//     Humanist UI they went 2, 1, 2, 1 between 304 and 336); at a turn that changes them the opening's first line
//     moves the turn's way, by at most the second line's height and 1 px, never the other way (the coordinator's
//     cap: the one-line chrome's room already holds part of it, so on Humanist UI the 83 px line moves it 65); at a
//     step that keeps them, by no more than 0.5 px, and over a run of such steps by no more than the fluid spacing
//     above it grows: the chrome's margin and the room its box keeps (--space-s,
//     twice, and --layout-chrome), the opening frame's offset (--space-2xs) and the identity pane's padding
//     (--space-m), each read at the run's two ends, printed beside the move, with 0.05 px for the layout's rounding;
//   - (d) at 768, root 100% and 200%, with motion allowed and reduced, the chrome on two lines is never sticky, and
//     data-ag-rows says the lines it lays out (Multilingual System at 768 at 200% with motion allowed: the row
//     needed 693.7 px of the chrome's 693.6, the enhancement's half-pixel slack read it as one line, and it wrapped
//     stuck);
//   - at 768 and 864, root text 200% from the first paint, loading the page shifts nothing: the enhancement adds no
//     line (Accessible Reading: with script the capsule holds Pause and its row takes two lines, without it one, so
//     the page moved down when the script came; the no-JS row now keeps Pause's room);
//   - at 1024 and 1440, the still Pause's held note shows at rest and, while the chrome sticks, hides over the page
//     (on Accessible Reading at 1440 it covered the signature sheet's "Project organization"), and either way it
//     stays Pause's description;
//   - at 1440, loading the page moves nothing in the header: the ornament's Pause, which the script shows, had no
//     place before it, and the capsule moved over when it came;
//   - before the script runs (its chunks held back), Pause keeps its place unseen, at 864 the capsule's and at 1440
//     the ornament's, and it is neither in the accessibility tree nor a Tab stop.

export type HeaderPack =
  | 'accessible-reading'
  | 'geometric-display'
  | 'technical-sans-mono'
  | 'humanist-ui'
  | 'multilingual-system'
  | 'book-serif'
  | 'drafting-grotesk'
  | 'editorial-serif'
  | 'field-serif'
  | 'paste-up'
  | 'swiss-grotesque';

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
      // The second line, the gap above it included: what it puts on the row's height.
      second: two ? o.bottom - c.bottom : 0,
      // On one line, the room the chrome's box keeps past its row (its min-block-size's): part of a
      // second line it already holds, so a turn moves the first line by the rest.
      room: two ? 0 : chrome.getBoundingClientRect().height - c.height,
      first: first.getBoundingClientRect().top + scrollY,
      // The fluid spacing above the first line, each token in px at this width.
      tokens: Object.fromEntries(
        (['--space-s', '--space-2xs', '--space-m', '--layout-chrome'] as const).map((name) => {
          const ruler = document.createElement('div');
          ruler.style.cssText = `position: absolute; visibility: hidden; block-size: var(${name});`;
          document.querySelector('.ag-page')!.append(ruler);
          const px = ruler.getBoundingClientRect().height;
          ruler.remove();
          return [name, px];
        }),
      ) as Record<string, number>,
    };
  });

/** How many times each token stands above the first line: the turns pin's fluid range. */
const ABOVE: Record<string, number> = {
  '--space-s': 2,
  '--space-2xs': 1,
  '--space-m': 1,
  '--layout-chrome': 1,
};

/** The page's layout-shift entries from the navigation on, none with recent input (Chromium). */
const loadShifts = (page: Page) =>
  page.evaluate(() => {
    const o = new PerformanceObserver(() => undefined);
    o.observe({ type: 'layout-shift', buffered: true });
    const all = o.takeRecords() as unknown as {
      value: number;
      hadRecentInput: boolean;
      sources: { node: Node | null }[];
    }[];
    o.disconnect();
    return all
      .filter((entry) => !entry.hadRecentInput)
      .map((entry) => ({
        value: entry.value,
        nodes: entry.sources.map((s) =>
          s.node instanceof Element
            ? `${s.node.localName}${[...s.node.classList].map((k) => `.${k}`).join('')}`
            : String(s.node?.nodeName ?? ''),
        ),
      }));
  });

/**
 * Each point of a 5 x 3 grid over a box (its top from the chrome's top) where the note is under the point. The note
 * takes no pointer, so for this read alone it does, then it's put back: hit-testing skips an element that takes none.
 */
const noteHits = (page: Page, id: string, box: number[]) =>
  page.evaluate(
    ({ nid, at }) => {
      const note = document.getElementById(nid)!;
      const top = document.querySelector('.ag-chrome')!.getBoundingClientRect().top;
      const [l, t, r, b] = [at[0]!, at[1]! + top, at[2]!, at[3]! + top];
      const keep = note.style.pointerEvents;
      note.style.pointerEvents = 'auto';
      const hits: string[] = [];
      try {
        for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9])
          for (const fy of [0.2, 0.5, 0.8]) {
            const [x, y] = [l + (r - l) * fx, t + (b - t) * fy];
            if (document.elementsFromPoint(x, y).some((el) => note.contains(el)))
              hits.push(`${x.toFixed(0)},${y.toFixed(0)}`);
          }
      } finally {
        note.style.pointerEvents = keep;
      }
      return hits;
    },
    { nid: id, at: box },
  );

export function headerFit(
  pack: HeaderPack,
  pins: {
    wide?: boolean;
    load?: boolean;
    turns?: boolean;
    wrong?: boolean;
    rootLoad?: boolean;
    note?: boolean;
    wideLoad?: boolean;
    waiting?: boolean;
  },
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
        const shifts = await loadShifts(page);
        const sum = shifts.reduce((a, e) => a + e.value, 0);
        console.log(`r150 fix ${pack} 320 load: ${sum.toFixed(4)} ${JSON.stringify(shifts)}`);
        expect(shifts, 'the load shifts nothing').toEqual([]);
      },
    );

  if (pins.turns)
    test(
      `at root 100% on ${pack}, from 300 to 440 px the row's lines never go back up, a turn moves the first line its own way by no more than its second line, and a step that keeps them by no more than the fluid spacing`,
      { annotation },
      async ({ page }) => {
        test.setTimeout(240_000);
        await open(page, 300, 800);
        const steps: {
          width: number;
          lines: number;
          second: number;
          room: number;
          first: number;
          tokens: Record<string, number>;
        }[] = [];
        for (let width = 300; width <= 440; width += 1) {
          await page.setViewportSize({ width, height: 800 });
          await twoFrames(page);
          await page.waitForTimeout(60);
          steps.push({ width, ...(await lines(page)) });
        }
        const back: string[] = [];
        const moves: string[] = [];
        const turns: string[] = [];
        const runs: string[] = [];
        // A run of steps that keep the lines: its creep against what the spacing above grew.
        let from = 0;
        const run = (to: number) => {
          const [a, b] = [steps[from]!, steps[to]!];
          const creep = b.first - a.first;
          const parts = Object.entries(ABOVE).map(
            ([name, n]) => [name, n * Math.abs(b.tokens[name]! - a.tokens[name]!)] as const,
          );
          const range = parts.reduce((sum, [, v]) => sum + v, 0);
          const line = `${a.width} -> ${b.width} (${a.lines} line(s)): crept ${creep.toFixed(2)}px, the spacing grew ${range.toFixed(2)}px (${parts.map(([name, v]) => `${name} ${v.toFixed(2)}`).join(', ')})`;
          runs.push(line);
          if (Math.abs(creep) > range + 0.05) moves.push(line);
        };
        for (let i = 1; i < steps.length; i++) {
          const [p, s] = [steps[i - 1]!, steps[i]!];
          if (s.lines > p.lines) back.push(`${p.width} ${p.lines} -> ${s.width} ${s.lines}`);
          const moved = s.first - p.first;
          if (s.lines === p.lines) {
            if (Math.abs(moved) > 0.5)
              moves.push(
                `${p.width} -> ${s.width} (${s.lines} lines kept): the first line jumped ${moved.toFixed(2)}px`,
              );
            continue;
          }
          run(i - 1);
          from = i;
          // Onto two lines the first line goes down, onto one up: by at most the second line and 1 px.
          const [two, one] = s.lines > p.lines ? [s, p] : [p, s];
          const way = s.lines > p.lines ? 1 : -1;
          const line = `${p.width} -> ${s.width} (${p.lines} -> ${s.lines} lines): moved ${moved.toFixed(1)}px, its second line ${two.second.toFixed(1)}px, the one-line room ${one.room.toFixed(1)}px (${two.second.toFixed(1)} - ${one.room.toFixed(1)} = ${(two.second - one.room).toFixed(1)})`;
          turns.push(line);
          if (moved * way < -0.05 || Math.abs(moved) > two.second + 1) moves.push(line);
        }
        run(steps.length - 1);
        console.log(`r150 fix ${pack} turn lines: ${JSON.stringify(turns)}`);
        console.log(`header-fit ${pack} same-line runs: ${JSON.stringify(runs)}`);
        console.log(
          `r150 fix ${pack} turns: ${JSON.stringify(steps.map((s) => [s.width, s.lines, Math.round(s.second), Math.round(s.first)]))}`,
        );
        expect(back, 'as the window widens, the row never takes more lines').toEqual([]);
        expect(
          moves,
          'a turn moves the first line its own way by no more than its second line; a step that keeps the lines, by no more than the spacing',
        ).toEqual([]);
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

  if (pins.rootLoad)
    for (const width of [768, 864])
      test(
        `at ${width} at 200% root text from the first paint on ${pack}, the enhancement adds no line: loading the page shifts nothing`,
        { annotation },
        async ({ page, browserName }) => {
          test.skip(browserName !== 'chromium', 'Chromium alone has layout-shift entries');
          // The root's text at 200% before the page's first paint, as a reader's setting is.
          await page.addInitScript(() => {
            const set = () =>
              document.documentElement.style.setProperty('font-size', '200%', 'important');
            if (document.documentElement) set();
            else
              new MutationObserver((_, watch) => {
                if (!document.documentElement) return;
                set();
                watch.disconnect();
              }).observe(document, { childList: true });
          });
          await open(page, width, 900);
          expect(
            await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
            'the root text at 200%',
          ).toBe('32px');
          await page.waitForTimeout(150);
          const at = await lines(page);
          const shifts = await loadShifts(page);
          console.log(
            `header-fit ${pack} ${width} 200% load: ${at.lines} line(s), ${shifts.reduce((sum, entry) => sum + entry.value, 0).toFixed(4)} ${JSON.stringify(shifts)}`,
          );
          expect(shifts, 'the load shifts nothing').toEqual([]);
        },
      );

  if (pins.note)
    for (const width of [1024, 1440])
      test(
        `at ${width} on ${pack}, under reduced motion, the held note shows at rest and hides while the chrome sticks, and stays Pause's description`,
        { annotation },
        async ({ page }) => {
          await open(page, width, 900);
          // Pause is the capsule's last item to 75rem, the ornament's first above.
          const pause = page.locator(
            width > 1200 ? '.ag-ornament .ag-orn' : '.ag-capsule .ag-orn--capsule',
          );
          await expect(pause).toBeVisible();
          await expect(pause).toHaveAttribute('aria-disabled', 'true');
          await expect(
            page.locator('[data-ag-pause][data-ag-waiting]'),
            'the script has decided both Pause copies',
          ).toHaveCount(0);
          const id = (await pause.getAttribute('aria-describedby'))!;
          const text = ((await page.locator(`[id="${id}"]`).textContent()) ?? '').trim();
          expect(text, 'the still Pause says why').not.toBe('');
          await expect(pause, 'at rest, the note is its description').toHaveAccessibleDescription(
            text,
          );
          // Where the note sits from the chrome's top, at rest: shown.
          const rest = await page.evaluate((nid) => {
            const note = document.getElementById(nid)!;
            const n = note.getBoundingClientRect();
            const h = document.querySelector('.ag-chrome')!.getBoundingClientRect();
            return {
              shown: n.width > 1 && n.height > 1,
              box: [n.left, n.top - h.top, n.right, n.bottom - h.top],
            };
          }, id);
          expect(rest.shown, 'at rest the note shows').toBe(true);
          const restHits = await noteHits(page, id, rest.box);
          expect(restHits.length, 'at rest the grid finds the note under it').toBeGreaterThan(0);
          await page.evaluate(() => scrollTo(0, 600));
          await page.waitForTimeout(150);
          await twoFrames(page);
          // Stuck: across the note's box, nothing hits the note; what's under it is the page's.
          const stuck = {
            ...(await page.evaluate(() => {
              const chrome = document.querySelector<HTMLElement>('.ag-chrome')!;
              return {
                position: getComputedStyle(chrome).position,
                top: chrome.getBoundingClientRect().top,
                scrollY,
              };
            })),
            hits: await noteHits(page, id, rest.box),
          };
          console.log(
            `header-fit ${pack} ${width} note: "${text}", rest ${JSON.stringify(rest)}, ${restHits.length} of 15 at rest hit it, stuck ${JSON.stringify(stuck)}`,
          );
          expect(stuck.position, 'the chrome sticks').toBe('sticky');
          expect(stuck.scrollY).toBeGreaterThan(0);
          expect(stuck.hits, 'while the chrome sticks, the note covers nothing').toEqual([]);
          await expect(
            pause,
            'stuck, the note is still its description',
          ).toHaveAccessibleDescription(text);
        },
      );

  if (pins.wideLoad)
    test(
      `at 1440 on ${pack}, loading the page moves nothing in the header: Pause's place beside the ornament is kept`,
      { annotation },
      async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'Chromium alone has layout-shift entries');
        await open(page, 1440, 900);
        await page.waitForTimeout(600);
        const header = (await loadShifts(page)).filter((entry) =>
          entry.nodes.some((n) => /\bag-(chrome|capsule|ornament)\b/.test(n)),
        );
        console.log(`header-fit ${pack} 1440 load: ${JSON.stringify(header)}`);
        expect(header, 'no shift moves the chrome, the capsule or the ornament').toEqual([]);
      },
    );

  if (pins.waiting)
    for (const width of [864, 1440])
      test(
        `at ${width} on ${pack}, before the script runs, Pause keeps its place unseen, out of the accessibility tree and the Tab order`,
        { annotation },
        async ({ page, browserName }) => {
          test.skip(browserName !== 'chromium', 'the script is held back by aborting its chunks');
          let aborted = 0;
          await page.route('**/_next/static/chunks/**', (route) => {
            aborted += 1;
            return route.abort();
          });
          await page.setViewportSize({ width, height: 900 });
          await page.goto('/', { waitUntil: 'load' });
          await page.waitForTimeout(300);
          expect(aborted, "the script's chunks were held back").toBeGreaterThan(0);
          await expect(page.locator('.ag-chrome[data-ag-rows]'), 'no enhancement ran').toHaveCount(
            0,
          );
          expect(
            await page.evaluate(() => matchMedia('(scripting: enabled)').matches),
            'script runs here',
          ).toBe(true);
          // Below 75rem Pause is the capsule's last item, above it the ornament's first.
          const copy = width > 1200 ? '.ag-ornament .ag-orn' : '.ag-capsule .ag-orn--capsule';
          const held = await page.evaluate((sel) => {
            const p = document.querySelector<HTMLElement>(sel)!;
            const r = p.getBoundingClientRect();
            const cs = getComputedStyle(p);
            return {
              width: r.width,
              height: r.height,
              display: cs.display,
              visibility: cs.visibility,
            };
          }, copy);
          await expect(page.getByRole('button', { name: 'Pause the sky' })).toHaveCount(0);
          await page.locator('.ag-capsule__name').focus();
          const stops: string[] = [];
          for (let i = 0; i < 8; i += 1) {
            await page.keyboard.press('Tab');
            stops.push(
              await page.evaluate(() => {
                const el = document.activeElement as HTMLElement | null;
                return el?.matches('[data-ag-pause]')
                  ? 'Pause'
                  : `${el?.localName ?? ''}.${el?.className.toString().split(' ')[0] ?? ''}`;
              }),
            );
          }
          console.log(
            `header-fit ${pack} ${width} waiting: ${JSON.stringify(held)}, ${aborted} chunks held back, Tab ${JSON.stringify(stops)}`,
          );
          expect(stops, 'a waiting Pause is no Tab stop').not.toContain('Pause');
          expect(held.visibility, 'unseen').toBe('hidden');
          expect(held.width, 'its place is kept').toBeGreaterThan(0);
        },
      );
}
