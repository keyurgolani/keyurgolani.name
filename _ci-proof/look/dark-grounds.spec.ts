import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { fixtureSiteSelecting } from '../../packages/variant-contract/src/contract-fixtures';
import { contractFixture } from '../../packages/variant-contract/src/node/fixtures';
import { expect, test } from '../harness/fixtures';
import { DRAWING_RATIO, drawingsAmong } from './forced-backplate';
import { contrast, decodePng, pixel, type Image, type Rgb } from '../quality/lib/pixels';

// Probe, run as a CI look: Singular's dark grounds (data-ground inverse or accent: the panels' own
// and the ones the pager lends the bar, the rail and the strip) with forced colours on or off
// (L1_PROBE_ROW forced-colors or default), on the home page and a case study, light and dark, at
// 1024 and 390. Each dark panel is brought into view and every drawing on a dark ground is read:
// border sides, background colour, background image, outline and underline, with its computed
// colour's ratio against the ground and, where it lies in the view, the ratio its pixels reach
// against the ground's colour. Every focusable on a dark ground is focused from the keyboard and
// its ring read in pixels: the focused shot against the same clip unfocused, each side's strongest
// changed pixel, the ring's ratio the weakest side's. The canvas ground's two rules drawn as a
// background image (.sg-rec, .sg-colophon__in) are read in pixels too. Last, every part with a
// drawing on a dark ground goes to the shared drawings judge (drawingsAmong). Under forced colours
// a part the judge finds under DRAWING_RATIO, or a ring under it, fails; the region reads, the
// rules and the default row are reported only.

const OUT = process.env.PROOF_LOOK_OUT ?? '';
const ROW = process.env.L1_PROBE_ROW === 'default' ? 'default' : 'forced-colors';
const FORCED = ROW === 'forced-colors';
const DRAWING = DRAWING_RATIO;
const FIXTURE = contractFixture('complete');
const DIR = path.dirname(FIXTURE.files.portfolio);

test.use({
  appOptions: {
    portfolio: FIXTURE.files.portfolio,
    siteText: fixtureSiteSelecting(readFileSync(FIXTURE.files.site, 'utf8'), 'singular'),
    sourceFiles: Object.fromEntries(
      FIXTURE.unitFiles.map((file) => [file, readFileSync(path.join(DIR, file), 'utf8')]),
    ),
  },
});

const CASES = (['/', '/work/project-name'] as const).flatMap((route) =>
  (['light', 'dark'] as const).flatMap((palette) =>
    [1024, 390].map((width) => ({ route, palette, width })),
  ),
);

type Box = [number, number, number, number];

interface Drawing {
  ground: string;
  groundRgb: Rgb;
  where: string;
  pseudo: boolean;
  prop: string;
  colour: string;
  computed: number | null;
  box: Box;
  width: number;
  /** The part's mark for the shared drawings judge, or null (a ground or a pseudo-element). */
  dw: string | null;
}

const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 250))),
      ),
  );

const at = (image: Image, x: number, y: number): Rgb | null =>
  x < 0 || y < 0 || x >= image.width || y >= image.height
    ? null
    : pixel(image, Math.floor(y) * image.width + Math.floor(x));

/** The strongest ratio a region's pixels reach against `ground`, or its median; null outside. */
function regionRatio(
  image: Image,
  [x0, y0, x1, y1]: Box,
  ground: Rgb,
  how: 'max' | 'median',
): number | null {
  const ratios: number[] = [];
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(image.height, Math.ceil(y1)); y += 1)
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(image.width, Math.ceil(x1)); x += 1)
      ratios.push(contrast(pixel(image, y * image.width + x), ground));
  if (!ratios.length) return null;
  if (how === 'max') return Math.max(...ratios);
  ratios.sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)]!;
}

/** Where a drawing paints, as x0, y0, x1, y1 in the view: an edge's band, or the box inside. */
function regionOf(d: Drawing): Box | null {
  const [x, y, w, h] = d.box;
  const b = Math.max(1, Math.ceil(d.width));
  const midX: [number, number] = [x + w * 0.25, x + w * 0.75];
  const midY: [number, number] = [y + h * 0.25, y + h * 0.75];
  if (d.prop === 'border-top' || d.prop.startsWith('background-image'))
    return [midX[0], y, midX[1], y + b];
  if (d.prop === 'border-bottom') return [midX[0], y + h - b, midX[1], y + h];
  if (d.prop === 'border-left') return [x, midY[0], x + b, midY[1]];
  if (d.prop === 'border-right') return [x + w - b, midY[0], x + w, midY[1]];
  if (d.prop === 'background-color') return [x + 2, y + 2, x + w - 2, y + h - 2];
  return null;
}

