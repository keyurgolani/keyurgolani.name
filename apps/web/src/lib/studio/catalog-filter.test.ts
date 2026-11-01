import assert from 'node:assert/strict';
import test from 'node:test';
import { appearanceCatalog } from '~/server/studio-appearance';
import type { CatalogOption } from './appearance';
import {
  ALL,
  catalogFilter,
  FAMILIES,
  familyCounts,
  familyOf,
  matchesQuery,
  quietToLoud,
} from './catalog-filter';

const option = (id: string, family: string | null, extra: Partial<CatalogOption> = {}) =>
  ({
    id,
    name: id.replace(/-/g, ' '),
    description: null,
    tier: 'stable',
    provenance: [],
    performance: null,
    access: null,
    status: 'ready',
    statusLabel: null,
    family,
    ...extra,
  }) satisfies CatalogOption;

test('every scheme and language in the catalog carries a family its chips list', () => {
  const catalog = appearanceCatalog();
  for (const axis of ['colorScheme', 'designLanguage'] as const) {
    const options = catalog.axes.find((each) => each.axis === axis)!.options;
    const ids = new Set<string>(FAMILIES[axis].map((family) => family.id));
    for (const each of options) assert.ok(ids.has(each.family ?? ''), `${axis} ${each.id}`);
    // The chips' counts add up to All.
    const [all, ...families] = familyCounts(axis, options);
    assert.equal(all!.id, ALL);
    assert.equal(
      families.reduce((sum, family) => sum + family.count, 0),
      all!.count,
    );
  }
  const schemes = catalog.axes.find((each) => each.axis === 'colorScheme')!.options;
  assert.equal(
    familyOf(
      'colorScheme',
      schemes.find((each) => each.id === 'warm-parchment'),
    ),
    'earthy',
  );
});

test('a family and a search each narrow the list, a pack with no family lists under All only, and the sort runs quiet to loud', () => {
  const options = [
    option('warm-parchment', 'earthy', { description: 'Warm paper and ink' }),
    option('graphite', 'neutral'),
    option('third-party', null),
  ];
  assert.deepEqual(
    catalogFilter(options, { family: 'earthy' }).map((each) => each.id),
    ['warm-parchment'],
  );
  assert.equal(catalogFilter(options, { family: ALL }).length, 3);
  assert.deepEqual(
    catalogFilter(options, { query: 'paper ink' }).map((each) => each.id),
    ['warm-parchment'],
  );
  assert.ok(matchesQuery(options[1]!, 'stable'), 'the tier');
  assert.equal(familyOf('colorScheme', options[2]), ALL);
  assert.deepEqual(
    familyCounts('colorScheme', options).map(({ id, count }) => `${id} ${count}`),
    ['all 3', 'earthy 1', 'neutral 1'],
  );
  assert.deepEqual(
    quietToLoud(['loud', 'quiet', 'tie-a', 'tie-b'], (each) =>
      each === 'loud' ? 3 : each === 'quiet' ? 0 : 1,
    ),
    ['quiet', 'tie-a', 'tie-b', 'loud'],
  );
});
