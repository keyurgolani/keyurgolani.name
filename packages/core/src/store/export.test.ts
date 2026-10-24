// portfolio-store export-revision and verify-revision (#9, from #3's items
// 19 and 26), on a real data directory through runCli(): a published
// revision as read-only's source layout in export format 1, which the
// store-free reader (catalog/bundle.ts) verifies unchanged and read-only
// serves as the same unit; every refusal writes nothing; nothing of the
// store's own reaches a bundle; and verify-revision finds what's wrong with
// one by the reader's codes, with paths relative to it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import {
  applyEdits,
  canonicalize,
  isPlainObject,
  mediaBlobs,
  resolvePortfolioView,
  validatePublicationUnit,
  type MediaRecord,
} from '@portfolio/schema';
import { readPairBytes } from '@portfolio/schema/node';
import { parseBundle, verifyBundle } from '../catalog/bundle';
import type { SchemeGenerators } from '../catalog/schemes';
import { sourceCatalogReader } from '../catalog/source';
import { sha256, type Sha256, type UnitChecks, type UnitInput } from '../catalog/unit';
import { publicationUnitOf } from '../catalog/view';
import { bundleDirectory, servedBlobs } from './bundle-files';
import type { Draft, DraftOutcome } from './drafts';
import { nodeFs, type FsPort } from './fs-port';
import type { RevisionId } from './layout';
import { readEvents } from './pointer';
import { readRevision } from './revisions';
import type { Store } from './store';
import { cli } from './test-support/cli';
import { recordingFs, crashingFs } from './test-support/crash-fs';
import { newStore, owned, pairInput, tempDir, testChecks } from './test-support/fixtures';

const readSource = (dir: string) => readPairBytes(dir);
const hexOf = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The test build's one generator: a seed scheme, its tokens the seed. */
const generators: SchemeGenerators = {
  declared: (schemeId) =>
    schemeId === 'gen-seed' ? { id: 'test-seed', version: 1, input: 'seed-color' } : undefined,
  run(declared, input) {
    if (!('seedColor' in input)) return { ok: false, problem: 'a seed only' };
    const tokens = { accent: input.seedColor };
    return {
      ok: true,
      generator: { id: declared.id, version: declared.version },
      tokens: { light: tokens, dark: tokens },
    };
  },
  check: (entry) => isPlainObject(entry) && isPlainObject(entry.tokens),
};

/** The checks of a build whose media document is #10's, and which has a seed scheme. */
const checks: UnitChecks = testChecks({
  referencedBlobs: (media) => mediaBlobs(media),
  schemes: generators,
});

const bytesOf = (label: string, size = 96) =>
  Buffer.concat([Buffer.from(`${label}:`), Buffer.alloc(size, label.length)]);

/**
 * The blobs the store holds for the test's media: a public cover, a private
 * portrait, an image nothing places, each with one rendition, and a PDF.
 */
const BLOBS = {
  coverSource: bytesOf('cover-source'),
  coverRendition: bytesOf('cover-w4'),
  portraitSource: bytesOf('portrait-source'),
  portraitRendition: bytesOf('portrait-w4'),
  unplacedSource: bytesOf('unplaced-source'),
  unplacedRendition: bytesOf('unplaced-w4'),
  pdf: bytesOf('reading-list-pdf'),
};

function image(assetId: string, source: Buffer, rendition: Buffer): MediaRecord {
  return {
    assetId,
    sha256: hexOf(source),
    mime: 'image/png',
    bytes: source.byteLength,
    width: 4,
    height: 4,
    renditions: [
      {
        name: 'w4-a1',
        ext: 'webp',
        mime: 'image/webp',
        bytes: rendition.byteLength,
        width: 4,
        height: 4,
        sha256: hexOf(rendition),
      },
    ],
    derivedAt: '2026-10-24T08:00:00.000Z',
    algorithmVersion: 1,
    source: { kind: 'local', path: `${assetId}.png` },
    availability: { state: 'available' },
  };
}

const MEDIA = {
  assets: [
    image('cover', BLOBS.coverSource, BLOBS.coverRendition),
    image('portrait', BLOBS.portraitSource, BLOBS.portraitRendition),
    image('unplaced', BLOBS.unplacedSource, BLOBS.unplacedRendition),
    {
      assetId: 'reading-list',
      sha256: hexOf(BLOBS.pdf),
      mime: 'application/pdf',
      bytes: BLOBS.pdf.byteLength,
      renditions: [],
      derivedAt: '2026-10-24T08:00:00.000Z',
      algorithmVersion: 1,
      source: { kind: 'local', path: 'reading-list.pdf' },
      availability: { state: 'available' },
    },
  ],
};

/**
 * The engineering pair's portfolio with the test's media: shipyard's cover,
 * public; its private portrait and its PDF, placed beside it; and an image
 * nothing places.
 */
function withMediaEntries(text: string): string {
  const placed = text.replace(
    '    summary: A deploy orchestrator that rolls back before you notice.\n',
    '    summary: A deploy orchestrator that rolls back before you notice.\n' +
      '    cover:\n      asset: cover\n' +
      '    media:\n      - asset: portrait\n      - asset: reading-list\n',
  );
  assert.notEqual(placed, text);
  return (
    `${placed}media:\n` +
    '  - id: cover\n    kind: image\n    source: cover.png\n    alt: A test cover.\n' +
    '  - id: portrait\n    kind: image\n    source: portrait.png\n    visibility: private\n' +
    '    alt: A private portrait.\n' +
    '  - id: unplaced\n    kind: image\n    source: unplaced.png\n    alt: Nothing places it.\n' +
    '  - id: reading-list\n    kind: document\n    source: reading-list.pdf\n'
  );
}

