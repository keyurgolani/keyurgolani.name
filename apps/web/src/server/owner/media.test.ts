import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { validatePublicationUnit } from '@portfolio/schema';
import { readDeploymentConfig, type DeploymentConfig } from '../config';
import { setDeploymentState } from '../config-store';
import { createDispatcher, NO_BINDINGS } from '../dispatcher';
import { listOperations } from '../operations';
import { mintSession } from './session-mint';
import { mediaCheck } from './media';
import { NO_MEDIA, ownerStore } from './store';
import { mediaGrant, storeHandlers } from './store-handlers';

// Media at a Studio draft save (#10, items 5 and 6): draft.save, behind #2's
// session and #1's draft.write, derives the draft's media document from its
// media entries when the policy grants media.ingest. The caller never
// writes the media document, by a save or by an edit. And the
// media.renditions startup check says when sharp won't load, and when the
// media root isn't a directory the server only reads.

const ORIGIN = 'https://rowan.test';
const SITE = readFileSync(
  fileURLToPath(new URL('../../../../../site.example.yml', import.meta.url)),
  'utf8',
);
const SESSION = mintSession();
const CHECKS = {
  validate: (pair: Parameters<typeof validatePublicationUnit>[0]) =>
    validatePublicationUnit(pair, { canonicalOrigin: ORIGIN }),
  appVersion: 'test',
};

