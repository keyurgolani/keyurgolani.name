import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  credentialFingerprint,
  csrfToken,
  filesystemSessionStore,
  newSessionToken,
  sessionDigest,
} from '@portfolio/core/owner';
import { validatePublicationUnit } from '@portfolio/schema';
import { authorize, type Authorized } from '../authorize';
import { accessIn, CAPABILITIES, PROFILES, type Profile } from '../capabilities';
import { compose, OWNER_PASSWORD_PROVIDER } from '../composition';
import { readDeploymentConfig, type DeploymentConfig, type Env } from '../config';
import { setDeploymentState, type DeploymentState } from '../config-store';
import type { Handler, HandlerContext } from '../dispatcher';
import { listOperations, type Operation } from '../operations';
import { provider } from './auth';
import { ownerHandlers, ownerPreviews, ownerStore } from './index';
import { mintSession } from './session-mint';

// studio-3 and publish-1 (#2): every protected entry in the registry, read
// from listOperations(), so an entry a later issue registers is walked as
// soon as it does: every entry that needs a session, and every command.
// Each one is called two ways. Through /api/studio: the dispatcher the
// owner branch composes with the password provider over a real data
// directory, which is what app/api/studio/[name]/route.ts calls, and the
// read-only and demo dispatchers. As a service: the handler the owner
// branch binds for it, with the token authorize() gives or one it doesn't.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../../site.example.yml', import.meta.url)),
};
const ORIGIN = 'https://rowan.test';
const SIBLING = 'https://demo.rowan.test';
const COOKIE = '__Host-studio_session';
const base64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
// Nothing here signs in with a password, so a hash of the right shape will do.
const HASH = `$scrypt$ln=17,r=8,p=1$${base64(randomBytes(16))}$${base64(randomBytes(32))}`;
const PORTFOLIO =
  'schemaVersion: 3\nlocale: en\ndirection: ltr\nidentity:\n  name: Rowan Test\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n';
/** #5's fixture a fixture grant renders (#7): the test pair. */
const FIXTURE = {
  portfolio: { format: 'yaml', sourceText: PORTFOLIO },
  site: { format: 'yaml', sourceText: readFileSync(EXAMPLES.site, 'utf8') },
} as const;
const ENVIRONMENT = {
  displayMode: 'system',
  contrast: 'system',
  motion: 'system',
  enhancement: 'on',
};
const REVISION = `rev_${'a'.repeat(32)}`;
const DRAFT = `drf_${'b'.repeat(32)}`;
const DOCUMENTS = {
  portfolio: { format: 'yaml', sourceText: 'schemaVersion: 2\n' },
  site: { format: 'yaml', sourceText: 'schemaVersion: 2\n' },
};
/** Input each entry's schema takes, where `{}` isn't any: a query's goes in its search parameters. */
const INPUT: Record<string, Record<string, unknown>> = {
  'auth.sessions.revoke': { ref: '0123abcd' },
  'preview.grant.mint': { subject: { fixture: 'complete' }, environment: ENVIRONMENT },
  'preview.grant.renew': { grant: 'A'.repeat(22) },
  'preview.grant.revoke': { grant: 'A'.repeat(22) },
  'preview.grant.status': { grant: 'A'.repeat(22) },
  'revision.get': { revisionId: REVISION },
  'draft.get': { draftId: DRAFT },
  'draft.save': { draftId: DRAFT, expectedVersion: 1, documents: DOCUMENTS },
  'draft.applyEdits': {
    draftId: DRAFT,
    expectedVersion: 1,
    edits: [{ document: 'portfolio', pointer: '/locale', op: 'set', value: 'en' }],
  },
  'draft.rebase': {
    draftId: DRAFT,
    expectedVersion: 1,
    documents: DOCUMENTS,
    baseRevisionId: null,
  },
  'draft.diff': { draftId: DRAFT },
  'draft.refreshSources': { draftId: DRAFT, expectedVersion: 1 },
  'draft.changes.accept': {
    draftId: DRAFT,
    expectedVersion: 1,
    changeIds: [`dch_${'0'.repeat(32)}`],
  },
  'draft.changes.dismiss': {
    draftId: DRAFT,
    expectedVersion: 1,
    changeIds: [`dch_${'0'.repeat(32)}`],
  },
  'draft.discard': { draftId: DRAFT },
  publish: { draftId: DRAFT, draftVersion: 1, expectedLiveRevisionId: null },
  rollback: { targetRevisionId: REVISION, expectedLiveRevisionId: null },
  recover: { targetRevisionId: REVISION, expectedLiveRevisionId: null },
};
/**
 * What an entry answers once every guard passes, where that's an error: a
 * sign-in with no password is a credential failure, and the draft and the
 * revision these name aren't there. The pointer moves expect no live
 * revision, though owner's first start imported the mounted pair as one.
 * Either way, it ran.
 */
