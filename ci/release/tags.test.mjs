import test from 'node:test';
import assert from 'node:assert/strict';
import { ghcrImage, parseReleaseTag, promotionTargets, rcImageTag } from './tags.mjs';

test('a release tag is vX.Y.Z-rc.N or vX.Y.Z, and nothing else', () => {
  assert.deepEqual(parseReleaseTag('v1.2.3-rc.4'), {
    kind: 'rc',
    version: '1.2.3',
    major: 1,
    minor: 2,
    patch: 3,
    rc: 4,
  });
  assert.equal(parseReleaseTag('v1.0.0').kind, 'final');
  assert.equal(parseReleaseTag('v10.20.30').version, '10.20.30');
  for (const tag of [
    '1.2.3',
    'v1.2',
    'v1.2.3-rc',
    'v1.2.3-rc.0',
    'v1.2.3-rc.01',
    'v01.2.3',
    'v1.2.3-beta.1',
    'v1.2.3-rc.1+build',
    'v1.2.3 ',
    'refs/tags/v1.2.3',
    '',
    undefined,
  ]) {
    assert.equal(parseReleaseTag(tag), null, String(tag));
  }
});

test('an RC digest is tagged with the tag minus its v', () => {
  assert.equal(rcImageTag('v1.2.3-rc.4'), '1.2.3-rc.4');
});

test('promotion moves X.Y, X, and latest only when no newer final release holds them', () => {
  assert.deepEqual(promotionTargets('v1.0.0', []), ['1.0.0', '1.0', '1', 'latest']);
  assert.deepEqual(promotionTargets('v1.2.0', ['v1.0.0', 'v1.1.4', 'v1.2.0', 'v1.3.0-rc.1']), [
    '1.2.0',
    '1.2',
    '1',
    'latest',
  ]);
  // A patch to an older line keeps the newer lines' tags where they are.
  assert.deepEqual(promotionTargets('v1.1.5', ['v1.1.4', 'v1.2.0', 'v2.0.0']), ['1.1.5', '1.1']);
  assert.deepEqual(promotionTargets('v1.3.0', ['v1.2.0', 'v2.0.0']), ['1.3.0', '1.3', '1']);
  assert.deepEqual(promotionTargets('v1.1.3', ['v1.1.4']), ['1.1.3']);
  assert.throws(() => promotionTargets('v1.0.0-rc.1', []), /not a final release tag/);
});

test('the GHCR image is the repository lowercased, and only an owner/repo name', () => {
  assert.equal(ghcrImage('KeyurGolani/keyurgolani.name'), 'ghcr.io/keyurgolani/keyurgolani.name');
  for (const bad of ['', 'owner', 'owner/repo/extra', 'owner/re po', undefined]) {
    assert.throws(() => ghcrImage(bad), /owner\/repo/);
  }
});