/** A solid PNG, written out by hand: no image library, nothing downloaded. */
function solidPng(width: number, height: number, [r, g, b]: readonly number[]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill([r, g, b]).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const portfolioText = (source: string) =>
  [
    'schemaVersion: 3',
    'locale: en',
    'direction: ltr',
    'identity:',
    '  name: Rowan Media',
    'media:',
    '  - id: harbor',
    '    kind: image',
    `    source: ${source}`,
    '    alt: A harbor at dawn',
    'sections:',
    '  - kind: lede',
    '    id: about',
    '    body: Hi.',
    '',
  ].join('\n');

const documents = (source: string) => ({
  portfolio: { format: 'yaml' as const, sourceText: portfolioText(source) },
  site: { format: 'yaml' as const, sourceText: SITE },
});

function configFor(dataDir: string, mediaRoot: string): DeploymentConfig {
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'owner',
      PORTFOLIO_ORIGIN: ORIGIN,
      PORTFOLIO_SOURCE_DIR: '/srv/portfolio',
      PORTFOLIO_DATA_DIR: dataDir,
      PORTFOLIO_MEDIA_ROOT: mediaRoot,
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  return read.config;
}

async function setup(t: TestContext) {
  const base = mkdtempSync(path.join(tmpdir(), 'owner-media-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dataDir = path.join(base, 'data');
  const mediaRoot = path.join(base, 'media');
  mkdirSync(dataDir, { mode: 0o700 });
  mkdirSync(path.join(mediaRoot, 'images'), { recursive: true });
  const picture = solidPng(640, 320, [30, 90, 160]);
  writeFileSync(path.join(mediaRoot, 'images', 'harbor.png'), picture);
  const config = configFor(dataDir, mediaRoot);
  setDeploymentState({
    config,
    catalog: { getLive: () => assert.fail('no visitor route here') },
    dispatch: () => assert.fail('tests call their own dispatcher'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
  const owner = ownerStore({
    config,
    checks: CHECKS,
    setServable: () => {},
  });
  t.after(() => owner.release());
  assert.deepEqual(await owner.checkDirectory(), []);
  const created = await owner.store.drafts.create(
    { documents: documents('images/harbor.png') },
    'owner',
  );
  assert.ok(created.kind === 'saved');
  const dispatch = createDispatcher({
    ...NO_BINDINGS,
    operations: listOperations(),
    handlers: storeHandlers(owner.studio),
    resolveSession: async ({ request }) => ({
      session: request.headers.get('x-test-session') === 'owner' ? SESSION : null,
    }),
    checkOrigin: async ({ request }) => request.headers.get('origin') === ORIGIN,
  });
  const send = (name: string, body: unknown, session = 'owner') =>
    dispatch(
      new Request(`${ORIGIN}/api/studio/${name}`, {
        method: 'POST',
        headers: {
          origin: ORIGIN,
          'content-type': 'application/json',
          'x-test-session': session,
        },
        body: JSON.stringify(body),
      }),
      name,
    );
  return { owner, mediaRoot, picture, draft: created.draft, send };
}

interface SavedDraft {
  readonly version: number;
  readonly documents: {
    readonly media?: { readonly model: { assets: Record<string, unknown>[] } };
  };
}

test('draft.save derives the media document from the media entries, and ignores one the caller sends', async (t) => {
  const { owner, picture, draft, send } = await setup(t);
  const forged = {
    format: 'json',
    sourceText: JSON.stringify({ assets: [{ assetId: 'harbor', sha256: 'f'.repeat(64) }] }),
  };
  const response = await send('draft.save', {
    draftId: draft.draftId,
    expectedVersion: draft.version,
    documents: { ...documents('images/harbor.png'), media: forged },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const saved = ((await response.json()) as { data: { draft: SavedDraft } }).data.draft;
  const [harbor] = saved.documents.media!.model.assets;
  assert.equal(harbor!.assetId, 'harbor');
  assert.equal(harbor!.sha256, createHash('sha256').update(picture).digest('hex'));
  assert.deepEqual([harbor!.width, harbor!.height], [640, 320]);
  assert.deepEqual(harbor!.source, { kind: 'local', path: 'images/harbor.png' });
  assert.deepEqual(
    (harbor!.renditions as { name: string }[]).map(({ name }) => name),
    ['w480-a1', 'w480-a1-jpg'],
  );
  // Each blob it names is stored, so the draft can publish.
  for (const rendition of harbor!.renditions as { sha256: string }[]) {
    assert.ok(await owner.store.assets.has(`sha256:${rendition.sha256}`));
  }

  // Without a session, nothing is saved or ingested.
  const anonymous = await send(
    'draft.save',
    { draftId: draft.draftId, expectedVersion: saved.version, documents: documents('x.png') },
    'none',
  );
  assert.equal(anonymous.status, 401);
});

test('a draft with no media entries keeps no media document, even one the caller sends', async (t) => {
  const { draft, send } = await setup(t);
  const bare = {
    portfolio: {
      format: 'yaml' as const,
      sourceText: portfolioText('images/harbor.png').replace(/media:\n(?: {2}.*\n)+/, ''),
    },
    site: documents('x').site,
  };
  assert.ok(!bare.portfolio.sourceText.includes('media:'));
  const forged = {
    format: 'json',
    sourceText: JSON.stringify({ assets: [{ assetId: 'harbor', sha256: 'f'.repeat(64) }] }),
  };
  const response = await send('draft.save', {
    draftId: draft.draftId,
    expectedVersion: draft.version,
    documents: { ...bare, media: forged },
  });
  assert.equal(response.status, 200, await response.clone().text());
  const saved = ((await response.json()) as { data: { draft: SavedDraft } }).data.draft;
  assert.equal(saved.documents.media, undefined);
});

test('a save without media.ingest keeps the media document the draft had, whatever the caller sends', async (t) => {
  const { owner, draft, send } = await setup(t);
  const first = await send('draft.save', {
    draftId: draft.draftId,
    expectedVersion: draft.version,
    documents: documents('images/harbor.png'),
  });
  const saved = ((await first.json()) as { data: { draft: SavedDraft } }).data.draft;
  const before = saved.documents.media!.model;
  const kept = await owner.studio.saveDraft(
    {
      draftId: draft.draftId,
      expectedVersion: saved.version,
      documents: { ...documents('images/other.png'), media: { format: 'json', sourceText: '{}' } },
    },
    NO_MEDIA,
  );
  assert.ok(kept.kind === 'saved');
  assert.deepEqual(kept.draft.documents.media?.model, before);
});

test('an edit to the media document is refused: it is derived', async (t) => {
  const { draft, send } = await setup(t);
  const response = await send('draft.applyEdits', {
    draftId: draft.draftId,
    expectedVersion: draft.version,
    edits: [{ document: 'media', pointer: '/assets', op: 'set', value: [] }],
  });
  assert.equal(response.status, 422);
  const { error } = (await response.json()) as {
    error: { code: string; details: { diagnostics: { code: string }[] } };
  };
  assert.equal(error.code, 'validation_failed');
  assert.deepEqual(
    error.details.diagnostics.map(({ code }) => code),
    ['media.derived'],
  );
});

test('a source gone since the last save keeps its revision, marked missing', async (t) => {
  const { mediaRoot, draft, send } = await setup(t);
  const first = await send('draft.save', {
    draftId: draft.draftId,
    expectedVersion: draft.version,
    documents: documents('images/harbor.png'),
  });
  const saved = ((await first.json()) as { data: { draft: SavedDraft } }).data.draft;
  rmSync(path.join(mediaRoot, 'images', 'harbor.png'));
  const second = await send('draft.save', {
    draftId: draft.draftId,
    expectedVersion: saved.version,
    documents: documents('images/harbor.png'),
  });
  assert.equal(second.status, 200);
  const after = ((await second.json()) as { data: { draft: SavedDraft } }).data.draft;
  const [was] = saved.documents.media!.model.assets;
  const [now] = after.documents.media!.model.assets;
  assert.equal(now!.sha256, was!.sha256);
  assert.deepEqual(now!.renditions, was!.renditions);
  assert.equal((now!.availability as { reason: string }).reason, 'missing');
});

test("media.renditions warns when sharp won't load, and when the media root isn't a read-only directory", async (t) => {
  const base = mkdtempSync(path.join(tmpdir(), 'owner-media-check-'));
  t.after(() => {
    chmodSync(path.join(base, 'ro'), 0o755);
    rmSync(base, { recursive: true, force: true });
  });
  mkdirSync(path.join(base, 'ro'));
  mkdirSync(path.join(base, 'rw'));
  chmodSync(path.join(base, 'ro'), 0o555);
  const config = (mediaRoot?: string) =>
    ({ profile: 'owner', ...(mediaRoot ? { mediaRoot } : {}) }) as DeploymentConfig;
  const codes = async (check: ReturnType<typeof mediaCheck>, root?: string) =>
    (await check({ config: config(root) })).map(({ severity, code }) => `${severity}:${code}`);

  const loads = mediaCheck();
  assert.deepEqual(await codes(loads), []);
  // Root may write anywhere, so only another user sees the mode.
  if (process.getuid?.() !== 0) assert.deepEqual(await codes(loads, path.join(base, 'ro')), []);
  assert.deepEqual(await codes(loads, path.join(base, 'rw')), ['warning:media_root_writable']);
  assert.deepEqual(await codes(loads, path.join(base, 'none')), ['warning:media_root_missing']);

  const missing = mediaCheck(async () => ({ ok: false, code: 'ERR_DLOPEN_FAILED' }));
  const issues = await missing({ config: config() });
  assert.deepEqual(
    issues.map(({ severity, code }) => `${severity}:${code}`),
    ['warning:media_renditions_unavailable'],
  );
  assert.match(issues[0]!.message, /published media keeps serving/);
});

test("a save's media grant is #1's policy for its session: owner's session gets both, nothing else gets either", (t) => {
  const base = mkdtempSync(path.join(tmpdir(), 'owner-media-grant-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const deployAs = (env: Record<string, string>) => {
    const read = readDeploymentConfig(
      { NODE_ENV: 'production', PORTFOLIO_ORIGIN: ORIGIN, ...env },
      { cwd: '/' },
    );
    assert.ok(read.ok, JSON.stringify(read.issues));
    setDeploymentState({
      config: read.config,
      catalog: { getLive: () => assert.fail('no visitor route here') },
      dispatch: () => assert.fail('no dispatch here'),
      degraded: [],
    });
  };
  t.after(() => setDeploymentState(undefined));
  deployAs({
    PORTFOLIO_PROFILE: 'owner',
    PORTFOLIO_SOURCE_DIR: '/srv/portfolio',
    PORTFOLIO_DATA_DIR: base,
  });
  assert.deepEqual(mediaGrant({ session: SESSION }), { ingest: true, fetchRemote: true });
  assert.deepEqual(mediaGrant({ session: null }), { ingest: false, fetchRemote: false });
  deployAs({ PORTFOLIO_PROFILE: 'read-only', PORTFOLIO_SOURCE_DIR: '/srv/portfolio' });
  assert.deepEqual(mediaGrant({ session: SESSION }), { ingest: false, fetchRemote: false });
  deployAs({ PORTFOLIO_PROFILE: 'demo' });
  assert.deepEqual(mediaGrant({ session: SESSION }), { ingest: false, fetchRemote: false });
});
