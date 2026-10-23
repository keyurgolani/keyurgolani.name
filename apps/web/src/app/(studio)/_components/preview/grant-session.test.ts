import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGrantSession,
  renewalDelay,
  type GrantState,
  type MintRequest,
} from './grant-session';

// One preview frame's grant, as Studio keeps it (#7, Slice 4, item 8),
// against stand-ins for studioFetch and the timers.

const REQUEST: MintRequest = {
  subject: { draft: `drf_${'a'.repeat(32)}`, version: 3 },
  environment: { displayMode: 'system', contrast: 'system', motion: 'system', enhancement: 'on' },
};
const AT = Date.parse('2026-10-22T10:00:00Z');
const IDLE = new Date(AT + 900_000).toISOString();

const grantOf = (n: number) => String(n).padStart(22, 'G');
const nonceOf = (n: number) => String(n).padStart(22, 'N');

type Reply = { status: number; data?: unknown } | Error;

/** A session over a stand-in studioFetch that answers each operation from `replies`, in turn. */
function setup(replies: Record<string, Reply[]>) {
  const sent: Array<{ name: string; body: unknown; csrfToken?: string; keepalive?: boolean }> = [];
  const states: GrantState[] = [];
  const timers: Array<{ run: () => void; ms: number; cleared: boolean }> = [];
  let minted = 0;
  const session = createGrantSession({
    csrfToken: 'csrf',
    call: async (name, { body, csrfToken, keepalive }) => {
      sent.push({
        name,
        body,
        ...(csrfToken ? { csrfToken } : {}),
        ...(keepalive ? { keepalive } : {}),
      });
      const queue = replies[name] ?? [];
      let reply = queue.shift();
      if (reply === undefined && name === 'preview.grant.mint') {
        minted += 1;
        reply = {
          status: 200,
          data: {
            status: 'active',
            grant: grantOf(minted),
            nonce: nonceOf(minted),
            idleExpiresAt: IDLE,
            absoluteExpiresAt: IDLE,
          },
        };
      }
      reply ??= { status: 200, data: { revoked: true } };
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(reply.data === undefined ? {} : { data: reply.data }), {
        status: reply.status,
      });
    },
    onState: (state) => states.push(state),
    now: () => AT,
    setTimer: (run, ms) => {
      const timer = { run, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      if (timer) (timer as { cleared: boolean }).cleared = true;
    },
  });
  /** Runs the heartbeat timer that's due, as the clock would. */
  const beat = async () => {
    const due = timers.filter(({ cleared }) => !cleared).at(-1);
    assert.ok(due, 'no heartbeat is scheduled');
    due.cleared = true;
    due.run();
    await new Promise((resolve) => setTimeout(resolve, 5));
  };
  const names = () => sent.map(({ name }) => name);
  return { session, sent, states, timers, beat, names };
}

test('a frame mints its grant with the CSRF token, and renews it on a heartbeat a third of its idle time away (#7, Slice 4)', async () => {
  const { session, sent, states, timers, beat, names } = setup({
    'preview.grant.renew': [
      { status: 200, data: { status: 'active', idleExpiresAt: IDLE, absoluteExpiresAt: IDLE } },
    ],
  });
  await session.mint(REQUEST);
  assert.deepEqual(sent[0], { name: 'preview.grant.mint', body: REQUEST, csrfToken: 'csrf' });
  assert.deepEqual(states, [
    { kind: 'minting' },
    { kind: 'active', grant: grantOf(1), nonce: nonceOf(1) },
  ]);
  assert.equal(timers.at(-1)?.ms, 300_000);
  sent.length = 0;
  await beat();
  assert.deepEqual(sent, [
    { name: 'preview.grant.renew', body: { grant: grantOf(1) }, csrfToken: 'csrf' },
  ]);
  // Renewed, so the next beat is scheduled again.
  assert.ok(timers.at(-1) && !timers.at(-1)!.cleared);
  assert.deepEqual(names(), ['preview.grant.renew']);
  assert.equal(renewalDelay(new Date(AT + 30_000).toISOString(), AT), 10_000);
  assert.equal(renewalDelay(new Date(AT + 3_000).toISOString(), AT), 5_000);
});

