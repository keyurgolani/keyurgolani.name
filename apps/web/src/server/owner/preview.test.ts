import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEdits, validatePublicationUnit, type DocumentFormat } from '@portfolio/schema';
import {
  createSessions,
  credentialFingerprint,
  filesystemSessionStore,
  GRANT_LIFETIME,
  GRANT_LIFETIME_RANGE,
  grantDigest,
  memoryAuditSink,
  openStore,
  preflight,
  prepareAuthDirectories,
  previewPaths,
  type Draft,
  type Store,
} from '@portfolio/core/owner';
import { liveContext } from '~/lib/variants';
import {
  readDeploymentConfig,
  PREVIEW_GRANT_LIFETIME_KEYS,
  type DeploymentConfig,
} from '../config';
import { setDeploymentState } from '../config-store';
import type { HandlerContext } from '../dispatcher';
import { authorize } from '../authorize';
import { listOperations } from '../operations';
import type { GrantSessionPort } from '../preview-port';
import type { Session } from '../session';
import { isStudioResult } from '../studio-result';
import { activityOf } from './auth';
import { ownerPreviews, type OwnerPreviews } from './preview';
import { mintSession } from './session-mint';

// The owner's preview grants (#7, Slice 2) over a real data directory: #3's
// store for the drafts and revisions grants render, #2's session records on
// disk, the grant store beside them, and #4's validator with the context
// startup checks the live pair against. Each command runs as the dispatcher
// calls it, with the token authorize() gives.

const ORIGIN = 'https://rowan.test';
const base64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
const HASH = `$scrypt$ln=17,r=8,p=1$${base64(Buffer.alloc(16, 1))}$${base64(Buffer.alloc(32, 2))}`;
const SITE = readFileSync(
  fileURLToPath(new URL('../../../../../site.example.yml', import.meta.url)),
  'utf8',
);
const portfolio = (name: string, extra = '') =>
  `schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: ${name}\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n${extra}`;
const pair = (portfolioText: string, siteText = SITE) => ({
  portfolio: { format: 'yaml' as DocumentFormat, sourceText: portfolioText },
  site: { format: 'yaml' as DocumentFormat, sourceText: siteText },
});
const ENVIRONMENT = {
  displayMode: 'dark',
  contrast: 'system',
  motion: 'reduce',
  enhancement: 'on',
};
const OVERRIDE = {
  variant: 'editorial-evidence',
  designLanguage: 'platform-neutral',
  colorScheme: 'warm',
  typography: 'classic',
  displayMode: 'high-contrast',
};

interface Setup {
  readonly config: DeploymentConfig;
  readonly store: Store;
  readonly previews: OwnerPreviews;
  readonly session: Session;
  readonly digest: string;
  /** Runs a preview.grant command as the dispatcher calls its handler. */
  command(name: string, input: unknown, session?: Session): Promise<unknown>;
  endSession(): Promise<void>;
}

