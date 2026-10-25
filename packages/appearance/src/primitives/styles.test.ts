import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  COLOR_ROLES,
  LANGUAGE_KEYS,
  TYPOGRAPHY_FIELDS,
  TYPOGRAPHY_MEASURES,
  TYPOGRAPHY_ROLES,
} from '../tokens';
import { LAYER_ORDER } from '../layers';
import type { DesignLanguageManifest } from '../manifests';
import { catalogPacks, packPackages } from '../node/catalog';
import { compilePack } from '../node/compile';
import { NAMED_COLORS } from '../node/source-audit';
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
  // The source audit's list and word rule, so the primitives and the
  // variants answer to one: `background` is a system color, but not inside
  // `background-color`.
  const NAMED = new RegExp(`(?<![\\w-])(?:${NAMED_COLORS.join('|')})(?![\\w(-])`, 'i');
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

/**
 * The one color mix whose amount is a literal, and its rule: the approved
 * prototype's backdrop; no contract-1 token carries scrim opacity. The
 * source audit doesn't read the primitives, so audit-exceptions.json holds
 * nothing for it; a wider audit that does is deferred (#102).
 */
const BACKDROP_MIX = {
  rule: "[data-ui-slot='dialog']::backdrop",
  call: 'color-mix(in srgb, var(--color-scrim) 62%, transparent)',
} as const;

/**
 * A literal percentage, such as 62%, .5%, 6.2e1%, or -62%, standing on its
 * own. A minus sign is part of the number, so it can't hide one: only a
 * word character or a dot before the digits makes them part of something
 * else, such as a token's name.
 */
const LITERAL_PERCENTAGE = /(?<![\w.])-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%/i;

test('the literal percentage check finds every spelling of one, and no token', () => {
  for (const literal of [
    '62%',
    '0.5%',
    '.5%',
    '6.2e1%',
    '62E0%',
    '1e+2%',
    '6.2e-1%',
    '-62%',
    '-.5%',
    '+62%',
  ]) {
    assert.match(
      `color-mix(in srgb, var(--color-scrim) ${literal}, transparent)`,
      LITERAL_PERCENTAGE,
      literal,
    );
  }
  for (const token of [
    'color-mix(in srgb, var(--color-scrim) var(--ui-surface-opacity), transparent)',
    'color-mix(in srgb, var(--color-x2) calc(var(--ui-a1) * 1), transparent)',
    'color-mix(in srgb, var(--color-x2) calc(var(--ui-a1) - 1px), transparent)',
  ]) {
    assert.doesNotMatch(token, LITERAL_PERCENTAGE, token);
  }
});

