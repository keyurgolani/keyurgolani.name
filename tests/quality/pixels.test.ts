import assert from 'node:assert/strict';
import test from 'node:test';
import { deltaEOk, rgbToOklab } from './lib/pixels';

// The palette check's colour distance (P-5 slice 3, item 6): Oklab, so the grounds of two
// dark schemes of different hue never pass as one, as an RGB tolerance let them (A P2-A).

test('Oklab puts white at L 1 and black at L 0, and grey on the neutral axis', () => {
  const [l, a, b] = rgbToOklab([255, 255, 255]);
  assert.ok(Math.abs(l - 1) < 1e-3 && Math.abs(a) < 1e-3 && Math.abs(b) < 1e-3);
  assert.ok(Math.abs(rgbToOklab([0, 0, 0])[0]) < 1e-9);
  const grey = rgbToOklab([128, 128, 128]);
  assert.ok(Math.abs(grey[1]) < 1e-3 && Math.abs(grey[2]) < 1e-3);
});

test("Botanical Sage and Warm Parchment, which an RGB tolerance called the same (A P2-A), are apart over the check's ΔE 2 line in both ink and ground; a colour and itself are 0", () => {
  // Their inks, near black, are only 2.8 apart, which is why the line is 2, not A's "about 3".
  const ink = deltaEOk([36, 44, 36], [44, 36, 28]);
  assert.ok(ink > 2 && ink < 3, String(ink));
  assert.ok(deltaEOk([232, 234, 227], [226, 217, 201]) > 2);
  assert.equal(deltaEOk([244, 236, 220], [244, 236, 220]), 0);
  // One step of 8-bit rounding is under the line.
  assert.ok(deltaEOk([244, 236, 220], [245, 236, 220]) < 1);
});