/** The engineering pair, selecting the seed scheme, with the test's media entries and document. */
function pairWithSeed(seed: string): UnitInput {
  const input = pairInput('engineering');
  return {
    ...input,
    portfolio: { ...input.portfolio, sourceText: withMediaEntries(input.portfolio.sourceText) },
    site: {
      ...input.site,
      sourceText: applyEdits(input.site.sourceText, input.site.format, [
        { op: 'set', pointer: '/appearance/colorScheme', value: 'gen-seed' },
        { op: 'set', pointer: '/appearanceInputs', value: { 'gen-seed': { seedColor: seed } } },
      ]),
    },
    media: { format: 'json', sourceText: `${JSON.stringify(MEDIA, null, 2)}\n` },
  };
}

function github(stars: number) {
  return {
    records: [
      {
        adapter: 'github',
        sectionId: 'on-code',
        fetchedAt: '2026-10-20T00:00:00Z',
        data: {
          username: 'ines',
          profileUrl: 'https://github.com/ines',
          source: 'rest',
          totalRepos: 3,
          totalStarsReceived: stars,
          starsGiven: null,
          contributionsLastYear: null,
          pinnedRepos: [],
          recentlyActive: [],
          contributionCalendar: [],
          languageBreakdown: [],
        },
      },
    ],
  };
}

function saved(outcome: DraftOutcome): Draft {
  assert.equal(outcome.kind, 'saved', JSON.stringify(outcome));
  if (outcome.kind !== 'saved') throw new Error('unreachable');
  return outcome.draft;
}

/** What no bundle may hold: test values for the store's own state, and a draft's record. */
const CANARIES = {
  draftRecord: 'CANARY-EXPORT-DRAFT-RECORD',
  session: 'CANARY-EXPORT-SESSION',
  claim: 'CANARY-EXPORT-SERVER-CLAIM',
  lock: 'CANARY-EXPORT-LOCK',
  audit: 'CANARY-EXPORT-AUDIT',
  passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$Q0FOQVJZ$CANARYEXPORTHASHtestvalueonly',
  githubToken: 'canary-export-github-token-test-value',
  reason: 'CANARY-EXPORT-EVENT-REASON',
  idempotencyKey: 'canary-export-idempotency-key',
  olderRevision: 'CANARY-EXPORT-NEVER-IN-REV-1',
} as const;

interface Seeded {
  readonly root: string;
  readonly store: Store;
  /** Imported first; live again after a rollback, with controls and schemes snapshots. */
  readonly first: RevisionId;
  /** Published from a draft with GitHub data, then rolled back from: an older revision. */
  readonly second: RevisionId;
}

/**
 * A store with two revisions and everything an export must leave out: a
 * working draft holding a private record, a session file, the server's
 * claim, the lock's file, an audit record, and events with a reason and
 * idempotency keys. Every path is real, with no link above it.
 */
async function seeded(t: TestContext): Promise<Seeded> {
  const root = realpathSync(tempDir(t, 'export-'));
  const dataDir = path.join(root, 'data');
  mkdirSync(dataDir, { mode: 0o700 });
  const store = await newStore(t, { dataDir, checks });
  for (const [name, bytes] of Object.entries(BLOBS)) {
    await store.assets.put(bytes, name === 'pdf' ? 'application/pdf' : 'image/png');
  }
  const imported = await store.publication.importSource(
    {
      documents: pairWithSeed('#3366ff'),
      sourceHash: `sha256:${hexOf('first')}`,
      expectedLiveRevisionId: null,
    },
    'operator',
  );
  assert.equal(imported.kind, 'committed', JSON.stringify(imported));
  const first = (imported as { revisionId: RevisionId }).revisionId;

  // The second revision adds GitHub data and a marker revision 1 never had.
  let draft = saved(await store.drafts.create({}, 'owner'));
  const marked = draft.documents.portfolio;
  draft = saved(
    await store.drafts.save(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        documents: {
          ...pairWithSeed('#3366ff'),
          portfolio: {
            format: marked.format,
            sourceText: applyEdits(marked.sourceText, marked.format, [
              { op: 'set', pointer: '/meta/description', value: CANARIES.olderRevision },
            ]),
          },
        },
      },
      'owner',
    ),
  );
  draft = saved(
    await store.drafts.refreshSources(
      { draftId: draft.draftId, expectedVersion: draft.version, snapshots: { github: github(12) } },
      'owner',
    ),
  );
  draft = saved(
    await store.drafts.decideChanges(
      {
        draftId: draft.draftId,
        expectedVersion: draft.version,
        changeIds: (draft.derived?.changes ?? []).map(({ id }) => id),
        decision: 'accepted',
      },
      'owner',
    ),
  );
  const published = await owned(store).publish(
    {
      draftId: draft.draftId,
      draftVersion: draft.version,
      expectedLiveRevisionId: first,
      idempotencyKey: `${CANARIES.idempotencyKey}-1`,
    },
    'owner',
  );
  assert.equal(published.kind, 'committed', JSON.stringify(published));
  const second = (published as { revisionId: RevisionId }).revisionId;
  const rolled = await owned(store).rollback(
    {
      targetRevisionId: first,
      expectedLiveRevisionId: second,
      reason: CANARIES.reason,
      idempotencyKey: `${CANARIES.idempotencyKey}-2`,
    },
    'owner',
  );
  assert.equal(rolled.kind, 'committed', JSON.stringify(rolled));

  // A working draft that holds a private record nothing published.
  const current = await store.drafts.getWorking();
  const working = saved(
    await store.drafts.create(current ? { expectedVersion: current.version } : {}, 'owner'),
  );
  const text = working.documents.portfolio.sourceText.replace(
    '  - id: deploy-scripts\n',
    `  - id: canary-export-draft\n    title: ${CANARIES.draftRecord}\n    medium: software\n    summary: Only the draft holds it.\n    visibility: private\n  - id: deploy-scripts\n`,
  );
  assert.notEqual(text, working.documents.portfolio.sourceText);
  saved(
    await store.drafts.save(
      {
        draftId: working.draftId,
        expectedVersion: working.version,
        documents: { ...pairWithSeed('#3366ff'), portfolio: { format: 'yaml', sourceText: text } },
      },
      'owner',
    ),
  );
  // The store's own state, as a server and a session leave it.
  mkdirSync(path.join(store.paths.ephemeral, 'sessions'), { recursive: true });
  writeFileSync(path.join(store.paths.ephemeral, 'sessions', 'canary.json'), CANARIES.session);
  writeFileSync(store.paths.server, JSON.stringify({ pid: 1, note: CANARIES.claim }));
  writeFileSync(store.paths.lock, JSON.stringify({ pid: 1, note: CANARIES.lock }));
  mkdirSync(store.paths.audit, { recursive: true });
  appendFileSync(
    path.join(store.paths.audit, '2026-10.jsonl'),
    `${JSON.stringify({ note: CANARIES.audit })}\n`,
  );
  return { root, store, first, second };
}

