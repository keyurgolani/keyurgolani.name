import test from 'node:test';
import assert from 'node:assert/strict';
import { selectableIds } from '@portfolio/appearance';
import { testRegistry } from '../../../../packages/appearance/src/test-support/packs';
import { APPEARANCE_REGISTRY } from '~/lib/appearance-registry';
import { appearanceCatalog } from './studio-appearance';

// What the Appearance workspace may offer (#8, Slice 5): what a site may
// select on each axis, so never the fallback composition, a Research pack,
// or anything this build doesn't register, each with what it means before
// publish.

test('the workspace offers what a site may select on each axis, and the display modes', () => {
  const catalog = appearanceCatalog(APPEARANCE_REGISTRY);
  assert.deepEqual(
    catalog.axes.map(({ axis }) => axis),
    ['variant', 'designLanguage', 'colorScheme', 'typography', 'displayMode'],
  );
  for (const { axis, options } of catalog.axes.slice(0, 4)) {
    assert.deepEqual(
      options.map(({ id }) => id),
      selectableIds(APPEARANCE_REGISTRY, axis as 'variant'),
      axis,
    );
  }
  const variants = catalog.axes[0]!.options.map(({ id }) => id);
  assert.ok(variants.length > 0);
  assert.ok(!variants.includes('fallback'), 'the fallback composition is no selection');
  assert.deepEqual(
    catalog.axes[4]!.options.map(({ id }) => id),
    ['system', 'light', 'dark', 'high-contrast'],
  );
  // Every option says what it is, before publish.
  const scheme = catalog.axes[2]!.options.find(({ id }) => id === 'warm-parchment')!;
  assert.equal(scheme.tier, 'stable');
  assert.match(scheme.provenance[0]!, /first-party/);
  assert.match(scheme.performance ?? '', /KB of CSS/);
  assert.match(scheme.access ?? '', /Light and dark/);
  for (const composition of catalog.axes[0]!.options) {
    assert.match(composition.performance ?? '', /^(?:light|medium|heavy) tier/, composition.id);
    assert.ok(composition.access, composition.id);
  }
});

test('a Research pack is never listed, though the build registers it', () => {
  const registry = testRegistry();
  const registered = [...registry.packs.colorScheme.values()].map(({ manifest }) => manifest);
  const research = registered.filter(({ tier }) => tier === 'research').map(({ id }) => id);
  assert.ok(research.length > 0, 'the test registry has a Research scheme');
  const listed = appearanceCatalog(registry).axes[2]!.options.map(({ id }) => id);
  for (const id of research) assert.ok(!listed.includes(id), id);
  assert.ok(listed.length > 0);
});
