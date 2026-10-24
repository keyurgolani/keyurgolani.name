import assert from 'node:assert/strict';
import test from 'node:test';
import { pairwise, TUPLE_AXES, tupleKey, type CoverageInput, type Tuple } from './coverage';

const VALUES: CoverageInput['values'] = {
  variant: ['fallback', 'kinetic'],
  designLanguage: ['platform-neutral', 'glass', 'fixture-language-stable'],
  colorScheme: ['warm-parchment', 'dark-only', 'fixture-scheme-stable', 'fixture-scheme-extended'],
  typography: ['humanist-ui', 'fixture-typography-stable'],
  displayMode: ['system', 'light', 'dark', 'high-contrast'],
};

/** dark-only has no light mode, and kinetic renders no glass, as a resolver might say. */
const accepts = (tuple: Tuple) =>
  !(tuple.colorScheme === 'dark-only' && tuple.displayMode === 'light') &&
  !(tuple.variant === 'kinetic' && tuple.designLanguage === 'glass');

const INPUT: CoverageInput = {
  values: VALUES,
  accepts,
  fallbackVariant: 'fallback',
  fixturePacks: [
    { axis: 'designLanguage', id: 'fixture-language-stable' },
    { axis: 'colorScheme', id: 'fixture-scheme-stable' },
    { axis: 'colorScheme', id: 'fixture-scheme-extended' },
    { axis: 'typography', id: 'fixture-typography-stable' },
  ],
};

/** Every pair of values across two axes, as `axis=value × axis=value`. */
function pairs(tuple: Tuple): string[] {
  const out: string[] = [];
  TUPLE_AXES.forEach((a, i) =>
    TUPLE_AXES.slice(i + 1).forEach((b) => out.push(`${a}=${tuple[a]} × ${b}=${tuple[b]}`)),
  );
  return out;
}

/** Every tuple of the cross-product, by brute force. */
function everyTuple(values: CoverageInput['values']): Tuple[] {
  let tuples: Record<string, string>[] = [{}];
  for (const axis of TUPLE_AXES) {
    tuples = tuples.flatMap((tuple) => values[axis].map((value) => ({ ...tuple, [axis]: value })));
  }
  return tuples as unknown as Tuple[];
}

test('every pair an accepted tuple holds is in a row, and the rest are listed as uncoverable', () => {
  const coverage = pairwise(INPUT);
  const covered = new Set(coverage.rows.flatMap(pairs));
  const all = everyTuple(VALUES);
  const coverable = new Set(all.filter(accepts).flatMap(pairs));
  for (const pair of coverable) assert.ok(covered.has(pair), pair);
  const rest = [...new Set(all.flatMap(pairs))].filter((pair) => !coverable.has(pair)).sort();
  assert.deepEqual([...coverage.uncoverable].sort(), rest);
  assert.ok(coverage.uncoverable.includes('colorScheme=dark-only × displayMode=light'));
  assert.ok(coverage.uncoverable.includes('variant=kinetic × designLanguage=glass'));
  assert.equal(coverage.tuples, all.length);
  assert.equal(coverage.accepted, all.filter(accepts).length);
});

test('no row is a tuple the resolver rejects, and no row repeats', () => {
  const { rows } = pairwise(INPUT);
  for (const row of rows) assert.ok(accepts(row), tupleKey(row));
  assert.equal(new Set(rows.map(tupleKey)).size, rows.length);
});

test('the rows are the same whatever order the registry lists its values in', () => {
  const reversed: CoverageInput = {
    ...INPUT,
    values: Object.fromEntries(
      TUPLE_AXES.map((axis) => [axis, [...VALUES[axis]].reverse()]),
    ) as unknown as CoverageInput['values'],
    fixturePacks: [...INPUT.fixturePacks].reverse(),
  };
  assert.deepEqual(pairwise(reversed).rows, pairwise(INPUT).rows);
  assert.deepEqual(pairwise(INPUT).rows, pairwise(INPUT).rows);
});