/** Every file under `dir`, relative, with / between names, never through a link. */
function filesIn(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? filesIn(path.join(dir, entry.name), `${prefix}${entry.name}/`)
        : [`${prefix}${entry.name}`],
    )
    .sort();
}

async function exportCli(
  seededStore: Seeded,
  args: readonly string[],
  extra: { readonly fs?: FsPort; readonly env?: Record<string, string> } = {},
) {
  return cli(['export-revision', ...args], {
    dataDir: seededStore.store.paths.root,
    readSource,
    checks,
    ...(extra.fs ? { fs: extra.fs } : {}),
    ...(extra.env
      ? { env: { PORTFOLIO_DATA_DIR: seededStore.store.paths.root, ...extra.env } }
      : {}),
  });
}

const verifyCli = (dir: string) => cli(['verify-revision', dir], { readSource, checks });

const bundleOf = (dir: string) =>
  JSON.parse(readFileSync(path.join(dir, 'bundle.json'), 'utf8')) as Record<string, unknown> & {
    blobs: { file: string; sha256: Sha256; size: number }[];
    events: Record<string, unknown>[];
    snapshots: Record<string, { file: string; contentHash: Sha256 }>;
  };

const FIXTURE = fileURLToPath(
  new URL('../../../../tests/fixtures/reference-export/', import.meta.url),
);

test('an export of live and of an older revision is export format 1: the store-free reader verifies each unchanged, and verify-revision passes it', async (t) => {
  const seededStore = await seeded(t);
  const { root, store, first, second } = seededStore;
  for (const [target, id] of [
    ['live', first],
    [second, second],
  ] as const) {
    const out = path.join(root, `out-${target}`);
    const run = await exportCli(seededStore, [target, '--out', out]);
    assert.equal(run.code, 0, run.err);
    assert.match(run.out, new RegExp(`^revision: ${id}$`, 'm'));

    const read = await readRevision(nodeFs, store.paths, id);
    assert.ok(read.ok);
    const { manifest, unit } = read.revision;
    const bundle = bundleOf(out);
    // The reader's own parse takes it, and its check passes it as it is.
    const parsed = parseBundle(bundle);
    assert.ok(parsed, 'parseBundle reads bundle.json');
    assert.equal(parsed.revisionId, id);
    assert.equal(parsed.unitHash, manifest.unitHash);
    const verified = await verifyBundle(bundleDirectory(out), {
      checks,
      keep: (served) => new Set(servedBlobs(served)),
    });
    assert.ok(verified.ok, JSON.stringify(!verified.ok && verified.problems));
    assert.deepEqual(verified.unit, publicationUnitOf(unit));

    // The documents byte for byte; every snapshot kind the revision has, none named here.
    assert.equal(readFileSync(path.join(out, 'portfolio.yml'), 'utf8'), unit.portfolio.sourceText);
    assert.equal(readFileSync(path.join(out, 'site.yml'), 'utf8'), unit.site.sourceText);
    const kinds = Object.keys(manifest.snapshots).sort();
    assert.deepEqual(Object.keys(bundle.snapshots).sort(), kinds);
    for (const kind of kinds) {
      const bytes = readFileSync(path.join(out, 'snapshots', `${kind}.json`));
      assert.equal(bytes.toString('utf8'), canonicalize(unit.snapshots[kind]));
      assert.equal(bundle.snapshots[kind]!.contentHash, sha256(bytes));
      assert.equal(sha256(bytes), manifest.snapshots[kind]!.contentHash);
    }
    assert.deepEqual(
      kinds,
      id === second ? ['controls', 'github', 'schemes'] : ['controls', 'schemes'],
    );
    JSON.parse(readFileSync(path.join(out, 'media', 'media.json'), 'utf8'));

    const verify = await verifyCli(out);
    assert.equal(verify.code, 0, verify.out);
    assert.match(verify.out, new RegExp(`^unit hash: ${manifest.unitHash}$`, 'm'));
    assert.equal(verify.out.includes(root), verify.out.includes(out), 'only the path it was given');
  }
});

