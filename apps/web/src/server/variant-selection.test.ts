import test from 'node:test';
import assert from 'node:assert/strict';
import type { VariantManifest } from '@portfolio/kit';
import { sampleSelection, type VariantSelection } from './variant-selection';

// /sample's query (#1, item 17): it starts from the site's appearance and
// takes only what the query names instead, and only registered values reach
// the variant.

const MANIFESTS: Record<string, VariantManifest> = {
  editorial: {
    slug: 'editorial',
    colorSchemes: [{ id: 'warm', default: true }, { id: 'noir' }],
    typographyPresets: [{ id: 'classic', default: true }, { id: 'modernist' }],
  } as unknown as VariantManifest,
  plain: { slug: 'plain' } as unknown as VariantManifest,
};

// Like the registry: a plain lookup by slug.
const find = (slug: string): VariantManifest | null =>
  (MANIFESTS as Record<string, VariantManifest | undefined>)[slug] ?? null;

/** The sample site's own appearance: Editorial in noir and modernist. */
const SITE: VariantSelection = {
  variant: 'editorial',
  colorScheme: 'noir',
  typography: 'modernist',
};

const select = (query: Record<string, string | string[] | undefined>, site = SITE) =>
  sampleSelection(query, find, site);

test("without a query it renders the site's appearance", () => {
  assert.deepEqual(select({}), SITE);
  // An axis the site leaves to the variant stays the variant's default.
  assert.deepEqual(select({}, { variant: 'editorial' }), { variant: 'editorial' });
});

test('the query overrides only what it names', () => {
  assert.deepEqual(select({ scheme: 'warm' }), {
    variant: 'editorial',
    colorScheme: 'warm',
    typography: 'modernist',
  });
  assert.deepEqual(select({ typography: 'classic' }), {
    variant: 'editorial',
    colorScheme: 'noir',
    typography: 'classic',
  });
  assert.deepEqual(select({ variant: 'editorial', scheme: 'warm', typography: 'classic' }), {
    variant: 'editorial',
    colorScheme: 'warm',
    typography: 'classic',
  });
});

test("another variant keeps the site's scheme and preset only where it declares them", () => {
  assert.deepEqual(select({ variant: 'plain' }), { variant: 'plain' });
  assert.deepEqual(select({ variant: 'plain', scheme: 'noir' }), { variant: 'plain' });
});

test('an unknown variant is a 404, however it is spelled', () => {
  for (const variant of ['nope', '', 'Editorial', ' editorial', '__proto__', 'constructor']) {
    assert.equal(select({ variant }), null, JSON.stringify(variant));
  }
  assert.equal(select({ variant: ['editorial', 'plain'] }), null, 'given twice');
});

test('a scheme or preset the query names that the variant does not declare is its default', () => {
  const cases: Array<Record<string, string | string[]>> = [
    { scheme: 'nebula', typography: 'geometric' },
    { scheme: 'canary"><script>', typography: '' },
    { scheme: ['noir', 'warm'], typography: ['modernist'] },
  ];
  for (const query of cases) {
    assert.deepEqual(select({ variant: 'editorial', ...query }), { variant: 'editorial' });
  }
});
