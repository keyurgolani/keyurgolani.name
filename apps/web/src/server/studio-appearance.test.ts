import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import {
  AXIS_BY_KIND,
  createAppearanceRegistry,
  exclusionOf,
  selectableIds,
} from '@portfolio/appearance';
import { packPackages, researchRecords } from '../../../../packages/appearance/src/node/catalog';
import { PACKS, testRegistry } from '../../../../packages/appearance/src/test-support/packs';
import { APPEARANCE_REGISTRY } from '~/lib/appearance-registry';
import { appearanceCatalog } from './studio-appearance';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

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

test('a pack the build left out is never listed, and no Research record registers (#20)', () => {
  // Since #20 a Research record is a file under a pack package's research/,
  // which never registers: the workspace never lists one of this checkout's.
  const records = researchRecords(REPO_ROOT, packPackages(REPO_ROOT)).flatMap(({ record }) =>
    record ? [record] : [],
  );
  assert.ok(records.length > 0, 'this checkout has a Research record');
  const built = appearanceCatalog(APPEARANCE_REGISTRY);
  for (const record of records) {
    const axis = built.axes.find(({ axis }) => axis === AXIS_BY_KIND[record.kind])!;
    assert.ok(!axis.options.some(({ id }) => id === record.id), record.id);
  }
  // A pack registry generation excluded is never listed either.
  const base = testRegistry();
  const registry = createAppearanceRegistry({
    VARIANTS: base.variants,
    PACKS: [...PACKS],
    EXCLUDED_PACKS: [
      {
        kind: 'color-scheme',
        id: 'left-out-scheme',
        packageName: '@acme/left-out',
        reason: "its license, GPL-3.0-only, isn't one a pack may ship under.",
      },
    ],
  });
  // The registry knows the pack it left out, and the workspace still doesn't list it.
  assert.ok(exclusionOf(registry, 'colorScheme', 'left-out-scheme'));
  const listed = appearanceCatalog(registry).axes[2]!.options.map(({ id }) => id);
  assert.ok(!listed.includes('left-out-scheme'));
  // Nothing registered is a Research pack, and the list isn't empty.
  for (const pack of registry.packs.colorScheme.values()) {
    assert.notEqual(pack.manifest.tier, 'research', pack.manifest.id);
  }
  assert.ok(listed.length > 0);
});