/** A ring in pixels: each side's strongest change from rest to focused, inside the band round `box`. */
function ringRead(focused: Image, rest: Image, box: Box, reach: number): (number | null)[] {
  const [bx, by, bw, bh] = box;
  const best: (number | null)[] = [null, null, null, null];
  const seen = [false, false, false, false];
  for (let y = 0; y < focused.height; y += 1)
    for (let x = 0; x < focused.width; x += 1) {
      const out = x < bx - reach || x > bx + bw + reach || y < by - reach || y > by + bh + reach;
      const deep = x > bx + reach && x < bx + bw - reach && y > by + reach && y < by + bh - reach;
      if (out || deep) continue;
      const d = [
        Math.abs(y - by),
        Math.abs(x - (bx + bw)),
        Math.abs(y - (by + bh)),
        Math.abs(x - bx),
      ];
      const side = d.indexOf(Math.min(...d));
      seen[side] = true;
      const f = pixel(focused, y * focused.width + x);
      const r = pixel(rest, y * rest.width + x);
      const ratio = f[0] === r[0] && f[1] === r[1] && f[2] === r[2] ? 1 : contrast(f, r);
      best[side] = Math.max(best[side] ?? 1, ratio);
    }
  return best.map((v, i) => (seen[i] ? (v ?? 1) : null));
}