test("the blobs are the renditions the public view serves, by bare hex, each with its sha256 and size; a private or unplaced asset's renditions and every original stay out", async (t) => {
  const seededStore = await seeded(t);
  const out = path.join(seededStore.root, 'out');
  assert.equal((await exportCli(seededStore, ['live', '--out', out])).code, 0);
  const bundle = bundleOf(out);
  // The public view keeps the cover and the PDF it places, and neither the
  // private portrait nor the image nothing places.
  const read = await readRevision(nodeFs, seededStore.store.paths, seededStore.first);
  assert.ok(read.ok);
  const unit = publicationUnitOf(read.revision.unit);
  const view = resolvePortfolioView(
    unit,
    { media: unit.media, snapshots: unit.snapshots },
    { mediaBase: '/media' },
  );
  assert.deepEqual(Object.keys(view.media).sort(), ['cover', 'reading-list']);
  const expected = [BLOBS.coverRendition].map((bytes) => ({
    file: `media/blobs/${hexOf(bytes)}`,
    sha256: `sha256:${hexOf(bytes)}`,
    size: bytes.byteLength,
  }));
  assert.deepEqual(bundle.blobs, expected);
  assert.deepEqual(
    servedBlobs(unit),
    expected.map(({ sha256: hash }) => hash),
  );
  for (const blob of expected) {
    assert.deepEqual(
      readFileSync(path.join(out, blob.file)),
      readFileSync(seededStore.store.paths.blob(blob.sha256 as Sha256)),
    );
  }
  assert.deepEqual(readdirSync(path.join(out, 'media', 'blobs')), [hexOf(BLOBS.coverRendition)]);
  for (const absent of [
    BLOBS.portraitRendition,
    BLOBS.unplacedRendition,
    BLOBS.pdf,
    BLOBS.coverSource,
    BLOBS.portraitSource,
    BLOBS.unplacedSource,
  ]) {
    assert.equal(existsSync(path.join(out, 'media', 'blobs', hexOf(absent))), false);
  }
  // The media document still lists every record, as the revision does.
  assert.equal(
    readFileSync(path.join(out, 'media', 'media.json'), 'utf8'),
    read.revision.unit.media!.sourceText,
  );
});

test("bundle.json has the reference fixture's shape, and its events are the ones that made the revision live, with public fields alone", async (t) => {
  const seededStore = await seeded(t);
  const { root, store, first, second } = seededStore;
  const fixture = JSON.parse(readFileSync(path.join(FIXTURE, 'bundle.json'), 'utf8')) as Record<
    string,
    unknown
  > & { events: Record<string, unknown>[]; documents: Record<string, Record<string, unknown>> };
  const all = await readEvents(nodeFs, store.paths);
  for (const id of [first, second]) {
    const out = path.join(root, `out-${id}`);
    assert.equal((await exportCli(seededStore, [id, '--out', out])).code, 0);
    const bundle = bundleOf(out);
    assert.deepEqual(Object.keys(bundle).sort(), Object.keys(fixture).sort());
    for (const name of ['portfolio', 'site', 'media']) {
      assert.deepEqual(
        Object.keys((bundle.documents as Record<string, object>)[name]!).sort(),
        Object.keys(fixture.documents[name]!).sort(),
      );
    }
    assert.deepEqual(bundle.source, { kind: id === first ? 'import' : 'draft' });
    const made = all.filter((event) => event.revisionId === id);
    assert.deepEqual(
      bundle.events.map(({ seq, type }) => [seq, type]),
      made.map(({ seq, type }) => [seq, type]),
    );
    assert.deepEqual(
      bundle.events.map((event) => event.seq),
      id === first ? [1, 3] : [2],
    );
    const fields = new Set(bundle.events.flatMap((event) => Object.keys(event)));
    for (const field of fields) {
      assert.ok(
        [
          'seq',
          'type',
          'revisionId',
          'previousRevisionId',
          'actor',
          'at',
          'sourceHash',
          'restoredFrom',
        ].includes(field),
        `${field} is public`,
      );
    }
    assert.equal(id === first ? 'sourceHash' in bundle.events[0]! : true, true);
  }
});

test('read-only serves an exported directory as the same unit, with the same unitHash', async (t) => {
  const seededStore = await seeded(t);
  for (const id of [seededStore.first, seededStore.second]) {
    const out = path.join(seededStore.root, `out-${id}`);
    assert.equal((await exportCli(seededStore, [id, '--out', out])).code, 0);
    const read = await readRevision(nodeFs, seededStore.store.paths, id);
    assert.ok(read.ok);
    const findings: unknown[] = [];
    const opened = sourceCatalogReader({
      sourceDir: out,
      mode: 'production',
      checks,
      report: (finding) => findings.push(finding),
    });
    assert.ok(opened.ok, JSON.stringify(!opened.ok && opened.findings));
    const live = await opened.reader.getLive();
    assert.equal(live.unitHash, read.revision.manifest.unitHash);
    assert.deepEqual(live.unit, publicationUnitOf(read.revision.unit));
  }
});

test('--documents-only writes the two documents, byte for byte, and nothing else', async (t) => {
  const seededStore = await seeded(t);
  const out = path.join(seededStore.root, 'documents');
  const run = await exportCli(seededStore, [seededStore.second, '--out', out, '--documents-only']);
  assert.equal(run.code, 0, run.err);
  assert.deepEqual(filesIn(out), ['portfolio.yml', 'site.yml']);
  const read = await readRevision(nodeFs, seededStore.store.paths, seededStore.second);
  assert.ok(read.ok);
  assert.equal(
    readFileSync(path.join(out, 'portfolio.yml'), 'utf8'),
    read.revision.unit.portfolio.sourceText,
  );
  assert.equal(
    readFileSync(path.join(out, 'site.yml'), 'utf8'),
    read.revision.unit.site.sourceText,
  );
  // With no bundle.json, there's nothing to verify it against.
  const verify = await verifyCli(out);
  assert.equal(verify.code, 1);
  assert.match(verify.out, /^problem: bundle_unreadable bundle\.json$/m);
});

