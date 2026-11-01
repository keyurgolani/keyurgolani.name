import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mix, type StudioPalette } from '@portfolio/kit/studio-thumbnail';
import thumbnail from './studio-thumbnail';

// The Studio thumbnail draws the home as an open book: a spread on its gutter rule with the
// contents on the recto, and the fore-edge's tabs down the outer edge, your place marked.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const anchors = { canvas: '#f5ecdb', text: '#2b2520', accent: '#b85c32', secondary: '#4a5a40' };
const PALETTE: StudioPalette = {
  ...anchors,
  surface: mix(anchors.canvas, anchors.text, 0.06),
  rule: mix(anchors.canvas, anchors.text, 0.16),
  muted: mix(anchors.canvas, anchors.text, 0.42),
  strong: mix(anchors.canvas, anchors.text, 0.62),
};

const draw = () => renderToStaticMarkup(<svg>{thumbnail(PALETTE)}</svg>);

/** Each <rect>'s geometry and fill, in drawing order, a Box's or a Headline's. */
const rects = (html: string) =>
  [
    ...html.matchAll(
      /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"(?: rx="[\d.]+")? fill="([^"]+)"/g,
    ),
  ].map(([, x, y, w, h, fill]) => ({ x: +x!, y: +y!, w: +w!, h: +h!, fill: fill! }));

test('the thumbnail is pure: the same palette draws the same picture, with no ids or text', () => {
  const html = draw();
  assert.equal(html, draw());
  assert.doesNotMatch(html, / id="|<text|<image|url\(/);
});

test('the spread folds on its gutter rule, with the fore-edge tabs on the outer edge', () => {
  const all = rects(draw());
  const gutter = all.find(({ h, w, fill }) => h === 85 && w < 1 && fill === PALETTE.rule);
  assert.ok(gutter, 'a full-height gutter rule');
  assert.ok(Math.abs(gutter.x + gutter.w / 2 - 68) < 0.5, `the gutter is the fold: ${gutter.x}`);
  const tabs = all.filter(({ x, w, h }) => x < 5 && w > 1 && w < 2 && h > 4);
  assert.ok(tabs.length >= 4, `fore-edge tabs: ${tabs.length}`);
  assert.equal(tabs.filter(({ fill }) => fill === PALETTE.accent).length, 1, 'one place marked');
  const folios = all.filter(({ y, h }) => y > 80 && h < 1.5);
  assert.ok(folios.some(({ x }) => x < 68) && folios.some(({ x }) => x > 68), 'a folio per page');
});
