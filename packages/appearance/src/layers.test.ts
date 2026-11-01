import test from 'node:test';
import assert from 'node:assert/strict';
import { APPEARANCE_LAYERS, LAYER_ORDER, startsWithLayerOrder } from './layers';
import { anchorV1 } from './derive';
import { printSet, schemeSets } from './sets';
import { WARM_PARCHMENT } from './test-support/packs';

// The layer order every layered stylesheet starts with (#19, Slice 2,
// item 1), and the sets each scheme shape renders.

test('the layer order is the refined body statement, exactly', () => {
  assert.equal(
    LAYER_ORDER,
    '@layer reset, scheme, language, typography, variant-layout, utilities, accessibility;',
  );
  assert.equal(LAYER_ORDER, `@layer ${APPEARANCE_LAYERS.join(', ')};`);
});

test('a stylesheet starts with it after nothing but whitespace and comments', () => {
  assert.ok(startsWithLayerOrder(`${LAYER_ORDER}\n.a { color: red; }`));
  assert.ok(startsWithLayerOrder(`\n  /* #19 fixes the order. */\n/* Another. */ ${LAYER_ORDER}`));
  assert.ok(!startsWithLayerOrder(`.a { color: red; }\n${LAYER_ORDER}`));
  assert.ok(
    !startsWithLayerOrder('@layer reset, scheme, language, typography, utilities, accessibility;'),
  );
  assert.ok(
    !startsWithLayerOrder(
      `@layer  reset, scheme, language, typography, variant-layout, utilities, accessibility;`,
    ),
  );
  assert.ok(!startsWithLayerOrder(`/* never closed ${LAYER_ORDER}`));
  assert.ok(!startsWithLayerOrder(`@charset "utf-8";\n${LAYER_ORDER}`));
  assert.ok(!startsWithLayerOrder(''));
});

test('each scheme shape renders its sets, with a light high-contrast set for print', () => {
  const light = anchorV1(WARM_PARCHMENT.anchors!.light!, 'light');
  const dark = anchorV1(WARM_PARCHMENT.anchors!.dark!, 'dark');
  assert.deepEqual(Object.keys(schemeSets({ light, dark })).sort(), [
    'dark',
    'high-contrast-dark',
    'high-contrast-light',
    'light',
  ]);
  assert.deepEqual(Object.keys(schemeSets({ dark })).sort(), [
    'dark',
    'high-contrast-dark',
    'high-contrast-light',
  ]);
  assert.deepEqual(Object.keys(schemeSets({ light })).sort(), ['high-contrast-light', 'light']);
  const authored = { ...light, accent: '#000000' };
  assert.equal(schemeSets({ light }, { light: authored })['high-contrast-light'], authored);
  assert.equal(printSet(schemeSets({ light, dark }), false), 'light');
  assert.equal(printSet(schemeSets({ light, dark }), true), 'high-contrast-light');
  assert.equal(printSet(schemeSets({ dark }), false), 'high-contrast-light');
  assert.throws(() => schemeSets({}), TypeError);
});
