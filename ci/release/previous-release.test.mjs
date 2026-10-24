import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { previousRelease } from './previous-release.mjs';

const PARENT = '0123456789abcdef0123456789abcdef01234567';

test('the previous release is the newest final tag in the candidate history', () => {
  assert.deepEqual(
    previousRelease({
      allTags: ['v1.0.0', 'v1.1.0-rc.1', 'v1.1.0', 'v1.2.0', 'v10.0.0-beta.1'],
      mergedTags: ['v1.0.0', 'v1.1.0-rc.1', 'v1.1.0'],
      parent: PARENT,
      hasStore: () => true,
    }),
    { ref: 'v1.1.0', why: 'the newest final release in the candidate history' },
  );
});

test('before the first final release, the candidate parent stands in', () => {
  assert.deepEqual(
    previousRelease({
      allTags: ['v1.0.0-rc.1', 'v1.0.0-rc.2'],
      mergedTags: ['v1.0.0-rc.1'],
      parent: PARENT,
      hasStore: () => true,
    }),
    {
      ref: PARENT,
      why: 'no final release ships the revision store yet, so the candidate parent stands in',
    },
  );
});

test("final releases outside the candidate's history fail, rather than fall back to its parent", () => {
  const chosen = previousRelease({
    allTags: ['v1.0.0'],
    mergedTags: [],
    parent: PARENT,
    hasStore: () => true,
  });
  assert.equal(chosen.ref, undefined);
  assert.match(
    chosen.error,
    /final releases with the revision store exist \(v1\.0\.0\), but none is in the candidate's history/,
  );
});

test('a release from before the revision store never counts: it has no store to back up', () => {
  const store = (tag) => tag !== 'v0.1.1';
  assert.deepEqual(
    previousRelease({
      allTags: ['v0.1.1'],
      mergedTags: ['v0.1.1'],
      parent: PARENT,
      hasStore: store,
    }),
    {
      ref: PARENT,
      why: 'no final release ships the revision store yet, so the candidate parent stands in',
    },
  );
  assert.equal(
    previousRelease({
      allTags: ['v0.1.1', 'v1.0.0'],
      mergedTags: ['v0.1.1', 'v1.0.0'],
      parent: PARENT,
      hasStore: store,
    }).ref,
    'v1.0.0',
  );
});

test('rc-rehearsal finds its previous release with this script, and has no quiet fallback of its own', () => {
  const workflow = parse(
    readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'),
  );
  const step = workflow.jobs['rc-rehearsal'].steps.find(
    (s) => s.name === 'Find the previous release',
  );
  assert.equal(step.run.trim(), 'node ci/release/previous-release.mjs');
  const checkout = workflow.jobs['rc-rehearsal'].steps.find((s) =>
    /^actions\/checkout@/.test(s.uses ?? ''),
  );
  assert.equal(checkout.with['fetch-depth'], 0, 'it sees every tag');
});