test("nothing of the store's own reaches a bundle: no draft, session, claim, lock, audit record, password hash, token, event reason, idempotency key, or another revision", async (t) => {
  const seededStore = await seeded(t);
  const out = path.join(seededStore.root, 'out');
  const run = await exportCli(seededStore, ['live', '--out', out], {
    env: {
      PORTFOLIO_OWNER_PASSWORD_HASH: CANARIES.passwordHash,
      GITHUB_TOKEN: CANARIES.githubToken,
    },
  });
  assert.equal(run.code, 0, run.err);
  const files = filesIn(out);
  assert.ok(files.includes('bundle.json'));
  for (const file of files) {
    const text = readFileSync(path.join(out, file), 'latin1');
    for (const [name, canary] of Object.entries(CANARIES)) {
      assert.equal(text.includes(canary), false, `${file} holds the ${name} canary`);
    }
    for (const store of ['drafts', 'ephemeral', 'audit', 'drf_']) {
      assert.equal(file.includes(store), false, file);
    }
  }
  for (const canary of Object.values(CANARIES)) {
    assert.equal(run.out.includes(canary) || run.err.includes(canary), false);
  }
  // The canaries are there to be left out: the store holds each one.
  const held = filesIn(seededStore.store.paths.root)
    .map((file) => readFileSync(path.join(seededStore.store.paths.root, file), 'latin1'))
    .join('\n');
  for (const name of [
    'draftRecord',
    'session',
    'claim',
    'lock',
    'audit',
    'reason',
    'idempotencyKey',
    'olderRevision',
  ] as const) {
    assert.ok(held.includes(CANARIES[name]), `the store holds the ${name} canary`);
  }
});

const isDirectory = (dir: string) => existsSync(dir) && statSync(dir).isDirectory();

/** What `dir`'s parent holds, so a refusal shows it left nothing beside the target either. */
const besides = (dir: string) => readdirSync(path.dirname(dir)).sort();

test('every refusal writes nothing, and says why: a target that is not empty, overlaps the data or source directory, or is reached through a link; an unknown or damaged revision; a missing or changed blob', async (t) => {
  const seededStore = await seeded(t);
  const { root, store, first } = seededStore;
  const source = path.join(root, 'source');
  mkdirSync(source);
  const refuse = async (
    label: string,
    args: readonly string[],
    code: string,
    env: Record<string, string> = {},
  ) => {
    const out = args[args.indexOf('--out') + 1]!;
    // Beside a target in the test's own directory: the system's temp directory changes under it.
    const before =
      path.dirname(out).startsWith(root) && isDirectory(path.dirname(out)) ? besides(out) : null;
    const recorded = recordingFs();
    const run = await exportCli(seededStore, args, { fs: recorded.fs, env });
    assert.equal(run.code, 1, `${label}: ${run.out}`);
    assert.match(run.err, new RegExp(`^${code}: .*Nothing was written\\.`, 'm'), label);
    assert.deepEqual(recorded.calls, [], `${label}: nothing written`);
    if (before) assert.deepEqual(besides(out), before, `${label}: nothing beside it`);
  };

  const full = path.join(root, 'full');
  mkdirSync(full);
  writeFileSync(path.join(full, 'keep.txt'), 'kept');
  await refuse('a target that holds a file', ['live', '--out', full], 'target_not_empty');
  assert.deepEqual(readdirSync(full), ['keep.txt']);
  const file = path.join(root, 'a-file');
  writeFileSync(file, 'x');
  await refuse('a target that is a file', ['live', '--out', file], 'target_not_empty');

  await refuse(
    'inside the data directory',
    ['live', '--out', path.join(store.paths.root, 'out')],
    'target_overlaps',
  );
  await refuse('the data directory itself', ['live', '--out', store.paths.root], 'target_overlaps');
  await refuse('holding the data directory', ['live', '--out', root], 'target_overlaps');
  const env = { PORTFOLIO_SOURCE_DIR: source };
  await refuse(
    'inside the source directory',
    ['live', '--out', path.join(source, 'out')],
    'target_overlaps',
    env,
  );
  await refuse('the source directory itself', ['live', '--out', source], 'target_overlaps', env);
  const holder = path.join(root, 'holder');
  mkdirSync(path.join(holder, 'source'), { recursive: true });
  await refuse('holding the source directory', ['live', '--out', holder], 'target_overlaps', {
    PORTFOLIO_SOURCE_DIR: path.join(holder, 'source'),
  });
  // A name below either that starts with two dots is still below it.
  await refuse(
    'a ..name inside the data directory',
    ['live', '--out', path.join(store.paths.root, '..x')],
    'target_overlaps',
  );
  await refuse(
    'a ..name inside the source directory',
    ['live', '--out', path.join(source, '..x')],
    'target_overlaps',
    env,
  );
  assert.equal(existsSync(path.join(store.paths.root, '..x')), false);
  // The data directory named through a link, and the target by its real path.
  const dataLink = path.join(root, 'data-link');
  symlinkSync(store.paths.root, dataLink);
  await refuse(
    'inside the data directory a link names',
    ['live', '--out', path.join(store.paths.root, 'out')],
    'target_overlaps',
    { PORTFOLIO_DATA_DIR: dataLink },
  );

  const empty = path.join(root, 'empty');
  mkdirSync(empty);
  const link = path.join(root, 'link');
  symlinkSync(empty, link);
  await refuse('a target that is a link', ['live', '--out', link], 'target_linked');
  await refuse('a target below a link', ['live', '--out', path.join(link, 'out')], 'target_linked');
  assert.deepEqual(readdirSync(empty), []);
  const intoData = path.join(root, 'into-data');
  symlinkSync(store.paths.root, intoData);
  await refuse(
    'a link into the data directory',
    ['live', '--out', path.join(intoData, 'x')],
    'target_linked',
  );
  await refuse(
    'no directory to put it in',
    ['live', '--out', path.join(root, 'no', 'such')],
    'target_parent_missing',
  );
  await refuse(
    'a file where its directory should be',
    ['live', '--out', path.join(file, 'out')],
    'target_parent_missing',
  );
  await refuse(
    'a file above its directory',
    ['live', '--out', path.join(file, 'x', 'out')],
    'target_parent_missing',
  );

  const out = path.join(root, 'out');
  await refuse('an unknown revision', [`rev_${'0'.repeat(32)}`, '--out', out], 'not_found');
  assert.equal(existsSync(out), false);

  // A changed byte in a stored document.
  const second = seededStore.second;
  const stored = path.join(store.paths.revision(second), 'documents', 'portfolio.yml');
  const original = readFileSync(stored);
  chmodSync(stored, 0o600);
  writeFileSync(stored, Buffer.concat([original, Buffer.from('# changed\n')]));
  await refuse('a damaged revision', [second, '--out', out], 'revision_damaged');
  writeFileSync(stored, original);

  // A rendition blob the store lost, then one whose bytes changed.
  const blob = store.paths.blob(`sha256:${hexOf(BLOBS.coverRendition)}`);
  const kept = readFileSync(blob);
  rmSync(blob);
  await refuse('a missing blob', [first, '--out', out], 'asset_missing');
  writeFileSync(blob, Buffer.concat([kept.subarray(0, -1), Buffer.from([kept.at(-1)! ^ 1])]));
  await refuse('a blob whose bytes changed', [first, '--out', out], 'asset_missing');
  writeFileSync(blob, kept);
  assert.equal(existsSync(out), false);

  // And with all of it put back, the same export goes through.
  assert.equal((await exportCli(seededStore, ['live', '--out', out])).code, 0);
});

