import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mix, type StudioPalette } from '@portfolio/kit/studio-thumbnail';
import thumbnail from './studio-thumbnail';

// The Studio thumbnail draws the entrance as it stands (OBS-2): the work on its canvas mat
// on the page's axis, and the floor band across the foot, not the old left-column room.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const anchors = { canvas: '#f5ecdb', text: '#2b2520', accent: '#8a4a2a', secondary: '#4a5a40' };
const PALETTE: StudioPalette = {
  ...anchors,
  surface: mix(anchors.canvas, anchors.text, 0.06),
  rule: mix(anchors.canvas, anchors.text, 0.16),
  muted: mix(anchors.canvas, anchors.text, 0.42),
  strong: mix(anchors.canvas, anchors.text, 0.62),
};

const draw = () => renderToStaticMarkup(<svg>{thumbnail(PALETTE)}</svg>);

/** Each <rect>'s geometry and fill, in drawing order. */
const rects = (html: string) =>
  [
    ...html.matchAll(
      /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"/g,
    ),
  ].map(([, x, y, w, h, fill]) => ({ x: +x!, y: +y!, w: +w!, h: +h!, fill: fill! }));

test('the thumbnail is pure: the same palette draws the same picture, with no ids or text', () => {
  const html = draw();
  assert.equal(html, draw());
  assert.doesNotMatch(html, / id="|<text|<image|url\(/);
});

test("the entrance's work hangs on its canvas mat on the page's axis, over a full-width floor", () => {
  const all = rects(draw());
  const mat = all.find(({ fill, w }) => fill === PALETTE.canvas && w > 60);
  assert.ok(mat, 'a canvas mat');
  assert.ok(Math.abs(mat.x + mat.w / 2 - 68) < 0.5, `the mat is centred: ${mat.x}+${mat.w}/2`);
  const floor = all.find(({ x, w, h, y }) => x === 0 && w === 136 && h > 15 && y > 60);
  assert.ok(floor, 'a floor band across the foot');
  assert.ok(mat.y + mat.h < floor.y, 'the mat stands above the floor line');
});