test('a failed renewal asks for the status, and superseded, expired, or unknown mint again, revoking the old grant (#7, Slice 4)', async () => {
  for (const status of ['superseded', 'expired', 'unknown']) {
    const { session, states, beat, names } = setup({
      'preview.grant.renew': [{ status: 500 }],
      'preview.grant.status': [{ status: 200, data: { status } }],
    });
    await session.mint(REQUEST);
    await beat();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(
      names(),
      [
        'preview.grant.mint',
        'preview.grant.renew',
        'preview.grant.status',
        'preview.grant.mint',
        'preview.grant.revoke',
      ],
      status,
    );
    assert.deepEqual(states.at(-1), { kind: 'active', grant: grantOf(2), nonce: nonceOf(2) });
  }
  // A renewal that answers a status acts on it straight away, and a network failure asks too.
  const answered = setup({ 'preview.grant.renew': [{ status: 200, data: { status: 'expired' } }] });
  await answered.session.mint(REQUEST);
  await answered.beat();
  assert.deepEqual(answered.names().slice(0, 3), [
    'preview.grant.mint',
    'preview.grant.renew',
    'preview.grant.mint',
  ]);
  const offline = setup({
    'preview.grant.renew': [new Error('offline')],
    'preview.grant.status': [{ status: 200, data: { status: 'active' } }],
  });
  await offline.session.mint(REQUEST);
  await offline.beat();
  assert.deepEqual(offline.names(), [
    'preview.grant.mint',
    'preview.grant.renew',
    'preview.grant.status',
  ]);
});

test('a load with no valid hello asks for the status, and an active grant is left as it is (#7, Slice 4)', async () => {
  const { session, names, states } = setup({
    'preview.grant.status': [
      { status: 200, data: { status: 'active' } },
      { status: 200, data: { status: 'unknown' } },
    ],
  });
  await session.mint(REQUEST);
  await session.check();
  assert.deepEqual(names(), ['preview.grant.mint', 'preview.grant.status']);
  await session.check();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(names().slice(2), [
    'preview.grant.status',
    'preview.grant.mint',
    'preview.grant.revoke',
  ]);
  assert.equal(states.at(-1)?.kind, 'active');
});

test('preview_blocked never mints again: the frame keeps its grant until the next save asks (#7, Slice 4)', async () => {
  const { session, names, states, timers, sent } = setup({
    'preview.grant.mint': [
      {
        status: 200,
        data: {
          status: 'active',
          grant: grantOf(7),
          nonce: nonceOf(7),
          idleExpiresAt: IDLE,
          absoluteExpiresAt: IDLE,
        },
      },
      { status: 200, data: { status: 'preview_blocked', diagnostics: 2 } },
    ],
  });
  await session.mint(REQUEST);
  const saved = { ...REQUEST, subject: { draft: `drf_${'a'.repeat(32)}`, version: 4 } };
  await session.mint(saved);
  assert.deepEqual(states.at(-1), {
    kind: 'blocked',
    diagnostics: 2,
    kept: { grant: grantOf(7), nonce: nonceOf(7) },
  });
  // Nothing revoked the kept grant, and nothing mints until the next save.
  assert.deepEqual(names(), ['preview.grant.mint', 'preview.grant.mint']);
  // The one timer left is the kept grant's heartbeat. Run as the clock
  // would, it renews that grant and mints nothing, and it leaves none.
  const pending = timers.filter(({ cleared }) => !cleared);
  assert.equal(pending.length, 1);
  for (const each of pending) {
    each.cleared = true;
    each.run();
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(names(), ['preview.grant.mint', 'preview.grant.mint', 'preview.grant.renew']);
  assert.deepEqual(sent.at(-1)?.body, { grant: grantOf(7) }, 'the renewal is of the kept grant');
  await session.mint({ ...saved, subject: { draft: `drf_${'a'.repeat(32)}`, version: 5 } });
  assert.equal(states.at(-1)?.kind, 'active');
  assert.deepEqual(names().slice(3), ['preview.grant.mint', 'preview.grant.revoke']);
});

/** A studioFetch stand-in whose answers wait until the test lets each go. */
function heldCalls() {
  const calls: Array<{ name: string; body: unknown; answer: (reply: unknown) => void }> = [];
  const call = (name: string, { body }: { body?: unknown }) =>
    new Promise<Response>((resolve) => {
      calls.push({
        name,
        body,
        answer: (data) => resolve(new Response(JSON.stringify({ data }), { status: 200 })),
      });
    });
  const active = (n: number) => ({
    status: 'active',
    grant: grantOf(n),
    nonce: nonceOf(n),
    idleExpiresAt: IDLE,
    absoluteExpiresAt: IDLE,
  });
  return { calls, call, active };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 5));

