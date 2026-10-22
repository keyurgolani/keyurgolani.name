import test from 'node:test';
import assert from 'node:assert/strict';
import { contrast, isHex, lightness, luminance, mix, withLightness } from './color';
import { randomHex, seeded } from './test-support/packs';

test('mix is color-mix(in srgb) with each channel rounded half up', () => {
  assert.equal(mix('#000000', '#ffffff', 50), '#808080'); // 127.5 rounds up
  assert.equal(mix('#f6eddc', '#2b241c', 3), '#f0e7d6');
  assert.equal(mix('#2b241c', '#f6eddc', 28), '#645c52');
  assert.equal(mix('#123456', '#abcdef', 0), '#123456');
  assert.equal(mix('#123456', '#abcdef', 100), '#abcdef');
  assert.throws(() => mix('#000000', '#ffffff', 12.5), RangeError);
  assert.throws(() => mix('#000000', '#ffffff', 101), RangeError);
});

test('contrast is WCAG 2', () => {
  assert.equal(contrast('#000000', '#ffffff'), 21);
  assert.equal(contrast('#ffffff', '#000000'), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.equal(luminance('#ffffff'), 1);
  assert.ok(Math.abs(contrast('#767676', '#ffffff') - 4.54) < 0.01);
});

test('a lightness step keeps the color in sRGB and moves the way it was asked', () => {
  const random = seeded(19);
  for (let index = 0; index < 500; index += 1) {
    const color = randomHex(random);
    // 8-bit channels can't show lightness just above black: #010101 is already about 0.067.
    const target = 0.1 + 0.85 * random();
    const stepped = withLightness(color, target);
    assert.ok(isHex(stepped), `${color} at ${target} gave ${stepped}`);
    // Rounding to 8-bit channels and mapping chroma into sRGB keep it within a step's width.
    assert.ok(
      Math.abs(lightness(stepped) - target) < 0.02,
      `${color} at ${target} gave ${stepped}`,
    );
  }
  assert.equal(withLightness('#917a84', 0.02), '#000000');
  assert.equal(withLightness('#336699', 0), '#000000');
  assert.equal(withLightness('#336699', 1), '#ffffff');
});