test('every fixture pack meets the fallback composition in a row', () => {
  const { rows } = pairwise(INPUT);
  for (const { axis, id } of INPUT.fixturePacks) {
    assert.ok(
      rows.some((row) => row.variant === 'fallback' && row[axis] === id),
      `${id} on the fallback composition`,
    );
  }
});

test('a fixture pack the resolver never renders on the fallback composition fails the plan', () => {
  assert.throws(
    () =>
      pairwise({
        ...INPUT,
        accepts: (tuple) => accepts(tuple) && tuple.colorScheme !== 'fixture-scheme-stable',
      }),
    /fixture-scheme-stable on the fallback composition/,
  );
});

test('the array stays near the pairwise bound, far below the cross-product', () => {
  const { rows, tuples } = pairwise(INPUT);
  // The two largest axes, 4 schemes by 4 modes, hold 15 coverable pairs
  // (dark-only has no light), each needing a row of its own.
  assert.ok(rows.length >= 15, `${rows.length} rows`);
  assert.ok(rows.length <= 24, `${rows.length} rows`);
  assert.ok(tuples === 2 * 3 * 4 * 2 * 4);
});

/** The rows a plain greedy scan picks: every candidate counted on every pick, the earliest on a tie. */
function scanned(input: CoverageInput): Tuple[] {
  const sorted = Object.fromEntries(
    TUPLE_AXES.map((axis) => [axis, [...new Set(input.values[axis])].sort()]),
  ) as unknown as CoverageInput['values'];
  const accepted = everyTuple(sorted).filter(input.accepts);
  const uncovered = new Set(accepted.flatMap(pairs));
  const rows: Tuple[] = [];
  const pick = (candidates: Tuple[]) => {
    let best: Tuple | undefined;
    let most = -1;
    for (const tuple of candidates) {
      if (rows.includes(tuple)) continue;
      const gain = pairs(tuple).filter((pair) => uncovered.has(pair)).length;
      if (gain > most) {
        best = tuple;
        most = gain;
      }
    }
    if (!best) return false;
    rows.push(best);
    for (const pair of pairs(best)) uncovered.delete(pair);
    return true;
  };
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const packs = [...input.fixturePacks].sort((a, b) => order(a.axis, b.axis) || order(a.id, b.id));
  for (const { axis, id } of packs) {
    const met = (tuple: Tuple) => tuple.variant === input.fallbackVariant && tuple[axis] === id;
    if (!rows.some(met)) pick(accepted.filter(met));
  }
  while (uncovered.size > 0 && pick(accepted)) {
    // Each pick covers at least one pair, or the loop ends.
  }
  return rows;
}

test('each row is the one a plain greedy scan picks, in the same order (#20)', () => {
  const wider: CoverageInput = {
    ...INPUT,
    values: {
      variant: ['fallback', 'kinetic', 'notes'],
      designLanguage: ['glass', 'platform-neutral', 'mono', 'fixture-language-stable', 'paper'],
      colorScheme: [...VALUES.colorScheme, 'ocean', 'ember', 'moss'],
      typography: ['humanist-ui', 'fixture-typography-stable', 'serif'],
      displayMode: VALUES.displayMode,
    },
  };
  for (const input of [INPUT, { ...INPUT, fixturePacks: [] }, wider]) {
    const { rows } = pairwise(input);
    assert.deepEqual(rows.map(tupleKey), scanned(input).map(tupleKey));
    // And on its own terms: every pair an accepted tuple holds is in a row,
    // so a change to scanned() can't agree with a pairwise() that drops one.
    const covered = new Set(rows.flatMap(pairs));
    for (const pair of new Set(everyTuple(input.values).filter(input.accepts).flatMap(pairs))) {
      assert.ok(covered.has(pair), pair);
    }
  }
});

test('an empty axis gives an empty array', () => {
  const coverage = pairwise({ ...INPUT, values: { ...VALUES, typography: [] }, fixturePacks: [] });
  assert.deepEqual(coverage.rows, []);
  assert.equal(coverage.tuples, 0);
});
