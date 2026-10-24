import test from 'node:test';
import assert from 'node:assert/strict';
import type { MoveResult, ReadResult } from './backend';
import type { LiveState } from './documents';
import { draftSession, INITIAL_SESSION, type SessionAction } from './draft-session';
import {
  describeMove,
  draftFindings,
  MOVE_ATTEMPTS,
  moveWithRecovery,
  newIdempotencyKey,
  publishBlocker,
  publishRequest,
} from './publication';
import { BASE_REVISION, BLOCKING, draft, LIVE_REVISION, WARNING } from './test-support';

// Publishing from Studio (#8, Slice 6): only the exact saved version #3
// checked, over the live revision Studio read, and a move whose answer never
// comes is asked again under the same key, so it never happens twice, and
// what's live comes from live.get.

const LIVE: LiveState = {
  state: 'live',
  liveRevisionId: BASE_REVISION,
  servingRevisionId: BASE_REVISION,
  seq: 4,
};
const run = (actions: readonly SessionAction[]) => actions.reduce(draftSession, INITIAL_SESSION);
const loaded = (
  over: Partial<Omit<Extract<SessionAction, { type: 'loaded' }>, 'type'>> = {},
): SessionAction => ({
  type: 'loaded',
  draft: draft(3),
  live: LIVE,
  journal: null,
  ...over,
});

test('publish is open only for the saved version #3 checked, over the live revision the draft started from', () => {
  const ready = run([loaded()]);
  assert.equal(publishBlocker(ready), null);
  assert.deepEqual(publishRequest(ready), {
    draftId: ready.draft!.draftId,
    draftVersion: 3,
    expectedLiveRevisionId: BASE_REVISION,
  });
  // A warning doesn't block it.
  assert.equal(
    publishBlocker(run([loaded({ draft: draft(3, 'p\n', { diagnostics: [WARNING] }) })])),
    null,
  );
  const cases: [string, SessionAction[]][] = [
    ['there is no saved draft', [loaded({ draft: null })]],
    ['it has unsaved changes', [loaded(), { type: 'edited', name: 'site', sourceText: 'x\n' }]],
    ['validation failed', [loaded({ draft: draft(3, 'p\n', { diagnostics: [BLOCKING] }) })]],
    ['the live revision is unknown', [loaded({ live: null })]],
    [
      'the live revision changed since the draft started',
      [loaded({ live: { ...LIVE, liveRevisionId: LIVE_REVISION } })],
    ],
    [
      'a newer saved draft conflicts with your changes',
      [
        loaded(),
        { type: 'edited', name: 'site', sourceText: 'x\n' },
        { type: 'conflicted', theirs: draft(4) },
      ],
    ],
  ];
  for (const [why, actions] of cases) {
    assert.equal(publishBlocker(run(actions)), why);
    assert.equal(publishRequest(run(actions)), null, why);
  }
});

test('each confirmed move gets a key of its own that #3 accepts', () => {
  const key = newIdempotencyKey();
  assert.match(key, /^[A-Za-z0-9._:-]{1,128}$/);
  assert.notEqual(newIdempotencyKey(), key);
});

/** A server that commits the first request, and answers a key it has seen with what that did. */
function server(lose: number) {
  const keys: string[] = [];
  let live: LiveState = LIVE;
  let committed: MoveResult | null = null;
  let lost = 0;
  return {
    keys,
    moves: () => (committed ? 1 : 0),
    send: async (key: string): Promise<MoveResult> => {
      keys.push(key);
      committed ??= { kind: 'committed', revisionId: LIVE_REVISION, seq: 5 };
      live = { ...LIVE, liveRevisionId: LIVE_REVISION, servingRevisionId: LIVE_REVISION, seq: 5 };
      // The commit happened; the answer is lost on the way back.
      if (lost < lose) {
        lost += 1;
        return { kind: 'failed', code: 'network', message: "Couldn't reach the server." };
      }
      return committed;
    },
    readLive: async (): Promise<ReadResult<LiveState>> => ({ kind: 'read', value: live }),
  };
}

