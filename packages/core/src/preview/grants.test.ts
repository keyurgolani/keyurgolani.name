import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { memoryAuditSink } from '../audit/sink';
import { revokeAllSessionFiles } from '../auth/session-files.mjs';
import { filesystemSessionStore } from '../auth/session-store';
import { createSessions, type Sessions, type SessionLifetime } from '../auth/sessions';
import { probeDataDirectory } from '../data/layout.mjs';
import { onStoreEvent } from '../store/common';
import { draftInput, type Draft } from '../store/drafts';
import type { Store } from '../store/store';
import {
  contentVariant,
  filesUnder,
  newStore,
  owned,
  pairInput,
  publishInput,
} from '../store/test-support/fixtures';
import {
  filesystemGrantStore,
  previewPaths,
  type GrantEnvironment,
  type GrantSubject,
} from './grant-store';
import {
  createPreviewGrants,
  GRANT_LIFETIME,
  MAX_ACTIVE_GRANTS,
  type GrantLogEntry,
  type PreviewGrants,
  type PreviewGrantsOptions,
} from './grants';
import { grantDigest, grantRef } from './token';

// Preview grants (#7, Slice 2) against the filesystem adapters the owner
// server runs on: the grant store under ephemeral/preview/, #2's session
// records under ephemeral/auth/, and #3's revision store for the drafts and
// revisions grants render, in one data directory that passed preflight.

const ORIGIN = 'https://rowan.test';
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const ENVIRONMENT: GrantEnvironment = Object.freeze({
  displayMode: 'dark',
  contrast: 'more',
  motion: 'reduce',
  enhancement: 'on',
});

interface Setup {
  readonly store: Store;
  readonly dataDir: string;
  readonly sessions: Sessions;
  readonly grants: PreviewGrants;
  readonly lines: GrantLogEntry[];
  readonly now: () => number;
  advance(ms: number): void;
  /** A second view of the same data directory, as another deployment would read it. */
  another(options: Partial<PreviewGrantsOptions>): PreviewGrants;
  /** Waits for the session ends onSessionEnded passed on to the grants. */
  settle(): Promise<void>;
}

async function setup(
  t: TestContext,
  { lifetime }: { readonly lifetime?: SessionLifetime } = {},
): Promise<Setup> {
  let at = Date.UTC(2026, 9, 22, 12, 0, 0);
  const now = () => at;
  const store = await newStore(t, { now });
  const dataDir = store.paths.root;
  assert.equal(await probeDataDirectory(dataDir), null);
  const sessions = createSessions({
    store: filesystemSessionStore(dataDir),
    audit: memoryAuditSink(now),
    fingerprint: 'MKhpw6F1Y5AkDvbeT_fgmw',
    now,
    ...(lifetime ? { lifetime } : {}),
  });
  const lines: GrantLogEntry[] = [];
  const options = (extra: Partial<PreviewGrantsOptions> = {}): PreviewGrantsOptions => ({
    store: filesystemGrantStore(dataDir),
    sessions: { resolveDigest: (digest) => sessions.resolveDigest(digest) },
    drafts: { exists: async (draftId) => (await store.drafts.get(draftId)) !== null },
    profile: 'owner',
    studioOrigin: ORIGIN,
    now,
    log: (line) => lines.push(line),
    ...extra,
  });
  const grants = createPreviewGrants(options());
  // #2's onSessionEnded, as the owner composition passes it on.
  const pending: Promise<unknown>[] = [];
  sessions.onSessionEnded((digest) => pending.push(grants.endSession(digest)));
  return {
    store,
    dataDir,
    sessions,
    grants,
    lines,
    now,
    advance: (ms) => {
      at += ms;
    },
    another: (extra) => createPreviewGrants(options(extra)),
    settle: async () => {
      await Promise.all(pending.splice(0));
    },
  };
}

