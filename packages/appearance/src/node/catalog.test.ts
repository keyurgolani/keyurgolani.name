import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  catalogPacks,
  compareVersions,
  LOCK_FILE,
  lockedPacks,
  lockProblems,
  NOTICES_FILE,
  packDigest,
  packPackages,
  renderLock,
  renderNotices,
  researchIds,
  researchRecords,
} from './catalog';

// #20's catalog lock, third-party notices, and Research records. The lock
// pins each first-party pack's version and content digest, a digest that
// changes without a version bump fails, and every file is written the same
// way from the same input.

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** A scratch workspace with one pack package holding `packs`, by id, as manifest and files. */
function workspace(
  packs: Record<string, { manifest: Record<string, unknown>; files?: Record<string, string> }>,
  research: Record<string, unknown> = {},
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-catalog-'));
  const pkg = path.join(root, 'packages', 'appearance-schemes');
  fs.mkdirSync(path.join(pkg, 'packs'), { recursive: true });
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({
      name: '@portfolio/appearance-schemes',
      portfolio: { kind: 'color-scheme', packs: './packs' },
    }),
  );
  for (const [id, { manifest, files = {} }] of Object.entries(packs)) {
    const dir = path.join(pkg, 'packs', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text);
  }
  if (Object.keys(research).length > 0) {
    fs.mkdirSync(path.join(pkg, 'research'));
    for (const [file, record] of Object.entries(research)) {
      fs.writeFileSync(path.join(pkg, 'research', file), JSON.stringify(record));
    }
  }
  return root;
}

const manifest = (id: string, version = '1.0.0', license = 'first-party') => ({
  id,
  name: id,
  version,
  tier: 'stable',
  provenance: {
    source: { name: 'Upstream', url: 'https://example.test/upstream' },
    license,
    attribution: 'The Upstream authors',
  },
});

test('the committed lock is current, canonical, and pins every first-party pack', () => {
  const packs = lockedPacks(ROOT);
  assert.deepEqual(
    packs.map(({ id }) => id),
    ['humanist-ui', 'platform-neutral', 'warm-parchment'],
  );
  const committed = fs.readFileSync(path.join(ROOT, LOCK_FILE), 'utf8');
  assert.deepEqual(lockProblems(committed, packs), []);
  assert.equal(committed, renderLock(packs));
  assert.equal(fs.readFileSync(path.join(ROOT, NOTICES_FILE), 'utf8'), renderNotices(packs));
  // Fixture packages and third parties never enter it.
  assert.ok(!committed.includes('fixture-'));
});

