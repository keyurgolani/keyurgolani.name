import test from 'node:test';
import assert from 'node:assert/strict';
import { runGenerator } from './generators';
import { DerivedSchemeSchema, readDerivedSchemes, type DerivedScheme } from './index';

// The derived.schemes entry (#10, 10h): what a draft save stores for a
// generator scheme and a publish freezes. It holds exactly the generator,
// the input's hash, and two complete color sets, and nothing else.

function entry(): DerivedScheme {
  const run = runGenerator(
    { id: 'fixture-seed', version: 1, input: 'seed-color' },
    { seedColor: '#3366FF' },
  );
  assert.ok(run.ok);
  return {
    generator: run.result.generator,
    inputsHash: 'a'.repeat(64),
    tokens: run.result.tokens,
  };
}

test("a generator's result, with its input's hash, is a derived scheme, and parses to the same value", () => {
  const scheme = entry();
  const parsed: DerivedScheme = DerivedSchemeSchema.parse(scheme);
  assert.deepEqual(parsed, scheme);
});

test('an incomplete token set, a mode missing, or a hash that is no SHA-256 is refused', () => {
  const scheme = entry();
  const { accent: _accent, ...lightWithoutAccent } = scheme.tokens.light as Record<string, string>;
  void _accent;
  const refused: [string, unknown][] = [
    ['a role missing', { ...scheme, tokens: { ...scheme.tokens, light: lightWithoutAccent } }],
    ['a mode missing', { ...scheme, tokens: { light: scheme.tokens.light } }],
    [
      'a color that is no hex',
      { ...scheme, tokens: { ...scheme.tokens, dark: { ...scheme.tokens.dark, accent: 'blue' } } },
    ],
    ['a short hash', { ...scheme, inputsHash: 'abc' }],
    ['an uppercase hash', { ...scheme, inputsHash: 'A'.repeat(64) }],
    ['a version that is no positive integer', { ...scheme, generator: { id: 'x', version: 0 } }],
    ['no generator', { inputsHash: scheme.inputsHash, tokens: scheme.tokens }],
  ];
  for (const [what, value] of refused) {
    assert.equal(DerivedSchemeSchema.safeParse(value).success, false, what);
  }
});

test('a field the shape lacks is refused, at the top, in the generator, in the tokens, and in a mode', () => {
  const scheme = entry();
  const refused: [string, unknown][] = [
    ['at the top', { ...scheme, fetchedAt: '2026-10-24T00:00:00Z' }],
    ['in the generator', { ...scheme, generator: { ...scheme.generator, input: 'seed-color' } }],
    [
      'in the tokens',
      { ...scheme, tokens: { ...scheme.tokens, highContrast: scheme.tokens.light } },
    ],
    [
      'in a mode',
      {
        ...scheme,
        tokens: { ...scheme.tokens, light: { ...scheme.tokens.light, glow: '#ffffff' } },
      },
    ],
  ];
  for (const [what, value] of refused) {
    assert.equal(DerivedSchemeSchema.safeParse(value).success, false, what);
  }
});

test('the high-contrast sets are optional, kept as they are when present, and each checked as a whole set', () => {
  const scheme = entry();
  const withContrast: DerivedScheme = {
    ...scheme,
    tokens: {
      ...scheme.tokens,
      highContrast: { light: scheme.tokens.dark, dark: scheme.tokens.light },
    },
  };
  assert.deepEqual(DerivedSchemeSchema.parse(withContrast), withContrast);
  assert.deepEqual(DerivedSchemeSchema.parse(scheme), scheme, 'without them, still whole');
  const { accent: _accent, ...partial } = scheme.tokens.light as Record<string, string>;
  void _accent;
  for (const [what, highContrast] of [
    ['a set missing a role', { light: partial, dark: scheme.tokens.dark }],
    ['a mode missing', { light: scheme.tokens.light }],
    [
      'a field it lacks',
      { light: scheme.tokens.light, dark: scheme.tokens.dark, print: scheme.tokens.light },
    ],
  ] as const) {
    const value = { ...scheme, tokens: { ...scheme.tokens, highContrast } };
    assert.equal(DerivedSchemeSchema.safeParse(value).success, false, what);
  }
});

test('readDerivedSchemes keeps each entry that checks, high-contrast sets and all, leaves out each that does not with a problem naming its scheme, and never throws', () => {
  const scheme = entry();
  const contrasted = {
    ...scheme,
    tokens: {
      ...scheme.tokens,
      highContrast: { light: scheme.tokens.dark, dark: scheme.tokens.light },
    },
  };
  const read = readDerivedSchemes({
    brand: scheme,
    contrasted,
    broken: { ...scheme, tokens: { light: scheme.tokens.light } },
    junk: 'not an entry',
  });
  assert.deepEqual(Object.keys(read.schemes).sort(), ['brand', 'contrasted']);
  assert.deepEqual(read.schemes.contrasted, contrasted, 'it round-trips as it is');
  assert.deepEqual(
    read.problems.map(({ code, schemeId }) => [code, schemeId]),
    [
      ['scheme.invalid', 'broken'],
      ['scheme.invalid', 'junk'],
    ],
  );
  // Nothing, or anything that isn't an object of entries, gives no scheme, and never a throw.
  assert.deepEqual(readDerivedSchemes(undefined), { schemes: {}, problems: [] });
  for (const value of [[], 'schemes', 7, true]) {
    const none = readDerivedSchemes(value);
    assert.deepEqual(none.schemes, {});
    assert.equal(none.problems.length, 1);
  }
  // A key that names a property of every object reads as data, not as one.
  const tricky = readDerivedSchemes(JSON.parse(`{"__proto__": ${JSON.stringify(scheme)}}`));
  assert.deepEqual(Object.keys(tricky.schemes), ['__proto__']);
  assert.equal(Object.getPrototypeOf(tricky.schemes), Object.prototype);
});
