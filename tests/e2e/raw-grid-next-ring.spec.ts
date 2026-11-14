import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { focusFindings } from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { ringContrast } from './horizontal-cinema-model';

// Raw Grid's way on at a work's foot: the case page's Next work and All work are each a
// ruled cell that is itself the link, side by side over the next row. Each cell rules only its own
// block-start and inline-start, so a ring drawn 2 px outside the cell lay its far sides on its
// neighbours' rules, the next cell's and the next row's, where the focus change is under 3:1: the
// quality cells read both links' focus perimeter in every mode, viewport and row. Focused from the
// keyboard, each rings clear of the rules, its own and its neighbours', at 3:1 on every side of its
// centre line, and passes the focus check, in light, dark and under more contrast, at 1440 and 390.
// A ring set out past a ruled cell still crosses the rules that meet its sides square on, the next
// cell's block-start rule across its inline side, say: there ring and rule are both the ink, so the
// points that lie inside such a rule, at most the rule's width a crossing, are left out of the 3:1
// count and printed. A rule along a side, the one the ring used to lie on, is never left out.
// The page's own column lines (.rg-lines, a 1 px gradient a column, behind everything) are rules
// the ring crosses too, between the rows: their places are read from that element's computed
// background (image, size, position) and box, each line's x printed, and a weak point is left out
// only within 1 px of a line, at most two a line (the ring's top and bottom), every one printed.
// On the complete contract fixture, the scheme and mode by the visitor's cookie.

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const annotation = [
  { type: 'route', description: '/work/[slug]' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'raw-grid'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

/** The complete fixture's one case study. */
const CASE = '/work/project-name';
/** A ruled edge on the page: a border's rect, and which way it runs. */
interface Rule {
  readonly runs: 'across' | 'down';
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly of: string;
}

/** Every border on the page but `skip`'s own, as rects in the viewport's CSS px. */
function rules(page: Page, skip: string): Promise<Rule[]> {
  return page.evaluate((skip) => {
    const own = document.querySelector(skip);
    const found: Rule[] = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el === own) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const s = getComputedStyle(el);
      const of = `${el.localName}${el.classList.length ? `.${[...el.classList].join('.')}` : ''}`;
      const edge = (width: string, style: string) =>
        style !== 'none' && style !== 'hidden' ? Number.parseFloat(width) : 0;
      const top = edge(s.borderTopWidth, s.borderTopStyle);
      const bottom = edge(s.borderBottomWidth, s.borderBottomStyle);
      const left = edge(s.borderLeftWidth, s.borderLeftStyle);
      const right = edge(s.borderRightWidth, s.borderRightStyle);
      if (top > 0)
        found.push({ runs: 'across', x: r.left, y: r.top, width: r.width, height: top, of });
      if (bottom > 0)
        found.push({
          runs: 'across',
          x: r.left,
          y: r.bottom - bottom,
          width: r.width,
          height: bottom,
          of,
        });
      if (left > 0)
        found.push({ runs: 'down', x: r.left, y: r.top, width: left, height: r.height, of });
      if (right > 0)
        found.push({
          runs: 'down',
          x: r.right - right,
          y: r.top,
          width: right,
          height: r.height,
          of,
        });
    }
    return found;
  }, skip);
}