for (const c of CASES)
  test(`probe: Singular's dark grounds, ${c.route} ${c.palette} ${c.width} ${ROW}`, async ({
    page,
  }) => {
    test.setTimeout(600_000);
    expect(OUT, 'PROOF_LOOK_OUT').not.toBe('');
    const slug = `${c.route === '/' ? 'home' : 'case'}-${c.palette}-${c.width}`;
    const dir = path.join(OUT, slug);
    mkdirSync(dir, { recursive: true });
    const lines: string[] = [];
    const say = (line: string) => {
      lines.push(line);
      console.log(`probe ${slug} ${ROW} ${line}`);
    };
    const height = c.width < 600 ? 844 : 768;
    await page.setViewportSize({ width: c.width, height });
    await page.emulateMedia({
      colorScheme: c.palette,
      forcedColors: FORCED ? 'active' : 'none',
      reducedMotion: 'reduce',
    });
    await page.goto(c.route, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(FORCED);
    await page.mouse.move(0, 0);
    const grounds = await page.evaluate(() =>
      [...document.querySelectorAll('[data-ground]')].map(
        (el) =>
          `${el.getAttribute('data-ground')} ${el.tagName.toLowerCase()}.${[...el.classList].join('.')}${el.hasAttribute('data-ui-surface') ? `[surface=${el.getAttribute('data-ui-surface')}]` : ''}`,
      ),
    );
    say(`grounds ${JSON.stringify(grounds)}`);
    const panels = await page.evaluate(() => {
      const list = [
        ...document.querySelectorAll("[data-ground='inverse'], [data-ground='accent']"),
      ].filter((el) => !el.closest('.sg-bar, .sg-rail, .sg-strip'));
      list.forEach((el, i) => el.setAttribute('data-l1-panel', String(i)));
      return list.length;
    });

    // Drawings on a dark ground, one view per dark panel.
    const seen = new Map<string, { d: Drawing; pixels: number | null; views: number[] }>();
    for (let v = 0; v < panels; v += 1) {
      await page.evaluate((i) => {
        document.querySelector(`[data-l1-panel='${i}']`)?.scrollIntoView({ block: 'start' });
      }, v);
      await settle(page);
      const png = await page.screenshot({
        animations: 'disabled',
        caret: 'hide',
      });
      writeFileSync(path.join(dir, `view${v}.png`), png);
      const view = decodePng(png);
      const read: Drawing[] = await page.evaluate(() => {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 1;
        const cx = cv.getContext('2d', { willReadFrequently: true })!;
        const rgba = (s: string): number[] => {
          cx.clearRect(0, 0, 1, 1);
          cx.fillStyle = '#010203';
          cx.fillStyle = s;
          cx.fillRect(0, 0, 1, 1);
          return [...cx.getImageData(0, 0, 1, 1).data];
        };
        const lum = ([r, g, b]: number[]) => {
          const f = (x: number) => {
            const s = x / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
        };
        const ratio = (a: number[], b: number[]) => {
          const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
          return +((x! + 0.05) / (y! + 0.05)).toFixed(2);
        };
        const groundOf = (g: Element) => {
          for (let el: Element | null = g; el; el = el.parentElement) {
            const k = rgba(getComputedStyle(el).backgroundColor);
            if (k[3]! > 0) return k;
          }
          return rgba(getComputedStyle(document.documentElement).backgroundColor);
        };
        const name = (el: Element) =>
          `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].join('.') : ''}`;
        const out: Drawing[] = [];
        const dark = [
          ...document.querySelectorAll("[data-ground='inverse'], [data-ground='accent']"),
        ].filter((g) => g.getClientRects().length > 0);
        for (const g of dark) {
          const gc = groundOf(g);
          const kind = `${g.getAttribute('data-ground')} ${name(g)}`;
          const els = [g, ...g.querySelectorAll('*')].filter(
            (el) => el.closest('[data-ground]') === g && el.getClientRects().length > 0,
          );
          for (const el of els) {
            const r = el.getBoundingClientRect();
            for (const pseudo of ['', '::before', '::after']) {
              const s = getComputedStyle(el, pseudo || null);
              if (pseudo && (s.content === 'none' || s.content === 'normal')) continue;
              if (s.visibility === 'hidden' || s.display === 'none') continue;
              const add = (prop: string, colour: string, width = 0) => {
                const k = rgba(colour);
                if (!pseudo && el !== g && !el.hasAttribute('data-l1-dw')) {
                  const w = window as unknown as { l1dw?: number };
                  w.l1dw = (w.l1dw ?? 0) + 1;
                  el.setAttribute('data-l1-dw', String(w.l1dw));
                }
                out.push({
                  ground: kind,
                  groundRgb: [gc[0]!, gc[1]!, gc[2]!],
                  where: `${name(el)}${pseudo}`,
                  pseudo: !!pseudo,
                  prop,
                  colour,
                  computed: k[3]! > 0 ? ratio(k, gc) : null,
                  box: [r.x, r.y, r.width, r.height],
                  width,
                  dw: !pseudo && el !== g ? el.getAttribute('data-l1-dw') : null,
                });
              };
              for (const side of ['top', 'right', 'bottom', 'left']) {
                const w = parseFloat(s.getPropertyValue(`border-${side}-width`));
                const st = s.getPropertyValue(`border-${side}-style`);
                if (w > 0 && st !== 'none' && st !== 'hidden')
                  add(`border-${side}`, s.getPropertyValue(`border-${side}-color`), w);
              }
              if (el !== g || pseudo) {
                if (rgba(s.backgroundColor)[3]! > 0) add('background-color', s.backgroundColor);
              }
              if (s.backgroundImage !== 'none')
                add(
                  `background-image ${s.backgroundImage.slice(0, 60)}`,
                  'transparent',
                  parseFloat(s.backgroundSize.split(' ')[1] ?? '1') || 1,
                );
              if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0)
                add('outline', s.outlineColor, parseFloat(s.outlineWidth));
              if (!pseudo && s.textDecorationLine !== 'none' && (el.textContent ?? '').trim())
                add('text-decoration', s.textDecorationColor);
            }
          }
        }
        return out;
      });
      for (const d of read) {
        const region = d.pseudo ? null : regionOf(d);
        const how = d.prop === 'background-color' ? 'median' : 'max';
        const px = region ? regionRatio(view, region, d.groundRgb, how) : null;
        const key = `${d.ground}|${d.where}|${d.prop}|${d.colour}|${d.groundRgb.join(',')}`;
        const had = seen.get(key);
        if (had) {
          had.views.push(v);
          if (px !== null) had.pixels = Math.max(had.pixels ?? 0, px);
        } else seen.set(key, { d, pixels: px, views: [v] });
      }
    }
    const drawings = [...seen.values()];
    const lowDrawings: string[] = [];
    for (const { d, pixels, views } of drawings) {
      const judged = pixels ?? d.computed;
      const low = judged !== null && judged < DRAWING;
      const line = `region ${low ? 'low' : judged === null ? 'n/a' : 'ok'} pixels ${pixels === null ? '-' : pixels.toFixed(2)} computed ${d.computed ?? '-'} | ${d.ground} on rgb(${d.groundRgb.join(',')}) | ${d.where} | ${d.prop} ${d.colour} | views ${views.join(',')}`;
      say(line);
      if (low) lowDrawings.push(line);
    }
    say(
      `drawings ${drawings.length} on dark grounds over ${panels} dark panels, ${drawings.filter((x) => x.pixels !== null).length} read in pixels, ${lowDrawings.length} under ${DRAWING}:1`,
    );

    // Rings: every focusable on a dark ground, from the keyboard, in pixels.
    const count = await page.evaluate(() => {
      const list = [
        ...document.querySelectorAll(
          "a[href], button, summary, input, select, textarea, [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((el) =>
        ['inverse', 'accent'].includes(
          el.closest('[data-ground]')?.getAttribute('data-ground') ?? '',
        ),
      );
      list.forEach((el, i) => el.setAttribute('data-l1-focus', String(i)));
      return list.length;
    });
    const lowRings: string[] = [];
    let shots = 0;
    let unread = 0;
    for (let i = 0; i < count; i += 1) {
      const el = page.locator(`[data-l1-focus='${i}']`);
      if (!(await el.evaluate((e) => e.getClientRects().length > 0))) {
        say(`ring ${i} not shown`);
        continue;
      }
      await el.focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await settle(page);
      const r = await el.evaluate((e) => {
        const g = e.closest('[data-ground]');
        const s = getComputedStyle(e);
        const b = getComputedStyle(e, '::before');
        const box = e.getBoundingClientRect();
        const ring: string[] = [];
        let reach = 2;
        if (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) {
          ring.push(`outline ${s.outlineWidth} ${s.outlineColor} offset ${s.outlineOffset}`);
          reach = Math.max(
            reach,
            parseFloat(s.outlineWidth) + Math.abs(parseFloat(s.outlineOffset) || 0),
          );
        }
        if (b.content !== 'none' && b.content !== 'normal' && parseFloat(b.borderTopWidth) > 0) {
          ring.push(`::before ${b.borderTopWidth} ${b.borderTopColor} inset ${b.top}`);
          reach = Math.max(reach, Math.abs(parseFloat(b.top) || 0) + parseFloat(b.borderTopWidth));
        }
        return {
          focusVisible: e.matches(':focus-visible'),
          active: document.activeElement === e,
          what: `${e.tagName.toLowerCase()}${e.classList.length ? '.' + [...e.classList].join('.') : ''}${e.hasAttribute('data-ui-slot') ? `[slot=${e.getAttribute('data-ui-slot')}]` : ''}`,
          ground: `${g?.getAttribute('data-ground')} ${g?.tagName.toLowerCase()}.${[...(g?.classList ?? [])].join('.')}${g?.hasAttribute('data-ui-surface') ? `[surface=${g.getAttribute('data-ui-surface')}]` : ''}`,
          ring,
          reach: Math.ceil(reach) + 1,
          box: [box.x, box.y, box.width, box.height] as [number, number, number, number],
        };
      });
      const [x, y, w, h] = r.box;
      const pad = r.reach + 4;
      const x0 = Math.max(0, Math.floor(x - pad));
      const y0 = Math.max(0, Math.floor(y - pad));
      const clip = {
        x: x0,
        y: y0,
        width: Math.min(c.width, Math.ceil(x + w + pad)) - x0,
        height: Math.min(height, Math.ceil(y + h + pad)) - y0,
      };
      if (clip.width <= 0 || clip.height <= 0 || !r.active) {
        say(`ring ${i} ${r.what}: ${r.active ? 'outside the view' : 'focus went elsewhere'}`);
        unread += 1;
        continue;
      }
      const focusedPng = await page.screenshot({
        clip,
        animations: 'disabled',
        caret: 'hide',
      });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await settle(page);
      const restPng = await page.screenshot({
        clip,
        animations: 'disabled',
        caret: 'hide',
      });
      const sides = ringRead(
        decodePng(focusedPng),
        decodePng(restPng),
        [x - x0, y - y0, w, h],
        r.reach,
      );
      const known = sides.filter((s): s is number => s !== null);
      const ratio = known.length ? Math.min(...known) : null;
      const low = !r.focusVisible || ratio === null || ratio < DRAWING;
      const line = `ring ${i} ${low ? 'LOW' : 'ok'} ${ratio === null ? '-' : ratio.toFixed(2)}:1 sides t/r/b/l ${sides.map((s) => (s === null ? '-' : s.toFixed(2))).join('/')} ${r.focusVisible ? '' : 'NOT focus-visible '}| ${r.what} on ${r.ground} | ${r.ring.join('; ') || 'no ring declared'}`;
      say(line);
      if (low) lowRings.push(line);
      if (shots < 4 || low) {
        shots += 1;
        writeFileSync(path.join(dir, `ring${i}-focused.png`), focusedPng);
        writeFileSync(path.join(dir, `ring${i}-rest.png`), restPng);
      }
    }
    say(
      `rings ${count} focusables on dark grounds, ${lowRings.length} under ${DRAWING}:1 or not focus-visible, ${unread} not read (outside the view, or focus went elsewhere)`,
    );

    // The canvas ground's rules drawn as a background image: do they paint?
    for (const sel of ['.sg-rec', '.sg-colophon__in']) {
      const n = await page.locator(sel).count();
      for (let i = 0; i < Math.min(n, 2); i += 1) {
        const el = page.locator(sel).nth(i);
        if (!(await el.evaluate((e) => e.getClientRects().length > 0))) continue;
        await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
        await settle(page);
        const info = await el.evaluate((e) => {
          const s = getComputedStyle(e);
          const b = e.getBoundingClientRect();
          return {
            image: s.backgroundImage.slice(0, 80),
            box: [b.x, b.y, b.width, b.height] as [number, number, number, number],
          };
        });
        const png = await page.screenshot({
          animations: 'disabled',
          caret: 'hide',
        });
        const name = `rule-${sel.slice(1)}-${i}.png`;
        writeFileSync(path.join(dir, name), png);
        const image = decodePng(png);
        const [bx, by, bw] = info.box;
        const ground = at(image, bx + bw / 2, by + 8);
        const ratio = ground
          ? regionRatio(image, [bx + bw * 0.3, by - 1, bx + bw * 0.7, by + 3], ground, 'max')
          : null;
        say(
          `rule ${sel} ${i} ${ratio === null ? 'outside the view' : ratio >= 1.5 ? 'paints' : 'ABSENT'} ${ratio === null ? '-' : ratio.toFixed(2)}:1 against rgb(${ground?.join(',') ?? '-'}) | computed background-image ${info.image} | ${name}`,
        );
      }
    }
    // The shared drawings judge (forced-backplate's drawingsAmong), last, since it hides the page's
    // words for good: each part with a drawing on a dark ground, shot as it paints and hidden.
    const marked = new Map<string, string>();
    for (const { d } of drawings)
      if (d.dw && !marked.has(d.dw)) marked.set(d.dw, `${d.where} on ${d.ground}`);
    const selectors = [...marked.keys()].map((k) => `[data-l1-dw='${k}']`);
    const judge = await drawingsAmong(page, selectors);
    const whose = (l: string) => marked.get(/data-l1-dw='(\d+)'/.exec(l)?.[1] ?? '') ?? '?';
    const unseen = judge.lost.filter((l) => l.endsWith('outside the viewport'));
    const judgeLost = judge.lost
      .filter((l) => !l.endsWith('outside the viewport'))
      .map((l) => `${whose(l)}: ${l}`);
    for (const l of judgeLost) say(`judge LOST ${l}`);
    for (const l of unseen) say(`judge unjudged ${whose(l)}: ${l}`);
    say(
      `judge drawingsAmong: ${selectors.length} parts with a drawing on a dark ground, ${judge.judged} judged, ${judgeLost.length} under ${DRAWING_RATIO}:1, ${unseen.length} outside the viewport`,
    );
    writeFileSync(path.join(dir, `read-${ROW}.txt`), `${lines.join('\n')}\n`);
    if (FORCED) {
      expect
        .soft(judgeLost, 'every part drawing on a dark ground reaches 3:1 on it (drawingsAmong)')
        .toEqual([]);
      expect
        .soft(lowRings, 'every ring on a dark ground reaches 3:1 from the keyboard')
        .toEqual([]);
    }
  });
