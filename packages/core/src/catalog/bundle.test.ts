import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalize, type MediaRecord } from '@portfolio/schema';
import { invalidInput, pairInput, testChecks } from '../store/test-support/fixtures';
import {
  BUNDLE_FILE,
  BUNDLE_LIMITS,
  parseBundle,
  verifyBundle,
  type BundleEntry,
  type BundleFiles,
  type BundleProblemCode,
} from './bundle';
import { checkUnit, sha256, unitHashOf, type Sha256, type UnitInput } from './unit';

// The store-free bundle reader (#9's read-only reference, #3's provisional
// format 1): exactly the files bundle.json lists, every hash and size, the
// unitHash, that the pair serves, the kept blobs listed and held, and every
// problem refusing the whole bundle.

const text = (value: string) => new TextEncoder().encode(value);
const hex = (hash: Sha256) => hash.slice('sha256:'.length);

/** A blob's bytes, distinct by `n`. */
const blobBytes = (n: number, size = 64) => new Uint8Array(size).fill(n);

const KEPT = blobBytes(1);
const OTHER = blobBytes(2);

function record(assetId: string, blob: Uint8Array): MediaRecord {
  return {
    assetId,
    sha256: hex(sha256(blobBytes(200))),
    mime: 'image/png',
    bytes: 200,
    width: 4,
    height: 4,
    renditions: [
      {
        name: 'w4-a1',
        ext: 'png',
        mime: 'image/png',
        bytes: blob.byteLength,
        width: 4,
        sha256: hex(sha256(blob)),
      },
    ],
    derivedAt: '2026-10-24T08:00:00Z',
    algorithmVersion: 1,
    source: { kind: 'local', path: `${assetId}.png` },
    availability: { state: 'available' },
  };
}

interface Export {
  readonly files: Map<string, Uint8Array | 'link'>;
  readonly bundle: Record<string, unknown>;
}

/** A full export of `input`, with a media document naming KEPT and OTHER, as bundle format 1 lays it out. */
function exportOf(input: UnitInput = pairInput('engineering')): Export {
  const mediaText = canonicalize({
    assets: [record('kept-asset', KEPT), record('other-asset', OTHER)],
  });
  const checked = checkUnit(
    { ...input, media: { format: 'json', sourceText: mediaText } },
    testChecks(),
  );
  assert.ok(checked.ok, 'the fixture pair checks');
  const { unit } = checked;
  const files = new Map<string, Uint8Array | 'link'>();
  const documents: Record<string, unknown> = {};
  for (const name of ['portfolio', 'site'] as const) {
    const document = unit[name];
    const file = `${name}.${document.format === 'yaml' ? 'yml' : 'json'}`;
    files.set(file, text(document.sourceText));
    documents[name] = {
      file,
      format: document.format,
      schemaVersion: document.schemaVersion,
      sourceHash: document.sourceHash,
      contentHash: document.contentHash,
    };
  }
  files.set('media/media.json', text(mediaText));
  documents.media = {
    file: 'media/media.json',
    format: 'json',
    schemaVersion: null,
    sourceHash: sha256(mediaText),
    contentHash: unit.media!.contentHash,
  };
  const snapshots: Record<string, unknown> = {};
  for (const [kind, value] of Object.entries(unit.snapshots)) {
    const bytes = text(canonicalize(value));
    files.set(`snapshots/${kind}.json`, bytes);
    snapshots[kind] = { file: `snapshots/${kind}.json`, contentHash: sha256(bytes) };
  }
  const blobs = [KEPT, OTHER].map((bytes) => {
    const hash = sha256(bytes);
    files.set(`media/blobs/${hex(hash)}`, bytes);
    return { file: `media/blobs/${hex(hash)}`, sha256: hash, size: bytes.byteLength };
  });
  const bundle = {
    bundleFormat: 1,
    revisionId: `rev_${'a'.repeat(32)}`,
    parentRevisionId: null,
    createdAt: '2026-10-24T08:00:00.000Z',
    createdBy: 'owner',
    source: { kind: 'publish' },
    appVersion: '0.0.0-test',
    unitHash: unit.unitHash,
    documents,
    snapshots,
    blobs,
    rendering: { variant: null, packs: [], contracts: {} },
    events: [{ seq: 1, type: 'publish', reason: 'canary-bundle-event-reason' }],
  };
  files.set(BUNDLE_FILE, text(JSON.stringify(bundle, null, 2)));
  return { files, bundle };
}

