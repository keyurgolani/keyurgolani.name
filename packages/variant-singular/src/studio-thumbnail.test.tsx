import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mix, type StudioPalette } from '@portfolio/kit/studio-thumbnail';
import thumbnail from './studio-thumbnail';

// The Studio thumbnail draws one statement to the screen: a single large headline on the
// full ground, and the action band across the foot on the other ground.

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

test('one large headline stands on the full ground, over the band on the other ground', () => {
  const all = rects(draw());
  assert.deepEqual(all[0], { x: 0, y: 0, w: 136, h: 85, fill: PALETTE.canvas });
  const band = all.find(({ x, w, fill }) => x === 0 && w === 136 && fill === PALETTE.text);
  assert.ok(band, 'a band on the ink');
  assert.equal(band.y + band.h, 85, 'the band ends the frame');
  const blocks = all.filter(({ h, w }) => h > 4 && w < 136);
  assert.equal(blocks.length, 1, 'one headline block');
  assert.ok(blocks[0]!.w > 68, 'the headline takes more than half the width');
});
