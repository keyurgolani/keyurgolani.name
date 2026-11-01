import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppearanceCatalog } from './appearance';
import { offeredRecipes, RECIPES, surprise, withRecipe, type Recipe } from './recipes';

const option = (id: string) => ({
  id,
  name: id,
  description: null,
  tier: null,
  provenance: [],
  performance: null,
  access: null,
  status: 'ready' as const,
  statusLabel: null,
});
const catalog = (values: Record<string, string[]>): AppearanceCatalog => ({
  axes: Object.entries(values).map(([axis, ids]) => ({
    axis: axis as AppearanceCatalog['axes'][number]['axis'],
    label: axis,
    fallback: ids[0] ?? '',
    options: ids.map(option),
  })),
});

const recipe = (id: string, selection: Recipe['selection']): Recipe => ({
  id,
  name: id,
  description: '',
  selection,
});
const A = recipe('a', {
  variant: 'v1',
  designLanguage: 'l1',
  colorScheme: 's1',
  typography: 't1',
  displayMode: 'light',
});
const B = recipe('b', {
  variant: 'v2',
  designLanguage: 'l1',
  colorScheme: 's2',
  typography: 't2',
  displayMode: 'dark',
});

test('the file registers nine recipes, each on all five axes, Shell the ninth', () => {
  assert.equal(RECIPES.length, 9);
  assert.equal(RECIPES.at(-1)?.id, 'shell');
  for (const each of RECIPES) assert.equal(Object.keys(each.selection).length, 5, each.id);
});

test('a recipe whose composition is still in progress (A2) is registered and not offered, until it is ready', () => {
  const values = {
    variant: [...new Set(RECIPES.map(({ selection }) => selection.variant))],
    designLanguage: [...new Set(RECIPES.map(({ selection }) => selection.designLanguage))],
    colorScheme: [...new Set(RECIPES.map(({ selection }) => selection.colorScheme))],
    typography: [...new Set(RECIPES.map(({ selection }) => selection.typography))],
    displayMode: [...new Set(RECIPES.map(({ selection }) => selection.displayMode))],
  };
  const everything = catalog(values);
  assert.equal(offeredRecipes(everything).length, 9, 'every one, with every composition ready');
  const held: AppearanceCatalog = {
    axes: everything.axes.map((entry) =>
      entry.axis === 'variant'
        ? {
            ...entry,
            options: entry.options.map((each) =>
              each.id === 'kinetic-cosmos' || each.id === 'shell'
                ? { ...each, status: 'pending' as const, statusLabel: 'In progress' }
                : each,
            ),
          }
        : entry,
    ),
  };
  const offered = offeredRecipes(held);
  assert.equal(offered.length, 7, 'registered 9, offered 7');
  assert.deepEqual(
    RECIPES.filter((each) => !offered.includes(each)).map(({ id }) => id),
    ['neon-maker', 'shell'],
  );
});

test('only recipes this build can show in full, and that the rules allow, are offered', () => {
  const offered = catalog({
    variant: ['v1', 'v2'],
    designLanguage: ['l1'],
    colorScheme: ['s1'],
    typography: ['t1', 't2'],
    displayMode: ['light', 'dark'],
  });
  assert.deepEqual(
    offeredRecipes(offered, undefined, [A, B]).map(({ id }) => id),
    ['a'],
  );
  assert.deepEqual(
    offeredRecipes(offered, (each) => each.displayMode !== 'light', [A, B]),
    [],
  );
});

test('a recipe applies to every axis but the kept ones, and Surprise me picks one that changes something', () => {
  const kept = new Set(['typography'] as const);
  assert.deepEqual(withRecipe(A.selection, B, kept), { ...B.selection, typography: 't1' });
  assert.equal(surprise([A, B], A.selection, new Set(), 0), B, 'the current look is no surprise');
  assert.equal(surprise([A], A.selection, new Set(), 0.9), null);
  const all = new Set([
    'variant',
    'designLanguage',
    'colorScheme',
    'typography',
    'displayMode',
  ] as const);
  assert.equal(surprise([A, B], A.selection, all, 0.5), null, 'every axis kept');
});