/** A signed-in session, as a mint request carries it. */
async function signIn(sessions: Sessions) {
  const { record } = await sessions.issue({ uaFamily: 'firefox' });
  return {
    record,
    session: {
      digest: record.digest,
      absoluteExpiresAt: sessions.expiry(record).absoluteExpiresAt,
    },
  };
}

async function newDraft(store: Store): Promise<Draft> {
  const working = await store.drafts.getWorking();
  const created = await store.drafts.create(
    {
      documents: pairInput('engineering'),
      ...(working ? { expectedVersion: working.version } : {}),
    },
    'owner',
  );
  assert.equal(created.kind, 'saved');
  return (created as { draft: Draft }).draft;
}

async function saveDraft(store: Store, draft: Draft, marker: string): Promise<Draft> {
  const saved = await store.drafts.save(
    {
      draftId: draft.draftId,
      expectedVersion: draft.version,
      documents: contentVariant(draftInput(draft), marker),
    },
    'owner',
  );
  assert.equal(saved.kind, 'saved');
  return (saved as { draft: Draft }).draft;
}

const draftSubject = (draft: Draft): GrantSubject => ({
  kind: 'draft',
  draftId: draft.draftId,
  version: draft.version,
});

/** Mints a grant of `draft`'s current version, pinned to its documents. */
function mintDraft(
  grants: PreviewGrants,
  session: { digest: string; absoluteExpiresAt: number },
  draft: Draft,
  schemes?: Readonly<Record<string, unknown>>,
) {
  return grants.mint({
    session,
    subject: draftSubject(draft),
    documents: draftInput(draft),
    ...(schemes ? { schemes } : {}),
    environment: ENVIRONMENT,
  });
}

const statusOf = async (grants: PreviewGrants, token: string) => (await grants.check(token)).status;

