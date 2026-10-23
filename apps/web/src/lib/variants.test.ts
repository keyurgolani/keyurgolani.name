import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FALLBACK_ID, validateManifest, type VariantRegistry } from '@portfolio/variant-contract';
import { compositionFor, liveContext, REGISTRY } from './variants';

// Which composition renders (#5, Slice 3): the selection when this build
// registers it, else the fallback composition.

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

test('documents are checked live: an unavailable selection warns, so startup serves the fallback', () => {
  const { catalog, extensions, validators } = liveContext();
  // #4's core checks no appearance axis: the appearance check (#19) checks each.
  for (const axis of ['variant', 'designLanguage', 'colorScheme', 'typography', 'displayMode']) {
    assert.equal(catalog.ids(axis as never, {} as never), null, axis);
  }
  assert.deepEqual(extensions, []);
  // The compatibility check (#5, Slice 5), which folds in the selection,
  // controls, and toggles, and #19's appearance check.
  assert.deepEqual(
    validators.map(({ id }) => id),
    ['variant-compatibility', 'appearance'],
  );
});
