import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedOwnerStore } from './owner-store.mjs';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function site(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'owner-store-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'config');
  const data = path.join(root, 'data');
  mkdirSync(source);
  mkdirSync(data, { mode: 0o700 });
  return { source, data };
}

test('seedOwnerStore publishes the source pair into the data directory as revision 1', (t) => {
  const { source, data } = site(t);
  copyFileSync(path.join(FIXTURES, 'portfolio.yml'), path.join(source, 'portfolio.yml'));
  copyFileSync(path.join(FIXTURES, 'site.yml'), path.join(source, 'site.yml'));
  seedOwnerStore(data, source);
  const live = JSON.parse(readFileSync(path.join(data, 'publication', 'live.json'), 'utf8'));
  assert.equal(live.seq, 1);
  assert.deepEqual(
    readdirSync(path.join(data, 'revisions')).filter((name) => name.startsWith('rev_')),
    [live.revisionId],
  );
  const stored = readFileSync(
    path.join(data, 'revisions', live.revisionId, 'documents', 'portfolio.yml'),
    'utf8',
  );
  assert.equal(stored, readFileSync(path.join(source, 'portfolio.yml'), 'utf8'));
});

test("seedOwnerStore throws when the pair can't be published, and when a document is missing", (t) => {
  const { source, data } = site(t);
  copyFileSync(path.join(FIXTURES, 'site.yml'), path.join(source, 'site.yml'));
  assert.throws(() => seedOwnerStore(data, source), /no portfolio document/);
  const broken = site(t);
  copyFileSync(path.join(FIXTURES, 'site.yml'), path.join(broken.source, 'site.yml'));
  copyFileSync(path.join(FIXTURES, 'site.yml'), path.join(broken.source, 'portfolio.yml'));
  assert.throws(() => seedOwnerStore(broken.data, broken.source), /didn't publish the pair/);
});
