import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { accessIn, CAPABILITIES, type Capability } from './capabilities';
import { createDispatcher, NO_BINDINGS, type Handler, type StudioBindings } from './dispatcher';
import type { Operation } from './operations';
import { capabilityPolicy, type Session } from './policy';

// The dispatcher's steps, in order, against fake registry entries and test
// doubles for #2's session and origin checks and #3's version check.

const SESSION: Session = { kind: 'owner' };

function fake(capability: Capability, overrides: Partial<Operation> = {}): Operation {
  const kind = overrides.kind ?? 'query';
  return {
    name: `fake.${capability}`,
    kind,
    capability,
    input: z.object({ note: z.string().optional() }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
    session: true,
    originCheck: kind === 'command',
    errors: [],
    ...overrides,
  };
}

function spy(result: unknown = { ok: true }) {
  const calls: unknown[] = [];
  const handler: Handler = (authorized, input) => {
    calls.push({ authorized, input });
    return result;
  };
  return { handler, calls };
}

/** Test doubles: `x-test-session: owner` carries a session, `x-test-origin: same` passes step 3. */
function doubles(handlers: Record<string, Handler>, overrides: Partial<StudioBindings> = {}) {
  return {
    handlers,
    resolveSession: async (request: Request) =>
      request.headers.get('x-test-session') === 'owner' ? SESSION : null,
    checkOrigin: async (request: Request) => request.headers.get('x-test-origin') === 'same',
    checkVersion: async () => true,
    ...overrides,
  } satisfies StudioBindings;
}

interface Call {
  session?: boolean;
  origin?: boolean;
  body?: string;
  contentType?: string;
  query?: string;
  requestId?: string | null;
}

/** A request whose body records whether the dispatcher read it. */
function call(method: string, name: string, options: Call = {}) {
  const read = { body: false };
  const headers = new Headers();
  if (options.requestId !== null) headers.set('x-request-id', options.requestId ?? 'req-test');
  if (options.session) headers.set('x-test-session', 'owner');
  if (options.origin) headers.set('x-test-origin', 'same');
  let body: ReadableStream<Uint8Array> | undefined;
  if (options.body !== undefined) {
    headers.set('content-type', options.contentType ?? 'application/json');
    const bytes = new TextEncoder().encode(options.body);
    body = new ReadableStream(
      {
        pull(controller) {
          read.body = true;
          controller.enqueue(bytes);
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
  }
  const url = `https://rowan.test/api/studio/${name}${options.query ?? ''}`;
  const init = { method, headers, body, duplex: 'half' } as RequestInit;
  return { request: new Request(url, init), read };
}

async function errorOf(response: Response) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  const body = (await response.json()) as {
    error: { code: string; message: string; requestId: string };
  };
  assert.deepEqual(Object.keys(body), ['error']);
  assert.deepEqual(Object.keys(body.error), ['code', 'message', 'requestId']);
  return body.error;
}

function owner(operations: Operation[], bindings: StudioBindings) {
  return createDispatcher({ policy: capabilityPolicy('owner'), operations, ...bindings });
}

// AC1: every owner capability that needs a session, as a query and as a command.
const SESSION_CAPABILITIES = CAPABILITIES.filter((id) => accessIn('owner', id) === 'session');

for (const capability of SESSION_CAPABILITIES) {
  for (const kind of ['query', 'command'] as const) {
    test(`${capability} ${kind}: no session is 401 and never reaches the handler; a session does`, async () => {
      const operation = fake(capability, { kind });
      const { handler, calls } = spy();
      const dispatch = owner([operation], doubles({ [operation.name]: handler }));
      const method = kind === 'query' ? 'GET' : 'POST';
      const body = kind === 'command' ? '{"note":"draft"}' : undefined;

      const anonymous = call(method, operation.name, { origin: true, body });
      const denied = await dispatch(anonymous.request, operation.name);
      assert.equal(denied.status, 401);
      assert.equal((await errorOf(denied)).code, 'authentication_required');
      assert.equal(calls.length, 0);
      assert.equal(anonymous.read.body, false);

      const signedIn = call(method, operation.name, { session: true, origin: true, body });
      const allowed = await dispatch(signedIn.request, operation.name);
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await allowed.json(), { data: { ok: true } });
      assert.equal(calls.length, 1);
    });
  }
}

test('1: an unknown name is 404 before anything else, even with the wrong method', async () => {
  const { handler, calls } = spy();
  const dispatch = owner(
    [fake('publish', { kind: 'command' })],
    doubles({ 'fake.publish': handler }),
  );
  const request = call('DELETE', 'fake.nope', { session: true, origin: true, body: '{}' });
  const response = await dispatch(request.request, 'fake.nope');
  assert.equal(response.status, 404);
  assert.deepEqual(await errorOf(response), {
    code: 'not_available_in_profile',
    message: "This deployment doesn't offer that operation.",
    requestId: 'req-test',
  });
  assert.equal(calls.length, 0);
  assert.equal(request.read.body, false);
});

test('1: a capability absent in the profile is the same 404, before the session is read', async () => {
  const { handler, calls } = spy();
  let sessionsRead = 0;
  const bindings = doubles(
    { 'fake.publish': handler },
    {
      resolveSession: async () => {
        sessionsRead++;
        return SESSION;
      },
    },
  );
  for (const profile of ['read-only', 'demo'] as const) {
    const dispatch = createDispatcher({
      policy: capabilityPolicy(profile),
      operations: [fake('publish', { kind: 'command' })],
      ...bindings,
    });
    const request = call('POST', 'fake.publish', { session: true, origin: true, body: '{}' });
    const response = await dispatch(request.request, 'fake.publish');
    assert.equal(response.status, 404, profile);
    assert.equal((await errorOf(response)).code, 'not_available_in_profile');
    assert.equal(request.read.body, false);
  }
  assert.equal(calls.length, 0);
  assert.equal(sessionsRead, 0);
});

test('1: the wrong method for the kind is 405, naming the one it takes', async () => {
  const dispatch = owner(
    [fake('draft.read'), fake('draft.write', { kind: 'command' })],
    doubles({}),
  );
  for (const [method, name, allow] of [
    ['POST', 'fake.draft.read', 'GET'],
    ['PUT', 'fake.draft.read', 'GET'],
    ['GET', 'fake.draft.write', 'POST'],
    ['PATCH', 'fake.draft.write', 'POST'],
  ] as const) {
    const request = call(method, name, { session: true, origin: true });
    const response = await dispatch(request.request, name);
    assert.equal(response.status, 405, `${method} ${name}`);
    assert.equal(response.headers.get('allow'), allow);
    assert.equal((await errorOf(response)).code, 'method_not_allowed');
  }
});

test('2: a missing session is 401 before the origin or the input is looked at', async () => {
  const dispatch = owner([fake('publish', { kind: 'command' })], doubles({}));
  const request = call('POST', 'fake.publish', { origin: false, body: 'not json' });
  const response = await dispatch(request.request, 'fake.publish');
  assert.equal(response.status, 401);
  assert.equal((await errorOf(response)).code, 'authentication_required');
  assert.equal(request.read.body, false);
});

test('3: a command from another origin is 403 before authorization or input', async () => {
  const { handler, calls } = spy();
  const dispatch = owner(
    [fake('publish', { kind: 'command' })],
    doubles({ 'fake.publish': handler }),
  );
  const request = call('POST', 'fake.publish', { session: true, origin: false, body: 'not json' });
  const response = await dispatch(request.request, 'fake.publish');
  assert.equal(response.status, 403);
  assert.equal((await errorOf(response)).code, 'request_origin_rejected');
  assert.equal(request.read.body, false);
  assert.equal(calls.length, 0);
});

test('3: until #2 supplies the check, every command is refused', async () => {
  const dispatch = owner([fake('publish', { kind: 'command' })], {
    ...NO_BINDINGS,
    resolveSession: async () => SESSION,
  });
  const response = await dispatch(
    call('POST', 'fake.publish', { body: '{}' }).request,
    'fake.publish',
  );
  assert.equal((await errorOf(response)).code, 'request_origin_rejected');
});

test('4: authorize() denies a session capability to a request without one', async () => {
  // An entry that wrongly skips the session step still meets the policy.
  const { handler, calls } = spy();
  const dispatch = owner(
    [fake('history.read', { session: false })],
    doubles({ 'fake.history.read': handler }),
  );
  const response = await dispatch(call('GET', 'fake.history.read').request, 'fake.history.read');
  assert.equal(response.status, 403);
  assert.equal((await errorOf(response)).code, 'capability_denied');
  assert.equal(calls.length, 0);
});

test('5: input outside the schema is 400, and the body is read only here', async () => {
  const { handler, calls } = spy();
  const dispatch = owner(
    [fake('draft.read'), fake('draft.write', { kind: 'command' })],
    doubles({ 'fake.draft.read': handler, 'fake.draft.write': handler }),
  );
  const cases: Array<[string, string, Call]> = [
    ['GET', 'fake.draft.read', { query: '?path=/srv/canary' }],
    ['POST', 'fake.draft.write', { body: 'not json' }],
    ['POST', 'fake.draft.write', { body: '{"note":42}' }],
    ['POST', 'fake.draft.write', { body: '{"note":"x"}', contentType: 'text/plain' }],
    ['POST', 'fake.draft.write', { body: `{"note":"${'x'.repeat(1024 * 1024)}"}` }],
  ];
  for (const [method, name, options] of cases) {
    const request = call(method, name, { session: true, origin: true, ...options });
    const response = await dispatch(request.request, name);
    assert.equal(response.status, 400, JSON.stringify(options).slice(0, 80));
    const error = await errorOf(response);
    assert.equal(error.code, 'invalid_input');
    assert.ok(!error.message.includes('canary') && !error.message.includes('note'));
    if (options.body !== undefined) assert.equal(request.read.body, true);
  }
  assert.equal(calls.length, 0);
});

test('5: an empty command body is an empty input', async () => {
  const { handler, calls } = spy();
  const dispatch = owner(
    [fake('publish', { kind: 'command' })],
    doubles({ 'fake.publish': handler }),
  );
  const response = await dispatch(
    call('POST', 'fake.publish', { session: true, origin: true, body: '' }).request,
    'fake.publish',
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    calls.map((entry) => (entry as { input: unknown }).input),
    [{}],
  );
});

test('6: a stale expected version is 409 before the handler runs', async () => {
  const { handler, calls } = spy();
  const dispatch = owner(
    [fake('rollback', { kind: 'command', expects: 'live-revision' })],
    doubles({ 'fake.rollback': handler }, { checkVersion: async () => false }),
  );
  const request = call('POST', 'fake.rollback', { session: true, origin: true, body: '{}' });
  const response = await dispatch(request.request, 'fake.rollback');
  assert.equal(response.status, 409);
  assert.equal((await errorOf(response)).code, 'version_conflict');
  assert.equal(calls.length, 0);
});

test('7: a failing handler, output outside its schema, or no handler at all is 500', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const dispatch = owner(
    [fake('draft.read'), fake('history.read'), fake('studio.view')],
    doubles({
      'fake.draft.read': () => {
        throw new Error('canary: /srv/canary/draft.yml');
      },
      'fake.history.read': () => ({ ok: true, path: '/srv/canary' }),
    }),
  );
  for (const name of ['fake.draft.read', 'fake.history.read', 'fake.studio.view']) {
    const response = await dispatch(call('GET', name, { session: true }).request, name);
    assert.equal(response.status, 500, name);
    const error = await errorOf(response);
    assert.equal(error.code, 'internal_error');
    assert.equal(error.requestId, 'req-test');
  }
  const lines = logged.mock.calls.map((entry) => String(entry.arguments[0]));
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.ok(!line.includes('canary'), line);
    assert.deepEqual(Object.keys(JSON.parse(line)), ['level', 'event', 'operation', 'requestId']);
  }
});

test('the request ID comes from proxy.ts, or a fresh one when the header is missing', async () => {
  const dispatch = owner([], doubles({}));
  const fresh = await errorOf(await dispatch(call('GET', 'x', { requestId: null }).request, 'x'));
  assert.match(fresh.requestId, /^[0-9a-f-]{36}$/);
});

test('HEAD runs a query as GET', async () => {
  const { handler, calls } = spy();
  const dispatch = owner([fake('draft.read')], doubles({ 'fake.draft.read': handler }));
  const response = await dispatch(
    call('HEAD', 'fake.draft.read', { session: true }).request,
    'fake.draft.read',
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
});
