import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mix, type StudioPalette } from '@portfolio/kit/studio-thumbnail';
import thumbnail from './studio-thumbnail';

// The Studio thumbnail draws the home's exposed grid: ruled cells with heavy borders, the
// poster cell, and the practice cell's black tape hung from its top rule.

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

/** Each heavy-bordered cell's geometry, in drawing order. */
const cells = (html: string) =>
  [
    ...html.matchAll(
      /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="none" stroke="([^"]+)"/g,
    ),
  ].map(([, x, y, w, h, stroke]) => ({ x: +x!, y: +y!, w: +w!, h: +h!, stroke: stroke! }));

test('the thumbnail is pure: the same palette draws the same picture, with no ids or text', () => {
  const html = draw();
  assert.equal(html, draw());
  assert.doesNotMatch(html, / id="|<text|<image|url\(/);
});

test('the poster cell and the practice cell stand side by side, ruled in the ink, under the tape', () => {
  const html = draw();
  const ruled = cells(html).filter(({ stroke }) => stroke === PALETTE.text);
  const poster = ruled.find(({ w, h }) => w > 80 && h > 60);
  const practice = ruled.find(({ x, h }) => x > 85 && h > 60);
  assert.ok(poster, 'a poster cell');
  assert.ok(practice, 'a practice cell beside it');
  assert.equal(poster.y, practice.y, 'the two share the grid row');
  assert.ok(poster.w > practice.w * 1.5, 'the poster is the wide cell');
  const tape = new RegExp(
    `<rect x="${practice.x}" y="${practice.y}" width="[\\d.]+" height="[\\d.]+" fill="${PALETTE.text}"`,
  );
  assert.match(html, tape, 'the tape hangs from the top rule of the practice cell');
});
