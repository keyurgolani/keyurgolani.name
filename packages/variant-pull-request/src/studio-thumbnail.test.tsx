import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mix, type StudioPalette } from '@portfolio/kit/studio-thumbnail';
import thumbnail from './studio-thumbnail';

// The Studio thumbnail draws the review page: the header band in the accent across the top,
// the tabs at the start, a file's diff in the middle, and the merge box at the end.

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

test('the header band spans the top in the accent, over the tabs, the diff and the merge box', () => {
  const all = rects(draw());
  const band = all.find(
    ({ x, y, w, fill }) => x === 0 && y === 0 && w === 136 && fill === PALETTE.accent,
  );
  assert.ok(band, 'a header band in the accent');
  const added = mix(PALETTE.canvas, PALETTE.accent, 0.22);
  const removed = mix(PALETTE.canvas, PALETTE.secondary, 0.22);
  const lines = all.filter(({ fill }) => fill === added || fill === removed);
  assert.ok(lines.length >= 4, `diff lines: ${lines.length}`);
  assert.ok(
    lines.every(({ y }) => y > band.y + band.h),
    'the diff sits under the band',
  );
  const merge = all.find(({ fill, h }) => fill === PALETTE.text && h > 30);
  assert.ok(merge && merge.x > 100, 'the merge box at the end');
});
