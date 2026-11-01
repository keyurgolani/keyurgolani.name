import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mix, type StudioPalette } from '@portfolio/kit/studio-thumbnail';
import thumbnail from './studio-thumbnail';

// Aurora Glass's Studio thumbnail: the first view under its sky, every pane rounded glass.

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
// aurora-meadow, light and dark.
const LIGHT = paletteOf({
  canvas: '#eef5ef',
  text: '#16251b',
  accent: '#2b6a1e',
  secondary: '#4e4376',
});
const DARK = paletteOf({
  canvas: '#0c1914',
  text: '#e7f3ea',
  accent: '#b8f09a',
  secondary: '#b3a4f0',
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

test('the sky falls in bands from the accent toward the canvas, with no gradient to share an id', () => {
  const all = rects(draw(LIGHT));
  const bands = all.filter(({ x, w, h }) => x === 0 && w === 136 && h < 5);
  assert.ok(bands.length >= 20, `${bands.length} bands`);
  assert.notEqual(bands[0]!.fill, bands[bands.length - 1]!.fill, 'the sky changes down the page');
});

test('the panes are rounded glass, and the call to action the one accent pill', () => {
  const all = rects(draw(LIGHT));
  const panes = all.filter(({ w, h, rx }) => w > 40 && h > 40 && rx >= 3);
  assert.ok(panes.length >= 2, 'the hero pane and the signature sheet');
  const pill = all.filter(
    ({ fill, h, rx }) => fill === LIGHT.accent && h > 4 && rx >= h / 2 - 0.01,
  );
  assert.equal(pill.length, 1, 'one accent pill');
  const capsule = all.find(({ y, h, rx, w }) => y < 5 && h > 5 && rx >= h / 2 && w > 60);
  assert.ok(capsule, 'the frosted capsule near the top');
});