async function setup(t: TestContext): Promise<Setup> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'owner-preview-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  assert.equal(await preflight({ dataDir }), null);
  assert.equal(await prepareAuthDirectories(dataDir), null);
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: 'owner',
      PORTFOLIO_ORIGIN: ORIGIN,
      PORTFOLIO_SOURCE_DIR: '/srv/config',
      PORTFOLIO_DATA_DIR: dataDir,
      PORTFOLIO_AUTH_PASSWORD_HASH: HASH,
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  const { config } = read;
  const context = { ...liveContext(), canonicalOrigin: ORIGIN };
  const store = openStore({
    dataDir,
    checks: { validate: (unit) => validatePublicationUnit(unit, context), appVersion: 'test' },
  });
  const sessions = createSessions({
    store: filesystemSessionStore(dataDir),
    audit: memoryAuditSink(),
    fingerprint: credentialFingerprint(HASH),
  });
  const { record } = await sessions.issue({ uaFamily: 'firefox' });
  const session = mintSession({ ref: record.digest.slice(0, 8) });
  const port: GrantSessionPort = {
    of: (given) =>
      given === session
        ? { digest: record.digest, absoluteExpiresAt: sessions.expiry(record).absoluteExpiresAt }
        : null,
    resolveDigest: (digest) => sessions.resolveDigest(digest),
    onSessionEnded: (listener) => sessions.onSessionEnded(listener),
  };
  const previews = ownerPreviews({
    config,
    sessions: port,
    ...liveContext(),
    fixtures: (id) => (id === 'complete' ? pair(portfolio('Fixture Person')) : null),
  });
  t.after(() => previews.close());
  setDeploymentState({
    config,
    catalog: { getLive: () => assert.fail('no live revision is read') },
    dispatch: () => assert.fail('no operation is dispatched'),
    degraded: [],
    previews: previews.port,
  });
  t.after(() => setDeploymentState(undefined));
  return {
    config,
    store,
    previews,
    session,
    digest: record.digest,
    async command(name, input, as = session) {
      const operation = listOperations().find((entry) => entry.name === name)!;
      const parsed = operation.input.parse(input);
      const authorized = authorize('preview.grant', as);
      assert.ok(authorized);
      const context: HandlerContext = {
        request: new Request(`${ORIGIN}/api/studio/${name}`, { method: 'POST' }),
        requestId: 'req-preview',
        operation,
        session: as,
        inputType: 'json',
        recheckSession: async () => null,
        commitWithSession: async () => {
          throw new Error('Nothing commits here.');
        },
      };
      const answer = await previews.handlers[name]!(authorized, parsed, context);
      if (isStudioResult(answer)) return answer.kind === 'error' ? { error: answer.code } : answer;
      assert.equal(operation.output.safeParse(answer).success, true, `${name} output`);
      return answer;
    },
    async endSession() {
      await sessions.end(record.digest, 'logout');
      // onSessionEnded passes it on without waiting.
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
  };
}

async function createDraft(store: Store, input = pair(portfolio('Draft Person'))): Promise<Draft> {
  const working = await store.drafts.getWorking();
  const created = await store.drafts.create(
    { documents: input, ...(working ? { expectedVersion: working.version } : {}) },
    'owner',
  );
  assert.equal(created.kind, 'saved', JSON.stringify(created));
  return (created as { draft: Draft }).draft;
}

const minted = (answer: unknown) => {
  const value = answer as { status: string; grant?: string };
  assert.equal(value.status, 'active', JSON.stringify(answer));
  return value.grant!;
};

test("a draft grant mints only for the draft's current version, pins it, and its frame renders that version under the session it's bound to (#7)", async (t) => {
  const { store, previews, command } = await setup(t);
  const draft = await createDraft(store);
  const grant = minted(
    await command('preview.grant.mint', {
      subject: { draft: draft.draftId, version: draft.version },
      environment: ENVIRONMENT,
    }),
  );
  assert.equal(await previews.port.admit(grant), true);
  const opened = await previews.port.open(grant);
  assert.equal(opened?.view.portfolio.identity.name, 'Draft Person');
  assert.deepEqual(opened?.environment, ENVIRONMENT);
  assert.match(opened?.ref ?? '', /^[0-9a-f]{8}$/);

  // The draft moves on: the frame still renders the version it pinned, and
  // a mint for the old version is refused.
  const saved = await store.drafts.save(
    { draftId: draft.draftId, expectedVersion: 1, documents: pair(portfolio('Saved Person')) },
    'owner',
  );
  assert.equal(saved.kind, 'saved');
  assert.equal((await previews.port.open(grant))?.view.portfolio.identity.name, 'Draft Person');
  assert.deepEqual(
    await command('preview.grant.mint', {
      subject: { draft: draft.draftId, version: 1 },
      environment: ENVIRONMENT,
    }),
    { error: 'version_conflict' },
  );
  // Nothing to render: no draft, revision, or fixture of that name.
  for (const subject of [
    { draft: `drf_${'0'.repeat(32)}`, version: 1 },
    { revision: `rev_${'0'.repeat(32)}` },
    { fixture: 'no-such-fixture' },
  ]) {
    assert.deepEqual(
      await command('preview.grant.mint', { subject, environment: ENVIRONMENT }),
      { error: 'not_found' },
      JSON.stringify(subject),
    );
  }
});

