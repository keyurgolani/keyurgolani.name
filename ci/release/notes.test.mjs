import test from 'node:test';
import assert from 'node:assert/strict';
import { renderNotes } from './notes.mjs';

const DIGEST = `sha256:${'c'.repeat(64)}`;
const base = {
  image: 'ghcr.io/owner/repo',
  digest: DIGEST,
  sha: '1'.repeat(40),
  repository: 'owner/repo',
  runUrl: 'https://github.com/owner/repo/actions/runs/1',
};

test('candidate notes name the pull source by digest, the GHCR login, and verification', () => {
  const notes = renderNotes({ ...base, tag: 'v1.2.0-rc.3' });
  assert.match(notes, /Release candidate 3 for 1\.2\.0/);
  assert.ok(notes.includes(`docker pull ghcr.io/owner/repo@${DIGEST}`));
  assert.match(notes, /private for now, so pulling needs a login/);
  assert.ok(
    notes.includes(`gh attestation verify oci://ghcr.io/owner/repo@${DIGEST} --repo owner/repo`),
  );
  assert.match(notes, /`1\.2\.0-rc\.3` points at the same digest\. `latest` doesn't move/);
  assert.match(notes, /## Upgrade/);
  assert.match(notes, /## Roll back/);
  assert.doesNotMatch(notes, /Dry run/);
});

test('promotion notes name the candidate and every tag that moved', () => {
  const notes = renderNotes({
    ...base,
    tag: 'v1.2.0',
    candidate: 'v1.2.0-rc.3',
    targets: ['1.2.0', '1.2', '1', 'latest'],
  });
  assert.match(notes, /Promotes v1\.2\.0-rc\.3 to 1\.2\.0, with no rebuild/);
  assert.match(notes, /`1\.2\.0`, `1\.2`, `1`, `latest` point at the same digest/);
});

test('dry-run notes say nothing was published', () => {
  assert.match(renderNotes({ ...base, tag: 'v0.0.0-rc.1', dryRun: true }), /^> Dry run/);
});

test('notes need a release tag and a digest', () => {
  assert.throws(() => renderNotes({ ...base, tag: 'main' }), /not a release tag/);
  assert.throws(() => renderNotes({ ...base, tag: 'v1.0.0', digest: 'latest' }), /not a sha256/);
});
