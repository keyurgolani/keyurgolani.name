import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mix, type StudioPalette } from '@portfolio/kit/studio-thumbnail';
import thumbnail from './studio-thumbnail';

// The Studio thumbnail draws the home's session: the main pane's prompt lines, the index
// docked on the right, and the tmux status line across the foot.

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

test('the status line runs across the foot in the accent, under the main pane and the docked index', () => {
  const all = rects(draw());
  const bar = all.find(({ x, w, fill }) => x === 0 && w === 136 && fill === PALETTE.accent);
  assert.ok(bar, 'a status line in the accent');
  assert.equal(bar.y + bar.h, 85, 'it ends the frame');
  const index = all.find(({ fill, h }) => fill === PALETTE.surface && h > 60);
  assert.ok(index, 'a docked index pane');
  assert.ok(index.x > 80 && index.x + index.w === 136, `the index docks right: ${index.x}`);
  assert.equal(index.y + index.h, bar.y, 'the index stands on the status line');
  const prompts = all.filter(
    ({ fill, x, w }) => fill === PALETTE.secondary && x < index.x && w === 14,
  );
  assert.ok(prompts.length >= 4, `prompt lines in the main pane: ${prompts.length}`);
});