/** `files` as the port, counting each read. */
function port(files: Map<string, Uint8Array | 'link'>, reads: string[] = []): BundleFiles {
  return {
    list: async () =>
      [...files].map(([path, bytes]): BundleEntry =>
        bytes === 'link'
          ? { path, type: 'other', size: 0 }
          : { path, type: 'file', size: bytes.byteLength },
      ),
    read: async (path, limit) => {
      reads.push(path);
      const bytes = files.get(path);
      if (!(bytes instanceof Uint8Array)) throw new Error('not a regular file');
      return bytes.slice(0, limit + 1);
    },
  };
}

const keepKept = () => new Set([sha256(KEPT)]);

function rewrite(exported: Export, change: (bundle: Record<string, unknown>) => void): Export {
  const bundle = structuredClone(exported.bundle);
  change(bundle);
  exported.files.set(BUNDLE_FILE, text(JSON.stringify(bundle)));
  return { files: exported.files, bundle };
}

async function codes(files: Map<string, Uint8Array | 'link'>, heldBytes?: number) {
  const verified = await verifyBundle(port(files), {
    checks: testChecks(),
    keep: keepKept,
    ...(heldBytes === undefined ? {} : { heldBytes }),
  });
  assert.equal(verified.ok, false, 'the bundle is refused');
  return verified.ok ? [] : verified.problems.map(({ code, path }) => `${code}:${path ?? ''}`);
}

const flip = (bytes: Uint8Array) => {
  const copy = bytes.slice();
  copy[copy.length - 1] = copy[copy.length - 1]! ^ 1;
  return copy;
};

test('a full export verifies: its unit, and only the kept blobs, held, each file read once', async () => {
  const { files } = exportOf();
  const reads: string[] = [];
  const verified = await verifyBundle(port(files, reads), { checks: testChecks(), keep: keepKept });
  assert.ok(verified.ok);
  assert.deepEqual([...verified.blobs.keys()], [sha256(KEPT)]);
  assert.deepEqual(verified.blobs.get(sha256(KEPT)), KEPT);
  assert.equal(verified.bundle.revisionId, `rev_${'a'.repeat(32)}`);
  assert.ok(verified.unit.media, 'the media document comes with the unit');
  assert.deepEqual([...reads].sort(), [...files.keys()].sort(), 'every file, once');
  assert.ok(Object.isFrozen(verified.unit.portfolio));
});

test('bundle.json gives the reader only the fields it checks, never the events', async () => {
  const { files } = exportOf();
  const verified = await verifyBundle(port(files), { checks: testChecks() });
  assert.ok(verified.ok);
  assert.deepEqual(Object.keys(verified.bundle).sort(), [
    'blobs',
    'bundleFormat',
    'documents',
    'revisionId',
    'snapshots',
    'unitHash',
  ]);
  assert.ok(!JSON.stringify(verified).includes('canary-bundle-event-reason'));
});

