import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  baseLockProblems,
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
    copyright: 'Copyright (c) 2026 The Upstream authors',
  },
});

test('the committed lock is current, canonical, and pins every first-party pack', () => {
  const packs = lockedPacks(ROOT);
  // Every pack the three first-party packages ship, and nothing else.
  const shipped = ['appearance-languages', 'appearance-schemes', 'appearance-typography']
    .flatMap((dir) => fs.readdirSync(path.join(ROOT, 'packages', dir, 'packs')))
    .sort();
  assert.deepEqual(
    packs.map(({ id }) => id),
    shipped,
  );
  for (const id of ['humanist-ui', 'platform-neutral', 'warm-parchment']) {
    assert.ok(shipped.includes(id), `the lock pins the fallback ${id}`);
  }
  const committed = fs.readFileSync(path.join(ROOT, LOCK_FILE), 'utf8');
  assert.deepEqual(lockProblems(committed, packs), []);
  assert.equal(committed, renderLock(packs));
  // The notices cover every registered pack, an installed one's too:
  // apps/web/scripts/check-appearance-catalog.test.ts holds them to the registry.
  assert.ok(
    fs.readFileSync(path.join(ROOT, NOTICES_FILE), 'utf8').startsWith('Third-party notices'),
  );
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

test('the lock records a translucent language approved and shipped surface-opacity, and nothing for an opaque one (#20 PR 2c)', () => {
  const language = (id: string, tokens: Record<string, string>, extra = {}) => ({
    id,
    axis: 'designLanguage' as const,
    packageName: '@portfolio/appearance-languages',
    dir: `packages/appearance-languages/packs/${id}`,
    manifest: { ...manifest(id), tokens, ...extra },
    digest: `sha256-${id}`,
  });
  const lock = JSON.parse(
    renderLock([
      language('floored', { 'surface-opacity': '97%' }, { approvedSurfaceOpacity: '78%' }),
      language('glassy', { 'surface-opacity': '88%' }),
      language('solid', { 'surface-opacity': '100%' }),
    ]),
  );
  assert.deepEqual(lock.packs.floored.surfaceOpacity, { approved: '78%', shipped: '97%' });
  assert.deepEqual(lock.packs.glassy.surfaceOpacity, { approved: '88%', shipped: '88%' });
  assert.equal(lock.packs.solid.surfaceOpacity, undefined);
  // The committed lock: glassmorphism ships its floor, and records the approved design's value.
  const committed = JSON.parse(fs.readFileSync(path.join(ROOT, LOCK_FILE), 'utf8'));
  assert.deepEqual(committed.packs.glassmorphism.surfaceOpacity, {
    approved: '78%',
    shipped: '97%',
  });
  const translucent = Object.entries(committed.packs).filter(
    ([, entry]) => (entry as { surfaceOpacity?: unknown }).surfaceOpacity,
  );
  assert.deepEqual(
    translucent.map(([id]) => id),
    ['glassmorphism'],
  );
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

test("a lock edited along with its pack still fails against the base's lock: same version, same digest (#20)", () => {
  const root = workspace({ a: { manifest: manifest('a'), files: { 'styles.css': 'x' } } });
  try {
    const dir = path.join(root, 'packages', 'appearance-schemes', 'packs', 'a');
    const read = () => catalogPacks(root, packPackages(root));
    const base = { ref: 'HEAD^1', text: renderLock(read()) };
    assert.deepEqual(baseLockProblems(base, read()), []);
    // The content changes, and the committed lock is edited to match, with no version bump.
    fs.writeFileSync(path.join(dir, 'styles.css'), 'changed');
    const edited = renderLock(read());
    assert.deepEqual(lockProblems(edited, read()), [], 'the committed lock alone looks current');
    const problems = baseLockProblems(base, read());
    assert.equal(problems.length, 1);
    assert.equal(problems[0]!.pack, 'a');
    assert.equal(problems[0]!.axis, 'colorScheme');
    assert.match(problems[0]!.message, /changed since HEAD\^1 without a version bump/);
    // Bumped, it holds.
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest('a', '1.0.1')));
    assert.deepEqual(baseLockProblems(base, read()), []);
    // Below the base's version fails whatever the digest.
    const ahead = { ref: 'HEAD^1', text: renderLock(read()) };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest('a', '1.0.0')));
    assert.match(
      baseLockProblems(ahead, read())[0]!.message,
      /version went down since HEAD\^1, from 1\.0\.1 to 1\.0\.0/,
    );
    // A base with no lock, or one that doesn't pin the pack, holds it to nothing.
    assert.deepEqual(baseLockProblems({ ref: 'HEAD^1', text: null }, read()), []);
    assert.deepEqual(baseLockProblems({ ref: 'HEAD^1', text: renderLock([]) }, read()), []);
    assert.match(
      baseLockProblems({ ref: 'HEAD^1', text: 'nope' }, read())[0]!.message,
      /isn't valid JSON/,
    );
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
    const apache = renderNotices([
      {
        id: 'acme-type',
        axis: 'typography',
        packageName: '@acme/type',
        manifest: manifest('acme-type', '1.0.0', 'Apache-2.0'),
      },
    ]);
    assert.match(apache, /Licensed under the Apache-2\.0 license/);
    // The canonical text, as the Apache Software Foundation publishes it, its (a) to (d) labels included.
    assert.match(apache, /^ +Apache License$/m);
    assert.match(apache, /^ +\(a\) You must give any other recipients of the Work or$/m);
    assert.match(apache, /^ +\(d\) If the Work includes a "NOTICE" text file as part of its$/m);
    assert.match(apache, /^ +END OF TERMS AND CONDITIONS$/m);
    assert.match(apache, /^ +Copyright \[yyyy\] \[name of copyright owner\]$/m);
    assert.ok(notices.indexOf('lato (color scheme') < notices.indexOf('nord (color scheme'));
    assert.match(notices, /License: MIT/);
    assert.match(notices, /License: OFL-1\.1/);
    assert.match(notices, /Attribution: The Upstream authors/);
    assert.match(notices, /Source: Upstream, https:\/\/example\.test\/upstream/);
    // Each notice's copyright line, and under MIT the MIT permission notice beneath it.
    const nord = notices.slice(notices.indexOf('nord (color scheme'));
    assert.match(nord, /^ {4}Copyright \(c\) 2026 The Upstream authors$/m);
    assert.match(nord, /^ {4}Permission is hereby granted, free of charge,/m);
    assert.match(
      nord,
      /^ {4}The above copyright notice and this permission notice shall be included/m,
    );
    // Under OFL-1.1, the copyright line and the license's full text, once, after the notices.
    const lato = notices.slice(notices.indexOf('lato (color scheme'), notices.indexOf('nord ('));
    assert.match(lato, /Copyright \(c\) 2026 The Upstream authors/);
    assert.match(
      lato,
      /Licensed under the OFL-1\.1 license, whose full text follows these notices/,
    );
    assert.equal(notices.split('SIL OPEN FONT LICENSE Version 1.1').length - 1, 1);
    assert.ok(notices.lastIndexOf('SIL OPEN FONT LICENSE') > notices.indexOf('nord ('));
    assert.ok(!notices.includes('Apache License'), 'no Apache-2.0 pack, no Apache text');
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
  // The workspace's own: the fixture record and the catalog's 23 schemes (#20, PR 2), each in research/.
  const catalog = fs
    .readdirSync(path.join(ROOT, 'packages/appearance-schemes/research'))
    .map((file) => file.replace(/\.json$/, ''));
  assert.equal(catalog.length, 23);
  assert.deepEqual(researchIds(ROOT), ['fixture-research', ...catalog].sort());
});
