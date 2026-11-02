import assert from 'node:assert/strict';
import test from 'node:test';
import { ciede2000, deltaE00, hexToLab, srgbToLinear, type Lab } from './ciede2000';

// Sharma, Wu, and Dalal (2005), Table 1: the 34 reference pairs, each
// [L1, a1, b1, L2, a2, b2, ΔE00], at kL = kC = kH = 1. They exercise the
// formula's edge cases: hue angles either side of 0 and 180, the mean hue's
// three branches, neutrals, near-neutral blues where the rotation term
// matters, and dark colors where S_L dominates.
const SHARMA: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [50.0, 2.6772, -79.7751, 50.0, 0.0, -82.7485, 2.0425],
  [50.0, 3.1571, -77.2803, 50.0, 0.0, -82.7485, 2.8615],
  [50.0, 2.8361, -74.02, 50.0, 0.0, -82.7485, 3.4412],
  [50.0, -1.3802, -84.2814, 50.0, 0.0, -82.7485, 1.0],
  [50.0, -1.1848, -84.8006, 50.0, 0.0, -82.7485, 1.0],
  [50.0, -0.9009, -85.5211, 50.0, 0.0, -82.7485, 1.0],
  [50.0, 0.0, 0.0, 50.0, -1.0, 2.0, 2.3669],
  [50.0, -1.0, 2.0, 50.0, 0.0, 0.0, 2.3669],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0009, 7.1792],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.001, 7.1792],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0011, 7.2195],
  [50.0, 2.49, -0.001, 50.0, -2.49, 0.0012, 7.2195],
  [50.0, -0.001, 2.49, 50.0, 0.0009, -2.49, 4.8045],
  [50.0, -0.001, 2.49, 50.0, 0.001, -2.49, 4.8045],
  [50.0, -0.001, 2.49, 50.0, 0.0011, -2.49, 4.7461],
  [50.0, 2.5, 0.0, 50.0, 0.0, -2.5, 4.3065],
  [50.0, 2.5, 0.0, 73.0, 25.0, -18.0, 27.1492],
  [50.0, 2.5, 0.0, 61.0, -5.0, 29.0, 22.8977],
  [50.0, 2.5, 0.0, 56.0, -27.0, -3.0, 31.903],
  [50.0, 2.5, 0.0, 58.0, 24.0, 15.0, 19.4535],
  [50.0, 2.5, 0.0, 50.0, 3.1736, 0.5854, 1.0],
  [50.0, 2.5, 0.0, 50.0, 3.2972, 0.0, 1.0],
  [50.0, 2.5, 0.0, 50.0, 1.8634, 0.5757, 1.0],
  [50.0, 2.5, 0.0, 50.0, 3.2592, 0.335, 1.0],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
  [61.2901, 3.7196, -5.3901, 61.4292, 2.248, -4.962, 1.8731],
  [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
  [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
  [36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
  [90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
  [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
  [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
];

test('CIEDE2000 matches all 34 of Sharma, Wu, and Dalal’s reference pairs to 4 decimals', () => {
  assert.equal(SHARMA.length, 34);
  for (const [index, [l1, a1, b1, l2, a2, b2, expected]] of SHARMA.entries()) {
    const actual = ciede2000([l1, a1, b1], [l2, a2, b2]);
    assert.ok(
      Math.abs(actual - expected) < 5e-5,
      `pair ${index + 1}: ${actual.toFixed(6)}, expected ${expected}`,
    );
  }
});

test('CIEDE2000 is symmetric on every reference pair, and 0 for a color against itself', () => {
  for (const [l1, a1, b1, l2, a2, b2] of SHARMA) {
    const first: Lab = [l1, a1, b1];
    const second: Lab = [l2, a2, b2];
    assert.ok(Math.abs(ciede2000(first, second) - ciede2000(second, first)) < 1e-9);
    assert.equal(ciede2000(first, first), 0);
  }
  assert.equal(ciede2000([0, 0, 0], [0, 0, 0]), 0);
});

test('the parametric factors divide their term: kL 2 halves a pure lightness difference', () => {
  const pure = ciede2000([40, 0, 0], [60, 0, 0]);
  const weighted = ciede2000([40, 0, 0], [60, 0, 0], { kL: 2 });
  assert.ok(Math.abs(weighted - pure / 2) < 1e-9);
});

test('sRGB hex reads into CIELAB D65: white, black, and the primaries', () => {
  const near = (actual: Lab, expected: Lab) =>
    actual.forEach((value, index) =>
      assert.ok(
        Math.abs(value - expected[index]!) < 0.01,
        `${actual.map((v) => v.toFixed(4))} against ${expected}`,
      ),
    );
  near(hexToLab('#ffffff'), [100, 0, 0]);
  near(hexToLab('#000000'), [0, 0, 0]);
  near(hexToLab('#ff0000'), [53.2408, 80.0925, 67.2032]);
  near(hexToLab('#00ff00'), [87.7347, -86.1827, 83.1793]);
  near(hexToLab('#0000ff'), [32.297, 79.1875, -107.8602]);
  near(hexToLab('#808080'), [53.585, 0, 0]);
  assert.equal(srgbToLinear(0), 0);
  assert.ok(Math.abs(srgbToLinear(1) - 1) < 1e-12);
  assert.throws(() => hexToLab('#fff'), /six-digit hex/);
});

test('ΔE00 over hex: black to white is 100, a color against itself 0, and a 1-step gray under 1', () => {
  assert.ok(Math.abs(deltaE00('#000000', '#ffffff') - 100) < 0.01);
  assert.equal(deltaE00('#3a5f8c', '#3a5f8c'), 0);
  assert.ok(deltaE00('#808080', '#818181') < 1);
  assert.ok(deltaE00('#ff0000', '#00ff00') > 80);
});