test('serialization is deterministic: the same packs render the same bytes, in any order', () => {
  const root = workspace({ b: { manifest: manifest('b') }, a: { manifest: manifest('a') } });
  try {
    const packs = catalogPacks(root, packPackages(root));
    assert.equal(renderLock(packs), renderLock([...packs].reverse()));
    assert.equal(renderNotices(packs), renderNotices([...packs].reverse()));
    assert.deepEqual(Object.keys(JSON.parse(renderLock(packs)).packs), ['a', 'b']);
    assert.ok(renderLock(packs).endsWith('}\n'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a digest covers every file by path and bytes, and nothing else', () => {
  const root = workspace({ a: { manifest: manifest('a'), files: { 'styles.css': 'x' } } });
  try {
    const dir = path.join(root, 'packages', 'appearance-schemes', 'packs', 'a');
    const first = packDigest(dir);
    assert.match(first, /^sha256-[0-9a-f]{64}$/);
    assert.equal(packDigest(dir), first);
    fs.writeFileSync(path.join(dir, 'styles.css'), 'y');
    const changed = packDigest(dir);
    assert.notEqual(changed, first);
    fs.renameSync(path.join(dir, 'styles.css'), path.join(dir, 'other.css'));
    assert.notEqual(packDigest(dir), changed);
    fs.writeFileSync(path.join(dir, 'OFL.txt'), '');
    assert.notEqual(packDigest(dir), changed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a digest change without a version bump fails, and so does a version that goes down', () => {
  const root = workspace({ a: { manifest: manifest('a'), files: { 'styles.css': 'x' } } });
  try {
    const dir = path.join(root, 'packages', 'appearance-schemes', 'packs', 'a');
    const read = () => catalogPacks(root, packPackages(root));
    const lock = renderLock(read());
    assert.deepEqual(lockProblems(lock, read()), []);
    // The content changes, the version doesn't.
    fs.writeFileSync(path.join(dir, 'styles.css'), 'changed');
    const unbumped = lockProblems(lock, read());
    assert.equal(unbumped.length, 1);
    assert.equal(unbumped[0]!.pack, 'a');
    assert.equal(unbumped[0]!.axis, 'colorScheme');
    assert.match(unbumped[0]!.message, /changed without a version bump/);
    // Bumped, the lock is stale until it's written again.
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest('a', '1.0.1')));
    assert.match(lockProblems(lock, read())[0]!.message, /lock entry is stale/);
    assert.deepEqual(lockProblems(renderLock(read()), read()), []);
    // Going down fails whatever the digest.
    const bumped = renderLock(read());
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest('a', '1.0.0')));
    assert.match(
      lockProblems(bumped, read())[0]!.message,
      /version went down, from 1\.0\.1 to 1\.0\.0/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a lock that is missing, malformed, out of form, or lists a pack nobody ships fails', () => {
  const root = workspace({ a: { manifest: manifest('a') } });
  try {
    const packs = catalogPacks(root, packPackages(root));
    const lock = renderLock(packs);
    assert.match(lockProblems(null, packs)[0]!.message, /is missing/);
    assert.match(lockProblems('{', packs)[0]!.message, /isn't valid JSON/);
    assert.match(lockProblems('{"lockVersion":2,"packs":{}}', packs)[0]!.message, /lock version 1/);
    assert.match(
      lockProblems(JSON.stringify(JSON.parse(lock)), packs)[0]!.message,
      /canonical form/,
    );
    assert.match(lockProblems(lock, [])[0]!.message, /pins a, which no first-party package ships/);
    assert.match(lockProblems(renderLock([]), packs)[0]!.message, /a isn't in the lock/);
    // A changed tier or license is stale too.
    const edited = lock.replace('"tier": "stable"', '"tier": "extended"');
    assert.match(lockProblems(edited, packs)[0]!.message, /lock entry is stale/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('versions compare as semver, not as text', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
});

test('the notices carry each upstream-licensed pack, and only those', () => {
  const root = workspace({
    mine: { manifest: manifest('mine') },
    nord: { manifest: manifest('nord', '1.0.0', 'MIT') },
    lato: { manifest: manifest('lato', '1.0.0', 'OFL-1.1') },
    os: { manifest: manifest('os', '1.0.0', 'provided-by-operating-system') },
  });
  try {
    const notices = renderNotices(catalogPacks(root, packPackages(root)));
    assert.ok(notices.indexOf('lato (color scheme') < notices.indexOf('nord (color scheme'));
    assert.match(notices, /License: MIT/);
    assert.match(notices, /License: OFL-1\.1/);
    assert.match(notices, /Attribution: The Upstream authors/);
    assert.match(notices, /Source: Upstream, https:\/\/example\.test\/upstream/);
    assert.ok(!notices.includes('mine (') && !notices.includes('os ('));
    const none = renderNotices(
      catalogPacks(root, packPackages(root)).filter(({ id }) => id === 'mine'),
    );
    assert.match(none, /No pack in this build ships third-party material/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('research records are read from research/, checked, and never from packs/', () => {
  const record = {
    id: 'nord',
    name: 'Nord',
    kind: 'color-scheme',
    tier: 'research',
    source: { name: 'Nord', url: null },
    license: 'unverified',
    researchedAt: '2026-10-17',
    reason: 'Its license is unverified.',
  };
  const root = workspace(
    { a: { manifest: manifest('a') } },
    {
      'nord.json': record,
      'misnamed.json': { ...record, id: 'dracula' },
      'wrong-kind.json': { ...record, id: 'wrong-kind', kind: 'typography' },
      'bad.json': { ...record, id: 'bad', tier: 'stable' },
      'notes.txt': 'x',
    },
  );
  try {
    const files = researchRecords(root, packPackages(root));
    const problems = Object.fromEntries(
      files.map(({ file, problems }) => [path.basename(file), problems]),
    );
    assert.deepEqual(problems['nord.json'], []);
    assert.match(problems['misnamed.json']![0]!, /a record's file is its id/);
    assert.match(problems['wrong-kind.json']![0]!, /a typography record in a color-scheme package/);
    assert.match(problems['bad.json']![0]!, /\/tier/);
    assert.match(problems['notes.txt']![0]!, /holds <id>\.json files alone/);
    assert.deepEqual(
      researchIds(root),
      ['bad', 'dracula', 'nord', 'wrong-kind'].filter((id) => id !== 'bad'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  // The workspace's own: the fixture record, which lives in research/.
  assert.deepEqual(researchIds(ROOT), ['fixture-research']);
});
