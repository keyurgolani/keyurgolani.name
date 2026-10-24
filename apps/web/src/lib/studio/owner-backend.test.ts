import test from 'node:test';
import assert from 'node:assert/strict';
import type { StudioFetchOptions } from '~/lib/studio-fetch';
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

test('the session check is auth.session, and sign-out is auth.logout with the token', async () => {
  const { sent, studio } = backend(({ name }) =>
    name === 'auth.session' ? json(200, { data: {} }) : json(200, { data: { signedOut: true } }),
  );
  assert.equal(await studio.session(), true);
  assert.equal(await studio.signOut(), true);
  assert.deepEqual(
    sent.map(({ name, options }) => [name, options.csrfToken ?? null]),
    [
      ['auth.session', null],
      ['auth.logout', 'csrf-token'],
    ],
  );
  assert.equal(await backend(() => json(401, {})).studio.session(), false);
});