test('a version with blocks-preview findings gets no grant, only their count, and one that only blocks publishing still previews (#7)', async (t) => {
  const { store, command } = await setup(t);
  const broken = SITE.replace(
    'motionPolicy: respect-os',
    'motionPolicy: respect-os\nunknownKey: 1',
  );
  const blocked = await createDraft(store, pair(portfolio('Blocked Person'), broken));
  const findings = validatePublicationUnit(
    {
      portfolio: { text: portfolio('Blocked Person'), format: 'yaml', name: 'portfolio.yml' },
      site: { text: broken, format: 'yaml', name: 'site.yml' },
    },
    { ...liveContext(), canonicalOrigin: ORIGIN },
  ).diagnostics.filter((diagnostic) => diagnostic.severity === 'blocks-preview').length;
  assert.ok(findings > 0);
  assert.deepEqual(
    await command('preview.grant.mint', {
      subject: { draft: blocked.draftId, version: blocked.version },
      environment: ENVIRONMENT,
    }),
    { status: 'preview_blocked', diagnostics: findings },
  );
  assert.deepEqual((await readGrantFiles(store)).length, 0, 'no grant was written');

  // Two sections sharing an id: it can't go live, and it previews.
  const duplicate = portfolio(
    'Duplicate Person',
    '  - kind: now\n    id: about\n    body: Again.\n',
  );
  const publishOnly = await createDraft(store, pair(duplicate));
  minted(
    await command('preview.grant.mint', {
      subject: { draft: publishOnly.draftId, version: publishOnly.version },
      environment: ENVIRONMENT,
    }),
  );
});

/** The grant files in the store's data directory. */
async function readGrantFiles(store: Store): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  try {
    return await readdir(previewPaths(store.paths.root).grants);
  } catch {
    return [];
  }
}

test("an appearance override is checked against #4's schema, renders in the frame, and never reaches the draft (#7)", async (t) => {
  const { store, previews, command } = await setup(t);
  const draft = await createDraft(store);
  const grant = minted(
    await command('preview.grant.mint', {
      subject: { draft: draft.draftId, version: draft.version },
      appearance: OVERRIDE,
      environment: ENVIRONMENT,
    }),
  );
  const opened = await previews.port.open(grant);
  assert.equal(opened?.view.site.appearance.displayMode, 'high-contrast');
  const stored = await store.drafts.get(draft.draftId);
  assert.equal(stored?.version, 1);
  assert.equal(stored?.documents.site.sourceText, SITE, 'the draft is as saved');

  for (const appearance of [
    { ...OVERRIDE, displayMode: 'neon' },
    { ...OVERRIDE, extra: 'x' },
    { variant: 'editorial-evidence' },
  ]) {
    assert.deepEqual(
      await command('preview.grant.mint', {
        subject: { draft: draft.draftId, version: draft.version },
        appearance,
        environment: ENVIRONMENT,
      }),
      { error: 'invalid_input' },
      JSON.stringify(appearance),
    );
  }
});

test("a grant's content is read through Authorized<'preview.grant'>, built from the session it's bound to: under another profile's policy it opens nothing (#7)", async (t) => {
  const { config, previews, command } = await setup(t);
  const grant = minted(
    await command('preview.grant.mint', {
      subject: { fixture: 'complete' },
      environment: ENVIRONMENT,
    }),
  );
  assert.equal((await previews.port.open(grant))?.view.portfolio.identity.name, 'Fixture Person');
  // The same deployment state, but read-only's policy: no token, no content.
  setDeploymentState({
    config: { ...config, profile: 'read-only' },
    catalog: { getLive: () => assert.fail('no live revision is read') },
    dispatch: () => assert.fail('no operation is dispatched'),
    degraded: [],
  });
  assert.equal(await previews.port.open(grant), null);
});

