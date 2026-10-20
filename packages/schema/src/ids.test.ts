import test from 'node:test';
import assert from 'node:assert/strict';
import { isLanguageTag, isSectionId } from './ids';
import { SectionIdSchema } from './kinds/common';

test('isSectionId agrees with SectionIdSchema', () => {
  const samples = ['top', 'get-in-touch', 'a1-b2', 'a'.repeat(64), 'a'.repeat(65)];
  samples.push('main', 'Main', 'a--b', '-a', 'a-', '', 'a_b', 'é');
  for (const id of samples) {
    assert.equal(isSectionId(id), SectionIdSchema.safeParse(id).success, id);
  }
});

test('isLanguageTag accepts what Intl.getCanonicalLocales accepts', () => {
  for (const tag of ['en', 'en-US', 'en-us', 'sr-Latn-RS', 'und']) {
    assert.ok(isLanguageTag(tag), tag);
  }
  for (const tag of ['', 'en_US', 'en,fr', 'x-private']) {
    assert.ok(!isLanguageTag(tag), tag);
  }
});
