import test from 'node:test';
import assert from 'node:assert/strict';
import type { VariantManifest } from '@portfolio/kit';
import { sampleSelection } from './variant-selection';

// /sample's query (#1, item 17): only registered values reach the variant.

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

const select = (query: Record<string, string | string[] | undefined>) =>
  sampleSelection(query, find, 'editorial');

test('without a variant it renders the fallback, in its defaults', () => {
  assert.deepEqual(select({}), { variant: 'editorial' });
});

test('a registered variant renders with any scheme and typography preset it declares', () => {
  assert.deepEqual(select({ variant: 'editorial', scheme: 'noir', typography: 'modernist' }), {
    variant: 'editorial',
    colorScheme: 'noir',
    typography: 'modernist',
  });
  assert.deepEqual(select({ variant: 'plain' }), { variant: 'plain' });
});

test('an unknown variant is a 404, however it is spelled', () => {
  for (const variant of ['nope', '', 'Editorial', ' editorial', '__proto__', 'constructor']) {
    assert.equal(select({ variant }), null, JSON.stringify(variant));
  }
  assert.equal(select({ variant: ['editorial', 'plain'] }), null, 'given twice');
});

test('a scheme or preset the variant does not declare falls back to its default', () => {
  const cases: Array<Record<string, string | string[]>> = [
    { scheme: 'nebula', typography: 'geometric' },
    { scheme: 'canary"><script>', typography: '' },
    { scheme: ['noir', 'warm'], typography: ['modernist'] },
  ];
  for (const query of cases) {
    assert.deepEqual(select({ variant: 'editorial', ...query }), { variant: 'editorial' });
  }
  assert.deepEqual(select({ variant: 'plain', scheme: 'noir' }), { variant: 'plain' });
});