test('a grant is 128 random bits in base64url, kept only as its SHA-256 digest, and no file or log line holds the token', async (t) => {
  const { store, dataDir, sessions, grants, lines } = await setup(t);
  const { session } = await signIn(sessions);
  const draft = await newDraft(store);
  const tokens = new Set<string>();
  for (let i = 0; i < 8; i++) {
    const { token, record } = await mintDraft(grants, session, draft);
    assert.match(token, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(Buffer.from(token, 'base64url').length, 16);
    assert.equal(record.digest, grantDigest(token));
    tokens.add(token);
  }
  assert.equal(tokens.size, 8, 'each mint is a new grant');

  const paths = previewPaths(dataDir);
  for (const token of tokens) {
    const file = path.join(paths.grants, `${grantDigest(token)}.json`);
    assert.ok(statSync(file).isFile());
    assert.equal(statSync(file).mode & 0o777, 0o600);
  }
  for (const dir of [paths.root, paths.grants, paths.drafts]) {
    assert.equal(statSync(dir).mode & 0o777, 0o700, dir);
  }
  // No file in the data directory holds a token, and the log names a grant
  // by the first 8 hex characters of its digest alone.
  for (const file of filesUnder(dataDir)) {
    const text = readFileSync(path.join(dataDir, file), 'latin1');
    for (const token of tokens) assert.ok(!text.includes(token), `${file} holds a token`);
  }
  const logged = JSON.stringify(lines);
  for (const token of tokens) {
    assert.ok(!logged.includes(token), 'a log line holds a token');
    assert.ok(!logged.includes(grantDigest(token)), 'a log line holds a whole digest');
  }
  const minted = lines.filter((line) => line.event === 'preview.grant.minted');
  assert.equal(minted.length, 8);
  for (const line of minted) assert.match(line.grantRef ?? '', /^[0-9a-f]{8}$/);
  assert.deepEqual(
    new Set(minted.map((line) => line.grantRef)),
    new Set([...tokens].map((token) => grantRef(grantDigest(token)))),
  );
});

test("a grant is bound to its session's digest, the profile, the Studio origin, a channel nonce, its subject, and its environment, and a draft grant renders its pinned version", async (t) => {
  const { store, sessions, grants } = await setup(t);
  const { record: signedIn, session } = await signIn(sessions);
  const draft = await newDraft(store);
  const first = await mintDraft(grants, session, draft);
  const { record } = first;
  assert.equal(record.sessionDigest, signedIn.digest);
  assert.equal(record.profile, 'owner');
  assert.equal(record.studioOrigin, ORIGIN);
  assert.match(record.nonce, /^[A-Za-z0-9_-]{22}$/);
  assert.deepEqual(record.subject, { kind: 'draft', draftId: draft.draftId, version: 1 });
  assert.deepEqual(record.environment, ENVIRONMENT);
  assert.deepEqual(record.documents, draftInput(draft));
  assert.equal(record.state, 'active');

  // Each frame gets its own grant and nonce.
  const second = await mintDraft(grants, session, draft);
  assert.notEqual(second.token, first.token);
  assert.notEqual(second.record.nonce, first.record.nonce);

  // The draft moves on and nothing mints its new version: the grant renders
  // the version it pinned.
  await saveDraft(store, draft, 'moved on');
  const checked = await grants.check(first.token);
  assert.equal(checked.status, 'active');
  assert.deepEqual(
    checked.status === 'active' ? checked.record.documents : null,
    draftInput(draft),
  );
});

test('every request re-checks a grant: an unknown or malformed token, another profile, and another Studio origin render nothing', async (t) => {
  const { store, sessions, grants, another } = await setup(t);
  const { session } = await signIn(sessions);
  const draft = await newDraft(store);
  const { token } = await mintDraft(grants, session, draft);
  assert.equal(await statusOf(grants, token), 'active');
  for (const value of ['', 'local', `${token}x`, token.slice(1), token.replace(/./, '+')]) {
    assert.equal(await statusOf(grants, value), 'unknown', value);
  }
  // A token of the right shape no grant was minted for.
  assert.equal(await statusOf(grants, 'AAAAAAAAAAAAAAAAAAAAAA'), 'unknown');

  // Read under another Studio origin, then under the right one: it ended.
  const elsewhere = await mintDraft(grants, session, draft);
  assert.equal(
    await statusOf(another({ studioOrigin: 'https://elsewhere.test' }), elsewhere.token),
    'session_ended',
  );
  assert.equal(await statusOf(grants, elsewhere.token), 'session_ended');
});

test('every grant stops on logout, revocation, expiry, profile change, and timeout', async (t) => {
  const { store, dataDir, sessions, grants, advance, now, another, settle } = await setup(t);
  const draft = await newDraft(store);
  const fresh = async () => {
    const { record, session } = await signIn(sessions);
    const { token } = await mintDraft(grants, session, draft);
    assert.equal(await statusOf(grants, token), 'active');
    return { record, token };
  };

  // Logout, and a revocation from Studio's session list, through
  // onSessionEnded, which marks the session's grants at once.
  for (const reason of ['logout', 'revoked'] as const) {
    const { record, token } = await fresh();
    assert.equal(await sessions.end(record.digest, reason), true);
    await settle();
    assert.equal(await statusOf(grants, token), 'session_ended', reason);
    assert.equal(await grants.status(token, record.digest), 'session_ended');
  }

  // owner.mjs revoke-sessions, from another process, which nothing here
  // hears: the next request's check finds the session gone.
  {
    const { token } = await fresh();
    await revokeAllSessionFiles(dataDir, now());
    assert.equal(await statusOf(grants, token), 'session_ended');
    // A session signed in at the revocation's millisecond is revoked too (#2).
    advance(1);
  }

  // Session expiry: the grant renewed every 10 minutes outlives no session,
  // since renewing it never slides the session's idle limit.
  {
    const { record, token } = await fresh();
    for (let minutes = 10; minutes < 60; minutes += 10) {
      advance(10 * MINUTE);
      const renewed = await grants.renew(token, record.digest);
      assert.equal(renewed.status, 'active', `${minutes} minutes in`);
    }
    advance(10 * MINUTE);
    assert.equal(await statusOf(grants, token), 'session_ended');
  }

  // A profile change: the deployment reads the grant under another profile.
  {
    const { token } = await fresh();
    assert.equal(await statusOf(another({ profile: 'read-only' }), token), 'session_ended');
    assert.equal(await statusOf(grants, token), 'session_ended');
  }

  // Timeout: 15 minutes idle.
  {
    const { token } = await fresh();
    advance(15 * MINUTE - 1);
    assert.equal(await statusOf(grants, token), 'active');
    advance(1);
    assert.equal(await statusOf(grants, token), 'expired');
  }

  // Timeout: 2 hours at most, however often renewed.
  {
    const { record, token } = await fresh();
    for (let minutes = 10; minutes < 120; minutes += 10) {
      advance(10 * MINUTE);
      // Its session too, as a Studio command slides it.
      await sessions.touch(record, { kind: 'command' });
      assert.equal((await grants.renew(token, record.digest)).status, 'active');
    }
    advance(10 * MINUTE);
    assert.equal(await statusOf(grants, token), 'expired');
    assert.equal((await grants.renew(token, record.digest)).status, 'expired');
  }
});

test("renewal slides only the grant's idle limit, never past its cap or its session's absolute expiry, and never slides the session", async (t) => {
  const { store, sessions, grants, advance, now } = await setup(t, {
    lifetime: { idleMinutes: 120, maxHours: 1 },
  });
  const start = now();
  const { record: signedIn, session } = await signIn(sessions);
  const draft = await newDraft(store);
  const { token, record } = await mintDraft(grants, session, draft);
  // The session ends an hour after sign-in, before the grant's 2 hours.
  assert.deepEqual(grants.expiry(record), {
    idleExpiresAt: start + 15 * MINUTE,
    absoluteExpiresAt: start + HOUR,
  });

  advance(10 * MINUTE);
  const renewed = await grants.renew(token, signedIn.digest);
  assert.ok(renewed.status === 'active');
  assert.deepEqual(renewed.expiry, {
    idleExpiresAt: start + 25 * MINUTE,
    absoluteExpiresAt: start + HOUR,
  });
  // The session's record is as sign-in wrote it.
  const resolved = await sessions.resolveDigest(signedIn.digest);
  assert.ok(resolved.status === 'valid');
  assert.equal(resolved.record.lastSeenAt, signedIn.lastSeenAt);

  // Renewed every 10 minutes, near the session's end the idle limit stops at it.
  for (let minutes = 20; minutes <= 50; minutes += 10) {
    advance(10 * MINUTE);
    const each = await grants.renew(token, signedIn.digest);
    assert.ok(each.status === 'active', `${minutes} minutes in`);
    assert.equal(
      each.expiry.idleExpiresAt,
      Math.min(start + (minutes + 15) * MINUTE, start + HOUR),
    );
  }
  // At the session's absolute expiry the grant's own cap passes with it.
  advance(10 * MINUTE);
  assert.equal((await grants.renew(token, signedIn.digest)).status, 'expired');
  assert.equal(GRANT_LIFETIME.idleSeconds, 15 * 60);
  assert.equal(GRANT_LIFETIME.maxSeconds, 2 * 60 * 60);
});

test('draft grants stop on publish, discard, and a newer minted version, and revision and fixture grants survive a publish', async (t) => {
  const { store, sessions, grants } = await setup(t);
  // #3's events, as the owner composition passes them on.
  const pending: Promise<unknown>[] = [];
  t.after(
    onStoreEvent((event) => {
      if (event.name === 'published') pending.push(grants.supersedeDraftGrants());
      if (event.name === 'draftDiscarded' && event.draftId) {
        pending.push(grants.supersedeDraft(event.draftId as Draft['draftId']));
      }
    }),
  );
  const settle = async () => {
    await Promise.all(pending.splice(0));
  };
  const { record: signedIn, session } = await signIn(sessions);
  const revisionId = await publishInput(store, pairInput('design'));
  await settle();
  const revision = await grants.mint({
    session,
    subject: { kind: 'revision', revisionId },
    environment: ENVIRONMENT,
  });
  const fixture = await grants.mint({
    session,
    subject: { kind: 'fixture', fixture: 'complete' },
    environment: ENVIRONMENT,
  });

  // A newer version minted supersedes the older one's grant.
  const draft = await newDraft(store);
  const v1 = await mintDraft(grants, session, draft);
  const saved = await saveDraft(store, draft, 'two');
  assert.equal(await statusOf(grants, v1.token), 'active', 'a save alone changes nothing');
  const v2 = await mintDraft(grants, session, saved);
  assert.equal(await statusOf(grants, v1.token), 'superseded');
  assert.equal(await statusOf(grants, v2.token), 'active');

  // Publishing the draft stops its grants, and no revision or fixture grant.
  const live = await store.publication.status();
  const published = await owned(store).publish(
    {
      draftId: saved.draftId,
      draftVersion: saved.version,
      expectedLiveRevisionId: live.liveRevisionId,
    },
    'owner',
  );
  assert.equal(published.kind, 'committed');
  await settle();
  assert.equal(await grants.status(v2.token, signedIn.digest), 'superseded');
  assert.equal(await statusOf(grants, revision.token), 'active');
  assert.equal(await statusOf(grants, fixture.token), 'active');

  // Discarding a draft stops its grants.
  const other = await newDraft(store);
  const discardable = await mintDraft(grants, session, other);
  const discarded = await store.drafts.discard({ draftId: other.draftId }, 'owner');
  assert.equal(discarded.kind, 'discarded');
  await settle();
  assert.equal(await grants.status(discardable.token, signedIn.digest), 'superseded');
  assert.equal(await statusOf(grants, revision.token), 'active');
});

test('events only end grants sooner: the per-request check alone stops a draft grant once the draft is gone or a newer version has a grant', async (t) => {
  const { store, dataDir, sessions, grants } = await setup(t);
  const { session } = await signIn(sessions);

  // Discarded with no listener: the next check finds the draft gone.
  const gone = await newDraft(store);
  const orphan = await mintDraft(grants, session, gone);
  assert.equal((await store.drafts.discard({ draftId: gone.draftId }, 'owner')).kind, 'discarded');
  assert.equal(await statusOf(grants, orphan.token), 'superseded');

  // A newer version's mark written, and its grant never: as a crash between
  // the two would leave it. The older grant stops.
  const draft = await newDraft(store);
  const older = await mintDraft(grants, session, draft);
  await filesystemGrantStore(dataDir).setNewestDraftVersion(draft.draftId, draft.version + 1);
  assert.equal(await statusOf(grants, older.token), 'superseded');

  // A damaged mark can't say which versions are behind it: every grant of the draft stops.
  const next = await saveDraft(store, draft, 'three');
  await filesystemGrantStore(dataDir).deleteDraftMarker(draft.draftId);
  const fresh = await mintDraft(grants, session, next);
  assert.equal(await statusOf(grants, fresh.token), 'active');
  writeFileSync(path.join(previewPaths(dataDir).drafts, `${draft.draftId}.json`), '{"v":1}\n');
  assert.equal(await statusOf(grants, fresh.token), 'superseded');
  // The next mint writes the mark again, and what the damage stopped stays stopped.
  const again = await mintDraft(grants, session, next);
  assert.equal(await statusOf(grants, again.token), 'active');
  assert.equal(await statusOf(grants, fresh.token), 'superseded');
});

test('a grant that ends keeps its hash, without its documents, until its 2-hour cap, and then reads as unknown', async (t) => {
  const { store, dataDir, sessions, grants, advance } = await setup(t);
  const { record: signedIn, session } = await signIn(sessions);
  const draft = await newDraft(store);
  const { token, record } = await mintDraft(grants, session, draft, { brand: { tokens: {} } });
  const file = path.join(previewPaths(dataDir).grants, `${record.digest}.json`);
  assert.ok(readFileSync(file, 'utf8').includes('"documents"'));
  assert.ok(readFileSync(file, 'utf8').includes('"schemes"'));

  assert.equal(await grants.revoke(token, signedIn.digest), true);
  assert.equal(await grants.revoke(token, signedIn.digest), false, 'once');
  const ended = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  assert.equal(ended.state, 'superseded');
  assert.equal(ended.documents, undefined, 'its copy of the draft is gone');
  assert.equal(ended.schemes, undefined, 'and its schemes with it');
  assert.equal(await grants.status(token, signedIn.digest), 'superseded');

  // An expired grant drops its documents at the next sweep.
  advance(MINUTE);
  const idle = await mintDraft(grants, session, draft);
  advance(16 * MINUTE);
  await grants.sweep();
  const idleFile = path.join(previewPaths(dataDir).grants, `${idle.record.digest}.json`);
  assert.ok(!readFileSync(idleFile, 'utf8').includes('"documents"'));
  assert.equal(await statusOf(grants, idle.token), 'expired');

  // Two hours after the first mint, its record goes.
  advance(2 * HOUR - 17 * MINUTE - 1);
  await grants.sweep();
  assert.ok(existsSync(file));
  advance(1);
  assert.equal(await grants.sweep(), 1);
  assert.ok(!existsSync(file));
  assert.equal(await grants.status(token, signedIn.digest), 'unknown');
  assert.equal(await statusOf(grants, token), 'unknown');
});

test("status, renewal, and revocation act only on the caller's own grant, and anyone else's reads as unknown", async (t) => {
  const { store, sessions, grants } = await setup(t);
  const mine = await signIn(sessions);
  const theirs = await signIn(sessions);
  const draft = await newDraft(store);
  const { token } = await mintDraft(grants, mine.session, draft);
  assert.equal(await grants.status(token, theirs.record.digest), 'unknown');
  assert.equal((await grants.renew(token, theirs.record.digest)).status, 'unknown');
  assert.equal(await grants.revoke(token, theirs.record.digest), false);
  assert.equal(await grants.status(token, mine.record.digest), 'active');
  for (const value of ['', 'local', token.toUpperCase()]) {
    assert.equal(await grants.status(value, mine.record.digest), 'unknown', value);
    assert.equal(await grants.revoke(value, mine.record.digest), false, value);
  }
});

/**
 * What `ref` isn't, for a grant whose ref it is: a ref of no grant, the ref
 * in upper case, the ref with a character more, and nothing. A ref of digits
 * alone has no letter to raise, so its upper case is the ref itself: its
 * last digit becomes an upper-case letter instead.
 */
function notRefs(ref: string): string[] {
  const upper = /[a-f]/.test(ref) ? ref.toUpperCase() : `${ref.slice(0, -1)}A`;
  return [ref === '00000000' ? 'ffffffff' : '00000000', upper, `${ref}0`, ''];
}

test("what a ref isn't is never the ref, a ref of digits alone included, nor anything a ref may be but another", () => {
  const REF = /^[0-9a-f]{8}$/;
  for (const ref of ['09041461', '00000000', 'abcdef01', '1234abcd']) {
    const values = notRefs(ref);
    assert.ok(!values.includes(ref), ref);
    // Every one but the ref of no grant is a shape no ref has.
    assert.deepEqual(
      values.filter((value) => REF.test(value)),
      [ref === '00000000' ? 'ffffffff' : '00000000'],
      ref,
    );
  }
  assert.equal(notRefs('09041461')[1], '0904146A');
});

test("a grant's ref revokes it only for its own session, once, and any other ref ends nothing, as an unknown token does (#7)", async (t) => {
  const { store, sessions, grants } = await setup(t);
  const mine = await signIn(sessions);
  const theirs = await signIn(sessions);
  const draft = await newDraft(store);
  const { token, record } = await mintDraft(grants, mine.session, draft);
  const ref = grantRef(record.digest);
  // Another session's ref of it ends nothing.
  assert.equal(await grants.revokeRef(ref, theirs.record.digest), false);
  assert.equal(await grants.status(token, mine.record.digest), 'active');
  // Nor does a ref of no grant, or anything that isn't a ref's shape.
  for (const value of [...notRefs(ref), token, record.digest]) {
    assert.equal(await grants.revokeRef(value, mine.record.digest), false, value);
  }
  assert.equal(await grants.status(token, mine.record.digest), 'active');
  // Its own session's ref ends it, as superseded, once.
  assert.equal(await grants.revokeRef(ref, mine.record.digest), true);
  assert.equal(await grants.status(token, mine.record.digest), 'superseded');
  assert.equal(await grants.revokeRef(ref, mine.record.digest), false, 'once');
});

test(`a session holds at most ${MAX_ACTIVE_GRANTS} active grants, and a mint past that supersedes its oldest`, async (t) => {
  const { sessions, grants, advance } = await setup(t);
  const { session } = await signIn(sessions);
  const other = await signIn(sessions);
  const tokens: string[] = [];
  for (let i = 0; i < MAX_ACTIVE_GRANTS; i++) {
    advance(1);
    const { token } = await grants.mint({
      session,
      subject: { kind: 'fixture', fixture: 'complete' },
      environment: ENVIRONMENT,
    });
    tokens.push(token);
  }
  const theirs = await grants.mint({
    session: other.session,
    subject: { kind: 'fixture', fixture: 'complete' },
    environment: ENVIRONMENT,
  });
  for (const token of tokens) assert.equal(await statusOf(grants, token), 'active');
  advance(1);
  await grants.mint({
    session,
    subject: { kind: 'fixture', fixture: 'complete' },
    environment: ENVIRONMENT,
  });
  assert.equal(await statusOf(grants, tokens[0]!), 'superseded');
  for (const token of tokens.slice(1)) assert.equal(await statusOf(grants, token), 'active');
  assert.equal(await statusOf(grants, theirs.token), 'active', "another session's grants stay");
});

test('a damaged grant file counts as no grant and is deleted, and a link in place of the store directory is refused', async (t) => {
  const { store, dataDir, sessions, grants } = await setup(t);
  const { session } = await signIn(sessions);
  const draft = await newDraft(store);
  const { token, record } = await mintDraft(grants, session, draft);
  const file = path.join(previewPaths(dataDir).grants, `${record.digest}.json`);
  writeFileSync(file, '{"v":1,"state":"active"}\n');
  assert.equal(await statusOf(grants, token), 'unknown');
  assert.ok(!existsSync(file));

  // ephemeral/preview/ swapped for a link to somewhere else: nothing is written there.
  const elsewhere = mkdtempSync(path.join(tmpdir(), 'grants-elsewhere-'));
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }));
  rmSync(previewPaths(dataDir).root, { recursive: true, force: true });
  symlinkSync(elsewhere, previewPaths(dataDir).root);
  await assert.rejects(mintDraft(grants, session, draft), /link/);
  assert.deepEqual(filesUnder(elsewhere), []);
  rmSync(previewPaths(dataDir).root);
  mkdirSync(previewPaths(dataDir).root, { mode: 0o700 });
});

