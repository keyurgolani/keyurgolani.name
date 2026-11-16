import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { expect, test } from '../harness/fixtures';
import {
  centreLineChange,
  clipAround,
  focusFindings,
  frames,
  ringCentreLine,
  type LinePoint,
} from '../quality/lib/a11y/interaction';
import { clearOfStuckCovers } from '../quality/lib/a11y/covers';
import { inPage, type Active, type Stop } from '../quality/lib/a11y/probe';
import { contrast, decodePng, pixel } from '../quality/lib/pixels';

// Scratch read, never committed: Spatial Bento's focus rings on one tuple at 390x844 (touch), the
// default row, walked by Tab as the cell walks. At each named stop: the harness's own verdict
// (focusFindings), then the ring's centre line side by side (top, right, bottom, left, corners),
// each side's points at 3:1 with the band whole and at its centre only, the pixels across the band
// at each side's middle, what paints at each side's middle (elementsFromPoint), and the stop's
// ancestors' clips, layers and grounds. The clips go beside it as PNGs. PROOF_LOOK_OUT names the dir.

const TUPLE = {
  variant: 'spatial-bento',
  designLanguage: 'minimal-flat',
  colorScheme: 'neutral-slate',
  typography: 'accessible-reading',
  displayMode: 'system',
};
const TARGETS: string[] = [
  '#sb--overview > div:nth-child(1) > aside:nth-child(6) > p:nth-child(3) > a:nth-child(1)',
  '#writing-title > h4:nth-child(1) > a:nth-child(1)',
  '#contact > p:nth-child(3) > a:nth-child(1)',
];
const [WIDTH, HEIGHT] = [390, 844] as const;
const TOUCH = WIDTH < 768;
const OUT = process.env.PROOF_LOOK_OUT ?? 'look';
const BASE = `${TUPLE.designLanguage}-${TUPLE.colorScheme}-${TUPLE.typography}-${TUPLE.displayMode}-${WIDTH}`;
const ROWS = ['default', 'forced-colors'] as const;

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const site = parseDocument(
  fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'spatial-bento'),
);
for (const axis of ['designLanguage', 'colorScheme', 'typography', 'displayMode'] as const) {
  site.setIn(['appearance', axis], TUPLE[axis]);
}

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: site.toString(),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: WIDTH, height: HEIGHT },
  hasTouch: TOUCH,
  isMobile: TOUCH,
});

