// HC diagnosis only, not for merge (#220's reds): chapter-origins' foot Next at 1024 by 768, default, in carbon-inspired and
// soft-organic, x5 each, on CI Linux, through the packs spec's own selectable site and pack guard. Report only: it asserts
// the pack guard and nothing else. For each run it logs, each line prefixed [kgn-diag] on stdout (the CI job's log):
// - the stop's box (getBoundingClientRect) and its computed outline width and offset;
// - ringContrast's per-side { points, strong }, and every weak centre-line point (the focus check's own centreLineChange
//   on that one point) with its (x, y), its device pixel and its focused and blurred colours and their contrast;
// - the painted ring's edges: from the focused and blurred clips, the changed pixels' bounding rows (top, bottom) and
//   columns (left, right) per side, in device pixels and CSS px, and their bounding box;
// - focusFindings' verdict, the findings array.
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import path from 'node:path';
import { PLATFORM_DEFAULTS } from '../../packages/appearance/src/axes';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { loadThresholds } from '../../quality/thresholds';
import { expect, test } from '../harness/fixtures';
import {
  centreLineChange,
  clipAround,
  focusFindings,
  frames as drawn,
  ringCentreLine,
  type LinePoint,
} from '../quality/lib/a11y/interaction';
import { inPage, type Active } from '../quality/lib/a11y/probe';
import { contrast, decodePng, pixel } from '../quality/lib/pixels';
import { packCookie } from '../quality/lib/sweep';
import { arrivedAt, load, read, ringContrast } from './horizontal-cinema-model';

/** The complete fixture through Horizontal Cinema, its language and type the visitor's to pick. */
function serving() {
  const fixture = contractFixture('complete');
  const dir = path.dirname(fixture.files.portfolio);
  const site = fixtureSiteSelecting(readFileSync(fixture.files.site, 'utf8'), 'horizontal-cinema')
    .replace('\n  designLanguage: locked\n', '\n  designLanguage: selectable\n')
    .replace('\n  typography: locked\n', '\n  typography: selectable\n');
  if (/\n {2}(designLanguage|typography): locked\n/.test(site)) {
    throw new Error("The complete fixture's visitor controls moved: update serving().");
  }
  return {
    portfolio: fixture.files.portfolio,
    siteText: site,
    sourceFiles: Object.fromEntries(
      fixture.unitFiles.map((file) => [file, readFileSync(path.join(dir, file), 'utf8')]),
    ),
  };
}

test.use({ appOptions: serving(), viewport: { width: 1024, height: 768 } });
test.describe.configure({ retries: 0 });

const annotation = [
  { type: 'route', description: '/' },
  { type: 'profile', description: 'read-only' },
];
const tag = '@interaction';
const LANGUAGES = ['carbon-inspired', 'soft-organic'] as const;

/** Loads the strip in `language`, by the cookie the pack sweep sets, and checks the pack rendered (the one assertion). */
async function loadIn(page: Page, origin: string, language: string): Promise<void> {
  const tuple = { ...PLATFORM_DEFAULTS, variant: 'horizontal-cinema', designLanguage: language };
  await page.context().addCookies([packCookie({ tuple }, origin)]);
  await load(page);
  const boundary = page.locator('[data-variant]').first();
  await expect(boundary).toHaveAttribute('data-design-language', language);
  await expect(boundary).toHaveAttribute('data-typography', PLATFORM_DEFAULTS.typography);
}