test("a rendition over the reader's 20 MiB blob limit is too_large before anything is read whole or written", async (t) => {
  const root = realpathSync(tempDir(t, 'export-large-'));
  const dataDir = path.join(root, 'data');
  mkdirSync(dataDir, { mode: 0o700 });
  const store = await newStore(t, { dataDir, checks });
  const source = bytesOf('large-source');
  const rendition = Buffer.alloc(20 * 1024 * 1024 + 1, 7);
  await store.assets.put(source, 'image/png');
  await store.assets.put(rendition, 'image/webp');
  const input = pairInput('engineering');
  const imported = await store.publication.importSource(
    {
      documents: {
        ...input,
        // The cover the public view places, its one rendition past the limit.
        portfolio: { ...input.portfolio, sourceText: withMediaEntries(input.portfolio.sourceText) },
        media: {
          format: 'json',
          sourceText: JSON.stringify({ assets: [image('cover', source, rendition)] }),
        },
      },
      sourceHash: `sha256:${hexOf('large')}`,
      expectedLiveRevisionId: null,
    },
    'operator',
  );
  assert.equal(imported.kind, 'committed', JSON.stringify(imported));
  const out = path.join(root, 'out');
  const recorded = recordingFs();
  const run = await cli(['export-revision', 'live', '--out', out], {
    dataDir,
    readSource,
    checks,
    fs: recorded.fs,
  });
  assert.equal(run.code, 1);
  assert.match(run.err, /^too_large: .* 20971520, .*Nothing was written\.$/m);
  assert.deepEqual(recorded.calls, []);
  assert.equal(existsSync(out), false);
});

test('live on an empty store is refused, and so are a bad revision ID and a missing --out, as usage', async (t) => {
  const root = realpathSync(tempDir(t, 'export-empty-'));
  const dataDir = path.join(root, 'data');
  mkdirSync(dataDir, { mode: 0o700 });
  const store = await newStore(t, { dataDir, checks });
  const out = path.join(root, 'out');
  const run = await cli(['export-revision', 'live', '--out', out], {
    dataDir: store.paths.root,
    readSource,
    checks,
  });
  assert.equal(run.code, 1);
  assert.match(run.err, /^empty: /m);
  assert.equal(existsSync(out), false);
  for (const argv of [
    ['export-revision', 'rev_nope', '--out', out],
    ['export-revision', 'live'],
    ['export-revision', '--out', out],
    ['export-revision', 'live', 'live', '--out', out],
    ['verify-revision'],
  ]) {
    assert.equal(
      (await cli(argv, { dataDir: store.paths.root, readSource, checks })).code,
      2,
      argv.join(' '),
    );
  }
});

test('an empty directory at the target takes the export, and a write that fails leaves neither the target nor anything beside it', async (t) => {
  const seededStore = await seeded(t);
  const empty = path.join(seededStore.root, 'empty');
  mkdirSync(empty);
  assert.equal((await exportCli(seededStore, ['live', '--out', empty])).code, 0);
  assert.ok(filesIn(empty).includes('bundle.json'));

  for (const point of ['export.write', 'export.fsync', 'export.rename']) {
    const out = path.join(seededStore.root, `failed-${point}`);
    const before = besides(out);
    const fs = crashingFs({ point, nth: point === 'export.rename' ? 1 : 3 }, 'throw');
    const run = await exportCli(seededStore, ['live', '--out', out], { fs });
    assert.ok(fs.crashed(), point);
    assert.equal(run.code, 1, point);
    assert.equal(existsSync(out), false, point);
    assert.deepEqual(besides(out), before, `${point}: no staging left`);
  }
});

test('a sync of the target directory that fails after the rename leaves the export in place, with a warning, and exits 0', async (t) => {
  const seededStore = await seeded(t);
  const out = path.join(seededStore.root, 'synced');
  const fs = crashingFs({ point: 'export.parent.fsync', nth: 1 }, 'throw');
  const run = await exportCli(seededStore, ['live', '--out', out], { fs });
  assert.ok(fs.crashed());
  assert.equal(run.code, 0, run.err);
  assert.match(run.err, /^warning: parent_fsync_failed: the export is in place in /m);
  assert.equal((await verifyCli(out)).code, 0);
});

/** Strict checks: this build serves no site, as one without its variant wouldn't. */
const strict: UnitChecks = {
  ...checks,
  validateLive: (pair) => {
    const result = validatePublicationUnit(pair);
    return {
      ...result,
      diagnostics: [
        ...result.diagnostics,
        {
          code: 'variant.unavailable',
          severity: 'blocks-preview',
          document: 'site',
          pointer: '/appearance/variant',
          message: 'Not in this build.',
          remediation: 'Install it.',
        },
      ],
    };
  },
};