test("/studio/preview is offered the working draft's version and the live revision, each with the variant its site selects, and only under preview.grant from the page's session (#7, Slice 4)", async (t) => {
  const { store, previews, session } = await setup(t);
  assert.deepEqual(await previews.port.previewable(session), []);
  const live = await store.publication.publish(
    {
      draftId: (await createDraft(store, pair(portfolio('Live Person')))).draftId,
      draftVersion: 1,
      expectedLiveRevisionId: null,
    },
    'operator',
  );
  assert.equal(live.kind, 'committed');
  const { revisionId } = live as { revisionId: `rev_${string}` };
  assert.deepEqual(await previews.port.previewable(session), [
    { kind: 'revision', subject: { revision: revisionId }, variant: 'editorial-evidence' },
  ]);
  const draft = await createDraft(store, pair(portfolio('Draft Person')));
  assert.deepEqual(await previews.port.previewable(session), [
    {
      kind: 'draft',
      subject: { draft: draft.draftId, version: draft.version },
      variant: 'editorial-evidence',
    },
    { kind: 'revision', subject: { revision: revisionId }, variant: 'editorial-evidence' },
  ]);
  // No session, or one no provider minted: the page's policy check fails, and nothing is offered.
  assert.deepEqual(await previews.port.previewable(null), []);
  assert.deepEqual(await previews.port.previewable({ ...session }), []);
});

test('publishing, discarding, and the session ending stop grants at once, through the store and the session events (#7)', async (t) => {
  const { store, previews, command, endSession } = await setup(t);
  const status = async (grant: string) =>
    ((await command('preview.grant.status', { grant })) as { status: string }).status;
  const live = await store.publication.publish(
    {
      draftId: (await createDraft(store, pair(portfolio('Live Person')))).draftId,
      draftVersion: 1,
      expectedLiveRevisionId: null,
    },
    'operator',
  );
  assert.equal(live.kind, 'committed');
  const { revisionId } = live as { revisionId: `rev_${string}` };
  const revision = minted(
    await command('preview.grant.mint', {
      subject: { revision: revisionId },
      environment: ENVIRONMENT,
    }),
  );
  assert.equal((await previews.port.open(revision))?.view.portfolio.identity.name, 'Live Person');

  const draft = await createDraft(store);
  const drafted = minted(
    await command('preview.grant.mint', {
      subject: { draft: draft.draftId, version: draft.version },
      environment: ENVIRONMENT,
    }),
  );
  const published = await store.publication.publish(
    { draftId: draft.draftId, draftVersion: draft.version, expectedLiveRevisionId: revisionId },
    'operator',
  );
  assert.equal(published.kind, 'committed');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await status(drafted), 'superseded');
  assert.equal(await status(revision), 'active', 'a revision grant survives a publish');

  const other = await createDraft(store);
  const discardable = minted(
    await command('preview.grant.mint', {
      subject: { draft: other.draftId, version: other.version },
      environment: ENVIRONMENT,
    }),
  );
  assert.equal((await store.drafts.discard({ draftId: other.draftId }, 'owner')).kind, 'discarded');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await status(discardable), 'superseded');

  await endSession();
  assert.equal(await previews.port.admit(revision), false);
  // The record says why, until its cap: the next session can't ask for it,
  // but the grant service can.
  assert.equal((await previews.grants.check(revision)).status, 'session_ended');
});

