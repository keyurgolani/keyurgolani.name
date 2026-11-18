import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import {
  annotation,
  openTuple,
  rootText,
  servingObsidianAtelier,
  type Tuple,
} from './obsidian-atelier-tuples';

// Obsidian Atelier's top row from a tablet's width: the name, the room switch on the sixth column
// line, and the corner at the content's end, the running head, the Appearance control and Index.
// The corner stood at the end over the whole content, so nothing kept its running head off the
// switch, and below about 850 px, or under a wide face past 80rem where the switch shows each room's
// title, the running head ran over the switch's last rooms: in a landscape phone's 844 by 390 under
// Swiss Grotesque, and Drafting Grotesk in Neobrutalist, the quality cells found it over room III's
// centre, and under the fixture's own Humanist UI it covered room III at 768 and 800. The running
// head is the part that gives way. With the root text at 200%, Appearance and Index alone are wider
// than what's left beside the switch at 1024 and 1440, and they lay over the switch or ran past the
// window. On the complete contract fixture served as the quality cells serve it, as a touch phone,
// at 768, 800, 844, 900, 1024, 1280 and 1440, every link in the top row has its own centre, the
// running head is clear of the switch, the switch keeps to its four columns, and Appearance and
// Index stand between the switch and the content's end with the page not scrolling sideways, under
// Swiss Grotesque, Humanist UI and Accessible Reading, and Drafting Grotesk in Neobrutalist's Paper
// and Ink, dark; and so at 1024 and 1440 with the root text at 200%, under Humanist UI and
// Accessible Reading.

test.use({ appOptions: servingObsidianAtelier(), isMobile: true, hasTouch: true });

const TUPLES: readonly Tuple[] = [
  'platform-neutral/warm-parchment/swiss-grotesque/system',
  'platform-neutral/warm-parchment/humanist-ui/system',
  'platform-neutral/warm-parchment/accessible-reading/system',
  'neobrutalist/paper-ink/drafting-grotesk/dark',
];

const CLEAR = { covered: [], under: [], past: 0, outside: [], sideways: 0 };

/**
 * The top row's links whose centre something else covers, the switch's links the running head lies
 * over, how far the switch runs past its four columns, the corner's controls that aren't between
 * the switch and the content's end, and how far the page scrolls sideways.
 */
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
    const here = document.querySelector('.oa-chrome__here')?.getBoundingClientRect();
    const under =
      here && here.width > 0
        ? [...document.querySelectorAll('.oa-chrome__rooms a')]
            .map((a) => ({ a, r: a.getBoundingClientRect() }))
            .filter(({ r }) => r.right > here.left + 0.5 && r.left < here.right - 0.5)
            .map(({ a }) => name(a))
        : [];
    // The page's own columns, laid out across the chrome's width by a grid of them that takes no
    // part in the row: the switch's four from the sixth line, and the content's end line.
    const chrome = document.querySelector<HTMLElement>('.oa-chrome')!;
    const lines = document.createElement('div');
    lines.style.cssText =
      'position: absolute; inset-inline: 0; display: grid; grid-template-columns: var(--layout-columns); column-gap: var(--layout-grid-gutter); visibility: hidden';
    chrome.append(lines);
    const css = getComputedStyle(lines);
    const tracks = css.gridTemplateColumns.split(' ').map(Number.parseFloat);
    const gap = Number.parseFloat(css.columnGap) || 0;
    const left = lines.getBoundingClientRect().left;
    lines.remove();
    const sum = (n: number[]) => n.reduce((a, b) => a + b, 0);
    // Its tracks are a side's, the columns', and the other side's: the content ends before the last.
    const contentEnd = left + sum(tracks.slice(0, -1)) + (tracks.length - 2) * gap;
    const rooms = document.querySelector('.oa-chrome__rooms')?.getBoundingClientRect();
    const shown = rooms && rooms.width > 0 ? rooms : null;
    let past = 0;
    if (shown) {
      const start = left + sum(tracks.slice(0, 6)) + 6 * gap;
      const end = start + sum(tracks.slice(6, 10)) + 3 * gap;
      past = Math.round(Math.max(start - shown.left, shown.right - end));
    }
    const outside = [
      ...document.querySelectorAll<HTMLElement>('.oa-chrome__appearance, .oa-chrome__dock'),
    ]
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0)
      .filter(
        ({ r }) => (shown !== null && r.left < shown.right - 0.5) || r.right > contentEnd + 0.5,
      )
      .map(({ e, r }) => `${e.className} ${Math.round(r.left)}-${Math.round(r.right)}`);
    const sideways = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return { covered, under, past: past > 1 ? past : 0, outside, sideways };
  });

for (const tuple of TUPLES) {
  const type = tuple.split('/')[2];
  test(
    `under ${type}, from 768 to 1440 every top row link has its own centre, the running head stays clear of the room switch, and the switch keeps to its four columns`,
    { annotation, tag: '@interaction' },
    async ({ page, app }) => {
      for (const width of [768, 800, 844, 900, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 390 });
        await openTuple(page, app.origin, tuple);
        expect(await readRow(page), `at ${width} by 390`).toEqual(CLEAR);
      }
    },
  );
}

for (const tuple of TUPLES.slice(1, 3)) {
  const type = tuple.split('/')[2];
  test(
    `under ${type}, with the root text at 200% at 1024 and 1440, every top row link has its own centre, and Appearance and Index stand between the switch and the content's end`,
    { annotation, tag: '@interaction' },
    async ({ page, app }) => {
      for (const [width, height] of [
        [1024, 768],
        [1440, 900],
      ] as const) {
        await page.setViewportSize({ width, height });
        await openTuple(page, app.origin, tuple);
        await rootText(page, '200%');
        expect(await readRow(page), `at ${width} by ${height}, the root text at 200%`).toEqual(
          CLEAR,
        );
      }
    },
  );
}
