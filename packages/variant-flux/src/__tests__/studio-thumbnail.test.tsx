import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mix, type StudioPalette } from '@portfolio/kit/studio-thumbnail';
import thumbnail from '../studio-thumbnail';

// The Studio thumbnail draws the field's first view: the dock of pill tabs across the top,
// the drop pouring in from the top right, and the sheets rising from the field, each with
// its tab on its top edge and the drip on the tab's shoulder, the tabs stepping across.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const anchors = { canvas: '#0e0b26', text: '#f4f2ff', accent: '#ff5d8a', secondary: '#ffb347' };
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

test('the dock runs across the top, the name its lit pill, and the drop pours in at the top right', () => {
  const all = rects(draw());
  const name = all.find(({ y, h, fill }) => y < 5 && h < 6 && fill === PALETTE.text);
  assert.ok(name, "the name's pill, lit in the ink");
  const tabs = all.filter(({ y, h, fill }) => y < 8 && h < 2 && fill === PALETTE.strong);
  assert.ok(tabs.length >= 4, `${tabs.length} destinations in the dock`);
  const drop = draw().match(/<path d="M(\d+) 0 [^"]*" fill="([^"]+)"/);
  assert.ok(drop, 'a shape pouring from the top edge');
  assert.ok(+drop[1]! > 90 && drop[2] === PALETTE.accent, 'the drop, in the accent, at the right');
});

test('the sheets rise full width, each with its tab on its top edge and the drip on its shoulder, stepping across', () => {
  const all = rects(draw());
  const bodies = all
    .filter(({ x, w }) => x === 0 && w === 136)
    .filter(({ fill }) => fill !== PALETTE.canvas);
  assert.equal(bodies.length, 2, 'two sheets');
  const leaf = bodies[0]!.fill;
  const tabs = bodies.map((body) =>
    all.find(({ x, y, h, fill }) => fill === leaf && x > 0 && y < body.y && y + h > body.y),
  );
  assert.ok(tabs.every(Boolean), "each sheet's tab stands on its top edge");
  assert.ok(tabs[1]!.x > tabs[0]!.x + tabs[0]!.w, 'the tabs step across');
  const drips = [...draw().matchAll(/<ellipse cx="([\d.]+)" cy="([\d.]+)"[^>]*fill="([^"]+)"/g)];
  assert.equal(drips.length, 2, 'a drip per tab');
  drips.forEach(([, cx], at) => {
    const tab = tabs[at]!;
    assert.ok(+cx! > tab.x + tab.w / 2 && +cx! < tab.x + tab.w, "on the tab's end shoulder");
  });
  assert.ok(
    drips.every(([, , , fill]) => fill === PALETTE.accent),
    'in the accent',
  );
});

test('it draws in the palette it gets: another scheme draws another picture', () => {
  const light = { ...PALETTE, canvas: '#f5eddc', text: '#2b2520' };
  assert.notEqual(draw(light), draw());
  assert.match(draw(light), /fill="#f5eddc"/);
});
