import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { clearOfStuckCovers } from '../quality/lib/a11y/covers';
import {
  centreLineChange,
  clipAround,
  focusFindings,
  frames,
  ringCentreLine,
  type LinePoint,
} from '../quality/lib/a11y/interaction';
import { inPage, type Active, type Stop } from '../quality/lib/a11y/probe';
import { contrast, decodePng, pixel } from '../quality/lib/pixels';

// The case page's crumb link and its focus ring at 390x844 (touch), on the complete fixture under
// platform-neutral/warm-parchment/humanist-ui/system, forced colors and the default row, reached
// by Tab as a cell reaches it. Its ring as the focus check reads it (focusFindings), then the ring's
// centre line side by side: each side's points at 3:1 with the band whole and at its centre only,
// the pixels across the band at each side's middle, what paints there, and the link's ancestors'
// clips and layers. The clips, focused and blurred, beside it. PROOF_LOOK_OUT names the dir.

const OUT = process.env.PROOF_LOOK_OUT ?? 'look';
const CRUMB =
  '#main > section:nth-child(1) > div:nth-child(1) > div:nth-child(2) > div:nth-child(1) > p:nth-child(1) > a:nth-child(1)';

const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);
const site = parseDocument(fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'flux'));
for (const [axis, value] of [
  ['designLanguage', 'platform-neutral'],
  ['colorScheme', 'warm-parchment'],
  ['typography', 'humanist-ui'],
  ['displayMode', 'system'],
] as const) {
  site.setIn(['appearance', axis], value);
}

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: site.toString(),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
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

const SQUARE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];

for (const row of ['forced-colors', 'default'] as const) {
  test(`crumb ring: flux complete /work/project-name at 390x844, ${row}`, async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(OUT, { recursive: true });
    await page.emulateMedia({
      media: null,
      reducedMotion: 'no-preference',
      forcedColors: row === 'forced-colors' ? 'active' : 'none',
      contrast: 'no-preference',
    });
    await page.goto('/work/project-name', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await frames(page, 500);
    const viewport = page.viewportSize()!;
    let presses = 0;
    let active: Active | null = null;
    while (presses < 80) {
      await page.keyboard.press('Tab');
      presses++;
      await frames(page);
      const now = await inPage<Active>(page, { kind: 'active' });
      if (!now.none && now.path === CRUMB) {
        active = now;
        break;
      }
    }
    expect(active, `Tab reaches ${CRUMB}`).not.toBeNull();
    const verdict = await focusFindings(page, active!);
    const margin = Math.max(4, Math.ceil(active!.reach) + 1);
    const at = await page.evaluate(() => [scrollX, scrollY] as const);
    const cleared = await clearOfStuckCovers(page, page.locator(CRUMB).first(), margin);
    const stop = await inPage<Stop | null>(page, { kind: 'stop', path: CRUMB });
    const box = stop?.box ?? active!.box;
    const clip = clipAround(box, margin, viewport)!;
    await frames(page);
    const shot = () => page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
    const focusedPng = await shot();
    const rounding = active!.rounding;
    const width = rounding?.width ?? 0;
    const line = ringCentreLine(
      box,
      rounding?.corners ?? SQUARE,
      (rounding?.offset ?? 0) + width / 2,
    );
    const bySide = new Map<string, LinePoint[]>();
    for (const point of line) {
      bySide.set(sideOf(point), [...(bySide.get(sideOf(point)) ?? []), point]);
    }
    const middles = Object.fromEntries(
      [...bySide].map(([side, points]) => [side, points[Math.floor(points.length / 2)]!]),
    );
    const dom = await page.evaluate(
      ({ path, middles }) => {
        const el = document.querySelector<HTMLElement>(path)!;
        const name = (e: Element) => {
          const cls = typeof e.className === 'string' ? e.className.trim() : '';
          return `${e.tagName.toLowerCase()}${e.id ? `#${e.id}` : ''}${cls ? `.${cls.split(/\s+/).join('.')}` : ''}`;
        };
        const style = getComputedStyle(el);
        const plain = [
          'visible',
          'none',
          'auto',
          'static',
          'normal',
          '1',
          'rgba(0, 0, 0, 0)',
          '0px',
        ];
        const chain: Record<string, string>[] = [];
        for (let e: Element | null = el; e && chain.length < 12; e = e.parentElement) {
          const s = getComputedStyle(e);
          const r = e.getBoundingClientRect();
          const keep: Record<string, string> = {
            el: name(e),
            box: `${r.x.toFixed(2)},${r.y.toFixed(2)} ${r.width.toFixed(2)}x${r.height.toFixed(2)}`,
          };
          for (const k of [
            'display',
            'overflow',
            'overflowClipMargin',
            'contain',
            'containerType',
            'position',
            'zIndex',
            'isolation',
            'transform',
            'opacity',
            'clipPath',
            'backgroundColor',
            'backgroundImage',
            'paddingTop',
            'paddingLeft',
            'marginTop',
          ] as const) {
            const v = String(s[k]);
            if (!plain.includes(v)) keep[k] = v.slice(0, 200);
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
        const rects = [...el.getClientRects()].map(
          (r) => `${r.x.toFixed(2)},${r.y.toFixed(2)} ${r.width.toFixed(2)}x${r.height.toFixed(2)}`,
        );
        return {
          text: (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
          focusVisible: el.matches(':focus-visible'),
          outline: `${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor} offset ${style.outlineOffset}`,
          display: style.display,
          lineHeight: style.lineHeight,
          fontSize: style.fontSize,
          rects,
          scrollPadding: getComputedStyle(document.documentElement).scrollPaddingBlockEnd,
          paints,
          chain,
        };
      },
      { path: CRUMB, middles },
    );
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await frames(page);
    const blurredPng = await shot();
    await page.evaluate(([x, y]) => scrollTo({ left: x, top: y, behavior: 'instant' }), at);
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
    const stem = `crumb-390x844-${row}`;
    writeFileSync(path.join(OUT, `${stem}-focused.png`), focusedPng);
    writeFileSync(path.join(OUT, `${stem}-blurred.png`), blurredPng);
    const read = {
      presses,
      scroll: at,
      cleared,
      box,
      clip,
      scale,
      reach: active!.reach,
      rounding,
      fragments: stop?.fragments?.length ?? active!.fragments?.length ?? 0,
      verdict,
      dom,
      sides,
    };
    writeFileSync(path.join(OUT, `${stem}.json`), JSON.stringify(read, null, 1));
    console.log(`${stem}: ${JSON.stringify(verdict.map((f) => `${f.rule}: ${f.actual}`))}`);
  });
}