test('renew and status never slide the session, a session the provider no longer holds gets none of them, and revoke ends a grant as superseded (#7)', async (t) => {
  const { command, digest } = await setup(t);
  const grant = minted(
    await command('preview.grant.mint', {
      subject: { fixture: 'complete' },
      environment: ENVIRONMENT,
    }),
  );
  const renewed = (await command('preview.grant.renew', { grant })) as Record<string, string>;
  assert.equal(renewed.status, 'active');
  assert.ok(Date.parse(renewed.idleExpiresAt!) <= Date.parse(renewed.absoluteExpiresAt!));
  // Another session, minted by the provider for another record, sees nothing.
  const stranger = mintSession({ ref: 'ffffffff' });
  assert.deepEqual(await command('preview.grant.status', { grant }, stranger), {
    error: 'authentication_required',
  });
  assert.deepEqual(await command('preview.grant.revoke', { grant }), { revoked: true });
  assert.deepEqual(await command('preview.grant.status', { grant }), { status: 'superseded' });
  assert.deepEqual(await command('preview.grant.renew', { grant }), { status: 'superseded' });
  assert.match(digest, /^[0-9a-f]{64}$/);

  const renew = listOperations().find((operation) => operation.name === 'preview.grant.renew')!;
  const status = listOperations().find((operation) => operation.name === 'preview.grant.status')!;
  const mint = listOperations().find((operation) => operation.name === 'preview.grant.mint')!;
  assert.deepEqual(activityOf(renew), { kind: 'query' });
  assert.deepEqual(activityOf(status), { kind: 'query' });
  assert.deepEqual(activityOf(mint), { kind: 'command', extend: false });
});

test("a grant whose content no longer renders fails with a neutral error, never the sample, and a log line that names only the grant's ref (#7)", async (t) => {
  const { store, previews, command } = await setup(t);
  const lines: string[] = [];
  t.mock.method(console, 'log', (line: unknown) => lines.push(String(line)));
  const draft = await createDraft(store);
  const grant = minted(
    await command('preview.grant.mint', {
      subject: { draft: draft.draftId, version: draft.version },
      environment: ENVIRONMENT,
    }),
  );
  // The pinned copy damaged on disk, before anything renders it.
  const file = path.join(previewPaths(store.paths.root).grants, `${grantDigest(grant)}.json`);
  const record = JSON.parse(readFileSync(file, 'utf8')) as {
    documents: { site: { sourceText: string } };
  };
  record.documents.site.sourceText = applyEdits(record.documents.site.sourceText, 'yaml', [
    { op: 'set', pointer: '/appearance/displayMode', value: 'neon' },
  ]);
  writeFileSync(file, `${JSON.stringify(record)}\n`);
  await assert.rejects(previews.port.open(grant), (error: Error) => {
    assert.equal(error.message, "The grant's content doesn't render.");
    return true;
  });
  const failed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const line = failed.find((entry) => entry.event === 'preview.render_failed');
  assert.deepEqual(Object.keys(line ?? {}).sort(), ['event', 'grantRef', 'level', 'ts']);
  assert.equal(line?.grantRef, grantDigest(grant).slice(0, 8));
  const logged = lines.join('\n');
  assert.ok(!logged.includes(grant), 'no log line holds the token');
  assert.ok(!logged.includes(grantDigest(grant)), 'no log line holds the whole digest');
  assert.ok(!logged.includes('neon') && !logged.includes('Draft Person'), 'no content');
});

test("the config's grant lifetimes are the ones @portfolio/core enforces (#7)", () => {
  const {
    PORTFOLIO_PREVIEW_GRANT_IDLE_TTL_SECONDS: idle,
    PORTFOLIO_PREVIEW_GRANT_MAX_TTL_SECONDS: max,
  } = PREVIEW_GRANT_LIFETIME_KEYS;
  assert.deepEqual({ idleSeconds: idle.default, maxSeconds: max.default }, { ...GRANT_LIFETIME });
  assert.deepEqual(
    {
      idleSeconds: { min: idle.min, max: idle.max },
      maxSeconds: { min: max.min, max: max.max },
    },
    JSON.parse(JSON.stringify(GRANT_LIFETIME_RANGE)),
  );
});
