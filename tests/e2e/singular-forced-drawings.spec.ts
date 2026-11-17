import type { Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { contrast, decodePng, pixel } from '../quality/lib/pixels';
import { annotation, FORCED_CASES, fixtureIn, openForced } from './forced-backplate';

// Singular under forced colours: the drawings it makes from a background still paint. Forced
// colours drop a background image and give a background colour that isn't a system colour the
// canvas's, so a rule drawn as a gradient image or a mark filled in currentColor goes with them.
// Each part is read in pixels: a clip of where it draws, shot as it paints and again with the part
// hidden, its strongest changed pixel against the hidden shot. A part that changes nothing there
// paints nothing. The parts: the record rows' and the colophon's rules (their top edge, inside the
// margins), each closed fold's plus, and, where the rail shows, the current stop's filled mark
// (inside its ring).

test.use({ appOptions: fixtureIn('singular') });

/** The ratio a drawing reaches on its ground. */
const DRAWING = 3;

type Clip = { x: number; y: number; width: number; height: number };

/** The strongest change in `clip` when the element marked `mark` is hidden: 1 if none. */
async function paintsIn(page: Page, mark: string, clip: Clip): Promise<number> {
  const shoot = async () =>
    decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }));
  const shot = await shoot();
  const hide = (on: boolean) =>
    page.evaluate(
      ([m, v]) => {
        const el = document.querySelector<HTMLElement>(`[data-forced-part='${m}']`)!;
        if (v) el.style.setProperty('visibility', 'hidden', 'important');
        else el.style.removeProperty('visibility');
      },
      [mark, on] as const,
    );
  await hide(true);
  const bare = await shoot();
  await hide(false);
  let ratio = 1;
  for (let i = 0; i < shot.width * shot.height; i += 1)
    ratio = Math.max(ratio, contrast(pixel(shot, i), pixel(bare, i)));
  return ratio;
}

// The current mark first, read while a panel (not the record, whose mark is a line) is current.
const PARTS = [
  {
    kind: 'current mark',
    selector: '.sg-rail__stop[aria-current]:not(.sg-rail__stop--record) .sg-rail__mark',
    most: 1,
  },
  { kind: 'rule', selector: '.sg-rec', most: 2 },
  { kind: 'rule', selector: '.sg-colophon__in', most: 1 },
  { kind: 'plus', selector: '.sg-fold:not([open]) .sg-fold__mark', most: 2 },
] as const;

for (const c of FORCED_CASES)
  test(
    `under forced colours in the ${c.palette} palette, on ${c.route} at ${c.width}, the rules, the folds' plus and the current stop's mark still paint`,
    { annotation: annotation(c.route), tag: '@interaction' },
    async ({ page }) => {
      await openForced(page, c);
      await expect(page.locator('[data-variant]').first()).toHaveAttribute(
        'data-variant',
        'singular',
      );
      expect(
        await page.evaluate(() => matchMedia('(forced-colors: active)').matches),
        'forced colours are on',
      ).toBe(true);
      const view = page.viewportSize()!;
      const read: string[] = [];
      const judged: Record<string, number> = {};
      if (c.width >= 600) {
        await page.evaluate(() =>
          document
            .querySelector('[data-sg-stop]:not([data-sg-record])')
            ?.scrollIntoView({ block: 'start' }),
        );
        await page.waitForFunction(
          () =>
            !!document.querySelector('.sg-rail__stop[aria-current]:not(.sg-rail__stop--record)'),
        );
      }
      for (const part of PARTS) {
        const count = await page.locator(part.selector).count();
        let taken = 0;
        for (let i = 0; i < count && taken < part.most; i += 1) {
          const el = page.locator(part.selector).nth(i);
          if (!(await el.evaluate((e) => e.getClientRects().length > 0))) continue;
          const mark = `${part.kind}-${i}`;
          // The rail is fixed: its mark is read where it is.
          await el.evaluate(
            (e, [m, scroll]) => {
              e.setAttribute('data-forced-part', m);
              if (scroll) e.scrollIntoView({ block: 'center' });
            },
            [mark, part.kind !== 'current mark'] as const,
          );
          await page.evaluate(
            () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
          );
          const box = await el.evaluate((e) => {
            const r = e.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              ring: parseFloat(getComputedStyle(e).borderTopWidth) || 0,
            };
          });
          // Where it draws: a rule along the top edge, inside the margins; a plus over its box;
          // a mark's fill inside its ring.
          const area =
            part.kind === 'rule'
              ? { x: box.x + box.width * 0.3, y: box.y - 1, width: box.width * 0.4, height: 4 }
              : part.kind === 'plus'
                ? { x: box.x - 1, y: box.y - 1, width: box.width + 2, height: box.height + 2 }
                : {
                    x: box.x + box.ring + 1,
                    y: box.y + box.ring + 1,
                    width: box.width - 2 * (box.ring + 1),
                    height: box.height - 2 * (box.ring + 1),
                  };
          const x = Math.max(0, Math.floor(area.x));
          const y = Math.max(0, Math.floor(area.y));
          const clip = {
            x,
            y,
            width: Math.min(view.width, Math.ceil(area.x + area.width)) - x,
            height: Math.min(view.height, Math.ceil(area.y + area.height)) - y,
          };
          if (clip.width < 1 || clip.height < 1) continue;
          taken += 1;
          judged[part.kind] = (judged[part.kind] ?? 0) + 1;
          const ratio = await paintsIn(page, mark, clip);
          console.log(
            `forced drawing ${c.route} ${c.palette} ${c.width} ${part.kind} ${part.selector} ${i}: ${ratio.toFixed(2)}:1 in ${JSON.stringify(clip)}`,
          );
          if (ratio < DRAWING)
            read.push(
              `${part.kind} ${part.selector} ${i}: ${ratio <= 1 ? 'paints nothing' : `${ratio.toFixed(2)}:1`}`,
            );
        }
      }
      // What each case must have judged, so a page that lost its parts can't pass.
      expect(judged.rule ?? 0, 'the rules judged').toBeGreaterThan(0);
      if (c.route === '/') expect(judged.plus ?? 0, "the folds' plus judged").toBeGreaterThan(0);
      if (c.width >= 600)
        expect(judged['current mark'] ?? 0, "the current stop's mark judged").toBe(1);
      expect(read, `every drawing reaches ${DRAWING}:1 on its ground`).toEqual([]);
    },
  );
