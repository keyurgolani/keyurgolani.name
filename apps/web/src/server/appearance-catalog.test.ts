import test from 'node:test';
import assert from 'node:assert/strict';
import type { VariantManifest } from '@portfolio/kit';
import type { AppearanceSelection } from '@portfolio/schema';
import { createAppearanceCatalog } from './appearance-catalog';

const manifest = (slug: string, schemes: string[], presets: string[]) =>
  ({
    slug,
    colorSchemes: schemes.map((id) => ({ id, name: id, themes: ['light'] })),
    typographyPresets: presets.map((id) => ({ id, name: id })),
  }) as unknown as VariantManifest;

const catalog = createAppearanceCatalog([
  manifest('editorial', ['warm', 'noir'], ['classic', 'modernist']),
  manifest('bare', [], []),
]);

const selection = (variant: string): AppearanceSelection => ({
  variant,
  designLanguage: 'platform-neutral',
  colorScheme: 'warm',
  typography: 'classic',
  displayMode: 'system',
});

test('variants are the registered slugs, and display modes are system, light, and dark', () => {
  assert.deepEqual(catalog.ids('variant', selection('editorial')), ['editorial', 'bare']);
  assert.deepEqual(catalog.ids('displayMode', selection('editorial')), ['system', 'light', 'dark']);
});

test("color schemes and typography come from the selected variant's manifest", () => {
  assert.deepEqual(catalog.ids('colorScheme', selection('editorial')), ['warm', 'noir']);
  assert.deepEqual(catalog.ids('typography', selection('editorial')), ['classic', 'modernist']);
  // Nothing to check against: a variant that declares none, or one not registered.
  assert.equal(catalog.ids('colorScheme', selection('bare')), null);
  assert.equal(catalog.ids('typography', selection('missing')), null);
});

test('design languages and generator-backed schemes have no registry yet', () => {
  assert.equal(catalog.ids('designLanguage', selection('editorial')), null);
  assert.equal(catalog.generatorInput('brand-seed'), undefined);
});