const PROBLEMS: readonly [string, (exported: Export) => Export, BundleProblemCode][] = [
  [
    'a flipped byte in a document',
    (e) => (e.files.set('portfolio.yml', flip(e.files.get('portfolio.yml') as Uint8Array)), e),
    'hash_mismatch',
  ],
  [
    'a flipped byte in a snapshot',
    (e) => {
      const file = [...e.files.keys()].find((path) => path.startsWith('snapshots/'))!;
      e.files.set(file, flip(e.files.get(file) as Uint8Array));
      return e;
    },
    'hash_mismatch',
  ],
  [
    'a flipped byte in the media document',
    (e) => (
      e.files.set('media/media.json', flip(e.files.get('media/media.json') as Uint8Array)),
      e
    ),
    'hash_mismatch',
  ],
  [
    'a flipped byte in a kept blob',
    (e) => {
      const file = `media/blobs/${hex(sha256(KEPT))}`;
      e.files.set(file, flip(KEPT));
      return e;
    },
    'hash_mismatch',
  ],
  [
    'a flipped byte in a blob nothing keeps',
    (e) => {
      const file = `media/blobs/${hex(sha256(OTHER))}`;
      e.files.set(file, flip(OTHER));
      return e;
    },
    'hash_mismatch',
  ],
  [
    'a blob of another size than listed',
    (e) => (e.files.set(`media/blobs/${hex(sha256(KEPT))}`, blobBytes(1, 65)), e),
    'hash_mismatch',
  ],
  [
    'a file bundle.json does not list',
    (e) => (e.files.set('notes.txt', text('x')), e),
    'unexpected_file',
  ],
  ['a stray .DS_Store', (e) => (e.files.set('media/.DS_Store', text('x')), e), 'unexpected_file'],
  [
    'a link in place of a listed file',
    (e) => (e.files.set('site.yml', 'link'), e),
    'unexpected_file',
  ],
  ['a link anywhere', (e) => (e.files.set('snapshots/extra.json', 'link'), e), 'unexpected_file'],
  ['a listed file missing', (e) => (e.files.delete('site.yml'), e), 'file_missing'],
  [
    'a listed blob missing',
    (e) => (e.files.delete(`media/blobs/${hex(sha256(OTHER))}`), e),
    'file_missing',
  ],
  [
    'a document over 1 MiB',
    (e) => (e.files.set('portfolio.yml', new Uint8Array(BUNDLE_LIMITS.documentBytes + 1)), e),
    'too_large',
  ],
  [
    'a unitHash that is not the files’',
    (e) => rewrite(e, (b) => (b.unitHash = sha256('other'))),
    'unit_hash_mismatch',
  ],
  [
    'a contentHash that is not the model’s',
    (e) =>
      rewrite(e, (b) => {
        const documents = b.documents as Record<string, Record<string, unknown>>;
        documents.site!.contentHash = sha256('other');
        b.unitHash = unitHashOf(
          documents as never,
          Object.fromEntries(
            Object.entries(b.snapshots as Record<string, { contentHash: Sha256 }>).map(
              ([kind, entry]) => [kind, entry.contentHash],
            ),
          ),
        );
      }),
    'content_hash_mismatch',
  ],
  ['another bundle format', (e) => rewrite(e, (b) => (b.bundleFormat = 2)), 'bundle_unreadable'],
  ['no bundle format', (e) => rewrite(e, (b) => delete b.bundleFormat), 'bundle_unreadable'],
  [
    'bundle.json that is not JSON',
    (e) => (e.files.set(BUNDLE_FILE, text('{')), e),
    'bundle_unreadable',
  ],
  ['no bundle.json', (e) => (e.files.delete(BUNDLE_FILE), e), 'bundle_unreadable'],
  [
    'bundle.json over 1 MiB',
    (e) => (e.files.set(BUNDLE_FILE, new Uint8Array(BUNDLE_LIMITS.bundleBytes + 1)), e),
    'too_large',
  ],
  [
    'a kept blob bundle.json does not list',
    (e) =>
      rewrite(e, (b) => {
        b.blobs = (b.blobs as { sha256: Sha256 }[]).filter((blob) => blob.sha256 !== sha256(KEPT));
        e.files.delete(`media/blobs/${hex(sha256(KEPT))}`);
      }),
    'blob_unlisted',
  ],
  [
    'a media document that does not check',
    (e) => {
      const bad = text(JSON.stringify({ assets: 'nope' }));
      e.files.set('media/media.json', bad);
      return rewrite(e, (b) => {
        (b.documents as Record<string, Record<string, unknown>>).media!.sourceHash = sha256(bad);
      });
    },
    'does_not_serve',
  ],
];

for (const [name, change, code] of PROBLEMS) {
  test(`${name} refuses the whole bundle (${code})`, async () => {
    const found = await codes(change(exportOf()).files);
    assert.ok(
      found.some((entry) => entry.startsWith(`${code}:`)),
      `${found.join(', ')} includes ${code}`,
    );
  });
}

