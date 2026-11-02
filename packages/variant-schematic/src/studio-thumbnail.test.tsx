import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mix, type StudioPalette } from '@portfolio/kit/studio-thumbnail';
import thumbnail from './studio-thumbnail';

// Schematic's Studio thumbnail: the cover sheet of the drawing set, in ink lines on paper.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

/** A palette as Studio builds one from a scheme's anchors (pickers' paletteFrom). */
const paletteOf = (anchors: Pick<StudioPalette, 'canvas' | 'text' | 'accent' | 'secondary'>) => ({
  ...anchors,
  surface: mix(anchors.canvas, anchors.text, 0.06),
  rule: mix(anchors.canvas, anchors.text, 0.16),
  muted: mix(anchors.canvas, anchors.text, 0.42),
  strong: mix(anchors.canvas, anchors.text, 0.62),
});
// drafting-blue, light and dark.
const LIGHT = paletteOf({
  canvas: '#dde8f4',
  text: '#0b2b52',
  accent: '#00739a',
  secondary: '#9a5a00',
});
const DARK = paletteOf({
  canvas: '#0b2b52',
  text: '#eaf2ff',
  accent: '#59d7ff',
  secondary: '#ffc857',
});

const draw = (palette: StudioPalette) => renderToStaticMarkup(<svg>{thumbnail(palette)}</svg>);

/** Each <rect>'s geometry, fill and corner, in drawing order. */
const rects = (html: string) =>
  [...html.matchAll(/<rect ([^>]*)>/g)].map(([, attrs]) => {
    const at = (name: string) => new RegExp(`(?:^| )${name}="([^"]+)"`).exec(attrs!)?.[1];
    return {
      x: Number(at('x')),
      y: Number(at('y')),
      w: Number(at('width')),
      h: Number(at('height')),
      fill: at('fill') || '',
      rx: at('rx') ? Number(at('rx')) : 0,
    };
  });

test('the thumbnail is pure and a picture: the same palette draws the same, with no text, images, ids or url()', () => {
  for (const palette of [LIGHT, DARK]) {
    const html = draw(palette);
    assert.equal(html, draw(palette));
    assert.doesNotMatch(html, / id="|<text|<image|<foreignObject|url\(/);
  }
  assert.notEqual(draw(LIGHT), draw(DARK), 'it is drawn in the palette');
});

test('it fills the 136 by 85 canvas and draws inside it', () => {
  const all = rects(draw(LIGHT));
  assert.ok(
    all.some(({ x, y, w, h }) => x === 0 && y === 0 && w === 136 && h >= 85) ||
      all.filter(({ x, w }) => x === 0 && w === 136).reduce((sum, { h }) => sum + h, 0) >= 70,
    'the ground covers the canvas',
  );
  for (const { x, y, w, h } of all) {
    assert.ok(
      x >= 0 && y >= 0 && x + w <= 136.01 && y + h <= 85.01,
      `${x},${y} ${w}x${h} stays inside`,
    );
  }
});

/** Each unfilled, stroked <rect>: the frames and boxes the sheet is drawn in. */
const frames = (html: string) =>
  [
    ...html.matchAll(
      /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="none"/g,
    ),
  ].map(([, x, y, w, h]) => ({ x: +x!, y: +y!, w: +w!, h: +h! }));

test('the drawing frame is double, ticked top and bottom, with the title block at its bottom right', () => {
  const html = draw(LIGHT);
  const boxes = frames(html);
  const outer = boxes.find(({ x, w }) => x < 2 && w > 130);
  const inner = boxes.find(({ x, w }) => x > 3 && x < 6 && w > 120);
  assert.ok(outer && inner, 'two borders');
  const all = rects(html);
  const ticks = all.filter(({ y, h, w }) => w < 1 && h > 1 && (y < 5 || y >= 80));
  assert.ok(ticks.length >= 16, `column ticks along the top and the bottom: ${ticks.length}`);
  const block = boxes.find(
    ({ x, y, w, h }) =>
      x > 60 && y > 50 && Math.abs(x + w - 128) < 0.5 && Math.abs(y + h - 78) < 0.5,
  );
  assert.ok(block, 'the title block at the bottom right');
  // The cover's name is boxed twice.
  assert.ok(boxes.filter(({ x, y }) => x < 12 && y < 16).length >= 2, 'the boxed name');
});