test('a link planted in place of ephemeral/preview/grants/, to a directory holding a valid grant, never yields the grant: the check is unavailable', async (t) => {
  const { store, dataDir, sessions, grants } = await setup(t);
  const { session } = await signIn(sessions);
  const draft = await newDraft(store);
  const { token, record } = await mintDraft(grants, session, draft);
  assert.equal(await statusOf(grants, token), 'active');
  // The grants directory moved elsewhere, the valid record with it, and a link left in its place.
  const paths = previewPaths(dataDir);
  const elsewhere = path.join(mkdtempSync(path.join(tmpdir(), 'grants-planted-')), 'grants');
  t.after(() => rmSync(path.dirname(elsewhere), { recursive: true, force: true }));
  renameSync(paths.grants, elsewhere);
  symlinkSync(elsewhere, paths.grants);
  assert.equal(await statusOf(grants, token), 'unavailable');
  const fsStore = filesystemGrantStore(dataDir);
  await assert.rejects(fsStore.get(record.digest), /is a link/);
  await assert.rejects(fsStore.list(), /is a link/);
  await assert.rejects(fsStore.delete(record.digest), /is a link/);
  // The same for the draft markers.
  renameSync(paths.drafts, `${elsewhere}-drafts`);
  symlinkSync(`${elsewhere}-drafts`, paths.drafts);
  await assert.rejects(fsStore.newestDraftVersion(draft.draftId), /is a link/);
  await assert.rejects(fsStore.listDraftMarkers(), /is a link/);
  await assert.rejects(fsStore.deleteDraftMarker(draft.draftId), /is a link/);
  assert.ok(
    existsSync(path.join(elsewhere, `${record.digest}.json`)),
    'the planted grant was touched',
  );
});