/** Tab by Tab until `stop` has focus; a walk that never gets there throws (no assertion). */
async function tabTo(page: Page, stop: Locator): Promise<number> {
  for (let presses = 0; presses < 300; presses++) {
    if (await stop.evaluate((element) => element === document.activeElement)) return presses;
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab never reached the stop in 300 presses');
}

type Side = 'top' | 'right' | 'bottom' | 'left';
const sideOf = ({ nx, ny }: LinePoint): Side =>
  Math.abs(ny) >= Math.abs(nx) ? (ny < 0 ? 'top' : 'bottom') : nx > 0 ? 'right' : 'left';
const round = (x: number) => Math.round(x * 100) / 100;

for (const language of LANGUAGES) {
  for (let run = 1; run <= 5; run++) {
    const id = `${language} run ${String(run).padStart(2, '0')}`;
    const log = (part: string, value: unknown) =>
      console.log(`[kgn-diag] 234 ${id} ${part}: ${JSON.stringify(value)}`);
    test(
      `diag: chapter-origins' foot Next at 1024 by 768 in ${language}, its ring's points, painted edges and the focus check's verdict (zz-kgn x5 run ${String(run).padStart(2, '0')})`,
      { annotation, tag },
      async ({ page, app }) => {
        await loadIn(page, app.origin, language);
        const { scenes } = await read(page);
        const index = scenes.indexOf('chapter-origins');
        const next = page.locator('#chapter-origins .hc-bar--bottom > a.hc-bar__next');
        log('stop', { index, count: await next.count() });
        if (index < 0 || (await next.count()) !== 1) return;
        const presses = await tabTo(page, next);
        log('tab', { presses, arrived: await arrivedAt(page, index) });
        await drawn(page);
        // The box and the outline as computed.
        log(
          'box',
          await next.evaluate((link) => {
            const r = link.getBoundingClientRect();
            const s = getComputedStyle(link);
            const bar = link.closest('.hc-bar--bottom')!.getBoundingClientRect();
            return {
              box: { x: r.x, y: r.y, width: r.width, height: r.height },
              bar: { x: bar.x, y: bar.y, width: bar.width, height: bar.height },
              outline: {
                width: s.outlineWidth,
                offset: s.outlineOffset,
                style: s.outlineStyle,
                color: s.outlineColor,
              },
              focusVisible: link.matches(':focus-visible'),
              dpr: devicePixelRatio,
            };
          }),
        );
        // Its own shots, in focusFindings' order: focused, the blur, two frames, blurred; then focus back.
        const active = await inPage<Active>(page, { kind: 'active' });
        const width = active.rounding?.width ?? 0;
        const offset = active.rounding?.offset ?? 0;
        const clip = clipAround(active.box, Math.ceil(active.reach) + 1, page.viewportSize()!);
        log('active', { box: active.box, reach: active.reach, rounding: active.rounding, clip });
        if (clip && active.rounding && width > 0) {
          const shot = async () =>
            decodePng(await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }));
          await drawn(page);
          const focused = await shot();
          await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
          await drawn(page);
          const blurred = await shot();
          await next.evaluate((link: HTMLElement) => link.focus());
          const scale = focused.width / clip.width;
          const ratio = loadThresholds().contrast.nonText;
          const at = (x: number, y: number) => {
            const column = Math.floor((x - clip.x) * scale);
            const row = Math.floor((y - clip.y) * scale);
            return column < 0 || row < 0 || column >= focused.width || row >= focused.height
              ? -1
              : row * focused.width + column;
          };
          // Every weak centre-line point, as the check's own centreLineChange judges that one point.
          const line = ringCentreLine(active.box, active.rounding.corners, offset + width / 2);
          const weak = line.flatMap((point) => {
            const one = centreLineChange(focused, blurred, clip, [point], ratio, width / 2);
            if (one.total === 0 || one.strong === 1) return [];
            const i = at(point.x, point.y);
            const [a, b] = [pixel(focused, i), pixel(blurred, i)];
            return [
              {
                side: sideOf(point),
                x: round(point.x),
                y: round(point.y),
                device: [i % focused.width, Math.floor(i / focused.width)],
                focused: a,
                blurred: b,
                contrast: round(contrast(a, b)),
              },
            ];
          });
          log('weak points', { of: line.length, weak: weak.length, points: weak });
          // The painted ring's edges: the changed pixels' bounding rows and columns per side.
          const box = active.box;
          const [midX, midY] = [box.x + box.width / 2, box.y + box.height / 2];
          const edges: Record<
            string,
            { from: number; to: number; cssFrom: number; cssTo: number } | null
          > = { top: null, bottom: null, left: null, right: null };
          let all: { left: number; top: number; right: number; bottom: number } | null = null;
          const grow = (side: string, device: number, css: number) => {
            const e = edges[side];
            edges[side] = e
              ? {
                  from: Math.min(e.from, device),
                  to: Math.max(e.to, device),
                  cssFrom: Math.min(e.cssFrom, css),
                  cssTo: Math.max(e.cssTo, css),
                }
              : { from: device, to: device, cssFrom: css, cssTo: css };
          };
          for (let row = 0; row < focused.height; row++) {
            for (let column = 0; column < focused.width; column++) {
              const i = row * focused.width + column;
              const [a, b] = [pixel(focused, i), pixel(blurred, i)];
              if (a[0] === b[0] && a[1] === b[1] && a[2] === b[2]) continue;
              all = all
                ? {
                    left: Math.min(all.left, column),
                    top: Math.min(all.top, row),
                    right: Math.max(all.right, column),
                    bottom: Math.max(all.bottom, row),
                  }
                : { left: column, top: row, right: column, bottom: row };
              const x = clip.x + (column + 0.5) / scale;
              const y = clip.y + (row + 0.5) / scale;
              if (x >= box.x && x <= box.x + box.width)
                grow(y < midY ? 'top' : 'bottom', row, round(y));
              if (y >= box.y && y <= box.y + box.height)
                grow(x < midX ? 'left' : 'right', column, round(x));
            }
          }
          log('painted edges', { scale, clip, changedBounds: all, rowsAndColumns: edges });
        }
        log('ringContrast', await ringContrast(page, next));
        const again = await inPage<Active>(page, { kind: 'active' });
        log('focusFindings', await focusFindings(page, again));
      },
    );
  }
}
