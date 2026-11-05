// The baseline-pending list against the committed baselines
// (baseline-pending.ts): a composition is listed exactly when none of its
// baselines is committed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { CONTRACT_FIXTURE_NAMES } from '../../packages/variant-contract/src/fixture-names';
import {
  baselineProblems,
  committedBaselines,
  expectedBaselines,
  firstPartyCompositions,
  OTHER_BASELINES,
  pendingAnnotation,
  readPendingList,
  REPO_ROOT,
  type BaselineState,
} from './baseline-pending';

const FALLBACK = 'fallback';

test('the list names exactly the compositions with none of their baselines committed', () => {
  const problems = baselineProblems({
    compositions: firstPartyCompositions(),
    fallbackId: FALLBACK,
    fixtures: CONTRACT_FIXTURE_NAMES,
    files: committedBaselines(),
    pending: readPendingList(),
  });
  assert.deepEqual(problems, []);
});

test('the compositions it holds to the list are the first-party ones, the fallback among them', () => {
  const compositions = firstPartyCompositions();
  const manifest = (dir: string) =>
    (
      JSON.parse(readFileSync(path.join(REPO_ROOT, 'packages', dir, 'manifest.json'), 'utf8')) as {
        id: string;
      }
    ).id;
  assert.equal(manifest('fallback-composition'), FALLBACK);
  assert.ok(compositions.includes(FALLBACK));
  assert.ok(compositions.includes('flux'));
  // The test fixtures register only behind their flags.
  assert.ok(!compositions.includes(manifest('preview-fixtures')));
  assert.ok(!compositions.some((id) => id.startsWith('fixture-')));
});

// A small world: two compositions, two fixtures.
const FIXTURES = ['complete', 'rtl'];
const ENTRY = { owner: 'A', release: 'rc.2', fix: "Alpha's capture fix: one pose per width" };
const all = (id: string) => expectedBaselines(id, FIXTURES, FALLBACK);
const state = (overrides: Partial<BaselineState>): BaselineState => ({
  compositions: ['alpha', FALLBACK],
  fallbackId: FALLBACK,
  fixtures: FIXTURES,
  files: [...all(FALLBACK), ...OTHER_BASELINES],
  pending: { alpha: ENTRY },
  ...overrides,
});

test('a composition takes each fixture and the sample in each shot mode, the fallback no sample', () => {
  assert.deepEqual(all('alpha'), [
    'alpha-complete-desktop.png',
    'alpha-complete-mobile.png',
    'alpha-rtl-desktop.png',
    'alpha-rtl-mobile.png',
    'alpha-sample-desktop.png',
    'alpha-sample-mobile.png',
  ]);
  assert.equal(all(FALLBACK).length, 4);
  assert.deepEqual(baselineProblems(state({})), []);
});

test('an unlisted composition with no baselines fails', () => {
  const problems = baselineProblems(state({ pending: {} }));
  assert.equal(problems.length, 1);
  assert.match(
    problems[0]!,
    /^alpha isn't listed as pending, but 6 of its 6 baselines aren't committed/,
  );
});

test('an unlisted composition missing one baseline fails', () => {
  const files = [...all(FALLBACK), ...all('alpha').slice(1), ...OTHER_BASELINES];
  const problems = baselineProblems(state({ files, pending: {} }));
  assert.deepEqual(problems.length, 1);
  assert.match(
    problems[0]!,
    /1 of its 6 baselines aren't committed \(alpha-complete-desktop\.png\)/,
  );
  assert.deepEqual(
    baselineProblems(state({ files: [...files, all('alpha')[0]!], pending: {} })),
    [],
  );
});

test('a listed composition that gains one baseline fails', () => {
  const problems = baselineProblems(state({ files: [...state({}).files, 'alpha-rtl-mobile.png'] }));
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /^alpha is listed as pending, but 1 of its 6 baselines are committed/);
});

test('a committed file no composition takes fails, and so does a missing Demo Studio baseline', () => {
  assert.deepEqual(
    baselineProblems(state({ files: [...state({}).files, 'beta-complete-desktop.png'] })),
    ['beta-complete-desktop.png is committed, but no composition takes it'],
  );
  assert.deepEqual(baselineProblems(state({ files: all(FALLBACK) })), [
    `${OTHER_BASELINES[0]} isn't committed`,
  ]);
});

test('each entry names its owner, its release, and its fix, and only a registered id', () => {
  const cases: Record<string, unknown> = {
    'no fix': { owner: 'A', release: 'rc.2' },
    'an empty fix': { ...ENTRY, fix: ' ' },
    'a release that is no candidate': { ...ENTRY, release: 'v1.0.0' },
    'an owner that is no stream': { ...ENTRY, owner: 'lead A' },
    'a key of its own': { ...ENTRY, until: 'RC2' },
    'a bare string': 'later',
  };
  for (const [label, entry] of Object.entries(cases)) {
    assert.notDeepEqual(baselineProblems(state({ pending: { alpha: entry } })), [], label);
  }
  assert.deepEqual(baselineProblems(state({ pending: { alpha: ENTRY, beta: ENTRY } })), [
    'beta is listed, but no first-party composition has that id',
  ]);
  assert.notDeepEqual(baselineProblems(state({ pending: [] })), []);
  const unsorted = { zeta: ENTRY, alpha: ENTRY };
  assert.ok(
    baselineProblems(state({ compositions: ['alpha', 'zeta', FALLBACK], pending: unsorted })).some(
      (p) => p.endsWith('must list ids sorted'),
    ),
  );
});

test("a listed composition's annotation names its owner, release, and fix", () => {
  assert.equal(
    pendingAnnotation(ENTRY),
    "baseline pending (A, rc.2): Alpha's capture fix: one pose per width",
  );
});
