import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppearanceAxis, AppearanceSelection } from '@portfolio/schema';
import {
  APPEARANCE_AXES,
  DISPLAY_MODES,
  parseSelection,
  PLATFORM_DEFAULTS,
  serializeSelection,
  setAxis,
  type SelectionValues,
} from './index';
import { pick, seeded, testRegistry } from './test-support/packs';

const registry = testRegistry();
const BASE: AppearanceSelection = { ...PLATFORM_DEFAULTS, variant: 'acme-gallery' };

const codeOf = (selection: AppearanceSelection, axis: AppearanceAxis, value: string) =>
  setAxis(selection, axis, value, registry).diagnostic?.code ?? 'changed';

test('setAxis changes the one value it is given', () => {
  for (const [axis, value] of [
    ['variant', 'editorial-evidence'],
    ['designLanguage', 'fixture-translucent'],
    ['colorScheme', 'fixture-light-only'],
    ['typography', 'multilingual-system'],
    ['displayMode', 'high-contrast'],
  ] as const) {
    const result = setAxis(BASE, axis, value, registry);
    assert.equal(result.diagnostic, undefined, axis);
    assert.deepEqual(result.selection, { ...BASE, [axis]: value });
  }
  // A Research pack can be selected for review; publishing it is the validator's to refuse.
  assert.equal(codeOf(BASE, 'colorScheme', 'fixture-research'), 'changed');
  // Anything else the selection holds is carried over.
  const extended = { ...BASE, extensions: { '@acme/x': { note: 'kept' } } };
  assert.deepEqual(
    setAxis(extended, 'typography', 'multilingual-system', registry).selection.extensions,
    extended.extensions,
  );
});

test('setAxis refuses what an axis cannot take, and changes nothing', () => {
  const cases: Array<[AppearanceAxis, string, string]> = [
    ['designLanguage', 'missing-pack', 'appearance.unavailable'],
    ['colorScheme', 'missing-pack', 'appearance.unavailable'],
    ['typography', 'missing-pack', 'appearance.unavailable'],
    ['variant', 'missing-variant', 'variant.unavailable'],
    ['variant', 'fallback', 'variant.unavailable'],
    ['designLanguage', 'Not An Id', 'schema.invalid'],
    ['displayMode', 'sepia', 'schema.invalid'],
    ['colorScheme', 'platform-neutral', 'schema.invalid'],
    ['typography', 'warm-parchment', 'schema.invalid'],
    ['variant', 'humanist-ui', 'schema.invalid'],
  ];
  for (const [axis, value, code] of cases) {
    const result = setAxis(BASE, axis, value, registry);
    assert.equal(result.diagnostic?.code, code, `${axis} ${value}`);
    assert.equal(result.selection, BASE);
  }
  const unavailable = setAxis(BASE, 'colorScheme', 'missing-pack', registry).diagnostic!;
  assert.equal(unavailable.message, "names a color scheme this build doesn't register.");
  assert.match(
    unavailable.remediation,
    /select one this build registers: fixture-asset, fixture-dark-only, fixture-light-only, fixture-seed, warm-parchment\.$/,
  );
  assert.ok(!unavailable.message.includes('missing-pack'));
});

test('a mode the scheme lacks is refused, never fixed by changing another value', () => {
  const light = { ...BASE, displayMode: 'light' as const };
  const dark = setAxis(light, 'colorScheme', 'fixture-dark-only', registry);
  assert.equal(dark.diagnostic?.code, 'appearance.mode-incompatible');
  assert.equal(dark.diagnostic?.axis, 'colorScheme');
  assert.equal(dark.selection, light);
  const onDark = { ...BASE, colorScheme: 'fixture-dark-only' };
  assert.equal(codeOf(onDark, 'displayMode', 'light'), 'appearance.mode-incompatible');
  for (const mode of ['system', 'dark', 'high-contrast'] as const)
    assert.equal(codeOf(onDark, 'displayMode', mode), 'changed');
  // System, dark, and high contrast all fit a dark-only scheme.
  for (const mode of ['system', 'dark', 'high-contrast'] as const) {
    assert.equal(
      codeOf({ ...BASE, displayMode: mode }, 'colorScheme', 'fixture-dark-only'),
      'changed',
    );
  }
});

/** Ids and modes worth trying on any axis: registered, unregistered, malformed, and other axes'. */
const CANDIDATES = [
  ...['editorial-evidence', 'acme-gallery', 'fallback', 'missing-variant'],
  ...['platform-neutral', 'fixture-translucent'],
  ...[
    'warm-parchment',
    'fixture-dark-only',
    'fixture-light-only',
    'fixture-seed',
    'fixture-research',
  ],
  ...['humanist-ui', 'multilingual-system'],
  ...DISPLAY_MODES,
  ...['missing-pack', 'Not An Id', '', 'x', 'warm-parchment ', '__proto__', 'constructor'],
];

