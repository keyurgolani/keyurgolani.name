import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import {
  annotation,
  openTuple,
  rootText,
  servingObsidianAtelier,
  type Tuple,
} from './obsidian-atelier-tuples';

// Obsidian Atelier's Index stays in the window as a plate pinned at the top row's end, as wide as
// its own text, and from a tablet's width the room switch stands on the sixth column line. Nothing
// kept the switch's track clear of the pin, so with the root text at 200% at 768, where the plate
// is twice as wide, it lay over the switch's last room and covered its centre. On the complete
// contract fixture served as the quality cells serve it, as a touch phone, with the root text at
// 200% at 768, 800, 844, 900, 1024 and 1440, every top row link has its own centre, no room's focus
// ring reaches the pinned plate, and the page doesn't scroll sideways, under Swiss Grotesque,
// Humanist UI, Accessible Reading and Paste-Up, and Drafting Grotesk in Neobrutalist's Paper and
// Ink, dark.

test.use({ appOptions: servingObsidianAtelier(), isMobile: true, hasTouch: true });

const TUPLES: readonly Tuple[] = [
  'platform-neutral/warm-parchment/swiss-grotesque/system',
  'platform-neutral/warm-parchment/humanist-ui/system',
  'platform-neutral/warm-parchment/accessible-reading/system',
  'platform-neutral/warm-parchment/paste-up/system',
  'neobrutalist/paper-ink/drafting-grotesk/dark',
];

/** The top row's links whose centre something else covers, the rooms whose ring reaches the pinned plate, and the sideways scroll. */
const readRow = (page: Page) =>
  page.evaluate(() => {
    const name = (e: Element) =>
      `${e.localName}${[...e.classList]
        .slice(0, 1)
        .map((c) => `.${c}`)
        .join('')} ${(e.textContent ?? '').trim().slice(0, 20)}`;
    const covered = [...document.querySelectorAll<HTMLElement>('.oa-chrome a, .oa-chrome summary')]
      .filter((e) => e.getClientRects().length > 0 && !e.closest('[hidden], dialog:not([open])'))
      .flatMap((e) => {
        const r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return [];
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return hit && (hit === e || e.contains(hit))
          ? []
          : [`${name(e)} under ${hit ? name(hit) : 'nothing'}`];
      });
    const pin = document.querySelector('.oa-chrome__pin')?.getBoundingClientRect();
    const reaching =
      pin && pin.width > 0
        ? [...document.querySelectorAll<HTMLElement>('.oa-chrome__rooms a')]
            .map((a) => {
              const css = getComputedStyle(a);
              const reach =
                (Number.parseFloat(css.getPropertyValue('--ui-focus-width')) || 0) +
                Math.max(0, Number.parseFloat(css.getPropertyValue('--ui-focus-offset')) || 0);
              return { a, r: a.getBoundingClientRect(), reach };
            })
            .filter(({ r }) => r.width > 0)
            .filter(
              ({ r, reach }) =>
                r.right + reach > pin.left + 0.5 &&
                r.left - reach < pin.right - 0.5 &&
                r.bottom + reach > pin.top + 0.5 &&
                r.top - reach < pin.bottom - 0.5,
            )
            .map(
              ({ a, r, reach }) =>
                `${name(a)} ${Math.round(r.right + reach)} > ${Math.round(pin.left)}`,
            )
        : [];
    const sideways = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return { covered, reaching, sideways };
  });

for (const tuple of TUPLES) {
  const type = tuple.split('/')[2];
  test(
    `under ${type}, with the root text at 200% from 768 to 1440, every top row link has its own centre and no room's ring reaches the pinned Index`,
    { annotation, tag: '@interaction' },
    async ({ page, app }) => {
      for (const [width, height] of [
        [768, 768],
        [800, 768],
        [844, 768],
        [900, 768],
        [1024, 768],
        [1440, 900],
      ] as const) {
        await page.setViewportSize({ width, height });
        await openTuple(page, app.origin, tuple);
        await rootText(page, '200%');
        expect(await readRow(page), `at ${width} by ${height}, the root text at 200%`).toEqual({
          covered: [],
          reaching: [],
          sideways: 0,
        });
      }
    },
  );
}