test("an export this build wouldn't serve is refused as does_not_serve, with each problem, and nothing at or beside the target", async (t) => {
  const seededStore = await seeded(t);
  const out = path.join(seededStore.root, 'unserved');
  const before = besides(out);
  const run = await cli(['export-revision', 'live', '--out', out], {
    dataDir: seededStore.store.paths.root,
    readSource,
    checks: strict,
  });
  assert.equal(run.code, 1);
  assert.match(
    run.out,
    /^problem: does_not_serve site\.yml \(variant\.unavailable in site at \/appearance\/variant\)$/m,
  );
  assert.match(run.err, /^does_not_serve: .*Nothing was written\.$/m);
  assert.equal(existsSync(out), false);
  assert.deepEqual(besides(out), before);
});

test('a target filled, or its directory swapped for a link, after the checks is refused at the move, and the staging directory goes', async (t) => {
  const seededStore = await seeded(t);
  const { root } = seededStore;

  // The rename finds the target filled since it was checked.
  const filled = path.join(root, 'filled');
  const before = besides(filled);
  const busy: FsPort = {
    ...nodeFs,
    async rename(from, to, point, pass) {
      if (point === 'export.rename') {
        throw Object.assign(new Error('Directory not empty.'), { code: 'ENOTEMPTY' });
      }
      return nodeFs.rename(from, to, point, pass);
    },
  };
  const refusedFull = await exportCli(seededStore, ['live', '--out', filled], { fs: busy });
  assert.equal(refusedFull.code, 1);
  assert.match(refusedFull.err, /^target_not_empty: .*Nothing was written\.$/m);
  assert.deepEqual(besides(filled), before);

  // The target's directory becomes a link to another while the export writes.
  const parent = path.join(root, 'parent');
  const moved = path.join(root, 'moved');
  mkdirSync(parent);
  let swapped = false;
  const swapping: FsPort = {
    ...nodeFs,
    async fsync(target, point) {
      if (!swapped && point === 'export.dir.fsync') {
        swapped = true;
        renameSync(parent, moved);
        symlinkSync(moved, parent);
      }
      return nodeFs.fsync(target, point);
    },
  };
  const run = await exportCli(seededStore, ['live', '--out', path.join(parent, 'out')], {
    fs: swapping,
  });
  assert.ok(swapped);
  assert.equal(run.code, 1);
  assert.match(run.err, /^target_linked: .*Nothing was written\.$/m);
  assert.deepEqual(readdirSync(moved), [], 'nothing where the link points');
});

test('an export takes no lock, reads the revision by its ID, and a publish while it reads gives no mixed bundle', async (t) => {
  const seededStore = await seeded(t);
  const { root, store, first } = seededStore;
  // The lock file the seed left is a stale holder's; a held one is the same to an export.
  rmSync(store.paths.lock);
  const held = await store.lock.acquire('a-publish-that-runs-long');
  try {
    const out = path.join(root, 'while-locked');
    const run = await exportCli(seededStore, ['live', '--out', out]);
    assert.equal(run.code, 0, run.err);
  } finally {
    await held.release();
  }

  // Midway through reading the blobs, another revision goes live.
  let moved: RevisionId | null = null;
  const racing: FsPort = {
    ...nodeFs,
    async readFile(file) {
      if (moved === null && file.includes(`${path.sep}assets${path.sep}`)) {
        const draft = saved(
          await store.drafts.create(
            { expectedVersion: (await store.drafts.getWorking())?.version },
            'owner',
          ),
        );
        const changed = saved(
          await store.drafts.save(
            {
              draftId: draft.draftId,
              expectedVersion: draft.version,
              documents: {
                ...pairWithSeed('#3366ff'),
                portfolio: {
                  format: 'yaml',
                  sourceText: applyEdits(draft.documents.portfolio.sourceText, 'yaml', [
                    { op: 'set', pointer: '/meta/description', value: 'Published midway.' },
                  ]),
                },
              },
            },
            'owner',
          ),
        );
        const outcome = await owned(store).publish(
          {
            draftId: changed.draftId,
            draftVersion: changed.version,
            expectedLiveRevisionId: first,
          },
          'owner',
        );
        assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
        moved = (outcome as { revisionId: RevisionId }).revisionId;
      }
      return nodeFs.readFile(file);
    },
  };
  const out = path.join(root, 'raced');
  const run = await exportCli(seededStore, ['live', '--out', out], { fs: racing });
  assert.equal(run.code, 0, run.err);
  assert.ok(moved && moved !== first, 'a publish ran midway');
  const bundle = bundleOf(out);
  assert.equal(bundle.revisionId, first);
  assert.equal((await verifyCli(out)).code, 0);
});

/** A fresh full export of the live revision, for verify-revision to find things wrong with. */
async function exported(t: TestContext): Promise<{ out: string; seededStore: Seeded }> {
  const seededStore = await seeded(t);
  const out = path.join(seededStore.root, 'export');
  assert.equal((await exportCli(seededStore, ['live', '--out', out])).code, 0);
  return { out, seededStore };
}

