import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readPair } from '@portfolio/schema/node';
// The registry loads the variant packages, which need React's client build,
// so this test runs without the react-server condition (a .test.tsx file).
import { liveContext } from '~/lib/variants';

// The bundled pair, which demo serves and next dev renders with no documents
// (#4, item 9), against what this build registers (#5).

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
};

test('the bundled examples are a pair with no blocking record, against this build', () => {
  const result = readPair(EXAMPLES, liveContext());
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  // The owner default, Editorial Evidence, isn't registered until #13, so
  // the fallback composition renders it, with a warning.
  assert.deepEqual(
    result.diagnostics.map(({ code, severity, pointer }) => [code, severity, pointer]),
    [['variant.unavailable', 'warning', '/appearance/variant']],
  );
  // The variant is the contract's to check, and every other appearance axis
  // #19's appearance check's: the bundled site selects the platform's
  // fallback packs, which this build registers, so none of them warns.
  assert.deepEqual(result.notChecked, ['origin.sample', 'origin.stale']);
});

test('the site example selects the owner default, with the approved visitor controls', () => {
  const result = readPair(EXAMPLES);
  assert.ok(result.ok);
  const { appearance, visitorControls, motionPolicy, features } = result.pair.site;
  assert.deepEqual(appearance, {
    variant: 'editorial-evidence',
    designLanguage: 'platform-neutral',
    colorScheme: 'warm-parchment',
    typography: 'humanist-ui',
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
  // warm-parchment is an authored scheme, so the example gives no generator input.
  assert.equal(result.pair.site.appearanceInputs, undefined);
});
