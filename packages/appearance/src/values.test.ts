import test from 'node:test';
import assert from 'node:assert/strict';
import { fontStackProblem, languageValueProblem } from './index';
import { PLATFORM_NEUTRAL, TRANSLUCENT } from './test-support/packs';

test('the fallback and fixture languages are values a language may hold', () => {
  for (const [key, value] of Object.entries({ ...PLATFORM_NEUTRAL.tokens, ...TRANSLUCENT.tokens })) {
    assert.equal(languageValueProblem(value), null, `${key}: ${value}`);
  }
  for (const value of [
    '0 10px',
    '16px 24px / 8px',
    'steps(4, end)',
    'translate(-2px, -2px)',
    'calc(var(--color-accent))',
    'currentColor',
    'repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--color-border-subtle) 50%, transparent) 5px 6px)',
  ]) {
    assert.equal(languageValueProblem(value), null, value);
  }
});

test('a language value reaches nothing outside its declaration', () => {
  const rejected: Array<[string, RegExp]> = [
    ['url(images/x.png)', /url\(\) isn't allowed/],
    ['URL(x.png)', /url\(\) isn't allowed/],
    ['url(https://example.test/x.png)', /colons/],
    ['red; } body { display: none', /no quotes, braces, semicolons/],
    ['1px solid { }', /no quotes, braces, semicolons/],
    ['2px /* hidden */', /comment/],
    ['2px */', /comment/],
    ['u\\72l(x)', /backslashes/],
    ['image-set("x.png" 1x)', /no quotes/],
    ["image-set('x.png' 1x)", /no quotes/],
    ['2px !important', /!/],
    ['translate(1px', /parenthesis open/],
    ['1px)', /never opened/],
    ['attr(data-x)', /calls attr\(\)/],
    ['env(safe-area-inset-top)', /calls env\(\)/],
    ['image(x)', /calls image\(\)/],
    ['', /not empty/],
    [' 2px', /whitespace/],
    ['2px\n', /whitespace/],
    ['a'.repeat(2001), /at most 2000/],
  ];
  for (const [value, message] of rejected) {
    assert.match(languageValueProblem(value) ?? 'accepted', message, value);
  }
  assert.match(languageValueProblem(12) ?? '', /CSS text/);
});

test('a language value gets color only through var(--color-<role>)', () => {
  const rejected: Array<[string, RegExp]> = [
    ['#fff', /no quotes, braces, semicolons, backslashes, #/],
    ['1px solid rgb(0, 0, 0)', /can't make a color with rgb\(\)/],
    ['oklch(0.5 0.1 200)', /oklch\(\)/],
    ['color(display-p3 1 0 0)', /color\(\)/],
    ['light-dark(white, black)', /light-dark\(\)/],
    ['1px solid black', /can't hold the color black/],
    ['0 0 4px RebeccaPurple', /rebeccapurple/],
    ['1px solid CanvasText', /canvastext/],
    ['var(--ui-radius-card)', /only as var\(--color-<role>\)/],
    ['var(--color-accent, red)', /only as var\(--color-<role>\)/],
    ['var(--color-not-a-role)', /only as var\(--color-<role>\)/],
    ['var( --color-accent )', /only as var\(--color-<role>\)/],
  ];
  for (const [value, message] of rejected) {
    assert.match(languageValueProblem(value) ?? 'accepted', message, value);
  }
  // Units and words that merely contain a color's name are fine.
  assert.equal(languageValueProblem('transparent'), null);
  assert.equal(languageValueProblem('2em'), null);
  assert.equal(languageValueProblem('var(--color-canvas)'), null);
  assert.equal(languageValueProblem('hue-rotate(20deg)'), null);
});

test('a font stack is plain families that end with a generic family', () => {
  for (const stack of [
    '"Trebuchet MS", "Segoe UI", sans-serif',
    'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'Charter, "Bitstream Charter", Georgia, serif',
  ]) {
    assert.equal(fontStackProblem(stack), null, stack);
  }
  const rejected: Array<[string, RegExp]> = [
    ['"Inter"', /end with a generic family/],
    ['"Inter", "sans-serif"', /end with a generic family/],
    ['Inter, sans-serif; color: red', /families separated by commas/],
    ['"Inter\\"", sans-serif', /families separated by commas/],
    ["'Inter', sans-serif", /families separated by commas/],
    ['var(--type-body-font-family), sans-serif', /families separated by commas/],
    ['inherit, sans-serif', /can't use inherit/],
    [`${'"A", '.repeat(12)}serif`, /at most 12 families/],
  ];
  for (const [stack, message] of rejected) {
    assert.match(fontStackProblem(stack) ?? 'accepted', message, stack);
  }
});
