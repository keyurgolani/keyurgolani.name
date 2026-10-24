import test from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_ID } from '@portfolio/variant-contract';
import { sampleVariant, type RegisteredIds } from './sample';

// Which variant /sample renders (#1, item 17; #5, Slice 4; #9), against a
// build that registers the fallback composition and one other variant.

const BUILD: RegisteredIds = [
  { manifest: { id: FALLBACK_ID } },
  { manifest: { id: 'acme-ocean' } },
];

const variant = (text: string, registry: RegisteredIds = BUILD) =>
  sampleVariant(new URLSearchParams(text), registry);

test("/sample renders a registered variant ?variant= names, and otherwise the sample site's own", () => {
  assert.equal(variant(''), undefined);
  assert.equal(variant('variant=acme-ocean'), 'acme-ocean');
  assert.equal(variant('variant=acme-ocean&utm=x'), 'acme-ocean');
  // The fallback, an unknown id, an empty one, another case, and one given
  // twice fall back to the sample site's own selection, never a 404 (#9).
  for (const text of [
    `variant=${FALLBACK_ID}`,
    'variant=canary-variant',
    'variant=',
    'variant=ACME-OCEAN',
    'variant=acme-ocean&variant=acme-ocean',
  ]) {
    assert.equal(variant(text), undefined, text);
  }
});

test('by default it reads the ids this build registers', () => {
  assert.equal(sampleVariant(new URLSearchParams(`variant=${FALLBACK_ID}`)), undefined);
  assert.equal(sampleVariant(new URLSearchParams()), undefined);
});