test('a mint answered after the frame has gone has its grant revoked, never left to idle out (#7, Slice 4)', async () => {
  const { calls, call, active } = heldCalls();
  const states: GrantState[] = [];
  const session = createGrantSession({ call, csrfToken: 'csrf', onState: (s) => states.push(s) });
  const minting = session.mint(REQUEST);
  // The frame unmounts while its mint is out.
  session.stop();
  calls[0]!.answer(active(1));
  await minting;
  await settled();
  assert.deepEqual(
    calls.map(({ name, body }) => [name, name === 'preview.grant.revoke' ? body : null]),
    [
      ['preview.grant.mint', null],
      ['preview.grant.revoke', { grant: grantOf(1) }],
    ],
  );
  // The surface hears nothing after it stopped.
  assert.deepEqual(states, [{ kind: 'minting' }]);
});

test('of two mints that overlap, the older answer has its grant revoked, whichever comes back first (#7, Slice 4)', async () => {
  for (const order of ['older last', 'older first'] as const) {
    const { calls, call, active } = heldCalls();
    const states: GrantState[] = [];
    const session = createGrantSession({ call, csrfToken: 'csrf', onState: (s) => states.push(s) });
    const older = session.mint(REQUEST);
    const newer = session.mint({
      ...REQUEST,
      environment: { ...REQUEST.environment, enhancement: 'off' },
    });
    const [first, second] = order === 'older last' ? [1, 0] : [0, 1];
    calls[first]!.answer(active(first + 1));
    await settled();
    calls[second]!.answer(active(second + 1));
    await Promise.all([older, newer]);
    await settled();
    // The newer grant is the frame's, and the older one is revoked.
    assert.deepEqual(
      states.filter(({ kind }) => kind === 'active'),
      [{ kind: 'active', grant: grantOf(2), nonce: nonceOf(2) }],
      order,
    );
    const revoked = calls
      .filter(({ name }) => name === 'preview.grant.revoke')
      .map(({ body }) => body);
    assert.deepEqual(revoked, [{ grant: grantOf(1) }], order);
    session.stop();
  }
});

test('a mint answered after the session ended brings nothing back: the surface hears nothing more, and the grant ended with the session (#7, Slice 4)', async () => {
  const { calls, call, active } = heldCalls();
  const states: GrantState[] = [];
  const session = createGrantSession({ call, csrfToken: 'csrf', onState: (s) => states.push(s) });
  const minting = session.mint(REQUEST);
  // Another tab signs out while the mint is out.
  session.end();
  calls[0]!.answer(active(1));
  await minting;
  await settled();
  assert.deepEqual(states, [{ kind: 'minting' }, { kind: 'ended', announce: false }]);
  // The server ended every grant of the session: no revoke, and no heartbeat.
  assert.deepEqual(
    calls.map(({ name }) => name),
    ['preview.grant.mint'],
  );
  await session.mint(REQUEST);
  await session.check();
  assert.equal(states.length, 2);
  assert.equal(calls.length, 1);
});

