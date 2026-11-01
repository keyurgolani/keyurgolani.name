import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mix, type StudioPalette } from '@portfolio/kit/studio-thumbnail';
import thumbnail from './studio-thumbnail';

// The Studio thumbnail draws the opening as the page lays it out at 16:10: the accent field,
// its lower edge the wide arc, the hero's column on the axis, and the seal on the arc's
// lowest point, with the anchor band on paper below.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const paletteOf = (anchors: {
  canvas: string;
  text: string;
  accent: string;
  secondary: string;
}): StudioPalette => ({
  ...anchors,
  surface: mix(anchors.canvas, anchors.text, 0.06),
  rule: mix(anchors.canvas, anchors.text, 0.16),
  muted: mix(anchors.canvas, anchors.text, 0.42),
  strong: mix(anchors.canvas, anchors.text, 0.62),
});

// warm-parchment's light and dark anchors.
const LIGHT = paletteOf({
  canvas: '#f6eddc',
  text: '#2b241c',
  accent: '#b95f32',
  secondary: '#5f7653',
});
const DARK = paletteOf({
  canvas: '#251f19',
  text: '#f4e8d2',
  accent: '#f09d70',
  secondary: '#9db38d',
});

const draw = (palette: StudioPalette) => renderToStaticMarkup(<svg>{thumbnail(palette)}</svg>);

/** Each <rect>'s geometry and fill, in drawing order (a Headline sets its rx before its fill). */
const rects = (html: string) =>
  [
    ...html.matchAll(
      /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"(?: rx="[\d.]+")? fill="([^"]+)"/g,
    ),
  ].map(([, x, y, w, h, fill]) => ({ x: +x!, y: +y!, w: +w!, h: +h!, fill: fill! }));

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

test('the thumbnail is pure: the same palette draws the same picture, with no ids or text', () => {
  for (const palette of [LIGHT, DARK]) {
    const html = draw(palette);
    assert.equal(html, draw(palette));
    assert.doesNotMatch(html, / id="|<text|<image|url\(/);
  }
});

test('the field is the accent, its lower edge an arc lowest on the axis, the seal on that point', () => {
  const html = draw(LIGHT);
  assert.match(html, new RegExp(`<path d="M0 0H136V51A68 13 0 0 1 0 51Z" fill="${LIGHT.accent}">`));
  // The arc's lowest point is (68, 64); the seal's circle is centred there, on paper.
  const seal =
    /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="([^"]+)"><\/circle><circle/.exec(html);
  assert.ok(seal, 'the seal');
  assert.equal(+seal[1]!, 68);
  assert.ok(Math.abs(+seal[2]! - 64) < 1, `the seal sits on the arc's low point: ${seal[2]}`);
  assert.equal(seal[4], LIGHT.canvas);
  // The hero's column is centred on the page's axis: its kicker, line and lede.
  const hero = rects(html).filter(({ y, w }) => y > 10 && y < 40 && w > 20);
  assert.ok(hero.length >= 4, 'the kicker, the display line, and the lede');
  for (const { x, w } of hero) assert.ok(Math.abs(x + w / 2 - 68) < 0.6, `centred: ${x}+${w}/2`);
});

test("the field's ink is its on-accent, black's side or white's, read in the palette's own colours", () => {
  for (const palette of [LIGHT, DARK]) {
    const all = rects(draw(palette));
    // The display line: the widest bar on the field.
    const line = all
      .filter(({ y, w }) => y > 10 && y < 30 && w < 136)
      .sort((a, b) => b.w - a.w)[0]!;
    assert.ok(line.w > 80, 'the display line runs across the measure');
    // A drawing's bars are non-text graphics, held to 3:1 (warm-parchment's accent gives even
    // black 4.4:1, so the page's own field text is large).
    assert.ok(contrast(line.fill, palette.accent) >= 3, `${line.fill} on ${palette.accent}`);
    // On black's side: darker than the accent, as on-accent is on both of these.
    assert.ok(luminance(line.fill) < luminance(palette.accent), `${line.fill} is on black's side`);
  }
});
