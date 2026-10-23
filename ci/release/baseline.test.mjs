// The release candidate's dependency baseline, on fixture tag lists and
// GET releases/tags/{tag} answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { finalTagsNewestFirst, isPublishedRelease, pickBaseline } from './baseline.mjs';

const STRAY = ['v9-anything', 'v2.0.0-beta.1', 'v1.10.0-rc.1', 'v1.2', 'release-3', 'v01.0.0'];
const release = (tag, fields = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  ...fields,
});

test('stray tags are never the baseline: only vX.Y.Z, by version', () => {
  assert.deepEqual(finalTagsNewestFirst([...STRAY, 'v1.2.0', 'v1.10.0', 'v1.9.3']), [
    'v1.10.0',
    'v1.9.3',
    'v1.2.0',
  ]);
  assert.deepEqual(finalTagsNewestFirst(STRAY), []);
});

test('the baseline is the newest final tag with a published release', async () => {
  const published = new Set(['v1.2.0', 'v1.9.3']);
  const asked = [];
  const tag = await pickBaseline([...STRAY, 'v1.2.0', 'v1.10.0', 'v1.9.3'], async (t) => {
    asked.push(t);
    return published.has(t);
  });
  // v1.10.0 is tagged but has no release, so v1.9.3 is next.
  assert.equal(tag, 'v1.9.3');
  assert.deepEqual(asked, ['v1.10.0', 'v1.9.3']);
});

test('with stray tags only, or no release at all, there is no baseline', async () => {
  assert.equal(await pickBaseline(STRAY, async () => true), null);
  assert.equal(await pickBaseline(['v1.0.0'], async () => false), null);
  assert.equal(await pickBaseline([], async () => true), null);
});

test('only a published final release counts, not a draft, a pre-release, or a 404', () => {
  assert.equal(isPublishedRelease(release('v1.0.0'), 'v1.0.0'), true);
  assert.equal(isPublishedRelease(release('v1.0.0', { draft: true }), 'v1.0.0'), false);
  assert.equal(isPublishedRelease(release('v1.0.0', { prerelease: true }), 'v1.0.0'), false);
  assert.equal(isPublishedRelease(release('v1.0.1'), 'v1.0.0'), false);
  assert.equal(isPublishedRelease(null, 'v1.0.0'), false);
});