test('a grant store directory an operator loosened is put back to 0700, and the next mint goes through', async (t) => {
  const { store, dataDir, sessions, grants } = await setup(t);
  const { session } = await signIn(sessions);
  const draft = await newDraft(store);
  await mintDraft(grants, session, draft);
  const paths = previewPaths(dataDir);
  chmodSync(paths.root, 0o755);
  chmodSync(paths.grants, 0o777);
  chmodSync(paths.drafts, 0o750);
  // Another draft, so the mint writes its draft marker too.
  const { token } = await mintDraft(grants, session, await newDraft(store));
  for (const dir of [paths.root, paths.grants, paths.drafts]) {
    assert.equal(statSync(dir).mode & 0o777, 0o700, dir);
  }
  assert.equal(await statusOf(grants, token), 'active');
});

test('an end is never undone by a renewal that read the grant before it', async (t) => {
  const { store, sessions, grants } = await setup(t);
  const { record: signedIn, session } = await signIn(sessions);
  const draft = await newDraft(store);
  for (let round = 0; round < 20; round++) {
    const { token } = await mintDraft(grants, session, draft);
    const ends = [
      () => grants.revoke(token, signedIn.digest),
      () => grants.supersedeDraft(draft.draftId),
    ];
    await Promise.all([
      grants.renew(token, signedIn.digest),
      ends[round % 2]!(),
      grants.renew(token, signedIn.digest),
    ]);
    assert.equal(await grants.status(token, signedIn.digest), 'superseded', `round ${round}`);
  }
});

test('a draft grant, and only a draft grant, pins documents, and no grant outlives its session or goes behind a newer version', async (t) => {
  const { store, sessions, grants, now } = await setup(t);
  const { session } = await signIn(sessions);
  const draft = await newDraft(store);
  await assert.rejects(
    grants.mint({ session, subject: draftSubject(draft), environment: ENVIRONMENT }),
    TypeError,
  );
  await assert.rejects(
    grants.mint({
      session,
      subject: { kind: 'fixture', fixture: 'complete' },
      documents: draftInput(draft),
      environment: ENVIRONMENT,
    }),
    TypeError,
  );
  await assert.rejects(
    grants.mint({
      session,
      subject: { kind: 'fixture', fixture: 'complete' },
      schemes: { brand: {} },
      environment: ENVIRONMENT,
    }),
    /Only a draft grant pins generated schemes/,
  );
  await assert.rejects(
    grants.mint({
      session: { ...session, absoluteExpiresAt: now() },
      subject: { kind: 'fixture', fixture: 'complete' },
      environment: ENVIRONMENT,
    }),
    TypeError,
  );
  const saved = await saveDraft(store, draft, 'two');
  await mintDraft(grants, session, saved);
  await assert.rejects(mintDraft(grants, session, draft), TypeError);
});