/** Values each axis registers, so about half the tries are ones the axis can take. */
const OWN: Readonly<Record<AppearanceAxis, readonly string[]>> = {
  variant: ['editorial-evidence', 'acme-gallery'],
  designLanguage: ['platform-neutral', 'fixture-translucent'],
  colorScheme: [
    'warm-parchment',
    'fixture-dark-only',
    'fixture-light-only',
    'fixture-seed',
    'fixture-research',
  ],
  typography: ['humanist-ui', 'multilingual-system'],
  displayMode: DISPLAY_MODES,
};

function randomSelection(random: () => number): AppearanceSelection {
  return {
    variant: pick(random, ['editorial-evidence', 'acme-gallery', 'missing-variant']),
    designLanguage: pick(random, ['platform-neutral', 'fixture-translucent', 'missing-pack']),
    colorScheme: pick(random, [
      'warm-parchment',
      'fixture-dark-only',
      'fixture-light-only',
      'fixture-seed',
      'missing-pack',
    ]),
    typography: pick(random, ['humanist-ui', 'multilingual-system', 'missing-pack']),
    displayMode: pick(random, DISPLAY_MODES),
  };
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test('property: setAxis leaves the other four values byte-identical', () => {
  const random = seeded(19_001);
  let changed = 0;
  let refused = 0;
  for (let index = 0; index < 5000; index += 1) {
    const selection = Object.freeze(randomSelection(random));
    const before = bytes(selection);
    const axis = pick(random, APPEARANCE_AXES);
    const value = random() < 0.5 ? pick(random, OWN[axis]) : pick(random, CANDIDATES);
    const result = setAxis(selection, axis, value, registry);
    for (const other of APPEARANCE_AXES.filter((each) => each !== axis)) {
      assert.deepEqual(
        bytes(result.selection[other]),
        bytes(selection[other]),
        `${axis}=${value} moved ${other}`,
      );
    }
    assert.deepEqual(bytes(selection), before, 'the input is never changed');
    if (result.diagnostic) {
      refused += 1;
      assert.equal(result.selection, selection);
    } else {
      changed += 1;
      assert.equal(result.selection[axis], value);
    }
  }
  // Both outcomes came up often enough to mean something.
  assert.ok(changed > 1000 && refused > 1000, `${changed} changed, ${refused} refused`);
});

test('a selection serializes in axis order with the demo query keys', () => {
  assert.equal(
    serializeSelection(BASE),
    'variant=acme-gallery&language=platform-neutral&scheme=warm-parchment&type=humanist-ui&mode=system',
  );
  assert.equal(
    serializeSelection({ displayMode: 'dark', colorScheme: 'fixture-dark-only' }),
    'scheme=fixture-dark-only&mode=dark',
  );
  assert.equal(serializeSelection({}), '');
});

test('parseSelection keeps each well-formed value given once, and drops the rest', () => {
  assert.deepEqual(parseSelection('scheme=fixture-dark-only&mode=dark'), {
    colorScheme: 'fixture-dark-only',
    displayMode: 'dark',
  });
  assert.deepEqual(
    parseSelection(
      '?variant=a1&variant=b2&type=Bad%20Id&mode=sepia&language=platform-neutral&other=1',
    ),
    {
      designLanguage: 'platform-neutral',
    },
  );
  assert.deepEqual(parseSelection(`scheme=${'a'.repeat(1100)}`), {});
  assert.deepEqual(parseSelection(new URLSearchParams({ mode: 'high-contrast' })), {
    displayMode: 'high-contrast',
  });
  // A framework's search params: a value given twice arrives as a list, and is dropped.
  assert.deepEqual(
    parseSelection({ scheme: 'warm-parchment', variant: ['a1', 'b2'], mode: undefined }),
    {
      colorScheme: 'warm-parchment',
    },
  );
  assert.deepEqual(
    parseSelection({ __proto__: 'x', constructor: 'y' } as Record<string, string>),
    {},
  );
});

test('property: serializeSelection and parseSelection round-trip any values', () => {
  const random = seeded(19_002);
  for (let index = 0; index < 2000; index += 1) {
    const full = randomSelection(random);
    const values: SelectionValues = {};
    for (const axis of APPEARANCE_AXES) {
      if (random() < 0.6) Object.assign(values, { [axis]: full[axis] });
    }
    const text = serializeSelection(values);
    assert.deepEqual(parseSelection(text), values, text);
    assert.equal(serializeSelection(parseSelection(text)), text);
  }
});