test('a lost answer after the server committed: Studio reads live, asks again with the same key, and reports the true live revision', async () => {
  const store = server(1);
  const seen: (LiveState | null)[] = [];
  const report = await moveWithRecovery({
    send: store.send,
    readLive: store.readLive,
    key: 'studio-one',
    onRetry: (live) => seen.push(live),
  });
  assert.deepEqual(store.keys, ['studio-one', 'studio-one'], 'the retry carries the same key');
  assert.equal(store.moves(), 1, 'nothing published twice');
  assert.equal(report.attempts, 2);
  assert.equal(seen[0]?.liveRevisionId, LIVE_REVISION, 'it read live state before asking again');
  assert.equal(report.outcome.kind, 'committed');
  assert.equal(report.live?.liveRevisionId, LIVE_REVISION);
  assert.equal(
    describeMove('publish', report),
    `Published: the store made revision ${LIVE_REVISION.slice(0, 16)} live. Revision ${LIVE_REVISION.slice(0, 16)}, number 5, is live now.`,
  );
});

test('a move that times out is asked again with the same key, and gives up after its attempts, still saying what live.get says', async () => {
  const keys: string[] = [];
  const report = await moveWithRecovery({
    send: (key) => {
      keys.push(key);
      return new Promise<MoveResult>(() => {});
    },
    readLive: async () => ({ kind: 'read', value: LIVE }),
    key: 'studio-two',
    after: async () => {},
  });
  assert.deepEqual(keys, Array(MOVE_ATTEMPTS).fill('studio-two'));
  assert.equal(report.outcome.kind, 'failed');
  assert.match(describeMove('publish', report), /^Not published as far as Studio can tell: /);
  assert.match(
    describeMove('publish', report),
    new RegExp(`Revision ${BASE_REVISION.slice(0, 16)}, number 4, is live now\\.$`),
  );
  // Live where it was before the move: still "not published as far as Studio can tell".
  assert.match(
    describeMove('publish', report, null, LIVE.liveRevisionId),
    /^Not published as far as Studio can tell: /,
  );
  // Live moved since this page read it: it says what's live, never "not published" (#123 review).
  for (const kind of ['publish', 'rollback'] as const) {
    const moved = describeMove(kind, report, null, 'rev_somethingelse');
    assert.doesNotMatch(moved, /^Not (published|rolled back)/, kind);
    assert.match(moved, new RegExp(`this ${kind} may have gone through`), kind);
    assert.match(
      moved,
      new RegExp(`Revision ${BASE_REVISION.slice(0, 16)}, number 4, is live now\\.$`),
      kind,
    );
  }
});

test('a refusal, a moved live revision, or a newer draft version is never asked again', async () => {
  for (const outcome of [
    {
      kind: 'refused',
      code: 'revision_incompatible',
      message: "That revision can't be made live by this build.",
    },
    { kind: 'live-moved', liveRevisionId: LIVE_REVISION },
    { kind: 'draft-moved', version: 9 },
  ] as const) {
    let sent = 0;
    const report = await moveWithRecovery({
      send: async () => {
        sent += 1;
        return outcome;
      },
      readLive: async () => ({ kind: 'read', value: LIVE }),
      key: 'studio-three',
    });
    assert.equal(sent, 1, outcome.kind);
    assert.match(
      describeMove('rollback', report),
      /^Not rolled back: .*nothing moved|Nothing moved/,
    );
  }
});

test("readiness and a refusal read 8-2's complete summary: a finding that blocks preview blocks publish, and the refusal names its item", async () => {
  const previewOnly = { ...BLOCKING, severity: 'blocks-preview' as const };
  const draftWith = draft(3, 'schemaVersion: 3\nidentity:\n  name: ""\n', {
    diagnostics: [previewOnly],
  });
  assert.equal(publishBlocker(run([loaded({ draft: draftWith })])), 'validation failed');
  assert.deepEqual(
    draftFindings(draftWith).map((view) => view.item),
    ['Identity'],
  );
  const report = await moveWithRecovery({
    send: async () => ({
      kind: 'refused',
      code: 'validation_failed',
      message: 'The draft has findings that block publishing.',
      findings: [BLOCKING],
    }),
    readLive: async () => ({ kind: 'read', value: LIVE }),
    key: 'studio-four',
  });
  assert.match(
    describeMove('publish', report, draftWith.documents),
    /The first of 1: Identity, name, in portfolio\.yml: \/identity\/name is empty\. Give identity\.name a value\./,
  );
});
