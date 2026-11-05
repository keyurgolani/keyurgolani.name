// Unit tests for the accessibility suites' pure parts (#11, Slice 2): the
// PNG decoder and contrast math the focus and contrast checks use, the
// compiled-CSS audit, the reduced-motion rules, the checks each row and
// viewport owe, the high-contrast row's emulation, and the skill recipes,
// which must teach no kill switch the audit would fail.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { REPO_ROOT } from '../../quality/thresholds';
import {
  BATCH_GAP,
  batchConflict,
  batches,
  CONTRAST_RULE,
  cutShots,
  shotRect,
  ENHANCED_CONTRAST_RULE,
  dilate,
  framedItems,
  GLYPH_COVERAGE,
  glyphHalo,
  glyphMask,
  HALO,
  incompleteContrastFindings,
  incompleteContrastNodes,
  inFrame,
  inkScript,
  inkUnresolved,
  insideQuad,
  NEIGHBOUR_MARGIN,
  neededRatio,
  neighbourTexts,
  reaches,
  stillnessScript,
  worstRatio,
} from './lib/a11y/contrast';
import { stuckCoverScript } from './lib/a11y/covers';
import {
  centreLineChange,
  clipAround,
  fragmentsLength,
  ringCentreLine,
  ringFindings,
  ringLength,
  roundedRingLength,
} from './lib/a11y/interaction';
import { animationFindings, killSwitches } from './lib/a11y/motion';
import { requiredChecks } from './lib/checks';
import { displayModeProblems } from './lib/emulation';
import { PREFERENCE_ROWS, VIEWPORTS } from './lib/matrix';
import { contrast, decodePng, parseCssColor, pixel } from './lib/pixels';
import { axeRunOptions, rowIsHighContrast, type AxeRunOptions } from './lib/run-cell';
import { PREFERENCE_MODES } from './lib/vocabulary';

/** An RGB PNG of `rows`, each a list of [r, g, b], as a screenshot would be. */
function png(rows: readonly (readonly [number, number, number])[][]): Buffer {
  const image = new PNG({ width: rows[0]!.length, height: rows.length });
  rows.flat().forEach(([r, g, b], i) => image.data.set([r, g, b, 255], i * 4));
  return PNG.sync.write(image);
}

const RED = [200, 10, 30] as const;
const TEAL = [10, 140, 150] as const;

test('screenshots decode to the pixels they hold', () => {
  const rows = Array.from({ length: 5 }, (_, y) =>
    Array.from(
      { length: 3 },
      (_, x) => ((x + y) % 2 ? RED : TEAL) as readonly [number, number, number],
    ),
  );
  const image = decodePng(png(rows));
  assert.equal(image.width, 3);
  assert.equal(image.height, 5);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) assert.deepEqual(pixel(image, y * 3 + x), [...rows[y]![x]!]);
  }
  assert.throws(() => decodePng(Buffer.from('not a png')));
});

