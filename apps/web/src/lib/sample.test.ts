import test from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_ID } from '@portfolio/variant-contract';
import { sampleSelection, type RegisteredIds } from './sample';

// What /sample renders (#1, item 17; #5, Slice 4), against a build that
// registers the fallback composition and one other variant.

const BUILD: RegisteredIds = [
  { manifest: { id: FALLBACK_ID } },
  { manifest: { id: 'acme-ocean' } },
];

test("/sample renders the sample site's selection, or a registered variant ?variant= names", () => {
  // No parameter: the site's own selection, and links keep no query.
  assert.deepEqual(sampleSelection({}, BUILD), { query: {} });
  // A registered id: that variant, and every link and redirect keeps the parameter.
  assert.deepEqual(sampleSelection({ variant: 'acme-ocean' }, BUILD), {
    selected: 'acme-ocean',
    query: { variant: 'acme-ocean' },
  });
  // Other parameters are the page's business, not the links'.
  assert.deepEqual(sampleSelection({ variant: 'acme-ocean', utm: 'x' }, BUILD)?.query, {
    variant: 'acme-ocean',
  });
  // The fallback, an unknown id, an empty one, and one given twice are a 404.
  for (const variant of [FALLBACK_ID, 'canary-variant', '', ['acme-ocean', 'acme-ocean']]) {
    assert.equal(sampleSelection({ variant }, BUILD), null, String(variant));
  }
});

test('by default it reads the ids this build registers', () => {
  // This build registers the fallback composition, which /sample can't name.
  assert.equal(sampleSelection({ variant: FALLBACK_ID }), null);
  assert.deepEqual(sampleSelection({}), { query: {} });
});
