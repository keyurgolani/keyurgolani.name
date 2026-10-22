import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  COLOR_ROLES,
  LANGUAGE_KEYS,
  TYPOGRAPHY_FIELDS,
  TYPOGRAPHY_MEASURES,
  TYPOGRAPHY_ROLES,
} from '../tokens';
import { LAYER_ORDER } from '../layers';
import { SLOT_VALUES } from '../slots';

// The primitives' stylesheet (#19, Slice 3, item 2) holds no appearance of
// its own: every value comes through var(--color-*), var(--ui-*),
// var(--type-*), or --layout-*, as Slice 5's audit will require. These
// checks hold it to that now.

const SOURCE = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
/** The stylesheet without its comments. */
const CSS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every declaration, `property: value`, with the at-rule and selector text left out. */
function declarations(css: string): { property: string; value: string }[] {
  const found: { property: string; value: string }[] = [];
  for (const block of css.matchAll(/\{([^{}]*)\}/g)) {
    for (const piece of block[1]!.split(';')) {
      const colon = piece.indexOf(':');
      if (colon < 0 || piece.trim() === '') continue;
      found.push({ property: piece.slice(0, colon).trim(), value: piece.slice(colon + 1).trim() });
    }
  }
  return found;
}

const DECLARATIONS = declarations(CSS);

test('it starts with the layer order, and every rule sits in the reset or utilities layer', () => {
  assert.ok(CSS.trimStart().startsWith(LAYER_ORDER));
  const rest = CSS.trimStart().slice(LAYER_ORDER.length);
  // Each top-level block's prelude, and whatever sits outside every block.
  const preludes: string[] = [];
  let depth = 0;
  let prelude = '';
  for (const character of rest) {
    if (character === '{') {
      if (depth === 0) preludes.push(prelude.trim());
      prelude = '';
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    } else if (depth === 0) {
      prelude += character;
    }
  }
  assert.deepEqual(preludes, ['@layer reset', '@layer utilities']);
  assert.equal(prelude.trim(), '', 'nothing outside the two layers');
});

test('no color literal: colors come from the scheme', () => {
  const NAMED =
    /\b(?:black|white|red|green|blue|gray|grey|silver|canvas|canvastext|highlight|buttonface|buttontext)\b/i;
  for (const { property, value } of DECLARATIONS) {
    assert.doesNotMatch(value, /#[0-9a-f]{3,8}\b/i, `${property}: ${value}`);
    assert.doesNotMatch(
      value,
      /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|light-dark)\(/i,
      `${property}: ${value}`,
    );
    assert.doesNotMatch(value, NAMED, `${property}: ${value}`);
  }
});

test('no font, radius, shadow, blur, or timing literal: each comes from its pack', () => {
  const tokenOnly: Readonly<Record<string, RegExp>> = {
    'font-family': /^var\(--type-[a-z-]+-font-family\)$/,
    'font-size': /^var\(--type-[a-z-]+-font-size\)$/,
    'font-weight': /^var\(--type-[a-z-]+-font-weight\)$/,
    'line-height': /^var\(--type-[a-z-]+-line-height\)$/,
    'letter-spacing': /^var\(--type-[a-z-]+-letter-spacing\)$/,
    'font-variation-settings': /^var\(--type-[a-z-]+-font-variation-settings\)$/,
    'border-radius': /^var\(--ui-radius-[a-z]+\)$/,
    'box-shadow': /^(?:none|var\(--ui-shadow-[a-z]+\))$/,
    'transition-duration': /^var\(--ui-motion-(?:fast|standard|slow)\)$/,
    'transition-timing-function': /^var\(--ui-motion-easing\)$/,
  };
  for (const { property, value } of DECLARATIONS) {
    const rule = tokenOnly[property];
    if (rule) assert.match(value, rule, `${property}: ${value}`);
    if (property === 'font') assert.equal(value, 'inherit');
    assert.doesNotMatch(value, /\bblur\(/, `${property}: ${value}`);
    // A duration: digits then s or ms, outside a token.
    assert.doesNotMatch(value, /(?<![\w-])\d*\.?\d+m?s\b/, `${property}: ${value}`);
    assert.doesNotMatch(
      value,
      /(?<![\w-])(?:ease(?:-in|-out|-in-out)?|linear|cubic-bezier|steps)(?![\w-])/,
      `${property}: ${value}`,
    );
  }
  for (const animation of DECLARATIONS.filter(({ property }) => property === 'animation')) {
    assert.match(
      animation.value,
      /^var\(--ui-motion-(?:enter|exit|emphasis)\) var\(--ui-motion-(?:fast|standard|slow)\) var\(--ui-motion-easing\)(?: infinite)?$/,
      animation.value,
    );
  }
});

test("no !important, no custom property of its own, and no preference query, which is the accessibility layer's", () => {
  assert.doesNotMatch(CSS, /!important/);
  for (const { property } of DECLARATIONS) assert.ok(!property.startsWith('--'), property);
  assert.doesNotMatch(CSS, /prefers-|forced-colors|inverted-colors|@media print/);
});

test('every custom property it reads is one token contract 1 defines, or a variant layout one', () => {
  const tokens = new Set([
    ...COLOR_ROLES.map((role) => `--color-${role}`),
    ...LANGUAGE_KEYS.map((key) => `--ui-${key}`),
    ...TYPOGRAPHY_ROLES.flatMap((role) =>
      TYPOGRAPHY_FIELDS.map((field) => `--type-${role}-${field}`),
    ),
    ...TYPOGRAPHY_MEASURES.map((measure) => `--type-measure-${measure}`),
  ]);
  const read = [...CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]!);
  assert.ok(read.length > 100);
  for (const property of read) {
    assert.ok(
      tokens.has(property) || property.startsWith('--layout-'),
      `${property} isn't a token`,
    );
  }
});

test('every slot it styles is one SLOTS names', () => {
  const known = new Set<string>(SLOT_VALUES);
  const styled = [...CSS.matchAll(/\[data-ui-slot='([^']+)'\]/g)].map((match) => match[1]!);
  for (const slot of styled) assert.ok(known.has(slot), slot);
  for (const slot of SLOT_VALUES.filter((value) => !value.includes('.'))) {
    assert.ok(
      styled.some((value) => value === slot || value.startsWith(`${slot}.`)),
      `${slot} has no style`,
    );
  }
});

test('focus is an outline in the language and the scheme, in the utilities layer', () => {
  const utilities = CSS.slice(CSS.indexOf('@layer utilities'));
  assert.match(
    utilities,
    /\[data-appearance-boundary\] :focus-visible \{\s*outline: var\(--ui-focus-width\) var\(--ui-focus-style\) var\(--color-focus\);\s*outline-offset: var\(--ui-focus-offset\);/,
  );
});

test('touch targets keep their floors, in the utilities layer, whatever the control height', () => {
  const utilities = CSS.slice(CSS.indexOf('@layer utilities'));
  assert.match(
    utilities,
    /min-block-size: max\(24px, var\(--ui-control-height, 0px\)\);\s*min-inline-size: 24px;/,
  );
  assert.match(utilities, /@media \(max-width: 768px\)[\s\S]*min-block-size: max\(32px/);
  assert.match(utilities, /\[data-pinned\][\s\S]*min-block-size: 44px;/);
  assert.match(
    utilities,
    /@media \(pointer: coarse\)[\s\S]*\[data-emphasis='primary'\][\s\S]*min-block-size: 44px;/,
  );
});
