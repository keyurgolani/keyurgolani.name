import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readPair } from '@portfolio/schema/node';
// The registry loads the variant packages, which need React's client build,
// so this test runs without the react-server condition (a .test.tsx file).
import { listManifests } from '~/lib/registry';
import { createAppearanceCatalog } from './appearance-catalog';

// The bundled pair, which demo serves and next dev renders with no documents
// (#4, item 9), against the variants this build registers.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
};

test('the bundled examples are a pair with no blocking record, against this build', () => {
  const result = readPair(EXAMPLES, { catalog: createAppearanceCatalog(listManifests()) });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(
    result.diagnostics.map(({ code }) => code),
    [],
  );
  // Every appearance id it names is registered; only the design language,
  // which has no registry yet, goes unchecked.
  assert.deepEqual(result.notChecked, [
    'origin.sample',
    'origin.stale',
    'site.appearance.designLanguage',
  ]);
});

test('the site example renders the baseline appearance, with the approved visitor controls', () => {
  const result = readPair(EXAMPLES);
  assert.ok(result.ok);
  const { appearance, visitorControls, motionPolicy, features } = result.pair.site;
  assert.deepEqual(appearance, {
    variant: 'editorial',
    designLanguage: 'platform-neutral',
    colorScheme: 'warm',
    typography: 'classic',
    displayMode: 'system',
  });
  assert.deepEqual(visitorControls, {
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'selectable',
    typography: 'locked',
    displayMode: 'selectable',
  });
  assert.equal(motionPolicy, 'respect-os');
  assert.deepEqual(features, { feed: true, productAttribution: false });
  // No catalog says which generator a scheme has, so the example names none.
  assert.equal(result.pair.site.appearanceInputs, undefined);
});
