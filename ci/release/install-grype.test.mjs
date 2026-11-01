import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { digestProblem, GRYPE } from './install-grype.mjs';

test('Grype is pinned to one release asset and its SHA-256', () => {
  assert.match(GRYPE.version, /^\d+\.\d+\.\d+$/);
  assert.equal(
    GRYPE.url,
    `https://github.com/anchore/grype/releases/download/v${GRYPE.version}/grype_${GRYPE.version}_linux_amd64.tar.gz`,
  );
  assert.match(GRYPE.sha256, /^[0-9a-f]{64}$/);
});

test('an archive with another SHA-256 is refused', () => {
  const archive = Buffer.from('not grype');
  assert.match(digestProblem(archive), /does not match the pinned/);
  const sha = createHash('sha256').update(archive).digest('hex');
  assert.equal(digestProblem(archive, sha), null);
});
