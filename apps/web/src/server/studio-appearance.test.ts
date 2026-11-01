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
import { compositionStatus } from '@portfolio/variant-contract/status';
import { UPCOMING_COMPOSITIONS } from '@portfolio/variant-contract/studio-catalog';
import { APPEARANCE_REGISTRY } from '~/lib/appearance-registry';
import { REGISTRY } from '~/lib/variants';
import { previewAppearanceOptions } from './preview-options';
import { appearanceCatalog, inCompositionOrder } from './studio-appearance';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The compositions this build registers. */
const registered = () => new Set(REGISTRY.map(({ manifest }) => manifest.id));

/**
 * The held set, read from the registry and never a hand list (A2), as the split spec reads it:
 * every registered composition still pending, and every upcoming one no package registers yet.
 * A flip, or a registration, changes no line here.
 */
function heldSet(): string[] {
  const ids = registered();
  const pending = [...ids].filter((id) => compositionStatus(id) === 'pending');
  const upcoming = UPCOMING_COMPOSITIONS.map(({ id }) => id).filter((id) => !ids.has(id));
  // Empty since Flux, the last, flipped: then every option must read ready, which the tests hold.
  return [...new Set([...pending, ...upcoming])].sort();
}

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
    const selectable = selectableIds(APPEARANCE_REGISTRY, axis as 'variant');
    // The compositions in the program's order; the packs as the registry has them.
    assert.deepEqual(
      options.map(({ id }) => id),
      axis === 'variant'
        ? inCompositionOrder(
            selectable,
            (id) =>
              APPEARANCE_REGISTRY.variants.find(({ manifest }) => manifest.id === id)?.manifest
                .studio?.order,
          )
        : selectable,
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

test('a composition still in progress is listed for the picker to show disabled, In progress, and every other option is ready (A2)', () => {
  const catalog = appearanceCatalog(APPEARANCE_REGISTRY);
  const [variants, ...rest] = catalog.axes;
  assert.equal(variants!.axis, 'variant');
  const pending = variants!.options.filter(({ status }) => status === 'pending');
  assert.deepEqual(
    pending.map(({ id, statusLabel }) => [id, statusLabel]).sort(),
    heldSet()
      .filter((id) => registered().has(id))
      .map((id) => [id, 'In progress']),
  );
  for (const option of variants!.options.filter(({ status }) => status !== 'pending')) {
    assert.deepEqual([option.status, option.statusLabel], ['ready', null], option.id);
  }
  // No pack and no mode is gated.
  for (const { axis, options } of rest) {
    for (const option of options) {
      assert.deepEqual(
        [option.status, option.statusLabel],
        ['ready', null],
        `${axis} ${option.id}`,
      );
    }
  }
});

test("a preview frame's composition options say which are still in progress (A2)", () => {
  const { variants } = previewAppearanceOptions();
  assert.deepEqual(
    variants
      .filter(({ status }) => status === 'pending')
      .map(({ id }) => id)
      .sort(),
    heldSet().filter((id) => registered().has(id)),
  );
  assert.ok(variants.some(({ id, status }) => id === 'editorial-evidence' && status === undefined));
});

test("the compositions come in their manifests' studio.order, and one with none after them, as the registry has it", () => {
  // Synthetic: orders out of the input's order, two with none, which keep theirs.
  const orders: Record<string, number> = { c: 1, a: 2, e: 10 };
  assert.deepEqual(
    inCompositionOrder(['a', 'none-1', 'e', 'c', 'none-2'], (id) => orders[id]),
    ['c', 'a', 'e', 'none-1', 'none-2'],
  );
  assert.deepEqual(
    inCompositionOrder(['b', 'a'], () => undefined),
    ['b', 'a'],
  );
  // The build's: every composition with an order before every one without, lowest first.
  const orderOf = (id: string) =>
    APPEARANCE_REGISTRY.variants.find(({ manifest }) => manifest.id === id)?.manifest.studio?.order;
  const offered = appearanceCatalog()
    .axes.find((entry) => entry.axis === 'variant')!
    .options.map(({ id }) => id);
  const ranked = offered.map(orderOf);
  const firstUnranked = ranked.findIndex((order) => order === undefined);
  const ordered = firstUnranked === -1 ? ranked : ranked.slice(0, firstUnranked);
  assert.ok(ordered.length > 0, 'the first-party compositions give Studio an order');
  assert.deepEqual(
    ordered,
    [...ordered].sort((a, b) => a! - b!),
  );
  if (firstUnranked !== -1) {
    assert.ok(ranked.slice(firstUnranked).every((order) => order === undefined));
    // Those with none keep the registry's order.
    const unranked = offered.slice(firstUnranked);
    const selectable = selectableIds(APPEARANCE_REGISTRY, 'variant');
    assert.deepEqual(
      unranked,
      selectable.filter((id) => unranked.includes(id)),
    );
  }
  // And each composition's signature is its manifest's.
  for (const option of appearanceCatalog().axes[0]!.options) {
    const manifest = APPEARANCE_REGISTRY.variants.find(
      (each) => each.manifest.id === option.id,
    )!.manifest;
    assert.equal(option.signature, manifest.studio?.signature ?? null, option.id);
  }
});

test('no composition carries its provenance sources to the picker, which shows the owner its description', () => {
  for (const composition of appearanceCatalog().axes[0]!.options) {
    assert.deepEqual(composition.provenance, [], composition.id);
  }
});

test("every composition Studio offers is a finished one: no ready one's description is a scaffold's placeholder (A2)", () => {
  const compositions = appearanceCatalog().axes[0]!.options;
  const ready = compositions.filter(({ status }) => status === 'ready');
  assert.ok(ready.length > 0);
  for (const { id, description } of ready) {
    assert.doesNotMatch(description ?? '', /^Replace this/, id);
  }
});
