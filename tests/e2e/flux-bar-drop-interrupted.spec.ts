import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { contrast, type Rgb } from '../quality/lib/pixels';

// Flux's drop moves to the place being read by a stretch over both tabs, then a snap in to the new
// one, and each word turns its ink as the drop's moving edge passes it. A move can begin before
// the last has ended: a reader who jumps back to the top while the drop is still snapping in
// toward Contact. Every frame from that jump until the bar is still, each tab's word must read
// against what lies under it: the drop's fill where the drop covers the whole word, the bar's
// ground where it covers none of it (a word the edge is crossing is half on each, and isn't read).
// On industrial/warm-parchment/humanist-ui/system at 1024 and 1440, with and without more
// contrast, by mouse.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'flux')
      .replace(/designLanguage: .*/, 'designLanguage: industrial')
      .replace(/colorScheme: .*/, 'colorScheme: warm-parchment')
      .replace(/typography: .*/, 'typography: humanist-ui')
      .replace(/displayMode: .*/, 'displayMode: system'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];

/** One frame of the bar: the drop's span on screen, or null while it's off, and each word. */
interface Frame {
  readonly at: number;
  readonly span: readonly [number, number] | null;
  readonly words: readonly {
    readonly tab: string;
    readonly box: readonly [number, number];
    readonly ink: Rgb;
  }[];
}

/**
 * From the top of the page, with the drop landed on the name: the page is moved to Contact, and
 * once the drop's snap in toward Contact has carried its left edge past Writing, back to the
 * top (no frames, if the snap never gets there in four seconds). Then every frame until the drop
 * has held still for ten frames (two seconds at most).
 * Colours come back as sRGB, through a canvas, whatever space the page wrote them in.
 */
const interruptedSnap = () =>
  new Promise<{ frames: Frame[]; fill: Rgb; ground: Rgb; interrupted: number }>((done) => {
    const rgbOf = (() => {
      const pen = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
      return (color: string): Rgb => {
        pen.clearRect(0, 0, 1, 1);
        pen.fillStyle = color;
        pen.fillRect(0, 0, 1, 1);
        const [r, g, b] = pen.getImageData(0, 0, 1, 1).data;
        return [r!, g!, b!];
      };
    })();
    const nav = document.querySelector<HTMLElement>('.fx-bar__nav')!;
    const drop = document.querySelector<HTMLElement>('.fx-bar__drop')!;
    const tabs = [...nav.querySelectorAll<HTMLElement>('.fx-tabs a[data-fx-tab]')].filter(
      (tab) => tab.getClientRects().length > 0,
    );
    const writing = tabs.find((tab) => tab.dataset.fxTab === 'writing')!;
    const contact = document.querySelector<HTMLElement>('.fx-sheet[data-sheet="contact"]')!;
    // The bar's ground: the first opaque background from the tabs' list up.
    let ground: Rgb = [255, 255, 255];
    for (let el: Element | null = nav; el; el = el.parentElement) {
      const background = getComputedStyle(el).backgroundColor;
      if (background && !/^rgba\(.*,\s*0\)$|^transparent$/.test(background)) {
        ground = rgbOf(background);
        break;
      }
    }
    const fill = rgbOf(getComputedStyle(drop).backgroundColor);
    const spanOf = (): readonly [number, number] | null => {
      if (getComputedStyle(drop).visibility === 'hidden') return null;
      const bar = nav.getBoundingClientRect();
      const inset = /inset\(\s*([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px/.exec(
        getComputedStyle(drop).clipPath,
      );
      if (!inset) return null;
      return [bar.left + Number(inset[4]), bar.right - Number(inset[2])];
    };
    const frames: Frame[] = [];
    let interrupted = 0;
    let quiet = 0;
    let last = '';
    const record = () => {
      const span = spanOf();
      frames.push({
        at: performance.now() - interrupted,
        span,
        words: tabs.map((tab) => {
          const word = tab.querySelector<HTMLElement>('.fx-tab__word') ?? tab;
          const box = word.getBoundingClientRect();
          return {
            tab: tab.dataset.fxTab!,
            box: [box.left, box.right] as const,
            ink: rgbOf(getComputedStyle(word).color),
          };
        }),
      });
      const now = JSON.stringify(span) + drop.dataset.fxMove;
      quiet = now === last && drop.getAnimations().length === 0 ? quiet + 1 : 0;
      last = now;
      if (quiet >= 10 || performance.now() - interrupted > 2000)
        done({ frames, fill, ground, interrupted });
      else requestAnimationFrame(record);
    };
    const passedWriting = () => {
      const span = spanOf();
      return span !== null && span[0] > writing.getBoundingClientRect().right + 1;
    };
    const started = performance.now();
    const wait = () => {
      if (performance.now() - started > 4000) done({ frames, fill, ground, interrupted });
      else if (
        drop.dataset.fxMove === 'snap' &&
        drop.getAnimations().length > 0 &&
        passedWriting()
      ) {
        interrupted = performance.now();
        window.scrollTo({ top: 0, behavior: 'instant' });
        requestAnimationFrame(record);
      } else requestAnimationFrame(wait);
    };
    window.scrollTo({ top: contact.getBoundingClientRect().top + scrollY, behavior: 'instant' });
    requestAnimationFrame(wait);
  });

for (const [width, height] of [
  [1024, 768],
  [1440, 900],
] as const)
  for (const row of ['default', 'contrast-more'] as const)
    test(
      `at ${width}${row === 'contrast-more' ? ', under more contrast' : ''}, a jump back to the top while the drop is still snapping in toward Contact leaves every word on the ground it reads against, each frame`,
      { annotation },
      async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.emulateMedia({
          reducedMotion: 'no-preference',
          contrast: row === 'contrast-more' ? 'more' : 'no-preference',
        });
        await page.goto('/', { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready.then(() => true));
        await expect(page.locator('.fx[data-fx-live]')).toHaveCount(1);
        await expect(page.locator('.fx-bar__drop[data-fx-on][data-fx-move="land"]')).toHaveCount(1);
        const { frames, fill, ground } = await page.evaluate(interruptedSnap, undefined);
        const ratio = row === 'contrast-more' ? 7 : 4.5;
        const failing: string[] = [];
        for (const frame of frames) {
          for (const word of frame.words) {
            const [left, right] = word.box;
            const covered =
              frame.span !== null && left >= frame.span[0] - 0.5 && right <= frame.span[1] + 0.5;
            const clear =
              frame.span === null || right <= frame.span[0] + 0.5 || left >= frame.span[1] - 0.5;
            if (!covered && !clear) continue;
            const under = covered ? fill : ground;
            const read = contrast(word.ink, under);
            if (read < ratio)
              failing.push(
                `${Math.round(frame.at)} ms ${word.tab} ${covered ? 'on the drop' : 'off it'}: rgb(${word.ink.join(', ')}) on rgb(${under.join(', ')}), ${read.toFixed(2)}:1`,
              );
          }
        }
        console.log(
          `flux drop interrupted ${width} ${row}: ${frames.length} frames, ${failing.length} word frames under ${ratio}:1${failing.length ? `, first ${failing.slice(0, 6).join('; ')}` : ''}`,
        );
        expect(frames.length, 'frames from the jump until the drop is still').toBeGreaterThan(10);
        expect(failing, `words under ${ratio}:1 against what lies under them`).toEqual([]);
      },
    );
