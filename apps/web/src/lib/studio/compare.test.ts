import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppearanceCatalog } from '~/lib/studio/appearance';
import {
  changeLine,
  defaultMode,
  differences,
  gridPage,
  heavyPlate,
  neighbours,
  wipeStep,
} from './compare';

const A = {
  variant: 'editorial-evidence',
  colorScheme: 'warm-parchment',
  typography: 'humanist-ui',
  designLanguage: 'platform-neutral',
  displayMode: 'system',
} as const;

const option = (id: string) => ({
  id,
  name: id,
  description: null,
  tier: null,
  provenance: [],
  performance: null,
  access: null,
});
const CATALOG = {
  axes: [
    {
      axis: 'variant',
      label: 'Composition',
      fallback: 'fallback',
      options: [
        'editorial-evidence',
        'kinetic-cosmos',
        'obsidian-atelier',
        'spatial-bento',
        'horizontal-cinema',
      ].map(option),
    },
    {
      axis: 'colorScheme',
      label: 'Color scheme',
      fallback: 'warm-parchment',
      options: ['arctic-aurora', 'warm-parchment', 'graphite', 'neutral-slate', 'paper-ink'].map(
        option,
      ),
    },
  ],
} as unknown as AppearanceCatalog;

test('Compare names the axes that differ, and opens as a wipe when only token axes do', () => {
  assert.deepEqual(differences(A, A), []);
  const b = { ...A, colorScheme: 'graphite', displayMode: 'dark' };
  assert.deepEqual(differences(A, b), ['colorScheme', 'displayMode']);
  assert.equal(defaultMode(A, b), 'wipe');
  assert.equal(defaultMode(A, { ...b, variant: 'kinetic-cosmos' }), 'side');
});

test('a grid of stills is A, then the next options on its axis, wrapping, with A’s other axes', () => {
  const schemes = neighbours(CATALOG, A, 'colorScheme', 3);
  assert.deepEqual(
    schemes.map((each) => each.colorScheme),
    ['warm-parchment', 'graphite', 'neutral-slate', 'paper-ink'],
  );
  for (const each of schemes) assert.equal(each.variant, A.variant);
});

test('a grid page is always four plates, A first, and the last page the last three, so none is orphaned', () => {
  const compositions = CATALOG.axes.find((entry) => entry.axis === 'variant')!.options.length;
  const first = gridPage(CATALOG, A, 'variant', 0);
  assert.equal(first.plates.length, Math.min(4, compositions));
  assert.equal(first.plates[0], A);
  assert.equal(first.pages, Math.max(1, Math.ceil((compositions - 1) / 3)));
  // Every page, the last one too, is full, and between them they show every composition.
  const seen = new Set<string>();
  for (let page = 0; page < first.pages; page += 1) {
    const each = gridPage(CATALOG, A, 'variant', page);
    assert.equal(each.plates.length, Math.min(4, compositions), `page ${page + 1}`);
    assert.equal(each.plates[0], A);
    for (const plate of each.plates) seen.add(plate.variant);
  }
  assert.equal(seen.size, compositions);
  // A page past the last is the last.
  assert.deepEqual(gridPage(CATALOG, A, 'variant', 99).page, first.pages - 1);
  assert.equal(gridPage(CATALOG, A, 'colorScheme', 0).plates.length, 4);
});

test('the wipe divider moves by arrow and page keys, and Home and End take it to the edges', () => {
  assert.equal(wipeStep(50, 'ArrowLeft'), 45);
  assert.equal(wipeStep(98, 'ArrowRight'), 100);
  assert.equal(wipeStep(50, 'Home'), 0);
  assert.equal(wipeStep(50, 'PageUp'), 70);
  assert.equal(wipeStep(50, 'a'), null);
});

test('a composition still in progress is never a plate, so four ready ones are one page of A and three (A2)', () => {
  const pending = {
    axes: CATALOG.axes.map((entry) =>
      entry.axis === 'variant'
        ? {
            ...entry,
            options: entry.options.map((each) =>
              each.id === 'kinetic-cosmos'
                ? { ...each, status: 'pending' as const, statusLabel: 'In progress' }
                : each,
            ),
          }
        : entry,
    ),
  } as AppearanceCatalog;
  const grid = gridPage(pending, A, 'variant', 0);
  assert.deepEqual(
    grid.plates.map(({ variant }) => variant),
    ['editorial-evidence', 'obsidian-atelier', 'spatial-bento', 'horizontal-cinema'],
  );
  assert.deepEqual([grid.pages, grid.more], [1, 0]);
  assert.ok(
    !neighbours(pending, A, 'variant', 9).some(({ variant }) => variant === 'kinetic-cosmos'),
  );
});

test("the grid's heavy slot is the plate pointed at or focused, none while none is, and it moves with the pointer (P0-2b)", () => {
  const plates = ['colorScheme:a', 'colorScheme:b', 'colorScheme:c', 'colorScheme:d'];
  assert.equal(heavyPlate(plates, null), null);
  assert.equal(heavyPlate(plates, 'colorScheme:b'), 'colorScheme:b');
  assert.equal(heavyPlate(plates, 'colorScheme:d'), 'colorScheme:d');
  // A plate no longer on the page holds nothing.
  assert.equal(heavyPlate(plates, 'colorScheme:z'), null);
});

test('a grid page says where its neighbours start among A’s and how many A has, the last page the last three (M3)', () => {
  const others = CATALOG.axes.find((entry) => entry.axis === 'colorScheme')!.options.length - 1;
  const first = gridPage(CATALOG, A, 'colorScheme', 0);
  assert.deepEqual([first.first, first.others, first.plates.length], [1, others, 4]);
  const last = gridPage(CATALOG, A, 'colorScheme', first.pages - 1);
  assert.equal(last.page, last.pages - 1);
  assert.equal(last.first, others - 2, 'the last page is the last three');
  assert.equal(last.first + last.plates.length - 2, others);
});

test("a plate's change line names each pick that moves, in the rail's order, and nothing when none does (M2)", () => {
  assert.equal(changeLine(CATALOG, A, A), null);
  assert.equal(changeLine(CATALOG, A, { ...A, colorScheme: 'neutral-slate' }), 'neutral-slate');
  assert.equal(
    changeLine(
      CATALOG,
      { ...A, variant: 'obsidian-atelier' },
      { ...A, colorScheme: 'neutral-slate' },
    ),
    'editorial-evidence with neutral-slate',
  );
  assert.equal(
    changeLine(
      CATALOG,
      { ...A, variant: 'obsidian-atelier', displayMode: 'dark' },
      { ...A, colorScheme: 'neutral-slate' },
    ),
    'editorial-evidence with neutral-slate and system mode',
  );
});
