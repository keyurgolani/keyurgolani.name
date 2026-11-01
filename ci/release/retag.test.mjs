import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestDigest, retag, retagProblems } from './retag.mjs';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const OTHER = `sha256:${'b'.repeat(64)}`;
const IMAGE = 'ghcr.io/owner/repo.name';

/** A docker CLI stand-in: records calls, and every tag resolves to `resolves`. */
function fakeDocker(resolves = DIGEST) {
  const calls = [];
  const run = (args) => {
    calls.push(args);
    return args[2] === 'inspect' ? JSON.stringify({ mediaType: 'index', digest: resolves }) : '';
  };
  return { calls, run };
}

test('each tag is created from the digest by reference, then checked', () => {
  const docker = fakeDocker();
  const moved = retag(IMAGE, DIGEST, ['1.2.0', '1.2', '1', 'latest'], docker.run);
  assert.deepEqual(moved, [`${IMAGE}:1.2.0`, `${IMAGE}:1.2`, `${IMAGE}:1`, `${IMAGE}:latest`]);
  assert.deepEqual(docker.calls.slice(0, 2), [
    ['buildx', 'imagetools', 'create', '--tag', `${IMAGE}:1.2.0`, `${IMAGE}@${DIGEST}`],
    ['buildx', 'imagetools', 'inspect', `${IMAGE}:1.2.0`, '--format', '{{json .Manifest}}'],
  ]);
  // No build, no push of layers: only imagetools.
  assert.ok(docker.calls.every((args) => args[0] === 'buildx' && args[1] === 'imagetools'));
});

test('a tag that resolves to another digest stops the retag', () => {
  const docker = fakeDocker(OTHER);
  assert.throws(
    () => retag(IMAGE, DIGEST, ['1.2.0', 'latest'], docker.run),
    new RegExp(`${IMAGE}:1\\.2\\.0 resolves to ${OTHER}`),
  );
  // It stopped before moving latest.
  assert.equal(docker.calls.length, 2);
});

test('bad arguments are refused before docker runs', () => {
  const docker = fakeDocker();
  assert.throws(() => retag(IMAGE, 'sha256:short', ['1'], docker.run), /not a sha256 digest/);
  assert.throws(() => retag('Not An Image', DIGEST, ['1'], docker.run), /not an image name/);
  assert.throws(() => retag(IMAGE, DIGEST, [], docker.run), /no tags/);
  assert.throws(() => retag(IMAGE, DIGEST, ['bad tag'], docker.run), /not an image tag/);
  assert.equal(docker.calls.length, 0);
  assert.deepEqual(retagProblems('localhost:5000/portfolio', DIGEST, ['0.0.0-rc.1']), []);
});

test("the inspected digest is the index's", () => {
  assert.equal(manifestDigest(JSON.stringify({ digest: DIGEST })), DIGEST);
  assert.throws(() => manifestDigest('{}'), /no digest/);
});