const hex = (p: readonly number[]) =>
  `#${p
    .slice(0, 3)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;

const sideOf = (p: LinePoint) =>
  p.ny === -1
    ? 'top'
    : p.nx === 1
      ? 'right'
      : p.ny === 1
        ? 'bottom'
        : p.nx === -1
          ? 'left'
          : 'corner';

for (const ROW of ROWS as readonly ('default' | 'forced-colors' | 'contrast-more')[]) {
  test(`ring read: spatial-bento ${BASE}-${ROW}`, async ({ page }) => {
    const KEY = `${BASE}-${ROW}`;
    test.setTimeout(600_000);
    expect(TARGETS.length, 'the stops').toBeGreaterThan(0);
    mkdirSync(OUT, { recursive: true });
    await page.emulateMedia({
      media: null,
      reducedMotion: 'no-preference',
      forcedColors: ROW === 'forced-colors' ? 'active' : 'none',
      contrast: ROW === 'contrast-more' ? 'more' : 'no-preference',
    });
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await frames(page, 500);
    const pack = await page.evaluate(() => {
      const at = document.querySelector('[data-design-language]');
      return {
        language: at?.getAttribute('data-design-language'),
        scheme: at?.getAttribute('data-color-scheme'),
        type: at?.getAttribute('data-typography'),
        mode: document.documentElement.getAttribute('data-display-mode'),
      };
    });
    const viewport = page.viewportSize()!;
    const found: Record<string, unknown>[] = [];
    const left = new Set(TARGETS);
    let presses = 0;
    while (left.size > 0 && presses < 800) {
      await page.keyboard.press('Tab');
      presses++;
      await frames(page);
      const active = await inPage<Active>(page, { kind: 'active' });
      if (active.none || !left.has(active.path)) continue;
      left.delete(active.path);
      const verdict = await focusFindings(page, active);
      const margin = Math.max(4, Math.ceil(active.reach) + 1);
      const at = await page.evaluate(() => [scrollX, scrollY] as const);
      const clearance = await clearOfStuckCovers(page, page.locator(active.path).first(), margin);
      const stop = await inPage<Stop | null>(page, {
        kind: 'stop',
        path: active.path,
      });
      const box = stop?.box ?? active.box;
      const clip = clipAround(box, margin, viewport)!;
      await frames(page);
      const shot = () => page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
      const focusedPng = await shot();
      const rounding = active.rounding;
      const width = rounding?.width ?? 0;
      const square: readonly (readonly [number, number])[] = [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ];
      const corners = rounding?.corners ?? square;
      const line = ringCentreLine(box, corners, (rounding?.offset ?? 0) + width / 2);
      const bySide = new Map<string, LinePoint[]>();
      for (const point of line)
        bySide.set(sideOf(point), [...(bySide.get(sideOf(point)) ?? []), point]);
      const middles = Object.fromEntries(
        [...bySide].map(([side, points]) => [side, points[Math.floor(points.length / 2)]!]),
      );
      const dom = await page.evaluate(
        ({ path, middles }) => {
          const el = document.querySelector<HTMLElement>(path)!;
          const name = (e: Element) =>
            `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${
              typeof e.className === 'string' && e.className
                ? `.${e.className.trim().split(/\s+/).join('.')}`
                : ''
            }`;
          const style = getComputedStyle(el);
          const chain: Record<string, string>[] = [];
          for (let e: Element | null = el; e && chain.length < 14; e = e.parentElement) {
            const s = getComputedStyle(e);
            const r = e.getBoundingClientRect();
            const keep: Record<string, string> = {
              el: name(e),
              box: `${r.x.toFixed(2)},${r.y.toFixed(2)} ${r.width.toFixed(2)}x${r.height.toFixed(2)}`,
            };
            for (const k of [
              'overflow',
              'contain',
              'position',
              'zIndex',
              'isolation',
              'transform',
              'filter',
              'opacity',
              'clipPath',
              'contentVisibility',
              'backgroundColor',
              'backgroundImage',
              'boxShadow',
              'borderTop',
              'borderBottom',
              'paddingTop',
              'paddingBottom',
              'willChange',
            ] as const) {
              const v = String(s[k]);
              if (
                ![
                  'visible',
                  'none',
                  'auto',
                  'static',
                  'normal',
                  '1',
                  'rgba(0, 0, 0, 0)',
                  '0px',
                ].includes(v) &&
                !v.startsWith('0px none')
              )
                keep[k] = v.slice(0, 220);
            }
            chain.push(keep);
          }
          const paints = Object.fromEntries(
            Object.entries(middles).map(([side, p]) => [
              side,
              document
                .elementsFromPoint(p.x, p.y)
                .slice(0, 5)
                .map((e) => name(e)),
            ]),
          );
          const dock = document.querySelector('.sb-dock');
          const dockBox = dock?.getBoundingClientRect();
          return {
            dock: dock
              ? {
                  box: `${dockBox!.x.toFixed(2)},${dockBox!.y.toFixed(2)} ${dockBox!.width.toFixed(2)}x${dockBox!.height.toFixed(2)}`,
                  state: dock.getAttribute('data-state'),
                  shadow: getComputedStyle(dock).boxShadow.slice(0, 300),
                }
              : null,
            scrollMarginEnd: style.scrollMarginBlockEnd,
            tag: name(el),
            text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
            focusVisible: el.matches(':focus-visible'),
            outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor} offset ${style.outlineOffset}`,
            radius: style.borderRadius,
            display: style.display,
            paints,
            chain,
          };
        },
        { path: active.path, middles },
      );
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await frames(page);
      const blurredPng = await shot();
      await page.evaluate(
        (path) => (document.querySelector(path) as HTMLElement | null)?.focus(),
        active.path,
      );
      await page.evaluate(([x, y]) => scrollTo({ left: x, top: y, behavior: 'instant' }), at);
      await frames(page);
      const focused = decodePng(focusedPng);
      const blurred = decodePng(blurredPng);
      const scale = focused.width / clip.width;
      const index = (x: number, y: number) => {
        const c = Math.floor((x - clip.x) * scale);
        const r = Math.floor((y - clip.y) * scale);
        return c < 0 || r < 0 || c >= focused.width || r >= focused.height
          ? -1
          : r * focused.width + c;
      };
      const sides = Object.fromEntries(
        [...bySide].map(([side, points]) => {
          const whole = centreLineChange(focused, blurred, clip, points, 3, width / 2);
          const centre = centreLineChange(focused, blurred, clip, points, 3);
          const m = middles[side]!;
          const across: string[] = [];
          for (let t = -(width + 3); t <= width + 3 + 1e-9; t += 1 / scale) {
            const i = index(m.x + m.nx * t, m.y + m.ny * t);
            if (i < 0) continue;
            const [a, b] = [pixel(focused, i), pixel(blurred, i)];
            across.push(`${t.toFixed(2)}: ${hex(a)} over ${hex(b)} ${contrast(a, b).toFixed(2)}`);
          }
          return [
            side,
            {
              points: points.length,
              whole: `${whole.strong}/${whole.total}`,
              centre: `${centre.strong}/${centre.total}`,
              middle: `${m.x.toFixed(2)},${m.y.toFixed(2)}`,
              across,
            },
          ];
        }),
      );
      const stem = `${KEY}-${found.length + 1}`;
      writeFileSync(path.join(OUT, `${stem}-focused.png`), focusedPng);
      writeFileSync(path.join(OUT, `${stem}-blurred.png`), blurredPng);
      const read = {
        stem,
        path: active.path,
        presses,
        scroll: at,
        cleared: clearance,
        box,
        clip,
        reach: active.reach,
        rounding,
        fragments: stop?.fragments?.length ?? active.fragments?.length ?? 0,
        verdict,
        dom,
        sides,
      };
      writeFileSync(path.join(OUT, `${stem}.json`), JSON.stringify(read, null, 1));
      found.push({
        stem,
        path: active.path,
        verdict: verdict.map((f) => `${f.rule}: ${f.actual}`),
      });
    }
    writeFileSync(
      path.join(OUT, `${KEY}-walk.json`),
      JSON.stringify({ tuple: TUPLE, pack, presses, found, missed: [...left] }, null, 1),
    );
    console.log(
      `ring read ${KEY}: pack ${JSON.stringify(pack)}, ${presses} presses, found ${found.length}, missed ${left.size}`,
    );
    for (const f of found) console.log(`  ${JSON.stringify(f)}`);
  });
}