const RAN: Record<string, string> = {
  'auth.login': 'credentials_rejected',
  ...Object.fromEntries(
    [
      'revision.get',
      'draft.get',
      'draft.save',
      'draft.applyEdits',
      'draft.rebase',
      'draft.diff',
      'draft.refreshSources',
      'draft.changes.accept',
      'draft.changes.dismiss',
      'draft.discard',
    ].map((name) => [name, 'not_found']),
  ),
  ...Object.fromEntries(['publish', 'rollback', 'recover'].map((name) => [name, 'live_conflict'])),
};

const protectedEntries = () =>
  listOperations().filter((operation) => operation.session || operation.kind === 'command');

interface Deployed {
  readonly config: DeploymentConfig;
  readonly state: DeploymentState;
}

let root: string;
let dataDir: string;
const deployed = new Map<Profile, Deployed>();

async function deploy(profile: Profile, env: Env): Promise<void> {
  const read = readDeploymentConfig(
    { NODE_ENV: 'production', PORTFOLIO_PROFILE: profile, ...env },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  const composed = await compose({
    config: read.config,
    examples: EXAMPLES,
    report: () => {},
    authProviders: [OWNER_PASSWORD_PROVIDER],
    previewFixtures: (id) => (id === 'complete' ? FIXTURE : null),
  });
  assert.ok(composed.ok, JSON.stringify(composed.issues));
  deployed.set(profile, { config: read.config, state: composed.state });
}

/** Stores `profile`'s deployment, as register() does, and returns it. */
function serve(profile: Profile): Deployed {
  const deployment = deployed.get(profile);
  assert.ok(deployment, profile);
  setDeploymentState(deployment.state);
  return deployment;
}

test.before(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'protected-entries-'));
  const sourceDir = path.join(root, 'config');
  dataDir = path.join(root, 'data');
  mkdirSync(sourceDir);
  mkdirSync(dataDir, { mode: 0o700 });
  writeFileSync(path.join(sourceDir, 'portfolio.yml'), PORTFOLIO);
  copyFileSync(EXAMPLES.site, path.join(sourceDir, 'site.yml'));
  await deploy('owner', {
    PORTFOLIO_ORIGIN: ORIGIN,
    PORTFOLIO_SOURCE_DIR: sourceDir,
    PORTFOLIO_DATA_DIR: dataDir,
    PORTFOLIO_AUTH_PASSWORD_HASH: HASH,
  });
  await deploy('read-only', { PORTFOLIO_ORIGIN: ORIGIN, PORTFOLIO_SOURCE_DIR: sourceDir });
  await deploy('demo', { PORTFOLIO_ORIGIN: SIBLING });
});

test.after(() => {
  setDeploymentState(undefined);
  rmSync(root, { recursive: true, force: true });
});

/**
 * A session in the data directory, as sign-in stores one, and its token.
 * Each test session is deleted once it's done with, so the store holds no
 * more than the 5 a sign-in keeps, which the session list's output allows.
 */
