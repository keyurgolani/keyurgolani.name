import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mix, type StudioPalette } from '@portfolio/kit/studio-thumbnail';
import thumbnail from '../studio-thumbnail';

// The Studio thumbnail draws the console wall's first view: the board rail down the left
// edge, the status line across the top, and the wall's panels, the readouts a 2x2 of square
// modules among them.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const anchors = { canvas: '#010d0e', text: '#d8e4e6', accent: '#3fd0a8', secondary: '#e8a33d' };
const PALETTE: StudioPalette = {
  ...anchors,
  surface: mix(anchors.canvas, anchors.text, 0.06),
  rule: mix(anchors.canvas, anchors.text, 0.16),
  muted: mix(anchors.canvas, anchors.text, 0.42),
  strong: mix(anchors.canvas, anchors.text, 0.62),
};

const draw = (palette = PALETTE) => renderToStaticMarkup(<svg>{thumbnail(palette)}</svg>);

/** Each filled <rect>'s geometry and fill, in drawing order. */
const rects = (html: string) =>
  [
    ...html.matchAll(
      /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"(?: rx="[\d.]+")? fill="([^"]+)"/g,
    ),
  ].map(([, x, y, w, h, fill]) => ({ x: +x!, y: +y!, w: +w!, h: +h!, fill: fill! }));

test('the thumbnail is pure: the same palette draws the same picture, with no ids, text or images, inside 136 by 85', () => {
  const html = draw();
  assert.equal(html, draw());
  assert.doesNotMatch(html, / id="|<text|<image|url\(/);
  for (const { x, y } of rects(html)) assert.ok(x < 136 && y < 85, `${x},${y} is in the frame`);
});

test('the rail runs down the left edge and the status line across the top, with its two lit readings', () => {
  const all = rects(draw());
  const rail = all.find(({ x, y, h, w }) => x === 0 && y === 0 && h === 85 && w < 10);
  assert.ok(rail, 'a rail down the left edge, full height');
  const status = all.find(({ x, y, w, h }) => x <= rail.w + 1 && y === 0 && w > 120 && h < 7);
  assert.ok(status, 'a status line across the top');
  const lamps = [...draw().matchAll(/<circle [^>]*fill="([^"]+)"/g)].map(([, fill]) => fill);
  assert.deepEqual(lamps, [PALETTE.secondary, PALETTE.secondary], 'two lamps');
});

test('the readouts are a 2x2 of square modules, each with its figure in the ink', () => {
  const figures = rects(draw()).filter(
    ({ fill, h, w }) => fill === PALETTE.text && h > 4 && h < 5 && w < 12,
  );
  assert.equal(figures.length, 4, 'four figures');
  const xs = new Set(figures.map(({ x }) => x));
  const ys = new Set(figures.map(({ y }) => y));
  assert.equal(xs.size, 2, 'in two columns');
  assert.equal(ys.size, 2, 'in two rows');
  // The modules are square: a column's step across equals a row's step down, near enough.
  const [x0, x1] = [...xs].sort((a, b) => a - b);
  const [y0, y1] = [...ys].sort((a, b) => a - b);
  assert.ok(Math.abs(x1! - x0! - (y1! - y0!)) < 3, `${x1! - x0!} across, ${y1! - y0!} down`);
});

test('it draws in the palette it gets: another scheme draws another picture', () => {
  const light = { ...PALETTE, canvas: '#f5eddc', text: '#2b2520' };
  assert.notEqual(draw(light), draw());
  assert.match(draw(light), /fill="#f5eddc"/);
});
