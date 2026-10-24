import test from 'node:test';
import assert from 'node:assert/strict';
import type { StudioFetchOptions } from '~/lib/studio-fetch';
import { isOwnerBackend, type StudioBackend } from './backend';
import { ownerBackend } from './owner-backend';
import { draft, DRAFT_ID } from './test-support';

// The owner adapter (#8, Slice 1): #3's working draft through #1's registry
// entries, with expectedVersion on every save and the draft's text only in
// a command's JSON body.

interface Sent {
  readonly name: string;
  readonly options: StudioFetchOptions;
}

function backend(answer: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = [];
  const fetch = async (name: string, options: StudioFetchOptions = {}) => {
    sent.push({ name, options });
    return answer({ name, options });
  };
  return { sent, studio: ownerBackend(fetch, 'csrf-token') };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const DOCUMENTS = {
  portfolio: { format: 'yaml', sourceText: 'schemaVersion: 3\n# secret draft words\n' },
  site: { format: 'yaml', sourceText: 'schemaVersion: 2\n' },
} as const;

test('a save sends draft.save with the version it read, the CSRF token, and the text in the body alone', async () => {
  const { sent, studio } = backend(() => json(200, { data: { draft: draft(3) } }));
  const result = await studio.saveDraft({
    draftId: DRAFT_ID,
    expectedVersion: 2,
    documents: DOCUMENTS,
  });
  assert.deepEqual(result, { kind: 'saved', draft: draft(3) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.name, 'draft.save');
  assert.equal(sent[0]!.options.csrfToken, 'csrf-token');
  assert.deepEqual(sent[0]!.options.body, {
    draftId: DRAFT_ID,
    expectedVersion: 2,
    documents: DOCUMENTS,
  });
  // A command sends no query: nothing of the draft goes in a URL.
  assert.equal(sent[0]!.options.query, undefined);
});

test("a stale save's draft_conflict comes back as the newer draft, which nothing overwrote", async () => {
  const theirs = draft(4, 'schemaVersion: 3\n# theirs\n');
  const { studio } = backend(() =>
    json(409, {
      error: {
        code: 'draft_conflict',
        message: 'The draft changed.',
        requestId: 'r',
        details: { draftId: theirs.draftId, version: 4, documents: theirs.documents },
      },
    }),
  );
  const result = await studio.saveDraft({
    draftId: DRAFT_ID,
    expectedVersion: 2,
    documents: DOCUMENTS,
  });
  assert.deepEqual(result, {
    kind: 'conflict',
    theirs: { draftId: theirs.draftId, version: 4, documents: theirs.documents },
  });
});

test('a 401 is a signed-out result, a network failure and an error code are failures in words', async () => {
  assert.deepEqual(
    await backend(() => json(401, { error: { code: 'session_required' } })).studio.workingDraft(),
    { kind: 'signed-out' },
  );
  const down = await backend(() => {
    throw new TypeError('Failed to fetch');
  }).studio.saveDraft({ draftId: DRAFT_ID, expectedVersion: 1, documents: DOCUMENTS });
  assert.equal(down.kind, 'failed');
  assert.match((down as { message: string }).message, /kept in this browser/);
  const full = await backend(() =>
    json(507, { error: { code: 'storage_full', message: '/var/lib/portfolio is full' } }),
  ).studio.saveDraft({ draftId: DRAFT_ID, expectedVersion: 1, documents: DOCUMENTS });
  assert.equal(full.kind, 'failed');
  // A known code says its own words, never the server's message with a path in it.
  assert.doesNotMatch((full as { message: string }).message, /var\/lib/);
});

test('reads are queries, and a new draft starts from live with draft.create', async () => {
  const { sent, studio } = backend(({ name }) =>
    name === 'live.get'
      ? json(200, {
          data: {
            state: 'empty',
            liveRevisionId: null,
            servingRevisionId: null,
            seq: null,
            unitHash: null,
          },
        })
      : name === 'draft.getWorking'
        ? json(200, { data: { draft: null } })
        : json(200, { data: { draft: draft(1) } }),
  );
  assert.deepEqual(await studio.workingDraft(), { kind: 'read', value: null });
  assert.equal((await studio.live()).kind, 'read');
  assert.equal((await studio.startDraft()).kind, 'saved');
  assert.deepEqual(
    sent.map(({ name, options }) => [name, options.body === undefined ? 'query' : 'command']),
    [
      ['draft.getWorking', 'query'],
      ['live.get', 'query'],
      ['draft.create', 'command'],
    ],
  );
});

test("the session check is auth.session, and sign-out is auth.logout with the token and the owner's choice for the journal", async () => {
  const { sent, studio } = backend(({ name }) =>
    name === 'auth.session' ? json(200, { data: {} }) : json(200, { data: { signedOut: true } }),
  );
  assert.equal(await studio.session(), true);
  assert.equal(await studio.signOut('discard'), true);
  assert.equal(await studio.signOut('keep'), true);
  assert.deepEqual(
    sent.map(({ name, options }) => [name, options.csrfToken ?? null, options.signOut ?? null]),
    [
      ['auth.session', null, null],
      ['auth.logout', 'csrf-token', 'discard'],
      ['auth.logout', 'csrf-token', 'keep'],
    ],
  );
  assert.equal(await backend(() => json(401, {})).studio.session(), false);
});

const REVISION = `rev_${'3'.repeat(32)}`;
const LIVE_NOW = `rev_${'4'.repeat(32)}`;
const failed = (status: number, code: string, details?: unknown) =>
  json(status, { error: { code, message: 'm', requestId: 'r', ...(details ? { details } : {}) } });

test('publish and rollback go as commands with the version, the expected live revision, and the key, and nothing else', async () => {
  const { sent, studio } = backend(() => json(200, { data: { revisionId: REVISION, seq: 5 } }));
  assert.deepEqual(
    await studio.publish({
      draftId: DRAFT_ID,
      draftVersion: 3,
      expectedLiveRevisionId: LIVE_NOW,
      idempotencyKey: 'studio-key',
    }),
    { kind: 'committed', revisionId: REVISION, seq: 5 },
  );
  assert.deepEqual(
    await studio.rollback({
      targetRevisionId: REVISION,
      expectedLiveRevisionId: LIVE_NOW,
      idempotencyKey: 'studio-key-2',
    }),
    { kind: 'committed', revisionId: REVISION, seq: 5 },
  );
  assert.deepEqual(
    sent.map(({ name, options }) => [name, options.csrfToken, options.body, options.query]),
    [
      [
        'publish',
        'csrf-token',
        {
          draftId: DRAFT_ID,
          draftVersion: 3,
          expectedLiveRevisionId: LIVE_NOW,
          idempotencyKey: 'studio-key',
        },
        undefined,
      ],
      [
        'rollback',
        'csrf-token',
        {
          targetRevisionId: REVISION,
          expectedLiveRevisionId: LIVE_NOW,
          idempotencyKey: 'studio-key-2',
        },
        undefined,
      ],
    ],
  );
});

test("a move's refusals come back by kind: live moved, a newer draft, #3's codes, and a lost connection", async () => {
  const input = {
    targetRevisionId: REVISION,
    expectedLiveRevisionId: LIVE_NOW,
    idempotencyKey: 'studio-key',
  };
  const answer = (response: Response) => backend(() => response).studio.rollback(input);
  assert.deepEqual(
    await answer(
      failed(409, 'live_conflict', { liveRevisionId: REVISION, baseHash: null, liveHash: null }),
    ),
    { kind: 'live-moved', liveRevisionId: REVISION },
  );
  assert.deepEqual(
    await answer(failed(409, 'draft_conflict', { draftId: DRAFT_ID, version: 7, documents: {} })),
    { kind: 'draft-moved', version: 7 },
  );
  const incompatible = await answer(
    failed(422, 'revision_incompatible', { reason: 'removed', diagnostics: [] }),
  );
  assert.equal(incompatible.kind, 'refused');
  assert.equal(incompatible.kind === 'refused' && incompatible.code, 'revision_incompatible');
  const lost = await backend(() => {
    throw new TypeError('Failed to fetch');
  }).studio.rollback(input);
  assert.equal(lost.kind === 'failed' && lost.code, 'network');
  assert.deepEqual(await answer(json(401, {})), { kind: 'signed-out' });
});

test('history reads its pages by query, and a revision that is gone reads as none', async () => {
  const { sent, studio } = backend(({ name }) =>
    name === 'revision.get'
      ? failed(404, 'not_found')
      : json(200, { data: { revisions: [], events: [], nextOffset: null } }),
  );
  assert.deepEqual(await studio.revisions(50), {
    kind: 'read',
    value: { items: [], nextOffset: null },
  });
  assert.deepEqual(await studio.history(0), {
    kind: 'read',
    value: { items: [], nextOffset: null },
  });
  assert.deepEqual(await studio.revision(REVISION), { kind: 'read', value: null });
  assert.deepEqual(
    sent.map(({ name, options }) => [name, options.query, options.body]),
    [
      ['revision.list', { offset: '50' }, undefined],
      ['history.list', { offset: '0' }, undefined],
      ['revision.get', { revisionId: REVISION }, undefined],
    ],
  );
});

test("a plain StudioBackend, as #9's demo adapter is, has no publish, rollback, or history to reach; only the owner adapter is an OwnerBackend", () => {
  const unused = async () => {
    throw new Error('not called');
  };
  const plain: StudioBackend = {
    session: unused,
    live: unused,
    workingDraft: unused,
    startDraft: unused,
    saveDraft: unused,
    applyEdits: unused,
    signOut: unused,
  };
  assert.equal(isOwnerBackend(plain), false);
  // The type has none of them: each line below fails typecheck without its expectation.
  // @ts-expect-error a plain StudioBackend can't reach publish
  assert.equal(plain.publish, undefined);
  // @ts-expect-error nor rollback
  assert.equal(plain.rollback, undefined);
  // @ts-expect-error nor the publication history
  assert.equal(plain.revisions, undefined);
  const owner = backend(() => json(200, {})).studio;
  assert.equal(isOwnerBackend(owner), true);
  assert.equal(typeof owner.publish, 'function');
});
