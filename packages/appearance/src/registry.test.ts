import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorV2,
  axisFallback,
  createAppearanceRegistry,
  exclusionOf,
  findPack,
  isRegistered,
  otherAxes,
  selectableIds,
  type MetaPack,
} from './index';
import {
  DARK_ONLY,
  PACKS,
  SEED,
  VARIANTS,
  WARM_PARCHMENT,
  testRegistry,
} from './test-support/packs';

test('it indexes every pack by axis and keeps the variants as the metadata module lists them', () => {
  const registry = testRegistry();
  assert.equal(registry.variants, VARIANTS);
  assert.deepEqual([...registry.packs.designLanguage.keys()].sort(), [
    'fixture-translucent',
    'platform-neutral',
  ]);
  assert.deepEqual([...registry.packs.colorScheme.keys()].sort(), [
    'fixture-asset',
    'fixture-dark-only',
    'fixture-light-only',
    'fixture-seed',
    'warm-parchment',
  ]);
  assert.deepEqual([...registry.packs.typography.keys()].sort(), [
    'humanist-ui',
    'multilingual-system',
  ]);
  const scheme = findPack(registry, 'colorScheme', 'warm-parchment')!;
  assert.equal(scheme.packageName, '@portfolio/appearance-schemes');
  assert.equal(scheme.version, '0.1.0');
  assert.equal(scheme.manifest, WARM_PARCHMENT);
});

test("each scheme's base sets are derived once, and a generator scheme has both modes but no sets", () => {
  const registry = testRegistry();
  const warm = findPack(registry, 'colorScheme', 'warm-parchment')!;
  assert.deepEqual(warm.modes, ['light', 'dark']);
  // warm-parchment's derivation is anchor-v2 (#20 PR 2c).
  assert.deepEqual(warm.sets.light, anchorV2(WARM_PARCHMENT.anchors!.light!, 'light'));
  assert.deepEqual(warm.sets.dark, anchorV2(WARM_PARCHMENT.anchors!.dark!, 'dark'));
  const dark = findPack(registry, 'colorScheme', 'fixture-dark-only')!;
  assert.deepEqual(dark.modes, ['dark']);
  assert.equal(dark.sets.light, undefined);
  const seed = findPack(registry, 'colorScheme', 'fixture-seed')!;
  assert.deepEqual(seed.modes, ['light', 'dark']);
  assert.deepEqual(seed.sets, {});
  // Authored sets are used as written.
  const authored = {
    ...DARK_ONLY,
    id: 'fixture-authored',
    anchors: undefined,
    derivation: undefined,
    dark: dark.sets.dark!,
  };
  const withAuthored = testRegistry([
    ...PACKS,
    { kind: 'color-scheme', packageName: '@portfolio/x', version: '1.0.0', manifest: authored },
  ]);
  assert.equal(
    findPack(withAuthored, 'colorScheme', 'fixture-authored')!.sets.dark,
    dark.sets.dark,
  );
});

test('the selectable ids leave out the fallback composition, and no Research record registers', () => {
  const registry = testRegistry();
  assert.deepEqual(selectableIds(registry, 'variant'), ['acme-gallery', 'editorial-evidence']);
  assert.deepEqual(selectableIds(registry, 'colorScheme'), [
    'fixture-asset',
    'fixture-dark-only',
    'fixture-light-only',
    'fixture-seed',
    'warm-parchment',
  ]);
  // A Research record never registers (#20).
  assert.ok(!isRegistered(registry, 'colorScheme', 'fixture-research'));
  assert.ok(!isRegistered(registry, 'variant', 'fallback'));
  assert.deepEqual(otherAxes(registry, 'colorScheme', 'platform-neutral'), ['designLanguage']);
  assert.deepEqual(otherAxes(registry, 'typography', 'editorial-evidence'), ['variant']);
  assert.deepEqual(otherAxes(registry, 'colorScheme', 'missing-pack'), []);
  assert.equal(axisFallback('variant'), 'fallback');
  assert.equal(axisFallback('colorScheme'), 'warm-parchment');
});