/** A column line the page draws: its left edge and width in the viewport's CSS px, and its run. */
interface Line {
  readonly x: number;
  readonly width: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * The page's column lines, from each .rg-lines element's computed background: a
 * `linear-gradient(to right, <ink> <w>px, transparent <w>px)` tile (transparent read back as
 * rgba(0, 0, 0, 0)), `background-size` wide (a
 * length or a share of the box), from `background-position`'s x, across the element's box.
 */
function columnLines(page: Page): Promise<{ lines: Line[]; read: string[] }> {
  return page.evaluate(() => {
    const lines: Line[] = [];
    const read: string[] = [];
    for (const el of document.querySelectorAll('.rg-lines')) {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const image =
        /^linear-gradient\(to right, .+? ([\d.]+)px, (?:transparent|rgba\(0, 0, 0, 0\)) ([\d.]+)px\)$/.exec(
          s.backgroundImage,
        );
      const size = s.backgroundSize.split(' ')[0] ?? '';
      // A share of the box (8.33333%, or calc(8.33333%)) or a length.
      const share = /([\d.]+)%/.exec(size);
      const tile = share ? (Number.parseFloat(share[1]!) / 100) * r.width : Number.parseFloat(size);
      const start = Number.parseFloat(s.backgroundPositionX) || 0;
      read.push(
        `${s.backgroundImage} / ${s.backgroundSize} at ${s.backgroundPositionX}; box ${r.left},${r.top} ${r.width}x${r.height}`,
      );
      if (!image || !(tile > 0)) continue;
      const width = Number.parseFloat(image[1]!);
      for (let x = r.left + start; x < r.right; x += tile)
        lines.push({ x, width, top: r.top, bottom: r.bottom });
    }
    return { lines, read };
  });
}

/** The way on's two cells, as the records name them. */
const LINKS = {
  'Next work': '#main > article:nth-child(2) > nav:nth-child(4) > a.rg-next__go',
  'All work': '#main > article:nth-child(2) > nav:nth-child(4) > a.rg-next__all',
} as const;

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;
const ROWS = [
  { mode: 'light', contrast: 'no-preference' },
  { mode: 'dark', contrast: 'no-preference' },
  { mode: 'light', contrast: 'more' },
] as const;

for (const viewport of VIEWPORTS) {
  for (const row of ROWS) {
    const label = `${row.mode}${row.contrast === 'more' ? ' under more contrast' : ''}`;
    test(
      `in ${label} at ${viewport.width}, a work's Next work and All work cells focused from the keyboard ring clear of the rules at 3:1 on every side and pass the focus check`,
      { annotation, tag },
      async ({ page, app }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ contrast: row.contrast });
        await page.context().addCookies([
          {
            name: 'portfolio_appearance',
            value: new URLSearchParams({ scheme: 'warm-parchment', mode: row.mode }).toString(),
            url: app.origin,
          },
        ]);
        await page.goto(CASE, { waitUntil: 'networkidle' });
        await expect(page.locator('[data-variant]').first()).toHaveAttribute(
          'data-variant',
          'raw-grid',
        );
        // The mode asked is the one shown: the boundary carries it, and dark its own color-scheme.
        const boundary = page.locator('[data-display-mode]').first();
        await expect(boundary).toHaveAttribute('data-display-mode', row.mode);
        if (row.mode === 'dark')
          expect(await boundary.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
        for (const [name, selector] of Object.entries(LINKS)) {
          const link = page.locator(selector);
          await expect(link, name).toHaveCount(1);
          await link.scrollIntoViewIfNeeded();
          await page.keyboard.press('Shift');
          await link.focus();
          expect(await link.evaluate((el) => el.matches(':focus-visible')), name).toBe(true);
          const active = await inPage<Active>(page, { kind: 'active' });
          expect(active.rounding?.width ?? 0, `${name}: its ring is an outline`).toBeGreaterThan(0);
          // Every point of its centre line, on every side, at 3:1, but those inside a rule that
          // crosses the side square on, at most the rule's width a crossing; and the focus check's verdict.
          const measured = await ringContrast(page, link);
          const ruled = await rules(page, selector);
          const crossings = new Map<Rule, number>();
          const left = measured.weak.filter((point) => {
            const across = point.side === 'left' || point.side === 'right' ? 'across' : 'down';
            const rule = ruled.find(
              (each) =>
                each.runs === across &&
                point.x >= each.x &&
                point.x < each.x + each.width &&
                point.y >= each.y &&
                point.y < each.y + each.height,
            );
            if (rule) crossings.set(rule, (crossings.get(rule) ?? 0) + 1);
            return !rule;
          });
          // Then those within 1 px of a column line the ring crosses, at most two a line.
          const { lines, read } = await columnLines(page);
          const onLine = new Map<Line, typeof left>();
          const kept = left.filter((point) => {
            const line = lines.find(
              (each) =>
                (point.side === 'top' || point.side === 'bottom') &&
                point.x >= each.x - 1 &&
                point.x < each.x + each.width + 1 &&
                point.y >= each.top &&
                point.y < each.bottom,
            );
            if (line) onLine.set(line, [...(onLine.get(line) ?? []), point]);
            return !line;
          });
          const besideLines = [...onLine].map(([line, points]) => ({
            x: Math.round(line.x * 10) / 10,
            points: points.map(({ side, x, y }) => `${side} ${x},${y}`),
          }));
          const setAside = besideLines.reduce((sum, one) => sum + one.points.length, 0);
          console.log(
            `[column lines] ${name} ${label} ${viewport.width}: ${setAside} point(s) set aside on ${besideLines.length} line(s) of ${lines.length} (x ${lines.map((one) => Math.round(one.x * 10) / 10).join(', ')}); ${JSON.stringify(besideLines)}; read ${JSON.stringify(read)}`,
          );
          const skipped = [...crossings].map(([rule, points]) => ({
            of: rule.of,
            runs: rule.runs,
            at: Math.round(rule.runs === 'across' ? rule.y : rule.x),
            thickness: rule.runs === 'across' ? rule.height : rule.width,
            points,
          }));
          console.log(
            `[ring crossings] ${name} ${label} ${viewport.width}: ${skipped.reduce((sum, one) => sum + one.points, 0)} point(s) left out, ${JSON.stringify(skipped)}`,
          );
          const sides = (['top', 'right', 'bottom', 'left'] as const).map((side) => ({
            side,
            inView: measured.sides[side].points > 0,
            atThreeToOne: !kept.some((point) => point.side === side),
          }));
          const why = `${name}: its ring's centre line ${JSON.stringify({ ...measured, weak: kept, skipped, besideLines })}`;
          expect(
            skipped.filter(({ thickness, points }) => points > Math.ceil(thickness)),
            `${name}: no crossing leaves out more than its rule's width ${why}`,
          ).toEqual([]);
          // One read: every side at 3:1 with those points left out, and no column line setting aside
          // more than the ring's top and bottom.
          const besideLinesAtMostTwo = besideLines.every(({ points }) => points.length <= 2);
          expect({ sides, besideLinesAtMostTwo }, why).toEqual({
            sides: sides.map(({ side }) => ({ side, inView: true, atThreeToOne: true })),
            besideLinesAtMostTwo: true,
          });
          expect(await focusFindings(page, active), `${name}: the focus check ${why}`).toEqual([]);
        }
      },
    );
  }
}
