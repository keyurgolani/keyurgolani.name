import test from 'node:test';
import assert from 'node:assert/strict';
import { texturePixels, textureProblem, TEXTURE_DITHER, type TexturePixel } from './texture';

// The texture drawing the gate reads (#20 PR 2b): each pixel a texture puts
// where a surface's text sits, as shares of the surface and of each role.

const PADDING = { block: 20, inline: 20 };

function drawn(texture: string, inset = PADDING): TexturePixel[] {
  const pixels = texturePixels(texture, inset);
  assert.ok(typeof pixels !== 'string', String(pixels));
  return pixels;
}

/** The most of each role any one pixel holds. */
function peaks(pixels: readonly TexturePixel[]): Record<string, number> {
  const most: Record<string, number> = {};
  for (const pixel of pixels) {
    for (const [role, share] of Object.entries(pixel.roles)) {
      most[role] = Math.max(most[role] ?? 0, Math.round(share! * 1000) / 1000);
    }
    const sum = pixel.surface + Object.values(pixel.roles).reduce((a, b) => a + b!, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `shares sum to ${sum}`);
  }
  return most;
}

test('no texture puts only the surface under text', () => {
  assert.deepEqual(drawn('none'), [{ surface: 1, roles: {} }]);
});

test('each layer shows at its full strength somewhere under text, however thin', () => {
  // terminal-chrome's scanlines: 1px of 10% text-primary every 4px.
  assert.deepEqual(
    peaks(
      drawn(
        'repeating-linear-gradient(0deg, transparent 0 3px, color-mix(in srgb, var(--color-text-primary) 10%, transparent) 3px 4px)',
      ),
    ),
    { 'text-primary': 0.1 },
  );
  // A grain dot half a pixel wide, at the surface's center.
  assert.deepEqual(
    peaks(
      drawn(
        'radial-gradient(circle, color-mix(in srgb, var(--color-text-primary) 12%, transparent) 0 0.5px, transparent 0.75px)',
      ),
    ),
    { 'text-primary': 0.12 },
  );
  // neobrutalist's halftone dot, solid border-strong.
  assert.deepEqual(
    peaks(drawn('radial-gradient(circle, var(--color-border-strong) 0 1px, transparent 1.5px)')),
    { 'border-strong': 1 },
  );
  // bauhaus-geometric's wedges, a conic gradient.
  assert.deepEqual(
    peaks(
      drawn(
        'conic-gradient(from 45deg, color-mix(in srgb, var(--color-accent) 12%, transparent) 0 25%, transparent 0 50%, color-mix(in srgb, var(--color-information) 10%, transparent) 0 75%, transparent 0)',
      ),
    ),
    { accent: 0.12, information: 0.1 },
  );
});

test('layers that never meet stay apart, and layers that meet composite, the top one over', () => {
  const memphis = drawn(
    'radial-gradient(circle at 25% 25%, color-mix(in srgb, var(--color-accent) 20%, transparent) 0 8%, transparent 9%), radial-gradient(circle at 75% 70%, color-mix(in srgb, var(--color-information) 18%, transparent) 0 10%, transparent 11%)',
  );
  assert.deepEqual(peaks(memphis), { accent: 0.2, information: 0.18 });
  assert.ok(memphis.every((pixel) => Object.keys(pixel.roles).length <= 1));
  // A grid's two lines meet at its corner, which only an unpadded surface puts text on.
  const grid =
    'linear-gradient(var(--color-border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--color-border-subtle) 1px, transparent 1px)';
  assert.deepEqual(drawn(grid), [{ surface: 1, roles: {} }]);
  const corner = drawn(grid, { block: 0, inline: 0 }).find(
    (pixel) => pixel.roles['border-subtle'] === 1 && pixel.surface === 0,
  );
  assert.ok(corner);
});

test("a texture the gate can't draw says why", () => {
  for (const [texture, pattern] of [
    ['url(grain.png)', /a layer the gate can't draw/],
    ['linear-gradient(rgb(0 0 0 / 10%), transparent)', /a color the gate can't measure/],
    ['linear-gradient(var(--color-chartreuse), transparent)', /names no color role: chartreuse/],
    [
      'linear-gradient(to top right, var(--color-accent), transparent)',
      /a direction the gate can't read/,
    ],
    ['linear-gradient(var(--color-accent))', /fewer than two stops/],
    [
      'linear-gradient(var(--color-accent) 1vw, transparent)',
      /a stop position the gate can't read/,
    ],
  ] as const) {
    assert.match(textureProblem(texture) ?? 'drawn', pattern, texture);
  }
  assert.equal(textureProblem('none'), null);
  assert.equal(TEXTURE_DITHER, 2);
});