test("contrast is WCAG 2's, and computed colors parse with their alpha", () => {
  assert.equal(contrast([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(contrast([119, 119, 119], [119, 119, 119]), 1);
  assert.ok(Math.abs(contrast([118, 118, 118], [255, 255, 255]) - 4.54) < 0.01);
  assert.deepEqual(parseCssColor('rgb(1, 2, 3)'), { rgb: [1, 2, 3], alpha: 1 });
  assert.deepEqual(parseCssColor('rgba(1, 2, 3, 0.5)'), { rgb: [1, 2, 3], alpha: 0.5 });
  assert.deepEqual(parseCssColor('rgb(1 2 3 / 25%)'), { rgb: [1, 2, 3], alpha: 0.25 });
  assert.equal(parseCssColor('color(display-p3 1 0 0)'), null);
});

test('an Oklab, OKLCh or sRGB color() text color, as Chromium computes a color-mix(), parses to the sRGB it paints', () => {
  // Kinetic Cosmos's plate summary, a color-mix() the sampler once left unread.
  const summary = parseCssColor('oklab(0.784675 0.00358342 0.0225521)')!;
  assert.equal(summary.alpha, 1);
  assert.ok(summary.rgb.every((value, at) => Math.abs(value - [195, 186, 172][at]!) <= 3));
  assert.deepEqual(parseCssColor('oklab(1 0 0)'), { rgb: [255, 255, 255], alpha: 1 });
  assert.deepEqual(parseCssColor('oklab(0 0 0 / 0.5)'), { rgb: [0, 0, 0], alpha: 0.5 });
  // OKLCh's red, and the same in Oklab, agree.
  assert.deepEqual(
    parseCssColor('oklch(0.627955 0.257683 29.2339)'),
    parseCssColor('oklab(0.627955 0.224863 0.125846)'),
  );
  assert.deepEqual(parseCssColor('oklch(0.627955 0.257683 29.2339)')!.rgb, [255, 0, 0]);
  assert.deepEqual(parseCssColor('color(srgb 1 0.5 0 / 25%)'), { rgb: [255, 128, 0], alpha: 0.25 });
  assert.equal(parseCssColor('color(rec2020 1 0 0)'), null);
  assert.equal(parseCssColor('oklab(0.5 0.1)'), null);
  // And text in one still fails against a background its own color.
  assert.ok(worstRatio(png([[[195, 186, 172]]]), 'oklab(0.784675 0.00358342 0.0225521)')! < 1.1);
});

test('text over a background is held to the worst pixel, at the large-text size or the normal one', () => {
  const band = png([
    [
      [255, 255, 255],
      [138, 138, 138],
    ],
  ]);
  assert.ok(worstRatio(band, 'rgb(106, 106, 106)')! < 2);
  assert.ok(worstRatio(band, 'rgb(17, 17, 17)')! > 5);
  // Half-transparent black over white reads as mid-gray.
  assert.ok(Math.abs(worstRatio(png([[[255, 255, 255]]]), 'rgba(0, 0, 0, 0.5)')! - 3.95) < 0.05);
  assert.deepEqual(neededRatio(16, 400), { rule: 'text', ratio: 4.5 });
  assert.deepEqual(neededRatio(24, 400), { rule: 'large-text', ratio: 3 });
  assert.deepEqual(neededRatio(18.67, 700), { rule: 'large-text', ratio: 3 });
  assert.deepEqual(neededRatio(18.67, 400), { rule: 'text', ratio: 4.5 });
  assert.deepEqual(neededRatio(16, 400, 'normal'), { rule: 'text', ratio: 4.5 });
});

test("under high contrast, text is held to thresholds.json's highContrast ratios, 7 and 4.5 at large size", () => {
  assert.deepEqual(neededRatio(16, 400, 'high-contrast'), { rule: 'high-contrast-text', ratio: 7 });
  assert.deepEqual(neededRatio(24, 400, 'high-contrast'), {
    rule: 'high-contrast-large-text',
    ratio: 4.5,
  });
  assert.deepEqual(neededRatio(18.67, 700, 'high-contrast'), {
    rule: 'high-contrast-large-text',
    ratio: 4.5,
  });
  assert.deepEqual(neededRatio(18.67, 400, 'high-contrast'), {
    rule: 'high-contrast-text',
    ratio: 7,
  });
});

test("a neighbour's glyph at the sampled box's edge is hidden with it, as an en dash before a date, and a backdrop or a faint date still fails", () => {
  // The date's content box, and the en dash's line box right before it: no side bearing, so it
  // ends where the date begins, and its antialiased edge lands in the date's first column.
  const date = { x: 100, y: 10, width: 40, height: 18 };
  const dash = { x: 88, y: 10, width: 12, height: 18 };
  assert.equal(NEIGHBOUR_MARGIN, 2);
  // On the same line: touching, or overlapping or short by less than the margin, is the edge.
  assert.equal(reaches(dash, date), true, 'touching at the edge');
  assert.equal(reaches({ ...dash, x: 87 }, date), true, 'a pixel short');
  assert.equal(reaches({ ...dash, x: 90 }, date), true, 'overlapping by the margin');
  assert.equal(reaches({ ...dash, x: 86 }, date), false, 'the margin short');
  assert.equal(reaches({ ...dash, x: 80 }, date), false, 'further away');
  assert.equal(reaches({ ...dash, x: 91 }, date), false, 'overlapping past the margin');
  assert.equal(reaches({ ...dash, x: 140 }, date), true, 'touching the far edge');
  assert.equal(reaches({ ...dash, x: 129 }, date), false, 'past the margin at the far edge');
  // The line above or below: overlapping down by the margin or less.
  assert.equal(reaches({ ...date, y: -6 }, date), true, 'the line above, overlapping by 2');
  assert.equal(reaches({ ...date, y: -5 }, date), false, 'the line above, overlapping by 3');
  assert.equal(reaches({ ...date, y: -6, x: 200 }, date), false, 'the line above, off to the side');
  assert.equal(reaches({ ...date, y: 26 }, date), true, 'the line below, overlapping by 2');
  assert.equal(reaches({ ...date, y: 40 }, date), false, 'the next line, apart');
  // Text that covers the box, or sits over it, is its backdrop, not an edge.
  assert.equal(reaches({ x: 60, y: -20, width: 200, height: 80 }, date), false, 'a full cover');
  assert.equal(reaches(date, date), false, 'the same box');
  // An empty line box paints nothing, even one right at the edge.
  assert.equal(reaches({ ...dash, x: 100, width: 0 }, date), false, 'no width');
  assert.equal(reaches({ ...dash, height: 0 }, date), false, 'no height');
  // Only the in-flow texts at the edge, by index, among every text the page found near it.
  const inFlow = (...rects: { x: number; y: number; width: number; height: number }[]) => ({
    rects,
    outOfFlow: false,
  });
  assert.deepEqual(
    neighbourTexts(
      [
        inFlow({ ...date, x: 20, width: 60 }),
        inFlow(dash),
        inFlow(),
        inFlow({ ...date, y: 40 }, { ...dash, x: 60, width: 41 }),
        // A big numeral behind it, in flow or out of it, stays: it's the backdrop.
        inFlow({ x: 60, y: -20, width: 200, height: 80 }),
        // Out of flow, even at the edge, stays too.
        { rects: [dash], outOfFlow: true },
      ],
      date,
    ),
    [1, 3],
  );
  // Why: the dash's edge, a light column inside the date's dark box, takes the light date to
  // about 1:1, and with it hidden the date reads far over 4.5:1.
  const dark = [10, 10, 10] as const;
  const edge = [200, 200, 200] as const;
  const box = (first: readonly [number, number, number]) =>
    png(Array.from({ length: 3 }, () => [first, dark, dark, dark]));
  assert.ok(worstRatio(box(edge), 'rgb(232, 232, 232)')! < 1.5);
  assert.ok(worstRatio(box(dark), 'rgb(232, 232, 232)')! > 4.5);
  // A faint date over the same dark box still fails, dash or none.
  assert.ok(worstRatio(box(dark), 'rgb(58, 58, 58)')! < 2);
});

test('the audit finds a universal !important motion kill switch, inside at-rules too, and nothing else', () => {
  const found = killSwitches(`
    /* * { animation: none !important; } in a comment */
    *, *::before, *::after { box-sizing: border-box; }
    @layer variant-layout {
      @media (prefers-reduced-motion: reduce) {
        [data-variant='acme'] *, [data-variant='acme'] *::after { animation: none !important; transition: none !important; }
      }
    }
    [data-variant='acme'] *:before { transition-duration: 0s !important; }
    .card { transition: none !important; }
    [data-variant='acme'] * { animation: none; }
    @import url('x.css');
    * { scroll-behavior: auto !important; }
  `);
  assert.deepEqual(found, [
    {
      selector: "[data-variant='acme'] *, [data-variant='acme'] *::after",
      declaration: 'animation: none !important',
    },
    {
      selector: "[data-variant='acme'] *, [data-variant='acme'] *::after",
      declaration: 'transition: none !important',
    },
    {
      selector: "[data-variant='acme'] *:before",
      declaration: 'transition-duration: 0s !important',
    },
  ]);
});

test('no CSS recipe in the skills teaches a kill switch the audit fails', () => {
  const dir = path.join(REPO_ROOT, 'skills');
  const docs = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((file) =>
    file.endsWith('.md'),
  );
  assert.ok(docs.length > 0);
  for (const file of docs) {
    const text = readFileSync(path.join(dir, file), 'utf8');
    for (const [, css] of text.matchAll(/```css\n([\s\S]*?)```/g)) {
      assert.deepEqual(killSwitches(css!), [], file);
    }
  }
});

test("a skill recipe that stops motion under the boundary's data-motion stops it under the site's reduce policy and a visitor's pause both", () => {
  // Every boundary renders the site's reduce policy as data-motion="reduced"
  // and a pause as data-motion="static" (#19, Slice 4).
  const dir = path.join(REPO_ROOT, 'skills');
  let keyed = 0;
  for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.md')) continue;
    const text = readFileSync(path.join(dir, file), 'utf8');
    for (const [, css] of text.matchAll(/```css\n([\s\S]*?)```/g)) {
      for (const [, selector] of css!.matchAll(/(?:^|\})([^{}]*)\{/g)) {
        if (!/\[data-motion=/.test(selector!)) continue;
        keyed += 1;
        assert.match(selector!, /\[data-motion='reduced'\]/, `${file}: ${selector!.trim()}`);
        assert.match(selector!, /\[data-motion='static'\]/, `${file}: ${selector!.trim()}`);
      }
    }
  }
  assert.ok(keyed > 0, 'a recipe keys on data-motion');
});

test('reduced motion allows short opacity and color changes, and no movement or long or endless motion', () => {
  const at = (properties: string[], duration: number, infinite = false) => ({
    kind: 'CSSTransition',
    name: 'a',
    properties,
    duration,
    infinite,
  });
  assert.deepEqual(
    animationFindings([at(['opacity'], 150), at(['color'], 200), at(['transform'], 0)]),
    [],
  );
  const rules = (each: ReturnType<typeof at>) => animationFindings([each]).map((f) => f.actual);
  assert.match(rules(at(['transform'], 100))[0]!, /moves transform/);
  assert.match(rules(at(['marginLeft'], 100))[0]!, /moves marginLeft/);
  assert.match(rules(at(['background-position'], 100))[0]!, /moves background-position/);
  assert.match(rules(at(['opacity'], 250))[0]!, /runs 250 ms/);
  assert.match(rules(at(['opacity'], 100, true))[0]!, /runs forever/);
});

test('each row owes its suites, and the default row its conditions at the first and the phone viewports', () => {
  const [desktop, , phone] = VIEWPORTS;
  const owed = (row: string, viewport = desktop!.id) => new Set(requiredChecks(row, viewport));
  for (const check of [
    'axe',
    'contrast',
    'keyboard',
    'focus',
    'occlusion',
    'overlays',
    'hover',
    'reflow',
    'inventory',
    'enhancement',
  ]) {
    assert.ok(owed('default').has(check), check);
  }
  assert.ok(!owed('default', VIEWPORTS[1]!.id).has('reflow'));
  assert.ok(owed('default', phone!.id).has('landscape-occlusion'));
  assert.ok(!owed('default', phone!.id).has('hover'), 'a phone has no hover to compare');
  assert.ok(owed('reduced-motion').has('motion'));
  assert.ok(owed('forced-colors').has('focus'));
  assert.ok(owed('reduced-transparency').has('transparency'));
  assert.ok(owed('print').has('inventory'));
  assert.ok(owed('no-javascript').has('keyboard'));
});

test('every preference mode has its row, and the high-contrast row fails when no boundary renders the mode', () => {
  assert.deepEqual(
    PREFERENCE_ROWS.map((row) => row.id),
    [...PREFERENCE_MODES],
  );
  const row = PREFERENCE_ROWS.find((each) => each.id === 'high-contrast')!;
  assert.deepEqual(displayModeProblems(row, ['high-contrast']), []);
  assert.match(displayModeProblems(row, [])[0]!, /no presentation boundary .* ignored$/);
  assert.match(
    displayModeProblems(row, ['light'])[0]!,
    /renders light, not high-contrast: .* ignored$/,
  );
  assert.deepEqual(displayModeProblems(PREFERENCE_ROWS[0]!, []), []);
});

test("on a framed surface, the sampler leaves out only the incomplete items axe names inside a frame, before it samples any; without it, a frame's item says it's inside a frame", async () => {
  const top = { target: ['main .studio-content p'] };
  const framed = { target: ['iframe', '.ee-plate__label'] };
  const results = {
    incomplete: [{ id: 'color-contrast', nodes: [top, framed] }],
  } as unknown as Parameters<typeof incompleteContrastFindings>[1];
  assert.deepEqual([top, framed].map(inFrame), [false, true]);
  assert.equal(framedItems(results), 1);
  // A page whose every element has no box (though it holds still), recording what the sampler looked up.
  const looked: string[] = [];
  const page = {
    evaluate: async () => undefined,
    locator: (selector: string) => {
      looked.push(selector);
      const element = {
        scrollIntoViewIfNeeded: async () => undefined,
        evaluate: async (script: { name: string }) => {
          if (script.name === stillnessScript.name) return null;
          throw new Error('no element');
        },
      };
      return { first: () => element };
    },
  } as unknown as Parameters<typeof incompleteContrastFindings>[0];
  const unflagged = await incompleteContrastFindings(page, results);
  assert.deepEqual(
    unflagged.map(({ path, actual }) => [path, actual]),
    [
      ['main .studio-content p', 'it has no box in the viewport to sample'],
      [undefined, "axe named it inside a frame or shadow root, which the sampler can't reach"],
    ],
  );
  looked.length = 0;
  const flagged = await incompleteContrastFindings(page, results, true);
  assert.deepEqual(
    flagged.map(({ path }) => path),
    ['main .studio-content p'],
  );
  assert.deepEqual(looked, ['main .studio-content p'], 'nothing samples the frame item');
});

test('the sampler fails closed when its wait for an element to come to rest fails: the element is unresolved, never sampled', async () => {
  const results = {
    incomplete: [{ id: 'color-contrast', nodes: [{ target: ['main p'] }] }],
  } as unknown as Parameters<typeof incompleteContrastFindings>[1];
  let sampled = false;
  const page = {
    evaluate: async () => undefined,
    screenshot: async () => {
      sampled = true;
      throw new Error('no shot');
    },
    locator: () => {
      const element = {
        scrollIntoViewIfNeeded: async () => undefined,
        // Nothing covers it, and the wait itself throws, as when the element is detached mid-wait.
        evaluate: async (script: { name: string }) => {
          if (script.name === stillnessScript.name) throw new Error('detached');
          return null;
        },
      };
      return { first: () => element };
    },
  } as unknown as Parameters<typeof incompleteContrastFindings>[0];
  const findings = await incompleteContrastFindings(page, results);
  assert.deepEqual(
    findings.map(({ path, actual }) => [path, actual]),
    [
      [
        'main p',
        'unresolved: the wait for what moves it to come to rest failed (detached), so it was never seen at rest to sample',
      ],
    ],
  );
  assert.equal(sampled, false, 'a node the wait never saw at rest is not shot');
});

/** A white `width` by `height` image, as a blurred clip, with `ink` painted black, as its focused one. */
function canvas(
  width: number,
  height: number,
  ink: (x: number, y: number) => boolean = () => false,
) {
  const data = new Uint8Array(width * height * 4).fill(255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (ink(x, y)) data.set([0, 0, 0, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/**
 * The clips of `box` in `viewport`, the focused one with a ring `offset` px
 * out from the box, each side as many px wide as `sides` gives it.
 */
function ringClips(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  sides: { top: number; right: number; bottom: number; left: number },
  offset = 2,
) {
  const margin = 5;
  const clip = clipAround(box, margin, viewport)!;
  const left = box.x - clip.x - offset;
  const top = box.y - clip.y - offset;
  const right = box.x + box.width - clip.x + offset;
  const bottom = box.y + box.height - clip.y + offset;
  const inside = (x: number, y: number) =>
    x >= left - 2 && x < right + 2 && y >= top - 2 && y < bottom + 2;
  const focused = canvas(
    clip.width,
    clip.height,
    (x, y) =>
      inside(x, y) &&
      ((y < top && y >= top - sides.top) ||
        (y >= bottom && y < bottom + sides.bottom) ||
        (x < left && x >= left - sides.left) ||
        (x >= right && x < right + sides.right)),
  );
  return { focused, blurred: canvas(clip.width, clip.height), margin, clip };
}

const rules = (findings: readonly { rule: string }[]) => findings.map(({ rule }) => rule);

test("a stop's ring length counts each side by the span of it the viewport shows (#11)", () => {
  // In view: every side, whole.
  assert.equal(
    ringLength({ x: 10, y: 10, width: 100, height: 40 }, 5, { width: 200, height: 200 }),
    280,
  );
  // Cut by the bottom edge: the top, and the 28px of each side above the fold. No bottom.
  assert.equal(
    ringLength({ x: 20, y: 740, width: 100, height: 60 }, 5, { width: 200, height: 768 }),
    156,
  );
  // Cut by the left edge too: the 70px of the top in view, and no left side.
  assert.equal(
    ringLength({ x: -30, y: 740, width: 100, height: 60 }, 5, { width: 200, height: 768 }),
    98,
  );
});

test('a stop cut by the bottom edge passes with a 2px ring on what shows, and fails when a side it shows has 1px (#11)', () => {
  const box = { x: 20, y: 30, width: 40, height: 300 };
  const viewport = { width: 200, height: 200 };
  const whole = ringClips(box, viewport, { top: 2, right: 2, bottom: 2, left: 2 });
  assert.deepEqual(
    ringFindings(whole.focused, whole.blurred, box, whole.margin, viewport, whole.clip),
    [],
  );
  const thin = ringClips(box, viewport, { top: 2, right: 1, bottom: 2, left: 2 });
  assert.deepEqual(
    rules(ringFindings(thin.focused, thin.blurred, box, thin.margin, viewport, thin.clip)),
    ['perimeter'],
  );
});

test('a 1px ring round a stop in view, as the thin-indicator case draws, still fails the perimeter (#11)', () => {
  const box = { x: 40, y: 40, width: 60, height: 24 };
  const viewport = { width: 200, height: 200 };
  const thin = ringClips(box, viewport, { top: 1, right: 1, bottom: 1, left: 1 }, 3);
  assert.deepEqual(
    rules(ringFindings(thin.focused, thin.blurred, box, thin.margin, viewport, thin.clip)),
    ['perimeter'],
  );
  const none = ringClips(box, viewport, { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(
    rules(ringFindings(none.focused, none.blurred, box, none.margin, viewport, none.clip)),
    ['visible'],
  );
});

test("a wrapped stop's ring is one outline round its consecutive lines, and each line's own round lines apart", () => {
  const viewport = { width: 400, height: 400 };
  // Two lines, the second shorter, touching: 2 * (100 + 20) + 2 * (60 + 20), less the 60px
  // edge they share, on both, which one outline round them doesn't draw.
  const lines = [
    { x: 10, y: 10, width: 100, height: 20 },
    { x: 10, y: 30, width: 60, height: 20 },
  ];
  assert.equal(fragmentsLength(lines, 5, viewport), 240 + 160 - 120);
  // Consecutive lines with leading between them, a 6px gap: one outline across it, as if they
  // touched.
  const leading = [lines[0]!, { ...lines[1]!, y: 36 }];
  assert.equal(fragmentsLength(leading, 5, viewport), 2 * (100 + 46));
  // Lines a line or more apart are rung apart, every edge counted.
  const apart = [lines[0]!, { ...lines[1]!, y: 50 }];
  assert.equal(fragmentsLength(apart, 5, viewport), 400);
  // And a 1px ring round the one outline still fails its perimeter.
  const box = { x: 10, y: 10, width: 100, height: 40 };
  const thin = ringClips(box, viewport, { top: 1, right: 1, bottom: 1, left: 1 });
  assert.deepEqual(
    rules(
      ringFindings(
        thin.focused,
        thin.blurred,
        box,
        thin.margin,
        viewport,
        thin.clip,
        undefined,
        lines,
      ),
    ),
    ['perimeter'],
  );
});

test("a rounded stop's ring is held to its own path, edges plus corner arcs at radius plus offset, exactly, and a square one to its box", () => {
  const box = { x: 40, y: 40, width: 100, height: 40 };
  const viewport = { width: 200, height: 200 };
  // 8px corners and a 2px offset: the path is 104 by 44, each corner rounded at 10px.
  const rounded = {
    corners: [
      [8, 8],
      [8, 8],
      [8, 8],
      [8, 8],
    ] as [number, number][],
    offset: 2,
  };
  const edges = 2 * (104 - 10 - 10) + 2 * (44 - 10 - 10);
  const arcs = 4 * ((Math.PI * 10) / 2);
  assert.equal(roundedRingLength(box, rounded), edges + arcs);
  // One rounded corner, the rest square: three square corners keep their full edges.
  const one = {
    corners: [
      [8, 8],
      [0, 0],
      [0, 0],
      [0, 0],
    ] as [number, number][],
    offset: 2,
  };
  assert.equal(roundedRingLength(box, one), 2 * 104 + 2 * 44 - 2 * 10 + (Math.PI * 10) / 2);
  // A thin ring fails either way, each against its own expectation: the box's 2 * (100 + 40) for
  // the square, the path's for the rounded one.
  const thin = ringClips(box, viewport, { top: 1, right: 1, bottom: 1, left: 1 });
  const expected = (rounding?: { corners: [number, number][]; offset: number }) =>
    ringFindings(
      thin.focused,
      thin.blurred,
      box,
      thin.margin,
      viewport,
      thin.clip,
      undefined,
      undefined,
      rounding,
    ).map((finding) => finding.expected);
  assert.deepEqual(expected(), ['560 pixels at 3:1, a 2px ring']);
  assert.deepEqual(expected(rounded), [
    `${Math.round(2 * (edges + arcs))} pixels at 3:1, a 2px ring`,
  ]);
});

test("a pill's radii are scaled as CSS scales them, all four by one factor, not clamped corner by corner", () => {
  // 80 by 24 at 999px: the factor is 24 / 1998, so every corner is 12px round, a true pill; set
  // out 2px, 14px round a box 84 by 28. Clamped one by one, each corner would be 40 by 12, an
  // ellipse shorter than the pill.
  const pill = { x: 40, y: 40, width: 80, height: 24 };
  const corners = [
    [999, 999],
    [999, 999],
    [999, 999],
    [999, 999],
  ] as [number, number][];
  const close = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
  close(roundedRingLength(pill, { corners, offset: 0 }), 2 * (80 - 24) + 2 * Math.PI * 12);
  close(roundedRingLength(pill, { corners, offset: 2 }), 2 * (84 - 28) + 2 * Math.PI * 14);
  const clamped = [
    [40, 12],
    [40, 12],
    [40, 12],
    [40, 12],
  ] as [number, number][];
  assert.ok(
    roundedRingLength(pill, { corners: clamped, offset: 0 }) < 2 * (80 - 24) + 2 * Math.PI * 12,
  );
});

/**
 * The clips of a pill `box`, the focused one with an outline `width` px wide `offset` px out from
 * it in `ink` over white, antialiased as a browser draws it: each pixel takes the share of its
 * 4 by 4 samples inside the ring. `shows` is what an ancestor's overflow leaves of it.
 */
function pillClips(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
  {
    width,
    offset = 2,
    ink = [0, 0, 0],
    shows = () => true,
    clipAt = Infinity,
  }: {
    width: number;
    offset?: number;
    ink?: readonly [number, number, number];
    shows?: (x: number, y: number) => boolean;
    /** An ancestor's clip all round, this far out from the box: nothing of the ring past it shows. */
    clipAt?: number;
  },
) {
  const margin = Math.ceil(offset + width) + 1;
  const clip = clipAround(box, margin, viewport)!;
  const radius = Math.min(box.width, box.height) / 2;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // How far a point is outside the pill's border box (negative inside).
  const outside = (x: number, y: number) => {
    const qx = Math.abs(x - cx) - (box.width / 2 - radius);
    const qy = Math.abs(y - cy) - (box.height / 2 - radius);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  };
  const data = new Uint8Array(clip.width * clip.height * 4).fill(255);
  for (let row = 0; row < clip.height; row++) {
    for (let column = 0; column < clip.width; column++) {
      let inside = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const x = clip.x + column + (sx + 0.5) / 4;
          const y = clip.y + row + (sy + 0.5) / 4;
          const d = outside(x, y);
          if (d >= offset && d <= offset + width && d <= clipAt && shows(x, y)) inside++;
        }
      }
      const share = inside / 16;
      const at = (row * clip.width + column) * 4;
      for (let channel = 0; channel < 3; channel++)
        data[at + channel] = Math.round(ink[channel]! * share + 255 * (1 - share));
    }
  }
  return {
    focused: { width: clip.width, height: clip.height, data },
    blurred: canvas(clip.width, clip.height),
    margin,
    clip,
  };
}

test('a rounded outline is measured along its centre line, offset plus half its width out, its points one px apart along its own path (lead ruling, 31 Oct 2026, (b))', () => {
  const pill = { x: 40, y: 40, width: 80, height: 24 };
  const corners = [
    [999, 999],
    [999, 999],
    [999, 999],
    [999, 999],
  ] as [number, number][];
  // A 2px ring 2px out: its centre line is 3px out, round a 86 by 30 pill at 15px.
  const line = ringCentreLine(pill, corners, 3);
  assert.equal(line.length, 2 * (86 - 30) + 4 * Math.round((Math.PI * 15) / 2));
  for (const { x, y } of line) {
    const qx = Math.abs(x - 80) - (40 - 12);
    const qy = Math.abs(y - 52) - (12 - 12);
    const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 12;
    assert.ok(Math.abs(out - 3) < 1e-9, `(${x}, ${y}) is ${out}px out, not 3`);
  }
  // Its point count is its path's length, each of its eight runs rounded to a whole px.
  const close = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) <= 8 * 0.5, `${actual} is not about ${expected}`);
  close(line.length, roundedRingLength(pill, { corners, offset: 3 }));
});

test('planted rings round a full pill: a 2px ring passes along its centre line, and a 1px one, one under 3:1 and one clipped by overflow still fail (lead ruling, 31 Oct 2026, (b))', () => {
  const pill = { x: 40, y: 40, width: 80, height: 24 };
  const viewport = { width: 200, height: 200 };
  const corners = [
    [999, 999],
    [999, 999],
    [999, 999],
    [999, 999],
  ] as [number, number][];
  const verdict = (clips: ReturnType<typeof pillClips>, width: number) =>
    ringFindings(
      clips.focused,
      clips.blurred,
      pill,
      clips.margin,
      viewport,
      clips.clip,
      undefined,
      undefined,
      { corners, offset: 2, width },
    );
  // PASS: a whole 2px ring, antialiased round both ends. Its centre line changes by 3:1 all
  // round; its edge pixels round the curves are the fringe the ruling calls an artefact.
  const whole = pillClips(pill, viewport, { width: 2 });
  assert.deepEqual(verdict(whole, 2), []);
  const along = centreLineChange(
    whole.focused,
    whole.blurred,
    whole.clip,
    ringCentreLine(pill, corners, 3),
    3,
  );
  assert.ok(along.total > 0 && along.strong === along.total, `${along.strong} of ${along.total}`);
  // FAIL: a 1px ring. Under perimeterPx it's held to its pixels, as before, and has half a
  // 2px ring's.
  const thin = pillClips(pill, viewport, { width: 1 });
  const thinRules = rules(verdict(thin, 1));
  assert.ok(thinRules.length > 0, 'a 1px ring passes');
  assert.ok(
    thinRules.every((rule) => rule === 'contrast' || rule === 'perimeter'),
    `${thinRules}`,
  );
  // FAIL: a 2px ring in a grey under 3:1 against the white round it (2.96:1).
  const faint = pillClips(pill, viewport, { width: 2, ink: [150, 150, 150] });
  assert.deepEqual(rules(verdict(faint, 2)), ['contrast']);
  // FAIL: a 2px ring an ancestor's overflow cuts off past the pill's right end, where its round
  // end starts: a fifth of its centre line gone, though enough of its pixels change to pass the
  // 1px-ring contrast floor.
  const cut = pillClips(pill, viewport, { width: 2, shows: (x) => x < pill.x + pill.width - 12 });
  assert.deepEqual(rules(verdict(cut, 2)), ['perimeter']);
  // With no outline width (a ring that isn't an outline) it's held to its pixels, as before the
  // ruling, and the cut one fails there too.
  assert.ok(verdict(cut, 0).length > 0, 'a cut ring passes by its pixels');
  // PASS, as before the ruling: a whole 2px ring drawn further out than the outline (a box-shadow
  // beside an outline that draws nothing) misses the outline's centre line, but its pixels reach
  // a 2px ring's need, and the centre line only ever passes a ring the pixels failed.
  const shadow = pillClips(pill, viewport, { width: 2, offset: 5 });
  assert.deepEqual(verdict(shadow, 2), []);
  assert.equal(
    centreLineChange(
      shadow.focused,
      shadow.blurred,
      shadow.clip,
      ringCentreLine(pill, corners, 3),
      3,
    ).strong,
    0,
  );
});

test('planted rings at just over 3:1 (the revised ruling, option 1): a whole 2px ring at a sub-pixel position passes on its centre line with a pixel within one px of each point, and one clipped along its line, or a pixel inside it, still fails', () => {
  // A pill at a sub-pixel position: its 2px ring covers one row fully and the rows either side
  // in part, as a browser draws it.
  const pill = { x: 40.4, y: 40.4, width: 80, height: 24 };
  const viewport = { width: 200, height: 200 };
  const corners = [
    [999, 999],
    [999, 999],
    [999, 999],
    [999, 999],
  ] as [number, number][];
  // Grey 146 on white is 3.11:1: every scheme's focus colour is derived to just over 3:1.
  const ink = [146, 146, 146] as const;
  const verdict = (clips: ReturnType<typeof pillClips>) =>
    ringFindings(
      clips.focused,
      clips.blurred,
      pill,
      clips.margin,
      viewport,
      clips.clip,
      undefined,
      undefined,
      { corners, offset: 2, width: 2 },
    );
  const line = ringCentreLine(pill, corners, 3);
  const along = (clips: ReturnType<typeof pillClips>, half?: number) =>
    centreLineChange(clips.focused, clips.blurred, clips.clip, line, 3, half);
  // PASS: the whole ring. Its pixels fall short of a 2px ring's need (only its full rows reach
  // 3:1), and so does its centre line point by point, but every point has a 3:1 pixel within a
  // px and the ring drawn across its width.
  const whole = pillClips(pill, viewport, { width: 2, ink });
  assert.deepEqual(verdict(whole), []);
  const strict = along(whole);
  const credited = along(whole, 1);
  assert.equal(credited.strong, credited.total, `${credited.strong} of ${credited.total}`);
  assert.ok(strict.strong < credited.strong, `${strict.strong} of ${strict.total} point by point`);
  // FAIL: the same ring clipped along its own line all round (an ancestor's clip at the ring's
  // centre), so a 1px ring is left: a 3:1 pixel still lies a px off each point, but past the
  // clip nothing changes, so its outer edge doesn't, and the point isn't credited.
  const halved = pillClips(pill, viewport, { width: 2, ink, clipAt: 3 });
  assert.ok(verdict(halved).length > 0, 'a ring clipped along its line passes');
  assert.ok(along(halved, 1).strong < along(halved, 1).total * 0.9, `${along(halved, 1).strong}`);
  // FAIL: clipped a pixel inside its line (at its inner edge): nothing of it is left to see.
  const gone = pillClips(pill, viewport, { width: 2, ink, clipAt: 2 });
  assert.ok(verdict(gone).length > 0, 'a ring clipped inside its line passes');
  assert.equal(along(gone, 1).strong, 0);
  // FAIL, still: a 1px ring at the same colour (held to its pixels under perimeterPx), the
  // ring cut off past the pill's right end, and a ring under 3:1.
  const thin = pillClips(pill, viewport, { width: 1, ink });
  assert.ok(
    ringFindings(
      thin.focused,
      thin.blurred,
      pill,
      thin.margin,
      viewport,
      thin.clip,
      undefined,
      undefined,
      { corners, offset: 2, width: 1 },
    ).length > 0,
    'a 1px ring passes',
  );
  const cut = pillClips(pill, viewport, {
    width: 2,
    ink,
    shows: (x) => x < pill.x + pill.width - 12,
  });
  assert.ok(verdict(cut).length > 0, 'a ring cut off past its end passes');
  assert.ok(along(cut, 1).strong < along(cut, 1).total * 0.9, `${along(cut, 1).strong}`);
  const faint = pillClips(pill, viewport, { width: 2, ink: [150, 150, 150] });
  assert.ok(verdict(faint).length > 0, 'a ring under 3:1 passes');
});

test("a rotated stop's ring is held to its own sides, not its larger bounds, and a thin one still fails", () => {
  // A 2px ring drawn round the bounds of a box whose own sides are 90% of them.
  const box = { x: 40, y: 40, width: 100, height: 40 };
  const viewport = { width: 200, height: 200 };
  const sides = { width: 90, height: 36 };
  const short = ringClips(box, viewport, { top: 2, right: 2, bottom: 0, left: 2 });
  // Three sides of 2px, about 360 pixels: short of the 560 a 2px ring round the bounds needs,
  // and of the 504 round its own sides.
  assert.deepEqual(
    rules(ringFindings(short.focused, short.blurred, box, short.margin, viewport, short.clip)),
    ['perimeter'],
  );
  assert.deepEqual(
    rules(
      ringFindings(short.focused, short.blurred, box, short.margin, viewport, short.clip, sides),
    ),
    ['perimeter'],
  );
  // A whole 2px ring passes either way, and a 1px one fails round the sides too.
  const whole = ringClips(box, viewport, { top: 2, right: 2, bottom: 2, left: 2 });
  assert.deepEqual(
    ringFindings(whole.focused, whole.blurred, box, whole.margin, viewport, whole.clip, sides),
    [],
  );
  const thin = ringClips(box, viewport, { top: 1, right: 1, bottom: 1, left: 1 });
  assert.deepEqual(
    rules(ringFindings(thin.focused, thin.blurred, box, thin.margin, viewport, thin.clip, sides)),
    ['perimeter'],
  );
  // A rounding on a rotated stop is dropped: the expectation is its sides', rounded or not.
  const rounded = {
    corners: [
      [8, 8],
      [8, 8],
      [8, 8],
      [8, 8],
    ] as [number, number][],
    offset: 2,
  };
  const expected = (rounding?: typeof rounded) =>
    ringFindings(
      thin.focused,
      thin.blurred,
      box,
      thin.margin,
      viewport,
      thin.clip,
      sides,
      undefined,
      rounding,
    ).map((finding) => finding.expected);
  assert.deepEqual(expected(rounded), expected());
});

test('text is held to the background round its glyphs, their mask dilated by HALO, and not to decoration elsewhere in its box', () => {
  assert.equal(HALO, 2);
  // A 12x5 box on white: a glyph, a 2x3 bar at columns 2 and 3, and dark dots at
  // columns 6 (2px clear of the bar's edge) and 9 (5px clear), on the middle row.
  const W = [255, 255, 255] as const;
  const D = [34, 34, 34] as const;
  type Px = readonly [number, number, number];
  const at = (paint: (x: number, y: number) => Px | null, under: (x: number, y: number) => Px) =>
    Array.from({ length: 5 }, (_, y) =>
      Array.from({ length: 12 }, (_, x) => paint(x, y) ?? under(x, y)),
    );
  const glyph = (x: number, y: number) => (x >= 2 && x <= 3 && y >= 1 && y <= 3 ? true : false);
  const dots = (cols: readonly number[]) => (x: number, y: number) =>
    y === 2 && cols.includes(x) ? D : W;
  const shots = (cols: readonly number[]) => ({
    background: png(at(() => null, dots(cols))),
    black: png(at((x, y) => (glyph(x, y) ? ([0, 0, 0] as const) : null), dots(cols))),
    white: png(at((x, y) => (glyph(x, y) ? W : null), dots(cols))),
  });
  const clip = { x: 0, y: 0, width: 12, height: 5 };
  // The mask is the glyph's pixels alone, whatever the background holds.
  const far = shots([9]);
  const mask = glyphMask(decodePng(far.black), decodePng(far.white))!;
  assert.deepEqual(
    [...mask].flatMap((on, i) => (on ? [[i % 12, Math.floor(i / 12)]] : [])),
    [
      [2, 1],
      [3, 1],
      [2, 2],
      [3, 2],
      [2, 3],
      [3, 3],
    ],
  );
  // Dilated by a disc: two pixels straight out, one diagonally, not (2, 1) out.
  const grown = dilate(mask, 12, 2);
  assert.equal(grown[2 * 12 + 5], 1);
  assert.equal(grown[2 * 12 + 6], 0);
  assert.equal(grown[0 * 12 + 4], 1);
  assert.equal(grown[0 * 12 + 5], 0);
  // Decoration in the box but outside the halo: the whole box fails, the halo passes.
  assert.ok(worstRatio(far.background, 'rgb(34, 34, 34)')! < 1.01);
  const farHalo = glyphHalo(far.black, far.white, clip)!;
  assert.equal(farHalo.glyphs, 6);
  assert.ok(worstRatio(far.background, 'rgb(34, 34, 34)', farHalo.inside)! > 15);
  // A dot two pixels from the glyph's edge is inside the halo, and fails.
  const near = shots([5]);
  const nearHalo = glyphHalo(near.black, near.white, clip)!;
  assert.ok(worstRatio(near.background, 'rgb(34, 34, 34)', nearHalo.inside)! < 1.01);
  // Faint text with nothing in its box fails on the glyphs' own background.
  const plain = shots([]);
  const plainHalo = glyphHalo(plain.black, plain.white, clip)!;
  assert.ok(worstRatio(plain.background, 'rgb(250, 250, 250)', plainHalo.inside)! < 1.1);
  // At a device scale of 2, the halo is four of the shot's pixels.
  const twice = glyphHalo(far.black, far.white, { ...clip, width: 6 })!;
  assert.equal(twice.inside(7, 2, decodePng(far.background)), true);
  assert.equal(twice.inside(8, 2, decodePng(far.background)), false);
  // A glyph covering less than GLYPH_COVERAGE of a pixel isn't in the mask, and no glyph leaves
  // nothing to sample; shots of different sizes have no mask.
  const faint = Math.floor(GLYPH_COVERAGE * 255) - 1;
  const ghost = glyphHalo(
    png([[[255 - faint, 255 - faint, 255 - faint]]]),
    png([[[255, 255, 255]]]),
    { x: 0, y: 0, width: 1, height: 1 },
  )!;
  assert.equal(ghost.glyphs, 0);
  assert.equal(glyphHalo(png([[W]]), png([[W, W]]), clip), null);
});

test("a rotated box is sampled inside its own content quad, and its parent's border at the clip's corners isn't its background", () => {
  // A 20x4 content box turned 90deg about (10, 10): on screen it's 4 wide and 20 tall.
  const quad = {
    cx: 10,
    cy: 10,
    a: 0,
    b: 1,
    c: -1,
    d: 0,
    left: -10,
    right: 10,
    top: -2,
    bottom: 2,
  };
  const clip = { x: 0, y: 0, width: 20, height: 20 };
  const inside = insideQuad(quad, clip);
  const image = { width: 20, height: 20, data: new Uint8Array(20 * 20 * 4) };
  assert.equal(inside(10, 10, image), true);
  assert.equal(inside(10, 1, image), true);
  // Outside its 4px width, and within QUAD_INSET of its edge.
  assert.equal(inside(3, 10, image), false);
  assert.equal(inside(9, 10, image), true);
  assert.equal(inside(11, 10, image), false);
  assert.equal(inside(10, 19, image), false);
  // A light box in a dark frame: dark text fails the clip whole, and passes inside the quad.
  const rows = Array.from({ length: 20 }, (_, y) =>
    Array.from({ length: 20 }, (_, x) =>
      Math.abs(x + 0.5 - 10) < 2 && Math.abs(y + 0.5 - 10) < 10
        ? ([255, 255, 255] as const)
        : ([34, 34, 34] as const),
    ),
  );
  assert.ok(worstRatio(png(rows), 'rgb(34, 34, 34)')! < 1.01);
  assert.ok(worstRatio(png(rows), 'rgb(34, 34, 34)', inside)! > 15);
  // A quad that holds no whole pixel samples nothing.
  const thread = { ...quad, top: -0.5, bottom: 0.5 };
  assert.equal(worstRatio(png(rows), 'rgb(34, 34, 34)', insideQuad(thread, clip)), null);
});

/** Whether axe runs rule `id`, tagged `tags`, under `options`, as axe-core's ruleShouldRun decides. */
function axeRuns(options: AxeRunOptions, id: string, tags: readonly string[]): boolean {
  const runOnly = (options.runOnly ?? {}) as { type?: string; values?: readonly string[] };
  const enabled = options.rules?.[id]?.enabled;
  if (runOnly.type === 'rule') return runOnly.values?.includes(id) ?? false;
  if (typeof enabled === 'boolean') return enabled;
  return tags.some((tag) => runOnly.values?.includes(tag));
}
// The two rules' WCAG level tags, as axe-core 4.14 has them.
const AA_TAGS = ['wcag2aa'];
const AAA_TAGS = ['wcag2aaa'];

test('high-contrast rows run color-contrast-enhanced beside color-contrast, and no other row runs it', () => {
  const high = new Set(['contrast-more', 'high-contrast']);
  for (const swept of [false, true]) {
    for (const row of PREFERENCE_ROWS) {
      const options = axeRunOptions({
        swept,
        forced: row.context.forcedColors === 'active',
        highContrast: rowIsHighContrast(row),
      });
      const where = `${row.id}${swept ? ', swept' : ''}`;
      assert.equal(axeRuns(options, ENHANCED_CONTRAST_RULE, AAA_TAGS), high.has(row.id), where);
      assert.equal(axeRuns(options, CONTRAST_RULE, AA_TAGS), row.id !== 'forced-colors', where);
    }
  }
  // A tuple cell whose boundary renders high contrast, on the default row, runs it too.
  const tuple = axeRunOptions({ swept: false, forced: false, highContrast: true });
  assert.equal(axeRuns(tuple, ENHANCED_CONTRAST_RULE, AAA_TAGS), true);
  assert.equal(axeRuns(tuple, CONTRAST_RULE, AA_TAGS), true);
  assert.equal(axeRuns(tuple, 'button-name', ['wcag2a']), true, 'the tags still run');
  // Forced colors replace the page's palette: neither contrast rule runs, whatever the mode.
  const forced = axeRunOptions({ swept: false, forced: true, highContrast: true });
  assert.equal(axeRuns(forced, ENHANCED_CONTRAST_RULE, AAA_TAGS), false);
  assert.equal(axeRuns(forced, CONTRAST_RULE, AA_TAGS), false);
});

test("color-contrast-enhanced's incomplete items reach the sampler with color-contrast's, each element once, and a high-contrast element needs 7:1", async () => {
  const both = { target: ['main p.both'] };
  const enhancedOnly = { target: ['main p.enhanced'] };
  const results = {
    incomplete: [
      { id: CONTRAST_RULE, nodes: [both] },
      { id: ENHANCED_CONTRAST_RULE, nodes: [{ target: ['main p.both'] }, enhancedOnly] },
      { id: 'link-in-text-block', nodes: [{ target: ['main a'] }] },
    ],
  } as unknown as Parameters<typeof incompleteContrastFindings>[1];
  assert.deepEqual(
    incompleteContrastNodes(results).map((node) => node.target),
    [['main p.both'], ['main p.enhanced']],
  );
  // White behind 16px text at #696969, 5.49:1: AA's 4.5 passes it, high contrast's 7 doesn't.
  // Each element is shot three times: its background, then its glyphs black, then white.
  const white = png([[[255, 255, 255]]]);
  const shots = [white, png([[[0, 0, 0]]]), white];
  let shot = 0;
  const sampled = (mode: 'normal' | 'high-contrast') =>
    ({
      evaluate: async () => undefined,
      screenshot: async () => shots[shot++ % shots.length]!,
      locator: () => {
        const element = {
          scrollIntoViewIfNeeded: async () => undefined,
          // Nothing stuck covers it, it's on the axes, and its color holds through its shots.
          evaluate: async (script: { name: string }) =>
            script.name === stuckCoverScript.name
              ? null
              : script.name === inkScript.name
                ? 'rgb(105, 105, 105)'
                : {
                    mode,
                    color: 'rgb(105, 105, 105)',
                    fontSize: 16,
                    fontWeight: 400,
                    box: { x: 0, y: 0, width: 10, height: 10 },
                    texts: [],
                    flat: true,
                    turned: false,
                    quad: null,
                  },
        };
        return { first: () => element };
      },
    }) as unknown as Parameters<typeof incompleteContrastFindings>[0];
  assert.deepEqual(await incompleteContrastFindings(sampled('normal'), results), []);
  assert.deepEqual(
    (await incompleteContrastFindings(sampled('high-contrast'), results)).map(
      ({ rule, path, expected, actual }) => [rule, path, expected, actual],
    ),
    [
      ['high-contrast-text', 'main p.both', '7:1', '5.49:1 against its worst background pixel'],
      ['high-contrast-text', 'main p.enhanced', '7:1', '5.49:1 against its worst background pixel'],
    ],
  );
});

test('a color that turns while its shots are taken is read once more, and one that turns again is unresolved, never judged (row 25)', async () => {
  const results = {
    incomplete: [{ id: CONTRAST_RULE, nodes: [{ target: ['main p.tab'] }] }],
  } as unknown as Parameters<typeof incompleteContrastFindings>[1];
  // Dark text, #222, over white: about 15.9:1 once its color and its background agree.
  const white = png([[[255, 255, 255]]]);
  const shots = [white, png([[[0, 0, 0]]]), white];
  // `inks`: the color each read after the shots gives, in turn; `colors`, each sample's.
  const page = (colors: readonly string[], inks: readonly (string | null)[]) => {
    let shot = 0;
    let sample = 0;
    let ink = 0;
    const calls: string[] = [];
    const element = {
      scrollIntoViewIfNeeded: async () => undefined,
      evaluate: async (script: { name: string }) => {
        if (script.name === stuckCoverScript.name) return null;
        if (script.name === stillnessScript.name) return (calls.push('wait'), null);
        if (script.name === inkScript.name) {
          calls.push('ink');
          const read = inks[ink++];
          if (read === null) throw new Error('detached');
          return read;
        }
        if (script.name !== 'sampleScript') return undefined;
        calls.push('sample');
        return {
          mode: 'normal',
          color: colors[sample++]!,
          fontSize: 16,
          fontWeight: 400,
          box: { x: 0, y: 0, width: 10, height: 10 },
          texts: [],
          flat: true,
          turned: false,
          quad: null,
        };
      },
    };
    return {
      calls,
      page: {
        evaluate: async () => undefined,
        screenshot: async () => shots[shot++ % shots.length]!,
        locator: () => ({ first: () => element }),
      } as unknown as Parameters<typeof incompleteContrastFindings>[0],
    };
  };
  // Held through its shots: read once, and passes.
  const held = page(['rgb(34, 34, 34)'], ['rgb(34, 34, 34)']);
  assert.deepEqual(await incompleteContrastFindings(held.page, results), []);
  assert.deepEqual(held.calls, ['wait', 'sample', 'ink']);
  // Turned once (a script's class as the shots end a transition): waited for and read again,
  // and judged from the second read alone, which holds.
  const once = page(
    ['rgb(34, 34, 34)', 'rgb(250, 250, 250)'],
    ['rgb(250, 250, 250)', 'rgb(250, 250, 250)'],
  );
  const judged = await incompleteContrastFindings(once.page, results);
  assert.deepEqual(once.calls, ['wait', 'sample', 'ink', 'wait', 'sample', 'ink']);
  assert.deepEqual(
    judged.map(({ actual }) => actual),
    ['1.04:1 against its worst background pixel'],
  );
  // Turned both times, or unreadable after the shots: unresolved, a record, never a pass.
  const turns: readonly (readonly [string | null, string | null])[] = [
    ['rgb(1, 0, 0)', 'rgb(3, 0, 0)'],
    [null, null],
  ];
  for (const inks of turns) {
    const restless = page(['rgb(0, 0, 0)', 'rgb(2, 0, 0)'], inks);
    assert.deepEqual(
      (await incompleteContrastFindings(restless.page, results)).map(({ rule, actual }) => [
        rule,
        actual,
      ]),
      [['text', inkUnresolved(['rgb(0, 0, 0)', inks[0]], ['rgb(2, 0, 0)', inks[1]])]],
    );
  }
});

test("the batch path splits the elements it reads so no member's marks paint within BATCH_GAP of another's box, but a neighbour both hide by fill doesn't split them", () => {
  const box = (x: number) => ({ x, y: 0, width: 40, height: 20 });
  // Each candidate's own glyph mark paints over its box and BATCH_GAP - 1 round it, at most.
  const reach = BATCH_GAP - 1;
  const own = (id: number, x: number) => ({
    id,
    role: 'glyphs' as const,
    extent: { x: x - reach, y: -reach, width: 40 + 2 * reach, height: 20 + 2 * reach },
  });
  const far = [0, 100, 200].map((x, id) => ({ box: box(x), marks: [own(id, x)], alone: false }));
  assert.deepEqual(batches(far), [[0, 1, 2]], 'boxes 60 px apart share one batch');
  // Two boxes 10 px apart: each one's glyphs paint within BATCH_GAP of the other.
  const close = [0, 50].map((x, id) => ({ box: box(x), marks: [own(id, x)], alone: false }));
  assert.equal(batchConflict(close[0]!, close[1]!), true);
  assert.deepEqual(batches([...close, far[2]!]), [[0, 2], [1]]);
  // A neighbour text's parent between two far boxes, which both hide by fill: each one's own path hides it too.
  const shared = { id: 9, role: 'fill' as const, extent: { x: 40, y: 0, width: 60, height: 20 } };
  const sharing = [0, 100].map((x, id) => ({
    box: box(x),
    marks: [own(id, x), shared],
    alone: false,
  }));
  assert.equal(batchConflict(sharing[0]!, sharing[1]!), false);
  // One hides it by fill and the other is it, hidden by color: its currentColor borders and icons go too.
  const itself = { box: box(100), marks: [{ ...shared, role: 'glyphs' as const }], alone: false };
  assert.equal(batchConflict(sharing[0]!, itself), true);
  // A mark whose paint can't be bounded, or a member under a backdrop filter, has a batch to itself.
  const unbounded = {
    box: box(400),
    marks: [{ id: 7, role: 'glyphs' as const, extent: null }],
    alone: false,
  };
  assert.deepEqual(batches([far[0]!, unbounded, far[1]!]), [[0, 2], [1]]);
  assert.deepEqual(batches([far[0]!, { ...far[1]!, alone: true }, far[2]!]), [[0, 2], [1]]);
});

test("a batch's shots are cut from one shot of its boxes on whole pixels, each what page.screenshot() gives its own clip, checked against one own shot for each way the boxes' origins round, and every box gets its own when a cut differs", async () => {
  const viewport = { width: 200, height: 100 };
  // page.screenshot({ clip }) as Chromium answers it: the pixels from the clip's rounded origin, its size floored.
  const world = (x: number, y: number, skew = 0) =>
    [(x * 7 + skew) % 256, (y * 11) % 256, (x + y) % 256] as const;
  const fake = (skewUnion: boolean) => {
    const asked: { x: number; y: number; width: number; height: number }[] = [];
    return {
      asked,
      page: {
        screenshot: async ({
          clip,
        }: {
          clip: { x: number; y: number; width: number; height: number };
        }) => {
          asked.push(clip);
          const { x, y, width, height } = shotRect(clip, viewport);
          // A render that isn't the same for a wider clip, when asked for one.
          const skew = skewUnion && width > 40 ? 1 : 0;
          return png(
            Array.from({ length: height }, (_, row) =>
              Array.from({ length: width }, (_, column) => world(x + column, y + row, skew)),
            ),
          );
        },
      },
    };
  };
  const boxes = [
    { x: 10.25, y: 5.75, width: 30.5, height: 12.4 },
    { x: 120.6, y: 60.1, width: 20, height: 10.999 },
    { x: 60.5, y: 30.5, width: 8.2, height: 9.6 },
    { x: 11.2, y: 70.3, width: 25, height: 8 },
  ];
  assert.deepEqual(shotRect(boxes[0]!, viewport), { x: 10, y: 6, width: 30, height: 12 });
  const own = fake(false);
  const ownShots = await Promise.all(boxes.map((clip) => own.page.screenshot({ clip })));
  const cut = fake(false);
  const shots = await cutShots(cut.page as never, viewport, boxes);
  assert.deepEqual(
    shots.map((shot) => decodePng(shot)),
    ownShots.map((shot) => decodePng(shot)),
  );
  // One shot of them all, and one own shot for each of the four ways their origins round, across and down.
  assert.equal(cut.asked.length, 1 + 4);
  const skewed = fake(true);
  const fallback = await cutShots(skewed.page as never, viewport, boxes);
  assert.deepEqual(
    fallback.map((shot) => decodePng(shot)),
    ownShots.map((shot) => decodePng(shot)),
  );
  assert.equal(
    skewed.asked.length,
    1 + 1 + boxes.length - 1,
    'its first check fails, and every box is shot on its own',
  );
});