test('a broken build fails to make a registry, saying why', () => {
  const without = (id: string) => PACKS.filter(({ manifest }) => manifest.id !== id);
  assert.throws(() => testRegistry(PACKS, VARIANTS.slice(1)), /no fallback composition/);
  assert.throws(
    () => testRegistry(without('platform-neutral')),
    /no platform-neutral, the design-language fallback/,
  );
  assert.throws(() => testRegistry(without('warm-parchment')), /no warm-parchment/);
  assert.throws(() => testRegistry(without('humanist-ui')), /no humanist-ui/);
  // The metadata module lists no pack until registry generation registers them (Slice 2).
  assert.throws(() => createAppearanceRegistry({ VARIANTS }), /no platform-neutral/);
  // An id names one thing: a second pack on another axis, or a variant, can't take it.
  const asScheme = (id: string): MetaPack => ({
    kind: 'color-scheme',
    packageName: '@portfolio/x',
    version: '1.0.0',
    manifest: { ...DARK_ONLY, id },
  });
  assert.throws(
    () => testRegistry([...PACKS, asScheme('acme-gallery')]),
    /A variant and a color-scheme pack both register the id acme-gallery/,
  );
  assert.throws(
    () => testRegistry([...PACKS, asScheme('fallback')]),
    /A variant and a color-scheme pack both register the id fallback/,
  );
  assert.throws(
    () => testRegistry([...PACKS, asScheme('fixture-translucent')]),
    /A design-language pack and a color-scheme pack both register the id fixture-translucent/,
  );
  assert.throws(
    () =>
      testRegistry([
        ...PACKS,
        {
          ...PACKS[0]!,
          manifest: { ...PACKS[0]!.manifest, id: 'multilingual-system' },
        } as MetaPack,
      ]),
    /A typography pack and a design-language pack both register the id multilingual-system/,
  );
  const twice: MetaPack = { ...PACKS[4]! } as MetaPack;
  assert.throws(
    () => testRegistry([...PACKS, twice]),
    /Two color-scheme packs register the id fixture-dark-only/,
  );
  const singleMode = PACKS.map((pack) =>
    pack.manifest.id === 'warm-parchment'
      ? ({
          ...pack,
          manifest: { ...WARM_PARCHMENT, anchors: { light: WARM_PARCHMENT.anchors!.light } },
        } as MetaPack)
      : pack,
  );
  assert.throws(() => testRegistry(singleMode), /needs authored or anchored light and dark modes/);
  const generated = PACKS.map((pack) =>
    pack.manifest.id === 'warm-parchment'
      ? ({ ...pack, manifest: { ...SEED, id: 'warm-parchment' } } as MetaPack)
      : pack,
  );
  assert.throws(() => testRegistry(generated), /needs authored or anchored light and dark modes/);
});

test('an excluded pack registers nowhere, and keeps its reason for the diagnostics (#20)', () => {
  const excluded = {
    kind: 'color-scheme',
    id: 'acme-ocean',
    packageName: '@acme/packs',
    reason: "its license, LicenseRef-Proprietary, isn't one a pack may ship under.",
  } as const;
  const registry = createAppearanceRegistry({ VARIANTS, PACKS, EXCLUDED_PACKS: [excluded] });
  assert.ok(!isRegistered(registry, 'colorScheme', 'acme-ocean'));
  assert.ok(!selectableIds(registry, 'colorScheme').includes('acme-ocean'));
  assert.equal(exclusionOf(registry, 'colorScheme', 'acme-ocean'), excluded);
  assert.equal(exclusionOf(registry, 'typography', 'acme-ocean'), undefined);
  assert.throws(
    () =>
      createAppearanceRegistry({
        VARIANTS,
        PACKS,
        EXCLUDED_PACKS: [{ ...excluded, id: 'fixture-seed' }],
      }),
    /fixture-seed is both registered and excluded/,
  );
});
