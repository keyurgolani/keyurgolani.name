import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FALLBACK_ID, validateManifest, type VariantRegistry } from '@portfolio/variant-contract';
import { compositionFor, liveContext, REGISTRY, sampleVariant } from './variants';

// Which composition renders (#5, Slice 3): the selection when this build
// registers it, else the fallback composition, and what /sample renders.

const FALLBACK = REGISTRY.find(({ manifest }) => manifest.id === FALLBACK_ID)!;

/** The fallback, plus one registered variant built from its manifest. */
const BUILD: VariantRegistry = (() => {
  const raw = JSON.parse(
    readFileSync(
      new URL('../../../../packages/fallback-composition/manifest.json', import.meta.url),
      'utf8',
    ),
  );
  const result = validateManifest({ ...raw, id: 'acme-ocean' }, { packageName: '@acme/ocean' });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return [FALLBACK, { packageName: '@acme/ocean', version: '1.0.0', manifest: result.manifest }];
})();

test('this build registers the fallback composition', () => {
  // Installing a variant is a dependency and nothing else, so this names no other.
  assert.equal(FALLBACK.packageName, '@portfolio/fallback-composition');
});

test('a registered selection renders itself; anything else, the fallback in its place', () => {
  assert.deepEqual(compositionFor('acme-ocean', BUILD), {
    rendered: BUILD[1],
    requested: 'acme-ocean',
    fallback: false,
  });
  for (const selected of ['missing-variant', 'editorial-evidence', FALLBACK_ID]) {
    const composition = compositionFor(selected, BUILD);
    assert.equal(composition.rendered.manifest.id, FALLBACK_ID, selected);
    assert.equal(composition.requested, selected);
    assert.equal(composition.fallback, true);
  }
  assert.throws(() => compositionFor('acme-ocean', []), /registers no fallback composition/);
});

test("/sample renders the sample site's selection, or a registered variant ?variant= names", () => {
  assert.equal(sampleVariant({}, 'editorial-evidence', BUILD), 'editorial-evidence');
  assert.equal(sampleVariant({ variant: 'acme-ocean' }, 'editorial-evidence', BUILD), 'acme-ocean');
  // The fallback, an unknown id, an empty one, and one given twice are a 404.
  for (const variant of [FALLBACK_ID, 'canary-variant', '', ['acme-ocean', 'acme-ocean']]) {
    assert.equal(sampleVariant({ variant }, 'editorial-evidence', BUILD), null, String(variant));
  }
});

test('documents are checked live: an unavailable selection warns, so startup serves the fallback', () => {
  const { catalog, extensions, validators } = liveContext();
  assert.deepEqual(catalog.ids('displayMode', {} as never), [
    'system',
    'light',
    'dark',
    'high-contrast',
  ]);
  assert.equal(catalog.ids('variant', {} as never), null);
  assert.deepEqual(extensions, []);
  assert.deepEqual(
    validators.map(({ id }) => id),
    ['variant-selection', 'variant-controls', 'variant-routes'],
  );
});