test('a pair that does not serve under this build refuses the bundle, naming the record, never its text', async () => {
  const input = invalidInput('schema.invalid');
  // The fixture's hashes are made without checking: build them by hand.
  const exported = exportOf();
  const sourceText = input.portfolio.sourceText;
  exported.files.set('portfolio.yml', text(sourceText));
  const changed = rewrite(exported, (b) => {
    const documents = b.documents as Record<string, Record<string, unknown>>;
    documents.portfolio!.sourceHash = sha256(sourceText);
  });
  const verified = await verifyBundle(port(changed.files), { checks: testChecks() });
  assert.equal(verified.ok, false);
  if (verified.ok) return;
  assert.ok(verified.problems.length > 0);
  for (const problem of verified.problems) {
    assert.equal(problem.code, 'does_not_serve');
    assert.deepEqual(Object.keys(problem.diagnostic ?? {}).sort(), ['code', 'document', 'pointer']);
  }
});

test('the kept blobs over the held limit refuse the bundle whole', async () => {
  const found = await codes(exportOf().files, KEPT.byteLength - 1);
  assert.deepEqual(found, ['too_large:']);
  const verified = await verifyBundle(port(exportOf().files), {
    checks: testChecks(),
    keep: keepKept,
    heldBytes: KEPT.byteLength,
  });
  assert.ok(verified.ok, 'exactly at the limit is held');
});

test('a layout problem stops it before any file but bundle.json is read', async () => {
  const exported = exportOf();
  exported.files.set('extra', text('x'));
  const reads: string[] = [];
  const verified = await verifyBundle(port(exported.files, reads), { checks: testChecks() });
  assert.equal(verified.ok, false);
  assert.deepEqual(reads, [BUNDLE_FILE]);
});

test('too many files refuses it before anything is read', async () => {
  const files = new Map<string, Uint8Array | 'link'>();
  for (let n = 0; n <= BUNDLE_LIMITS.files; n++) files.set(`f${n}`, text(''));
  const reads: string[] = [];
  const verified = await verifyBundle(port(files, reads), { checks: testChecks() });
  assert.deepEqual(verified.ok ? [] : verified.problems.map(({ code }) => code), ['too_large']);
  assert.deepEqual(reads, []);
});

test('a listing that fails is bundle_unreadable', async () => {
  const verified = await verifyBundle(
    {
      list: async () => {
        throw new Error('EACCES');
      },
      read: async () => new Uint8Array(),
    },
    { checks: testChecks() },
  );
  assert.deepEqual(verified.ok ? [] : verified.problems, [{ code: 'bundle_unreadable' }]);
});

test('parseBundle checks every file name against the layout before any is used', () => {
  const { bundle } = exportOf();
  assert.ok(parseBundle(bundle));
  type Loose = {
    documents: Record<string, Record<string, unknown>>;
    snapshots: Record<string, Record<string, unknown>>;
    blobs: Record<string, unknown>[];
    revisionId: unknown;
    unitHash: unknown;
  };
  const variants: ((b: Loose) => void)[] = [
    (b) => (b.documents.portfolio!.file = '../portfolio.yml'),
    (b) => (b.documents.site!.file = 'site.json'),
    (b) => (b.documents.media!.file = 'media/../media.json'),
    (b) => (b.documents.media!.format = 'yaml'),
    (b) => (b.documents.extra = b.documents.site!),
    (b) => (b.snapshots['../x'] = { file: 'snapshots/../x.json', contentHash: sha256('x') }),
    (b) => (b.snapshots.controls!.file = 'snapshots/other.json'),
    (b) => (b.blobs[0]!.file = '../blob'),
    (b) => (b.blobs[0]!.file = `media/blobs/${'0'.repeat(64)}`),
    (b) => (b.blobs[0]!.sha256 = `sha256:${'A'.repeat(64)}`),
    (b) => (b.blobs[0]!.size = -1),
    (b) => (b.blobs[1] = b.blobs[0]!),
    (b) => (b.revisionId = 'rev_../../x'),
    (b) => (b.unitHash = 'sha256:short'),
    (b) => (b.documents.portfolio!.sourceHash = 'md5:x'),
  ];
  for (const change of variants) {
    const copy = structuredClone(bundle) as unknown as Loose;
    change(copy);
    assert.equal(parseBundle(copy), null, change.toString());
  }
});
