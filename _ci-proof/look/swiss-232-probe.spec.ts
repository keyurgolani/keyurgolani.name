// Probe for Swiss Signal's part openers (not for commit), run as a look on CI Linux: under every
// typography, on home, each part's display word at 320, 390 and 768 with 200% root text and at 320
// and 390 at 100%: the opener's width in rem, the word's size in px, its widest word's em a letter
// as set, and the words the words-whole
// check finds broken in it, as it is and with the word sized from its column (the poster line's
// fit: its step, or the size at which its longest word fits at F em a letter, never under body
// size) where the opener holds under 14rem, for F 0.85 and 0.95. JSON to $PROOF_LOOK_OUT and stdout
// ("partprobe "). Also the words-whole red's second tuple, Accessible Reading on Memphis Neon City.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { openTuple, servingSwissSignal, type Tuple } from './swiss-signal-tuples';

const OUT = process.env.PROOF_LOOK_OUT ?? process.env.LOOK_OUT ?? 'look';
mkdirSync(OUT, { recursive: true });
test.use({ appOptions: servingSwissSignal() });
test.describe.configure({ timeout: 900_000 });

const FACES = [
  'accessible-reading',
  'book-serif',
  'console-mono',
  'drafting-grotesk',
  'editorial-serif',
  'field-serif',
  'geometric-display',
  'humanist-ui',
  'multilingual-system',
  'neutral-ui',
  'paste-up',
  'screen-grotesque',
  'shell-mono',
  'swiss-grotesque',
  'technical-sans-mono',
];
const VIEWS = [
  { width: 320, height: 568, scale: 2 },
  { width: 390, height: 844, scale: 2 },
  { width: 768, height: 1024, scale: 2 },
  { width: 320, height: 568, scale: 1 },
  { width: 390, height: 844, scale: 1 },
];
const V = "[data-variant='swiss-signal']";
const FIT = (em: number) => `@container (max-width: 14rem) {
  ${V} .ss-part__title {
    font-size: max(var(--type-body-font-size), min(var(--type-step-7), calc(100cqi / (var(--layout-ss-word, 8) * ${em})))) !important;
  }
}`;
const CANDIDATES: Record<string, string> = { now: '', 'fit-85': FIT(0.85), 'fit-95': FIT(0.95) };

const read = (page: Page) =>
  page.evaluate(() => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return [...document.querySelectorAll<HTMLElement>('.ss-part__title')]
      .filter((title) => title.checkVisibility())
      .map((title) => {
        const open = title.closest<HTMLElement>('.ss-part__open')!;
        const os = getComputedStyle(open);
        const room =
          open.getBoundingClientRect().width -
          parseFloat(os.paddingInlineStart) -
          parseFloat(os.paddingInlineEnd);
        const broken: string[] = [];
        const px = parseFloat(getComputedStyle(title).fontSize);
        let em = 0;
        const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (const match of (node.textContent ?? '').matchAll(/[^\s/\u2013]+/g)) {
            const range = document.createRange();
            range.setStart(node, match.index!);
            range.setEnd(node, match.index! + match[0].length);
            const rects = [...range.getClientRects()].filter((r) => r.width > 0);
            if (rects.length === 0) continue;
            const lines = new Set(rects.map((r) => Math.round(r.top))).size;
            const width = rects.reduce((sum, r) => sum + r.width, 0);
            em = Math.max(em, width / (px * [...match[0]].length));
            if (lines > 1 && width <= room + 0.5) broken.push(match[0]);
          }
        }
        const word = Math.max(
          0,
          ...(title.textContent ?? '')
            .trim()
            .split(/\s+/)
            .map((w) => [...w].length),
        );
        return {
          text: (title.textContent ?? '').trim(),
          word,
          rem: Math.round((room / rem) * 10) / 10,
          px: Math.round(px * 10) / 10,
          em: Math.round(em * 1000) / 1000,
          height: Math.round(title.getBoundingClientRect().height),
          broken,
        };
      });
  });

const TUPLES = [
  ...FACES.map((face) => `platform-neutral/warm-parchment/${face}/system` as Tuple),
  'memphis/neon-city/accessible-reading/dark' as Tuple,
];

for (const tuple of TUPLES)
  test(`partprobe ${tuple}`, async ({ page, app }) => {
    const out: Record<string, unknown> = {};
    for (const view of VIEWS) {
      await page.setViewportSize({ width: view.width, height: view.height });
      await openTuple(page, app.origin, tuple);
      await page.evaluate((scale) => {
        document.documentElement.style.setProperty('font-size', `${scale * 100}%`, 'important');
        for (const title of document.querySelectorAll<HTMLElement>('.ss-part__title')) {
          const word = Math.max(
            0,
            ...(title.textContent ?? '')
              .trim()
              .split(/\s+/)
              .map((w) => [...w].length),
          );
          title.style.setProperty('--layout-ss-word', String(word));
        }
      }, view.scale);
      const row: Record<string, unknown> = {};
      for (const [name, css] of Object.entries(CANDIDATES)) {
        await page.evaluate((css) => {
          let style = document.getElementById('partprobe');
          if (!style) {
            style = document.createElement('style');
            style.id = 'partprobe';
            document.head.append(style);
          }
          style.textContent = css;
        }, css);
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        );
        row[name] = await read(page);
      }
      out[`${view.width} ${view.scale * 100}%`] = row;
    }
    expect(Object.keys(out).length).toBe(VIEWS.length);
    writeFileSync(path.join(OUT, `${tuple.replaceAll('/', '_')}.json`), JSON.stringify(out));
    console.log(`partprobe ${tuple} ${JSON.stringify(out)}`);
  });
