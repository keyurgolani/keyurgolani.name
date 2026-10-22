import assert from 'node:assert/strict';
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pairInput, tempDir, testChecks } from '../store/test-support/fixtures';
import {
  sourceCatalogReader,
  sourceDigest,
  type OpenSourceResult,
  type SourceCatalogOptions,
  type SourceFinding,
} from './source';
import { checkUnit, contentHash } from './unit';

// SourceCatalogReader's layout beyond the pair (#3, item 19): snapshots/
// and media/media.json beside the documents, as export-revision writes
// them, read by #10's readUnitFiles(). apps/web/src/server/catalog-source.test.ts
// covers the pair itself, with the build's own checks.

const PAIR = pairInput('engineering');
const CONTROLS = { variant: 'missing-variant', values: { columns: 2 } };

function directory(t: { after(fn: () => void): void }, files: Record<string, string>) {
  const dir = tempDir(t, 'source-catalog-');
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

const pair = () => ({
  'portfolio.yml': PAIR.portfolio.sourceText,
  'site.yml': PAIR.site.sourceText,
});

function open(sourceDir: string, overrides: Partial<SourceCatalogOptions> = {}): OpenSourceResult {
  return sourceCatalogReader({
    sourceDir,
    mode: 'production',
    checks: testChecks(),
    report: () => assert.fail('nothing reads it again in production'),
    ...overrides,
  });
}

function fatal(result: OpenSourceResult): SourceFinding[] {
  assert.equal(result.ok, false);
  return result.findings.filter((finding) => finding.severity === 'fatal');
}

test('snapshots and a media document beside the pair are the unit, and nothing else there is read', async (t) => {
  const media = { assets: [] };
  const dir = directory(t, {
    ...pair(),
    'snapshots/controls.json': JSON.stringify(CONTROLS),
    'snapshots/tokens.json': '{"color": {"ink": "#111"}}',
    'media/media.json': JSON.stringify(media),
    // #10's, export-revision's, and anybody's: none of them is read.
    'media/blobs/ab/cdef': 'not JSON',
    'bundle.json': 'not JSON either',
    'snapshots/Notes.json': '{',
    'snapshots/readme.txt': 'not a snapshot',
    'notes.md': '# not a document',
  });
  const result = open(dir);
  assert.ok(result.ok, JSON.stringify(result.findings));
  // A file in snapshots/ that's no snapshot only warns.
  assert.deepEqual(
    result.findings.map((finding) => [finding.severity, finding.code, finding.file]),
    [
      ['warning', 'snapshot.ignored', 'snapshots/Notes.json'],
      ['warning', 'snapshot.ignored', 'snapshots/readme.txt'],
    ],
  );
  const live = await result.reader.getLive();
  assert.equal(live.state, 'live');
  assert.ok(live.unit);
  assert.deepEqual(live.unit.snapshots, {
    controls: CONTROLS,
    tokens: { color: { ink: '#111' } },
  });
  assert.deepEqual(live.unit.media, media);
  assert.ok(Object.isFrozen(live.unit.snapshots.controls));
  // The unitHash is the one the store would give the same unit.
  const built = checkUnit(
    { ...PAIR, media: { format: 'json', sourceText: JSON.stringify(media) } },
    { ...testChecks(), snapshots: () => live.unit!.snapshots },
  );
  assert.ok(built.ok);
  assert.equal(live.unitHash, built.unit.unitHash);
  assert.equal(contentHash(live.unit.snapshots.controls), contentHash(CONTROLS));
  // Its ID covers every file it read.
  assert.match(live.revisionId, /^doc-[0-9a-f]{12}$/);
  const bare = open(directory(t, pair()));
  assert.ok(bare.ok);
  const plain = await bare.reader.getLive();
  assert.equal(
    plain.revisionId,
    `doc-${sourceDigest(['portfolio.yml', PAIR.portfolio.sourceText], ['site.yml', PAIR.site.sourceText])}`,
  );
  assert.notEqual(plain.revisionId, live.revisionId);
  assert.deepEqual(plain.unit?.snapshots, {});
  assert.equal(plain.unit && 'media' in plain.unit, false);
});

test('a snapshot that does not parse or passes 1 MiB stops startup, naming the file', (t) => {
  const broken = fatal(open(directory(t, { ...pair(), 'snapshots/controls.json': '{"a": 1,\n' })));
  assert.deepEqual(
    broken.map((finding) => [finding.code, finding.file, finding.line]),
    [['snapshot.syntax', 'snapshots/controls.json', 2]],
  );
  const repeated = fatal(
    open(directory(t, { ...pair(), 'snapshots/controls.json': '{"a": 1, "a": 2}' })),
  );
  assert.deepEqual(
    repeated.map((finding) => finding.code),
    ['snapshot.syntax'],
  );
  assert.match(repeated[0]!.message, /repeats a key/);
  const large = fatal(
    open(
      directory(t, {
        ...pair(),
        'snapshots/tokens.json': `{"a": "${'x'.repeat(1024 * 1024)}"}`,
      }),
    ),
  );
  assert.deepEqual(
    large.map((finding) => [finding.code, finding.file]),
    [['snapshot.syntax', 'snapshots/tokens.json']],
  );
  assert.match(large[0]!.message, /1 MiB/);
  // No finding quotes a file's text.
  assert.ok(!JSON.stringify([...broken, ...large]).includes('xxxx'));
});

test('a snapshot or media document it cannot read stops startup, and a snapshots file in place of the directory only warns', async (t) => {
  const dir = directory(t, pair());
  mkdirSync(path.join(dir, 'snapshots', 'controls.json'), { recursive: true });
  assert.deepEqual(
    fatal(open(dir)).map((finding) => [finding.code, finding.file]),
    [['snapshot.invalid', 'snapshots/controls.json']],
  );
  const media = directory(t, pair());
  mkdirSync(path.join(media, 'media', 'media.json'), { recursive: true });
  assert.deepEqual(
    fatal(open(media)).map((finding) => [finding.code, finding.file]),
    [['media.invalid', 'media/media.json']],
  );
  const file = open(directory(t, { ...pair(), snapshots: 'a file' }));
  assert.ok(file.ok);
  assert.deepEqual(
    file.findings.map((finding) => [finding.severity, finding.code]),
    [['warning', 'snapshot.ignored']],
  );
  assert.deepEqual((await file.reader.getLive()).unit?.snapshots, {});
});

test('a media document that does not parse stops startup, located in media/media.json', (t) => {
  const findings = fatal(open(directory(t, { ...pair(), 'media/media.json': '{"assets": [}' })));
  assert.deepEqual(
    findings.map((finding) => [finding.code, finding.document, finding.file]),
    [['media.syntax', 'media', 'media/media.json']],
  );
  // One that parses but isn't a media document stops it too.
  const invalid = fatal(open(directory(t, { ...pair(), 'media/media.json': '{"blobs": []}' })));
  assert.deepEqual(
    [
      ...new Set(
        invalid.map((finding) => [finding.code, finding.document, finding.file].join(' ')),
      ),
    ],
    ['media.invalid media media/media.json'],
  );
});

test('under next dev an edit to a snapshot or the media document is read again', async (t) => {
  const dir = directory(t, { ...pair(), 'snapshots/controls.json': JSON.stringify(CONTROLS) });
  const reported: SourceFinding[] = [];
  const result = open(dir, { mode: 'development', report: (finding) => reported.push(finding) });
  assert.ok(result.ok);
  const first = await result.reader.getLive();
  const edit = (name: string, text: string, seconds: number) => {
    const file = path.join(dir, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    utimesSync(file, seconds, seconds);
  };
  edit('snapshots/controls.json', '{"variant": "other"}', 2_000);
  const second = await result.reader.getLive();
  assert.deepEqual(second.unit?.snapshots.controls, { variant: 'other' });
  assert.notEqual(second.revisionId, first.revisionId);
  edit('media/media.json', '{"assets": []}', 3_000);
  assert.deepEqual((await result.reader.getLive()).unit?.media, { assets: [] });
  edit('snapshots/controls.json', '{', 4_000);
  await assert.rejects(result.reader.getLive());
  assert.deepEqual(
    reported.map((finding) => finding.code),
    ['snapshot.syntax'],
  );
});
