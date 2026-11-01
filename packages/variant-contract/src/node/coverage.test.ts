import test from 'node:test';
import assert from 'node:assert/strict';
import { CORE_SECTION_KINDS } from '@portfolio/schema';
import {
  coverageGaps,
  coverageProblems,
  rendersSharedSection,
  unitSaysCoveragePending,
} from './coverage';

const complete = {
  id: 'editorial-evidence',
  renderedKinds: [...CORE_SECTION_KINDS],
  routes: { home: 'bespoke', work: 'bespoke' },
} as const;

test('a first-party composition that renders every core kind and its own case study has no gaps', () => {
  assert.deepEqual(coverageGaps(complete), []);
  assert.deepEqual(coverageProblems(complete, false), []);
});

test('a missing core kind or a shared work route is a problem, unless its unit says pending', () => {
  const partial = {
    ...complete,
    renderedKinds: CORE_SECTION_KINDS.filter((kind) => kind !== 'github' && kind !== 'cta'),
    routes: { home: 'bespoke', work: 'shared' },
  } as const;
  const problems = coverageProblems(partial, false);
  assert.equal(problems.length, 2);
  assert.match(problems[0]!, /leaves out cta, github|leaves out github, cta/);
  assert.match(problems[1]!, /routes\.work is shared/);
  assert.match(problems[0]!, /coverage: 'pending'/);
  assert.deepEqual(coverageProblems(partial, true), []);
});

test('pending with nothing left to cover is stale', () => {
  const [problem, ...rest] = coverageProblems(complete, true);
  assert.equal(rest.length, 0);
  assert.match(problem!, /stale: remove it/);
});

test('the fallback and third-party variants keep the shared renderers', () => {
  for (const id of ['fallback', 'acme-orbit']) {
    const shared = { id, renderedKinds: [], routes: { home: 'shared', work: 'shared' } } as const;
    assert.deepEqual(coverageProblems(shared, false), []);
    assert.deepEqual(coverageProblems(shared, true), []);
  }
});

test("a unit's text says coverage is pending only in a live export of that one value", () => {
  assert.equal(unitSaysCoveragePending("export const coverage = 'pending';\n"), true);
  assert.equal(unitSaysCoveragePending('export const coverage = "pending"\n'), true);
  for (const source of [
    "// export const coverage = 'pending';\n",
    "/*\nexport const coverage = 'pending';\n*/\n",
    "export const coverage = 'done';\n",
    "export const distinct = 'pending';\n",
    "  export const coverage = 'pending';\n",
    '',
  ]) {
    assert.equal(unitSaysCoveragePending(source), false, JSON.stringify(source));
  }
});

test('rendered HTML with a shared section is told apart from bespoke markup', () => {
  assert.equal(
    rendersSharedSection('<main><section id="a" data-renderer="shared"></section></main>'),
    true,
  );
  assert.equal(rendersSharedSection("<article data-kind='quote' data-renderer='shared'>"), true);
  assert.equal(rendersSharedSection('<section data-renderer="bespoke"></section>'), false);
  assert.equal(rendersSharedSection('<p>data-renderer="shared" in text</p>'), false);
});