test('the page going revokes the grant with a request that outlives it, and holds none after (#7, Slice 4)', async () => {
  const { session, sent, timers, names } = setup({});
  await session.mint(REQUEST);
  session.leave();
  await settled();
  assert.deepEqual(sent.at(-1), {
    name: 'preview.grant.revoke',
    body: { grant: grantOf(1) },
    csrfToken: 'csrf',
    keepalive: true,
  });
  assert.ok(timers.every(({ cleared }) => cleared));
  // Nothing is held, so the frame going after revokes nothing more.
  session.stop();
  await settled();
  assert.deepEqual(names(), ['preview.grant.mint', 'preview.grant.revoke']);
  // Only the page going asks for keepalive: a frame's own revoke doesn't.
  const other = setup({});
  await other.session.mint(REQUEST);
  other.session.stop();
  await settled();
  assert.equal(other.sent.at(-1)?.keepalive, undefined);
});

test('a 401 or session_ended ends the session, and nothing more goes out, and only session_ended is news for the other tabs (#7, Slice 4)', async () => {
  // A 401: studioFetch told the other tabs as it saw it.
  const unauthorized = setup({ 'preview.grant.renew': [{ status: 401 }] });
  await unauthorized.session.mint(REQUEST);
  await unauthorized.beat();
  assert.deepEqual(unauthorized.states.at(-1), { kind: 'ended', announce: false });
  await unauthorized.session.mint(REQUEST);
  await unauthorized.session.check();
  unauthorized.session.stop();
  assert.deepEqual(unauthorized.names(), ['preview.grant.mint', 'preview.grant.renew']);

  // The grant's status: nothing has told the other tabs yet.
  const ended = setup({
    'preview.grant.status': [{ status: 200, data: { status: 'session_ended' } }],
  });
  await ended.session.mint(REQUEST);
  await ended.session.check();
  assert.deepEqual(ended.states.at(-1), { kind: 'ended', announce: true });
  assert.deepEqual(ended.names(), ['preview.grant.mint', 'preview.grant.status']);

  const renewed = setup({
    'preview.grant.renew': [{ status: 200, data: { status: 'session_ended' } }],
  });
  await renewed.session.mint(REQUEST);
  await renewed.beat();
  assert.deepEqual(renewed.states.at(-1), { kind: 'ended', announce: true });

  const signedOut = setup({ 'preview.grant.mint': [{ status: 401 }] });
  await signedOut.session.mint(REQUEST);
  assert.deepEqual(signedOut.states, [{ kind: 'minting' }, { kind: 'ended', announce: false }]);

  // The page ending it, for what another tab said or a 401 the page saw: told already.
  const told = setup({});
  await told.session.mint(REQUEST);
  told.session.end();
  assert.deepEqual(told.states.at(-1), { kind: 'ended', announce: false });
  told.session.end();
  assert.equal(told.states.filter(({ kind }) => kind === 'ended').length, 1);
});

test('a mint that fails says so, and stop revokes the grant and ends the heartbeat (#7, Slice 4)', async () => {
  const failing = setup({ 'preview.grant.mint': [{ status: 500 }] });
  await failing.session.mint(REQUEST);
  assert.deepEqual(failing.states.at(-1), { kind: 'failed' });

  const { session, names, timers, states } = setup({});
  await session.mint(REQUEST);
  session.stop();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(names(), ['preview.grant.mint', 'preview.grant.revoke']);
  assert.ok(timers.every(({ cleared }) => cleared));
  const count = states.length;
  await session.mint(REQUEST);
  assert.equal(states.length, count);
});
