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
  framedItems,
  incompleteContrastFindings,
  inFrame,
  NEIGHBOUR_MARGIN,
  neededRatio,
  neighbourTexts,
  reaches,
  worstRatio,
} from './lib/a11y/contrast';
import { animationFindings, killSwitches } from './lib/a11y/motion';
import { requiredChecks } from './lib/checks';
import { displayModeProblems } from './lib/emulation';
import { PREFERENCE_ROWS, VIEWPORTS } from './lib/matrix';
import { contrast, decodePng, parseCssColor, pixel } from './lib/pixels';
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
  // A page whose every element has no box, recording what the sampler looked up.
  const looked: string[] = [];
  const page = {
    evaluate: async () => undefined,
    locator: (selector: string) => {
      looked.push(selector);
      const element = {
        scrollIntoViewIfNeeded: async () => undefined,
        evaluate: async () => {
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
