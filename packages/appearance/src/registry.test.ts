import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorV1,
  axisFallback,
  createAppearanceRegistry,
  findPack,
  isRegistered,
  otherAxes,
  selectableIds,
  type MetaPack,
} from './index';
import { DARK_ONLY, PACKS, SEED, VARIANTS, WARM_PARCHMENT, testRegistry } from './test-support/packs';

test('it indexes every pack by axis and keeps the variants as the metadata module lists them', () => {
  const registry = testRegistry();
  assert.equal(registry.variants, VARIANTS);
  assert.deepEqual([...registry.packs.designLanguage.keys()].sort(), ['fixture-translucent', 'platform-neutral']);
  assert.deepEqual([...registry.packs.colorScheme.keys()].sort(), [
    'fixture-asset',
    'fixture-dark-only',
    'fixture-light-only',
    'fixture-research',
    'fixture-seed',
    'warm-parchment',
  ]);
  assert.deepEqual([...registry.packs.typography.keys()].sort(), ['humanist-ui', 'multilingual-system']);
  const scheme = findPack(registry, 'colorScheme', 'warm-parchment')!;
  assert.equal(scheme.packageName, '@portfolio/appearance-schemes');
  assert.equal(scheme.version, '0.1.0');
  assert.equal(scheme.manifest, WARM_PARCHMENT);
});

test("each scheme's base sets are derived once, and a generator scheme has both modes but no sets", () => {
  const registry = testRegistry();
  const warm = findPack(registry, 'colorScheme', 'warm-parchment')!;
  assert.deepEqual(warm.modes, ['light', 'dark']);
  assert.deepEqual(warm.sets.light, anchorV1(WARM_PARCHMENT.anchors!.light!, 'light'));
  assert.deepEqual(warm.sets.dark, anchorV1(WARM_PARCHMENT.anchors!.dark!, 'dark'));
  const dark = findPack(registry, 'colorScheme', 'fixture-dark-only')!;
  assert.deepEqual(dark.modes, ['dark']);
  assert.equal(dark.sets.light, undefined);
  const seed = findPack(registry, 'colorScheme', 'fixture-seed')!;
  assert.deepEqual(seed.modes, ['light', 'dark']);
  assert.deepEqual(seed.sets, {});
  // Authored sets are used as written.
  const authored = { ...DARK_ONLY, id: 'fixture-authored', anchors: undefined, derivation: undefined, dark: dark.sets.dark! };
  const withAuthored = testRegistry([...PACKS, { kind: 'color-scheme', packageName: '@portfolio/x', version: '1.0.0', manifest: authored }]);
  assert.equal(findPack(withAuthored, 'colorScheme', 'fixture-authored')!.sets.dark, dark.sets.dark);
});

test('the selectable ids leave out the fallback composition and Research packs', () => {
  const registry = testRegistry();
  assert.deepEqual(selectableIds(registry, 'variant'), ['acme-gallery', 'editorial-evidence']);
  assert.deepEqual(selectableIds(registry, 'colorScheme'), [
    'fixture-asset',
    'fixture-dark-only',
    'fixture-light-only',
    'fixture-seed',
    'warm-parchment',
  ]);
  assert.ok(isRegistered(registry, 'colorScheme', 'fixture-research'));
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
  assert.throws(() => testRegistry(without('platform-neutral')), /no platform-neutral, the design-language fallback/);
  assert.throws(() => testRegistry(without('warm-parchment')), /no warm-parchment/);
  assert.throws(() => testRegistry(without('humanist-ui')), /no humanist-ui/);
  // The metadata module lists no pack until registry generation registers them (Slice 2).
  assert.throws(() => createAppearanceRegistry({ VARIANTS }), /no platform-neutral/);
  const twice: MetaPack = { ...PACKS[4]! } as MetaPack;
  assert.throws(() => testRegistry([...PACKS, twice]), /Two color-scheme packs register the id fixture-dark-only/);
  const research = PACKS.map((pack) =>
    pack.manifest.id === 'humanist-ui' ? ({ ...pack, manifest: { ...pack.manifest, tier: 'research' } } as MetaPack) : pack,
  );
  assert.throws(() => testRegistry(research), /can't be a research pack/);
  const singleMode = PACKS.map((pack) =>
    pack.manifest.id === 'warm-parchment'
      ? ({ ...pack, manifest: { ...WARM_PARCHMENT, anchors: { light: WARM_PARCHMENT.anchors!.light } } } as MetaPack)
      : pack,
  );
  assert.throws(() => testRegistry(singleMode), /needs authored or anchored light and dark modes/);
  const generated = PACKS.map((pack) =>
    pack.manifest.id === 'warm-parchment' ? ({ ...pack, manifest: { ...SEED, id: 'warm-parchment' } } as MetaPack) : pack,
  );
  assert.throws(() => testRegistry(generated), /needs authored or anchored light and dark modes/);
});
