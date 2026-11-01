import test from 'node:test';
import assert from 'node:assert/strict';
import { DerivedSchemeSchema } from '@portfolio/appearance';
import { runGenerator } from '@portfolio/appearance/generators';
import { DERIVED_CAUSES } from '@portfolio/schema';
import { DerivedChangeSchema, DerivedSchemeEntrySchema } from './store-schemas';

// store-schemas.ts imports zod alone (the store-schemas-are-data rule), so
// it writes out the derived block's causes and generated scheme shape. These
// hold them to the packages' own.

const generated = () => {
  const run = runGenerator(
    { id: 'fixture-seed', version: 1, input: 'seed-color' },
    {
      seedColor: '#6750A4',
    },
  );
  assert.ok(run.ok, 'the fixture generator runs');
  return {
    generator: run.result.generator,
    inputsHash: 'a'.repeat(64),
    tokens: run.result.tokens,
  };
};

test("a derived change's causes are the schema package's DERIVED_CAUSES, no more and no fewer", () => {
  assert.deepEqual([...DerivedChangeSchema.shape.cause.options].sort(), [...DERIVED_CAUSES].sort());
});

test('a generated scheme the appearance schema takes, the store schema takes too, with or without its high-contrast sets', () => {
  const entry = generated();
  const withHighContrast = {
    ...entry,
    tokens: {
      ...entry.tokens,
      highContrast: { light: entry.tokens.light, dark: entry.tokens.dark },
    },
  };
  for (const value of [entry, withHighContrast]) {
    assert.ok(DerivedSchemeSchema.safeParse(value).success);
    assert.deepEqual(DerivedSchemeEntrySchema.parse(value), value);
  }
});

test('the store schema refuses what the appearance schema refuses: an extra field, a color that is not #rrggbb, a bad hash', () => {
  const entry = generated();
  const bad = [
    { ...entry, review: true },
    { ...entry, tokens: { ...entry.tokens, light: { ...entry.tokens.light, canvas: 'red' } } },
    { ...entry, inputsHash: 'not-a-hash' },
    { ...entry, generator: { ...entry.generator, version: 0 } },
  ];
  for (const value of bad) {
    assert.equal(DerivedSchemeSchema.safeParse(value).success, false);
    assert.equal(DerivedSchemeEntrySchema.safeParse(value).success, false);
  }
});
