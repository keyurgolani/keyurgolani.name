import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mix, type StudioPalette } from '@portfolio/kit/studio-thumbnail';
import thumbnail from './studio-thumbnail';

// Swiss Signal's Studio thumbnail: the poster as an index, square-cornered, its one signal block.

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
// signal-paper, light and dark.
const LIGHT = paletteOf({
  canvas: '#f4f1ea',
  text: '#111111',
  accent: '#e4572e',
  secondary: '#2c5784',
});
const DARK = paletteOf({
  canvas: '#131210',
  text: '#f4f1ea',
  accent: '#ff6a40',
  secondary: '#8db6f4',
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

test('the poster: square corners, the twelve columns faint, and one signal block, never more', () => {
  const all = rects(draw(LIGHT));
  assert.deepEqual(
    all.filter(({ rx }) => rx > 0),
    [],
    'no rounded corner',
  );
  const columns = all.filter(({ w, h }) => w < 0.5 && h > 70);
  assert.equal(columns.length, 11, 'eleven column rules part twelve columns');
  const signal = all.filter(({ fill }) => fill === LIGHT.accent);
  assert.equal(signal.length, 1, 'one accent element');
  assert.ok(signal[0]!.w > 15 && signal[0]!.h > 3, 'a block, not a hairline');
  // Two heavy rules across the page: the masthead's and the figures band's.
  assert.equal(
    all.filter(({ w, h, fill }) => w >= 126 && h >= 0.8 && fill === LIGHT.text).length,
    2,
  );
});