test('a color mix takes its amount from a token too, never a literal percentage, but for the backdrop', () => {
  let mixes = 0;
  let backdrops = 0;
  for (const { property, value } of DECLARATIONS) {
    for (let start = value.indexOf('color-mix('); start >= 0;) {
      // The call, to its own closing parenthesis.
      let depth = 0;
      let end = start + 'color-mix'.length;
      for (; end < value.length; end += 1) {
        if (value[end] === '(') depth += 1;
        else if (value[end] === ')' && --depth === 0) break;
      }
      const call = value.slice(start, end + 1);
      mixes += 1;
      if (call === BACKDROP_MIX.call && property === 'background-color') backdrops += 1;
      else assert.doesNotMatch(call, LITERAL_PERCENTAGE, `${property}: ${call}`);
      start = value.indexOf('color-mix(', end);
    }
  }
  assert.ok(mixes > 0, 'the surfaces mix their colors');
  // Once, and in the backdrop's own rule.
  assert.equal(backdrops, 1, BACKDROP_MIX.call);
  const rule = CSS.slice(CSS.indexOf(`${BACKDROP_MIX.rule} {`));
  assert.ok(
    rule.slice(0, rule.indexOf('}')).includes(`background-color: ${BACKDROP_MIX.call};`),
    BACKDROP_MIX.rule,
  );
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
    // A blur takes the language's token, never a length of its own.
    assert.doesNotMatch(value, /\bblur\((?!var\(--ui-[a-z-]+\)\))/, `${property}: ${value}`);
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

test("a busy action, and an unavailable one that keeps its focus, show whole while focused, so the ring isn't dimmed under 3:1 (#11)", () => {
  assert.match(
    CSS,
    /\[data-ui-slot='action'\]\[data-state='loading'\]:focus-visible,\s*\[data-ui-slot='action'\]\[aria-disabled='true'\]:focus-visible \{\s*opacity: 1;\s*\}/,
  );
});

test('only the display role lets a word break anywhere, so a 320px headline fits (#11)', () => {
  const block = (role: string) =>
    new RegExp(`\\[data-type-role='${role}'\\] \\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';
  assert.match(block('display'), /overflow-wrap: anywhere;/);
  for (const role of ['headline', 'body', 'label']) {
    assert.doesNotMatch(block(role), /overflow-wrap/, role);
  }
});

/** The value `property` takes in the one rule whose selector list is exactly `selectors`. */
function ruleValue(selectors: string, property: string): string {
  for (const block of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const prelude = block[1]!
      .split(',')
      .map((part) => part.trim())
      .join(', ');
    if (prelude !== selectors) continue;
    for (const piece of block[2]!.split(';')) {
      const colon = piece.indexOf(':');
      if (colon >= 0 && piece.slice(0, colon).trim() === property) {
        return piece
          .slice(colon + 1)
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
  }
  assert.fail(`no ${property} in ${selectors}`);
}

/**
 * A length token in CSS px: px, or rem at the 16px default. A bare 0 fails,
 * since calc() can't add it to a length (#11): the compiler writes it 0px.
 */
function px(value: string): number {
  const match = /^(-?\d*\.?\d+)(px|rem)$/.exec(value.trim());
  assert.ok(match, `${value} is a px or rem length`);
  return Number.parseFloat(match[1]!) * (match[2] === 'rem' ? 16 : 1);
}

/** `value`, a calc() or max() of --ui-* lengths, resolved in px with `tokens`. */
function resolve(value: string, tokens: Record<string, string>): number {
  const expression = value
    .replace(/var\(--ui-([a-z0-9-]+)\)/g, (_, key: string) => {
      assert.ok(tokens[key] !== undefined, `the pack sets ${key}`);
      return `(${px(tokens[key]!)})`;
    })
    .replace(/calc\(/g, '(')
    .replace(/max\(/g, 'Math.max(');
  assert.match(expression.replace(/Math\.max/g, ''), /^[\d\s.+\-*/(),]*$/, expression);
  return Function(`return ${expression};`)() as number;
}

test("the part after a field's or select's control, and a tooltip, stand off the focus ring's reach in every registered language (#11)", () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const languages = catalogPacks(root, packPackages(root)).filter(
    (pack) => pack.axis === 'designLanguage',
  );
  assert.ok(languages.length >= 30, `${languages.length} languages`);
  const spacing = {
    'field and select gap': ruleValue("[data-ui-slot='field'], [data-ui-slot='select']", 'gap'),
    'tooltip offset': ruleValue("[data-ui-slot='tooltip']", 'margin-block-end'),
  };
  for (const pack of languages) {
    const tokens = (pack.manifest as { tokens: Record<string, string> }).tokens;
    const reach = px(tokens['focus-width']!) + px(tokens['focus-offset']!);
    for (const [what, value] of Object.entries(spacing)) {
      const resolved = resolve(value, tokens);
      assert.ok(
        resolved >= reach,
        `${pack.id}: the ${what} is ${resolved}px, under the ring's ${reach}px`,
      );
      assert.ok(
        resolved >= px(tokens['space-control-block']!) / 2,
        `${pack.id}: the ${what} keeps the language's own spacing as its floor`,
      );
    }
  }
});

test("a language's bare 0 focus-offset still leaves the gap at the ring's reach, as the compiler writes it (#11)", () => {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const neutral = catalogPacks(root, packPackages(root)).find(
    ({ id }) => id === 'platform-neutral',
  )!;
  const manifest = neutral.manifest as unknown as DesignLanguageManifest;
  const result = compilePack({
    kind: 'design-language',
    manifest: {
      ...manifest,
      tokens: {
        ...manifest.tokens,
        'focus-offset': '0',
        // Half of it, 1px, is under the 2px ring, so the ring's reach sets the gap.
        'space-control-block': '0.125rem',
      },
    },
    dir: fileURLToPath(new URL(`${neutral.dir}/`, `file://${root}/`)),
  });
  assert.ok(result.ok);
  const compiled = new TextDecoder().decode(result.pack.stylesheet!.bytes);
  const tokens = Object.fromEntries(
    [...compiled.matchAll(/--ui-([a-z0-9-]+): ([^;]+);/g)].map(([, key, value]) => [key!, value!]),
  );
  assert.equal(tokens['focus-offset'], '0px');
  const gap = ruleValue("[data-ui-slot='field'], [data-ui-slot='select']", 'gap');
  assert.equal(resolve(gap, tokens), px(tokens['focus-width']!));
  assert.equal(
    resolve(ruleValue("[data-ui-slot='tooltip']", 'margin-block-end'), tokens),
    px(tokens['focus-width']!),
  );
});