test("verify-revision finds a changed byte, an extra file, a missing file, a link, and a directory outside the layout, by the reader's codes, with paths relative to the bundle", async (t) => {
  const { out, seededStore } = await exported(t);
  const problems = async () => {
    const run = await verifyCli(out);
    assert.equal(run.code, 1, run.out);
    assert.equal(
      run.out
        .split('\n')
        .some((entry) => entry.startsWith('problem:') && entry.includes(seededStore.root)),
      false,
      'no absolute path',
    );
    return run.out.split('\n').filter((entry) => entry.startsWith('problem: '));
  };
  const blob = bundleOf(out).blobs[0]!.file;
  const at = (file: string) => path.join(out, ...file.split('/'));

  const portfolio = readFileSync(at('portfolio.yml'));
  writeFileSync(at('portfolio.yml'), Buffer.concat([portfolio, Buffer.from('\n')]));
  assert.deepEqual(await problems(), ['problem: hash_mismatch portfolio.yml']);
  writeFileSync(at('portfolio.yml'), portfolio);

  const bytes = readFileSync(at(blob));
  writeFileSync(at(blob), Buffer.concat([bytes.subarray(0, -1), Buffer.from([bytes.at(-1)! ^ 1])]));
  assert.deepEqual(await problems(), [`problem: hash_mismatch ${blob}`]);
  writeFileSync(at(blob), bytes);

  writeFileSync(at('notes.txt'), 'extra');
  assert.deepEqual(await problems(), ['problem: unexpected_file notes.txt']);
  rmSync(at('notes.txt'));
  writeFileSync(at('media/blobs/.DS_Store'), 'extra');
  assert.deepEqual(await problems(), ['problem: unexpected_file media/blobs/.DS_Store']);
  rmSync(at('media/blobs/.DS_Store'));

  rmSync(at('snapshots/schemes.json'));
  assert.deepEqual(await problems(), ['problem: file_missing snapshots/schemes.json']);
  writeFileSync(
    at('snapshots/schemes.json'),
    canonicalize((await liveUnit(seededStore)).snapshots.schemes),
  );

  // A link to the very bytes it should hold is still a link: never followed.
  const moved = path.join(seededStore.root, 'outside-site.yml');
  writeFileSync(moved, readFileSync(at('site.yml')));
  rmSync(at('site.yml'));
  symlinkSync(moved, at('site.yml'));
  assert.deepEqual(await problems(), [
    'problem: unexpected_file site.yml',
    'problem: file_missing site.yml',
  ]);
  rmSync(at('site.yml'));
  writeFileSync(at('site.yml'), readFileSync(moved));

  mkdirSync(at('extra/inner'), { recursive: true });
  writeFileSync(at('extra/inner/file'), 'x');
  assert.deepEqual(await problems(), ['problem: unexpected_file extra']);
  rmSync(at('extra'), { recursive: true });

  assert.equal((await verifyCli(out)).code, 0, 'back as it was, it verifies');

  // The directory itself through a link: verify-revision follows none.
  const link = path.join(seededStore.root, 'export-link');
  symlinkSync(out, link);
  const linked = await verifyCli(link);
  assert.equal(linked.code, 1);
  assert.match(linked.out, /^problem: bundle_unreadable$/m);
  // And under a link to a directory above it.
  const above = path.join(seededStore.root, 'root-link');
  symlinkSync(seededStore.root, above);
  const under = await verifyCli(path.join(above, path.basename(out)));
  assert.equal(under.code, 1);
  assert.match(under.out, /^problem: bundle_unreadable$/m);
});

test('verify-revision names the bundle as it was given, never by an absolute path it made', async (t) => {
  const { out, seededStore } = await exported(t);
  const relative = (argv: readonly string[]) =>
    cli(argv, { readSource, checks, cwd: seededStore.root });
  const passing = await relative(['verify-revision', 'export']);
  assert.equal(passing.code, 0, passing.out);
  assert.match(passing.out, /^Verified \d+ files in export: /m);
  writeFileSync(path.join(out, 'notes.txt'), 'extra');
  const failing = await relative(['verify-revision', './export']);
  assert.equal(failing.code, 1);
  assert.match(failing.out, /^1 problem: \.\/export doesn't verify\.$/m);
  const missing = await relative(['verify-revision', 'nothing-here']);
  assert.equal(missing.code, 1);
  for (const run of [passing, failing, missing]) {
    assert.equal(`${run.out}${run.err}`.includes(seededStore.root), false, run.out);
  }
});

test('a file swapped for a link between its checks and its open is never followed', async (t) => {
  const { out, seededStore } = await exported(t);
  // The link points at the very bytes the file held, so only O_NOFOLLOW tells them apart.
  const copy = path.join(seededStore.root, 'portfolio-copy.yml');
  writeFileSync(copy, readFileSync(path.join(out, 'portfolio.yml')));
  const verified = await verifyBundle(
    bundleDirectory(out, {
      beforeOpen(file) {
        if (file !== 'portfolio.yml') return;
        rmSync(path.join(out, file));
        symlinkSync(copy, path.join(out, file));
      },
    }),
    { checks, keep: (served) => new Set(servedBlobs(served)) },
  );
  assert.equal(verified.ok, false);
  assert.deepEqual(!verified.ok && verified.problems, [
    { code: 'file_missing', path: 'portfolio.yml' },
  ]);
});

async function liveUnit({ store, first }: Seeded) {
  const read = await readRevision(nodeFs, store.paths, first);
  assert.ok(read.ok);
  return read.revision.unit;
}

test("verify-revision says does_not_serve for a bundle this build won't serve, and blob_unlisted for a rendition bundle.json leaves out", async (t) => {
  const { out } = await exported(t);
  const run = await cli(['verify-revision', out], { readSource, checks: strict });
  assert.equal(run.code, 1);
  assert.match(
    run.out,
    /^problem: does_not_serve site\.yml \(variant\.unavailable in site at \/appearance\/variant\)$/m,
  );

  // A rendition the media document names, dropped from bundle.json and the directory.
  const bundle = bundleOf(out);
  const [dropped, ...rest] = bundle.blobs;
  rmSync(path.join(out, ...dropped!.file.split('/')));
  writeFileSync(
    path.join(out, 'bundle.json'),
    `${JSON.stringify({ ...bundle, blobs: rest }, null, 2)}\n`,
  );
  const unlisted = await verifyCli(out);
  assert.equal(unlisted.code, 1);
  assert.deepEqual(
    unlisted.out.split('\n').filter((entry) => entry.startsWith('problem: ')),
    [`problem: blob_unlisted ${dropped!.file}`],
  );
});