async function signedIn(): Promise<string> {
  const token = newSessionToken();
  const at = Date.now();
  await filesystemSessionStore(dataDir).put({
    digest: sessionDigest(token),
    createdAt: at,
    lastSeenAt: at,
    absoluteExpiresAt: at + 12 * 3_600_000,
    credentialFingerprint: credentialFingerprint(HASH),
    uaFamily: 'firefox',
  });
  return token;
}

async function signOut(token: string): Promise<void> {
  await filesystemSessionStore(dataDir).delete(sessionDigest(token));
}

interface Sent {
  readonly token?: string;
  /** The Origin to send; null for none. Default the owner origin. */
  readonly origin?: string | null;
  /** Sec-Fetch-Site; null for none. Default same-origin. */
  readonly site?: string | null;
  /** The x-csrf-token to send; null for none. Default the session's own. */
  readonly csrf?: string | null;
}

/** `operation` through /api/studio, as a browser on the owner origin sends it, but for `sent`. */
async function send(profile: Profile, operation: Operation, sent: Sent = {}) {
  const { state } = serve(profile);
  const headers = new Headers({ 'x-request-id': 'req-protected' });
  const { token, origin = ORIGIN, site = 'same-origin' } = sent;
  if (token) headers.set('cookie', `${COOKIE}=${token}`);
  if (site !== null) headers.set('sec-fetch-site', site);
  const command = operation.kind === 'command';
  if (command) {
    if (origin !== null) headers.set('origin', origin);
    headers.set('content-type', 'application/json');
    const csrf = sent.csrf === undefined ? (token ? csrfToken(token) : null) : sent.csrf;
    if (csrf !== null) headers.set('x-csrf-token', csrf);
  }
  const input = INPUT[operation.name] ?? {};
  const query =
    command || Object.keys(input).length === 0
      ? ''
      : `?${new URLSearchParams(input as Record<string, string>)}`;
  const response = await state.dispatch(
    new Request(`${ORIGIN}/api/studio/${operation.name}${query}`, {
      method: command ? 'POST' : 'GET',
      headers,
      body: command ? JSON.stringify(input) : undefined,
    }),
    operation.name,
  );
  const body = (await response.json()) as { error?: { code: string } };
  return { status: response.status, code: body.error?.code ?? null };
}

/** Whether a session still counts: config.status answers it. */
async function counts(token: string): Promise<boolean> {
  const status = listOperations().find((operation) => operation.name === 'config.status')!;
  return (await send('owner', status, { token })).status === 200;
}

