import test from 'node:test';
import assert from 'node:assert/strict';
import type { VariantManifest } from '@portfolio/kit';
import type { AppearanceSelection } from '@portfolio/schema';
import { sampleSelection, siteSelection } from './variant-selection';

// What `/` renders, and /sample's query (#1, item 17): it starts from the
// site's appearance and takes only what the query names instead, and only
// registered values reach the variant. The site here picks no variant
// defaults, so a page that dropped its scheme or preset would fail.

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

/** The site's appearance: Editorial in noir and modernist, neither its default. */
const APPEARANCE: AppearanceSelection = {
  variant: 'editorial',
  designLanguage: 'platform-neutral',
  colorScheme: 'noir',
  typography: 'modernist',
  displayMode: 'dark',
};
const SITE = { variant: 'editorial', colorScheme: 'noir', typography: 'modernist' };

const select = (query: Record<string, string | string[] | undefined>, appearance = APPEARANCE) =>
  sampleSelection(query, find, appearance);

test("`/` renders the site's variant, color scheme, and typography preset", () => {
  assert.deepEqual(siteSelection(APPEARANCE), SITE);
  assert.deepEqual(
    siteSelection({
      ...APPEARANCE,
      variant: 'plain',
      colorScheme: 'nebula',
      typography: 'geometric',
    }),
    { variant: 'plain', colorScheme: 'nebula', typography: 'geometric' },
  );
});

test("without a query it renders the site's appearance", () => {
  assert.deepEqual(select({}), SITE);
  // An id the variant doesn't declare stays the variant's default.
  assert.deepEqual(select({}, { ...APPEARANCE, colorScheme: 'nebula', typography: 'geometric' }), {
    variant: 'editorial',
  });
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
