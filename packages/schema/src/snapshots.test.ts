import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeMediaBase,
  parseMediaDocument,
  parseMediaDocumentText,
  renditionUrl,
} from './media';
import {
  isSitePath,
  isSnapshotKind,
  parseSnapshot,
  parseSnapshotText,
  readSourceSnapshots,
  UrlTableSchema,
} from './snapshots';

// The unit's derived files (#10): snapshots/<kind>.json and
// media/media.json, parsed pure. A known kind checks against its schema,
// any other is kept as plain JSON, and no problem quotes the file.

const GITHUB = readFileSync(new URL('../../../snapshots/github.json', import.meta.url), 'utf8');

test('a snapshot kind is lowercase letters, digits, and hyphens, starting with a letter', () => {
  for (const kind of ['github', 'urls', 'npm-stats', 'a1']) assert.ok(isSnapshotKind(kind), kind);
  for (const kind of ['GitHub', '1abc', 'a_b', '', '-a', 'github.json']) {
    assert.ok(!isSnapshotKind(kind), kind);
  }
  assert.deepEqual(parseSnapshot('Bad Kind', {}), {
    ok: false,
    problems: [
      {
        kind: 'schema',
        code: 'invalid_kind',
        message:
          'The snapshot kind must be lowercase letters, digits, and hyphens, such as github.',
      },
    ],
  });
});

test("the example's GitHub snapshot checks, and a broken one is located without its text", () => {
  const result = parseSnapshotText('github', GITHUB);
  assert.ok(result.ok);
  const secret = 'canary-snapshot-value';
  const broken = parseSnapshotText(
    'github',
    `{\n  "records": [\n    { "adapter": "${secret}", "sectionId": "on-github" }\n  ]\n}\n`,
  );
  assert.equal(broken.ok, false);
  if (broken.ok) return;
  assert.deepEqual(
    broken.problems.map(({ kind, pointer, line }) => [kind, pointer, line]),
    [
      ['schema', '/records/0/adapter', 3],
      ['schema', '/records/0/data', 3],
      ['schema', '/records/0/fetchedAt', 3],
    ],
  );
  assert.ok(!JSON.stringify(broken).includes(secret));
});

test('a snapshot that is not one plain JSON document of at most 1 MiB is a syntax problem', () => {
  for (const text of ['{ "records": [ }', '{"a":1}{"b":2}', `"${'x'.repeat(1024 * 1024)}"`]) {
    const result = parseSnapshotText('notes', text);
    assert.equal(result.ok, false, text.slice(0, 20));
    if (!result.ok) assert.equal(result.problems[0]!.kind, 'syntax', text.slice(0, 20));
  }
  const located = parseSnapshotText('notes', '{\n  "a": [1,,2]\n}');
  assert.ok(!located.ok && located.problems[0]!.line === 2);
});

test('a kind no schema knows is kept as plain JSON', () => {
  assert.deepEqual(parseSnapshot('npm-stats', { downloads: [1, 2], name: 'kit' }), {
    ok: true,
    value: { downloads: [1, 2], name: 'kit' },
  });
  const notJson = parseSnapshot('npm-stats', { when: new Date(0) });
  assert.equal(notJson.ok, false);
  // The readers keep the kinds that check, and list the rest.
  const github = JSON.parse(GITHUB) as unknown;
  const read = readSourceSnapshots({
    github,
    urls: { redirects: { '/a': '/a' }, gone: [] },
    'npm-stats': { downloads: 3 },
  });
  assert.deepEqual(Object.keys(read.snapshots).sort(), ['github', 'npm-stats']);
  assert.deepEqual(read.invalid, ['urls']);
  assert.deepEqual(readSourceSnapshots(undefined), { snapshots: {}, invalid: [] });
});

test('the URL table holds paths, one hop each, and a path redirects or is gone, not both', () => {
  const ok = (table: unknown) => UrlTableSchema.safeParse(table).success;
  assert.ok(ok({ redirects: { '/work/a': '/work/b' }, gone: ['/work/c'] }));
  assert.ok(ok({ redirects: {}, gone: [] }));
  for (const table of [
    { redirects: { '/a': '/a' }, gone: [] },
    { redirects: { '/a': '/b', '/b': '/c' }, gone: [] },
    { redirects: { '/a': '/b' }, gone: ['/a'] },
    { redirects: {}, gone: ['/a', '/a'] },
    { redirects: { 'https://x.test/a': '/b' }, gone: [] },
    { redirects: {}, gone: ['/a?b=1'] },
    { redirects: {} },
  ]) {
    assert.ok(!ok(table), JSON.stringify(table));
  }
  for (const path of ['/', '/work/tide', '/a/b-c']) assert.ok(isSitePath(path), path);
  for (const path of ['', 'work', '//host/a', '/a b', '/a#b', '/a?b', '/a\\b']) {
    assert.ok(!isSitePath(path), path);
  }
});

const SHA = 'b'.repeat(64);
const RECORD = {
  assetId: 'atlas-cover',
  sha256: SHA,
  mime: 'image/png',
  bytes: 10,
  renditions: [{ name: 'w960-a1', ext: 'webp', mime: 'image/webp', bytes: 5, width: 960 }],
  derivedAt: '2026-10-01T12:00:00Z',
  algorithmVersion: 1,
};

test('a media document holds one record per asset, each rendition named once', () => {
  assert.ok(parseMediaDocument({ assets: [RECORD] }).ok);
  assert.ok(parseMediaDocument({ assets: [] }).ok);
  const twice = parseMediaDocument({ assets: [RECORD, RECORD] });
  assert.ok(!twice.ok && twice.problems[0]!.pointer === '/assets/1/assetId');
  const renamed = parseMediaDocument({
    assets: [{ ...RECORD, renditions: [RECORD.renditions[0], RECORD.renditions[0]] }],
  });
  assert.ok(!renamed.ok && renamed.problems[0]!.pointer === '/assets/0/renditions/1/name');
  for (const bad of [
    { ...RECORD, sha256: 'B'.repeat(64) },
    { ...RECORD, assetId: 'Atlas Cover' },
    { ...RECORD, dominantColor: '#ABCDEF' },
    { ...RECORD, width: 0 },
    { ...RECORD, source: 'atlas.png' },
  ]) {
    assert.equal(parseMediaDocument({ assets: [bad] }).ok, false, JSON.stringify(bad));
  }
  const text = parseMediaDocumentText(`{\n  "assets": [\n    { "assetId": "x" }\n  ]\n}`);
  assert.ok(!text.ok && text.problems.every(({ line }) => line === 3));
});

test('a rendition URL is <mediaBase>/<assetId>/<sha256>/<rendition>.<ext>', () => {
  assert.equal(
    renditionUrl('/media/', RECORD, RECORD.renditions[0]!),
    `/media/atlas-cover/${SHA}/w960-a1.webp`,
  );
  assert.equal(normalizeMediaBase('/preview-assets/g1'), '/preview-assets/g1');
  for (const base of ['media', '//cdn.test', 'https://cdn.test/media', '/', '/a b', '/a//b']) {
    assert.throws(() => normalizeMediaBase(base), TypeError, base);
  }
});