test('every protected registry entry is denied without a session, the origin, the CSRF token, or the capability, called as a service and through /api/studio', async () => {
  const entries = protectedEntries();
  assert.ok(entries.length > 0);
  // A session no denied request may end or change.
  const bystander = await signedIn();
  const other = await signedIn();

  for (const operation of entries) {
    const what = (case_: string) => `${operation.name}: ${case_}`;
    const token = await signedIn();
    // Without a session.
    if (operation.session) {
      assert.deepEqual(
        await send('owner', operation),
        { status: 401, code: 'authentication_required' },
        what('no session'),
      );
      assert.deepEqual(
        await send('owner', operation, { token: newSessionToken() }),
        { status: 401, code: 'authentication_required' },
        what('a token no sign-in issued'),
      );
    }
    if (operation.kind === 'command') {
      // Without the exact Origin, or a same-origin fetch.
      const refused = { status: 403, code: 'request_origin_rejected' };
      for (const [case_, sent] of [
        ['no Origin', { origin: null }],
        ['a sibling Origin', { origin: SIBLING, site: 'same-site' }],
        ['an http Origin', { origin: 'http://rowan.test' }],
        ['a same-site fetch', { site: 'same-site' }],
        ['a cross-site fetch', { site: 'cross-site' }],
      ] as const) {
        assert.deepEqual(await send('owner', operation, { token, ...sent }), refused, what(case_));
      }
      // Without the session's CSRF token: every command but sign-in needs it.
      if (operation.name !== 'auth.login') {
        for (const [case_, csrf] of [
          ['no CSRF token', null],
          ["another session's CSRF token", csrfToken(other)],
        ] as const) {
          assert.deepEqual(await send('owner', operation, { token, csrf }), refused, what(case_));
        }
      }
    }
    // Without the capability: read-only and demo grant none of them, so the
    // entry isn't there, even for an owner token sent with all it needs.
    for (const profile of PROFILES.filter(
      (name) => accessIn(name, operation.capability) === 'absent',
    )) {
      assert.deepEqual(
        await send(profile, operation, { token }),
        { status: 404, code: 'not_available_in_profile' },
        what(profile),
      );
    }
    assert.ok(await counts(token), what('a denied request ended the session'));
    await signOut(token);
  }
  assert.ok(await counts(bystander), 'a denied request ended another session');

  // With everything it needs, each one runs, so it was the missing piece
  // that denied it.
  for (const operation of entries) {
    const token = await signedIn();
    const answer = await send('owner', operation, { token });
    assert.equal(answer.code, RAN[operation.name] ?? null, operation.name);
    await signOut(token);
    // Past the millisecond of a revoke-all, so the next session counts.
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  // As a service: the handler the owner branch binds for each entry.
  const { config } = serve('owner');
  const auth = await provider({ config, mintSession });
  const previews = ownerPreviews({ config, sessions: auth.grantSessions });
  const handlers: Readonly<Record<string, Handler>> = {
    ...ownerHandlers({
      config,
      catalog: 'revisions',
      store: ownerStore({
        config,
        checks: { validate: (pair) => validatePublicationUnit(pair), appVersion: 'test' },
        setServable: () => {},
      }),
      variantHealth: async () => ({ status: 'ok', requested: 'any', rendered: 'any' }),
    }),
    ...auth.handlers,
    ...previews.handlers,
  };
  previews.close();
  assert.deepEqual(
    Object.keys(handlers).sort(),
    listOperations()
      .map((operation) => operation.name)
      .sort(),
    'a handler for every entry, and none for anything else',
  );
  const session = mintSession();
  for (const operation of entries) {
    const handler = handlers[operation.name]!;
    const context: HandlerContext = {
      request: new Request(`${ORIGIN}/api/studio/${operation.name}`),
      requestId: 'req-service',
      operation,
      session,
      inputType: operation.kind === 'query' ? 'search' : 'json',
      recheckSession: async () => null,
      commitWithSession: async () => {
        throw new Error('Nothing commits in this test.');
      },
    };
    // Without a session, authorize() gives no token for a capability that needs one.
    if (accessIn('owner', operation.capability) === 'session') {
      assert.equal(authorize(operation.capability, null), null, operation.name);
    }
    // A token authorize() never issued, and one for another capability.
    const forged = Object.freeze({
      capability: operation.capability,
      session,
    }) as unknown as Authorized;
    await assert.rejects(async () => handler(forged, {}, context), /not authorized/);
    for (const capability of CAPABILITIES.filter(
      (id) => id !== operation.capability && accessIn('owner', id) !== 'absent',
    )) {
      const token = authorize(capability, session);
      assert.ok(token, capability);
      await assert.rejects(
        async () => handler(token, {}, context),
        /not authorized/,
        `${operation.name} with ${capability}`,
      );
    }
    // Where the profile lacks the capability, authorize() gives no token at all.
    for (const profile of PROFILES.filter(
      (name) => accessIn(name, operation.capability) === 'absent',
    )) {
      serve(profile);
      assert.equal(authorize(operation.capability, session), null, `${operation.name} ${profile}`);
    }
    serve('owner');
  }
});
