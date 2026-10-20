import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { accessIn, CAPABILITIES, type Capability, type Profile } from './capabilities';
import type { DeploymentConfig } from './config';
import { setDeploymentState } from './config-store';
import {
  createDispatcher,
  NO_BINDINGS,
  type Handler,
  type HandlerContext,
  type StudioBindings,
} from './dispatcher';
import type { Operation } from './operations';
import { mintSession } from './owner/session-mint';
import type { Session } from './session';
import { dataResult, errorResult, redirectResult } from './studio-result';

// The dispatcher's steps, in order, against fake registry entries and test
// doubles for #2's session, origin, touch, and throttle bindings and #3's
// version check.

const SESSION = mintSession();
const FORGED: Session = { kind: 'owner' };

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

interface Spied {
  readonly input: unknown;
  readonly context: HandlerContext;
}

function spy(result: unknown = { ok: true }) {
  const calls: Spied[] = [];
  const handler: Handler = (_authorized, input, context) => {
    calls.push({ input, context });
    return result;
  };
  return { handler, calls };
}

/**
 * Test doubles: `x-test-session: owner` carries a minted session and
 * `forged` an object no provider minted; `x-test-origin: same` passes step 3.
 */
function doubles(handlers: Record<string, Handler>, overrides: Partial<StudioBindings> = {}) {
  return {
    handlers,
    resolveSession: async ({ request }) => {
      const carried = request.headers.get('x-test-session');
      return { session: carried === 'owner' ? SESSION : carried === 'forged' ? FORGED : null };
    },
    checkOrigin: async ({ request }) => request.headers.get('x-test-origin') === 'same',
    touchSession: async () => {},
    throttle: async () => null,
    checkVersion: async () => true,
    ...overrides,
  } satisfies StudioBindings;
}

interface Call {
  session?: 'owner' | 'forged';
  origin?: boolean;
  body?: string | Uint8Array;
  /** Defaults to JSON whenever there is a body; null sends none. */
  contentType?: string | null;
  query?: string;
  requestId?: string | null;
}

/** A request whose body records whether the dispatcher read it. */
function call(method: string, name: string, options: Call = {}) {
  const read = { body: false };
  const headers = new Headers();
  if (options.requestId !== null) headers.set('x-request-id', options.requestId ?? 'req-test');
  if (options.session) headers.set('x-test-session', options.session);
  if (options.origin) headers.set('x-test-origin', 'same');
  let body: ReadableStream<Uint8Array> | undefined;
  if (options.body !== undefined) {
    const type = options.contentType === undefined ? 'application/json' : options.contentType;
    if (type !== null) headers.set('content-type', type);
    const bytes =
      typeof options.body === 'string' ? new TextEncoder().encode(options.body) : options.body;
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

/** Stores a deployment of `profile` for the test, as register() would. */
function deploy(t: TestContext, profile: Profile) {
  setDeploymentState({
    config: { profile } as DeploymentConfig,
    catalog: { getLive: () => assert.fail('the dispatcher reads no catalog') },
    dispatch: () => assert.fail('tests call their own dispatcher'),
    degraded: [],
  });
  t.after(() => setDeploymentState(undefined));
}

function owner(t: TestContext, operations: Operation[], bindings: StudioBindings) {
  deploy(t, 'owner');
  return createDispatcher({ operations, ...bindings });
}

// AC1: every owner capability that needs a session, as a query and as a command.
const SESSION_CAPABILITIES = CAPABILITIES.filter((id) => accessIn('owner', id) === 'session');

for (const capability of SESSION_CAPABILITIES) {
  for (const kind of ['query', 'command'] as const) {
    test(`${capability} ${kind}: no session is 401 and never reaches the handler; a session does`, async (t) => {
      const operation = fake(capability, { kind });
      const { handler, calls } = spy();
      const dispatch = owner(t, [operation], doubles({ [operation.name]: handler }));
      const method = kind === 'query' ? 'GET' : 'POST';
      const body = kind === 'command' ? '{"note":"draft"}' : undefined;

      for (const session of [undefined, 'forged'] as const) {
        const anonymous = call(method, operation.name, { session, origin: true, body });
        const denied = await dispatch(anonymous.request, operation.name);
        assert.equal(denied.status, 401, String(session));
        assert.equal((await errorOf(denied)).code, 'authentication_required');
        assert.equal(anonymous.read.body, false);
      }
      assert.equal(calls.length, 0);

      const signedIn = call(method, operation.name, { session: 'owner', origin: true, body });
      const allowed = await dispatch(signedIn.request, operation.name);
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await allowed.json(), { data: { ok: true } });
      assert.equal(calls.length, 1);
    });
  }
}

test('1: an unknown name is 404 before anything else, even with the wrong method', async (t) => {
  const { handler, calls } = spy();
  const dispatch = owner(
    t,
    [fake('publish', { kind: 'command' })],
    doubles({ 'fake.publish': handler }),
  );
  const request = call('DELETE', 'fake.nope', { session: 'owner', origin: true, body: '{}' });
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

test('1: a capability absent in the profile is the same 404, before the session is read', async (t) => {
  const { handler, calls } = spy();
  let sessionsRead = 0;
  const bindings = doubles(
    { 'fake.publish': handler },
    {
      resolveSession: async () => {
        sessionsRead++;
        return { session: SESSION };
      },
    },
  );
  for (const profile of ['read-only', 'demo'] as const) {
    await t.test(profile, async (t) => {
      deploy(t, profile);
      const dispatch = createDispatcher({
        operations: [fake('publish', { kind: 'command' })],
        ...bindings,
      });
      const request = call('POST', 'fake.publish', { session: 'owner', origin: true, body: '{}' });
      const response = await dispatch(request.request, 'fake.publish');
      assert.equal(response.status, 404);
      assert.equal((await errorOf(response)).code, 'not_available_in_profile');
      assert.equal(request.read.body, false);
    });
  }
  assert.equal(calls.length, 0);
  assert.equal(sessionsRead, 0);
});

test("1: the policy is the stored deployment's, read per request", async (t) => {
  const { handler, calls } = spy();
  const dispatch = createDispatcher({
    operations: [fake('draft.read')],
    ...doubles({ 'fake.draft.read': handler }),
  });
  const signedIn = () => call('GET', 'fake.draft.read', { session: 'owner' }).request;

  await t.test('owner', async (t) => {
    deploy(t, 'owner');
    assert.equal((await dispatch(signedIn(), 'fake.draft.read')).status, 200);
  });
  await t.test('read-only', async (t) => {
    deploy(t, 'read-only');
    const response = await dispatch(signedIn(), 'fake.draft.read');
    assert.equal((await errorOf(response)).code, 'not_available_in_profile');
  });
  await t.test('none stored', async (t) => {
    t.mock.method(console, 'log', () => {});
    const response = await dispatch(signedIn(), 'fake.draft.read');
    assert.equal((await errorOf(response)).code, 'internal_error');
  });
  assert.equal(calls.length, 1);
});

test('1: the wrong method for the kind is 405, naming the one it takes', async (t) => {
  const dispatch = owner(
    t,
    [fake('draft.read'), fake('draft.write', { kind: 'command' })],
    doubles({}),
  );
  for (const [method, name, allow] of [
    ['POST', 'fake.draft.read', 'GET'],
    ['PUT', 'fake.draft.read', 'GET'],
    ['OPTIONS', 'fake.draft.read', 'GET'],
    ['GET', 'fake.draft.write', 'POST'],
    ['PATCH', 'fake.draft.write', 'POST'],
  ] as const) {
    const request = call(method, name, { session: 'owner', origin: true });
    const response = await dispatch(request.request, name);
    assert.equal(response.status, 405, `${method} ${name}`);
    assert.equal(response.headers.get('allow'), allow);
    assert.equal((await errorOf(response)).code, 'method_not_allowed');
  }
});

test('2: a missing session is 401 before the origin or the input is looked at', async (t) => {
  const dispatch = owner(t, [fake('publish', { kind: 'command' })], doubles({}));
  const request = call('POST', 'fake.publish', { origin: false, body: 'not json' });
  const response = await dispatch(request.request, 'fake.publish');
  assert.equal(response.status, 401);
  assert.equal((await errorOf(response)).code, 'authentication_required');
  assert.equal(request.read.body, false);
});

test('2: resolveSession sees the operation, and its headers go on every later response', async (t) => {
  const seen: string[] = [];
  const { handler } = spy();
  const dispatch = owner(
    t,
    [fake('draft.read'), fake('catalog.read', { session: false })],
    doubles(
      { 'fake.draft.read': handler, 'fake.catalog.read': handler },
      {
        // An ended session: no session, and two cookies cleared.
        resolveSession: async ({ operation, requestId }) => {
          seen.push(`${operation.name} ${requestId}`);
          return {
            session: null,
            headers: [
              ['set-cookie', 'studio_session=; Max-Age=0; Path=/'],
              ['set-cookie', 'studio_hint=; Max-Age=0; Path=/'],
            ],
          };
        },
      },
    ),
  );
  const cleared = ['studio_session=; Max-Age=0; Path=/', 'studio_hint=; Max-Age=0; Path=/'];

  const ended = await dispatch(call('GET', 'fake.draft.read').request, 'fake.draft.read');
  assert.equal(ended.status, 401);
  assert.deepEqual(ended.headers.getSetCookie(), cleared);
  assert.equal((await errorOf(ended)).code, 'authentication_required');

  const open = await dispatch(call('GET', 'fake.catalog.read').request, 'fake.catalog.read');
  assert.equal(open.status, 200);
  assert.deepEqual(open.headers.getSetCookie(), cleared);

  // Step 1 answers before the session is resolved.
  const unknown = await dispatch(call('GET', 'fake.nope').request, 'fake.nope');
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.headers.getSetCookie(), []);
  assert.deepEqual(seen, ['fake.draft.read req-test', 'fake.catalog.read req-test']);
});

test('3: a command from another origin is 403 before authorization or input', async (t) => {
  const { handler, calls } = spy();
  const dispatch = owner(
    t,
    [fake('publish', { kind: 'command' })],
    doubles({ 'fake.publish': handler }),
  );
  const request = call('POST', 'fake.publish', {
    session: 'owner',
    origin: false,
    body: 'not json',
  });
  const response = await dispatch(request.request, 'fake.publish');
  assert.equal(response.status, 403);
  assert.equal((await errorOf(response)).code, 'request_origin_rejected');
  assert.equal(request.read.body, false);
  assert.equal(calls.length, 0);
});

test('3: checkOrigin sees the operation and the session, so a login can skip CSRF', async (t) => {
  const seen: Array<[string, Session | null]> = [];
  const { handler } = spy();
  const login = fake('auth.session', { name: 'fake.login', kind: 'command', session: false });
  const dispatch = owner(
    t,
    [login, fake('publish', { kind: 'command' })],
    doubles(
      { 'fake.login': handler, 'fake.publish': handler },
      {
        checkOrigin: async ({ operation, session }) => {
          seen.push([operation.name, session]);
          return true;
        },
      },
    ),
  );
  await dispatch(call('POST', 'fake.login', { body: '{}' }).request, 'fake.login');
  await dispatch(
    call('POST', 'fake.publish', { session: 'owner', body: '{}' }).request,
    'fake.publish',
  );
  assert.deepEqual(seen, [
    ['fake.login', null],
    ['fake.publish', SESSION],
  ]);
});

test('3: until #2 supplies the check, every command is refused', async (t) => {
  const dispatch = owner(t, [fake('publish', { kind: 'command' })], {
    ...NO_BINDINGS,
    resolveSession: async () => ({ session: SESSION }),
  });
  const response = await dispatch(
    call('POST', 'fake.publish', { body: '{}' }).request,
    'fake.publish',
  );
  assert.equal((await errorOf(response)).code, 'request_origin_rejected');
});

test('3 runs before 4: a command both would deny is request_origin_rejected', async (t) => {
  // No session step, so only steps 3 and 4 stand between it and the handler.
  const { handler, calls } = spy();
  const dispatch = owner(
    t,
    [fake('publish', { kind: 'command', session: false })],
    doubles({ 'fake.publish': handler }),
  );
  const request = call('POST', 'fake.publish', { origin: false, body: '{}' });
  const response = await dispatch(request.request, 'fake.publish');
  assert.equal(response.status, 403);
  assert.equal((await errorOf(response)).code, 'request_origin_rejected');
  assert.equal(request.read.body, false);
  assert.equal(calls.length, 0);
});

test('4: authorize() denies a session capability to a request without one', async (t) => {
  // An entry that wrongly skips the session step still meets the policy.
  const { handler, calls } = spy();
  const dispatch = owner(
    t,
    [fake('history.read', { session: false })],
    doubles({ 'fake.history.read': handler }),
  );
  const response = await dispatch(call('GET', 'fake.history.read').request, 'fake.history.read');
  assert.equal(response.status, 403);
  assert.equal((await errorOf(response)).code, 'capability_denied');
  assert.equal(calls.length, 0);
});

test('4 runs before 5: a command authorize() denies never has its body read', async (t) => {
  const { handler, calls } = spy();
  const dispatch = owner(
    t,
    [fake('publish', { kind: 'command', session: false })],
    doubles({ 'fake.publish': handler }),
  );
  for (const session of [undefined, 'forged'] as const) {
    const request = call('POST', 'fake.publish', { session, origin: true, body: '{"note":"x"}' });
    const response = await dispatch(request.request, 'fake.publish');
    assert.equal(response.status, 403, String(session));
    assert.equal((await errorOf(response)).code, 'capability_denied');
    assert.equal(request.read.body, false);
  }
  assert.equal(calls.length, 0);
});

test('4: touchSession slides a session only once the request is authorized', async (t) => {
  const touched: string[] = [];
  const { handler } = spy();
  const dispatch = owner(
    t,
    [fake('publish', { kind: 'command' }), fake('catalog.read', { session: false })],
    doubles(
      { 'fake.publish': handler, 'fake.catalog.read': handler },
      {
        touchSession: async ({ operation, session }) => {
          assert.equal(session, SESSION);
          touched.push(operation.name);
        },
      },
    ),
  );
  const cases: Array<[string, string, Call, number]> = [
    ['POST', 'fake.publish', { session: 'owner', origin: false, body: '{}' }, 403],
    ['POST', 'fake.publish', { origin: true, body: '{}' }, 401],
    ['GET', 'fake.catalog.read', {}, 200],
    ['POST', 'fake.publish', { session: 'owner', origin: true, body: 'not json' }, 400],
    ['POST', 'fake.publish', { session: 'owner', origin: true, body: '{}' }, 200],
  ];
  for (const [method, name, options, status] of cases) {
    const response = await dispatch(call(method, name, options).request, name);
    assert.equal(response.status, status, `${method} ${name} ${JSON.stringify(options)}`);
  }
  assert.deepEqual(touched, ['fake.publish', 'fake.publish']);
});

test('4: a failed touch is logged without its cause, and the request goes on', async (t) => {
  const logged = t.mock.method(console, 'log', () => {});
  const { handler, calls } = spy();
  const dispatch = owner(
    t,
    [fake('draft.read')],
    doubles(
      { 'fake.draft.read': handler },
      {
        touchSession: async () => {
          throw new Error('canary: /srv/canary/sessions');
        },
      },
    ),
  );
  const response = await dispatch(
    call('GET', 'fake.draft.read', { session: 'owner' }).request,
    'fake.draft.read',
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const lines = logged.mock.calls.map((entry) => String(entry.arguments[0]));
  assert.equal(lines.length, 1);
  assert.ok(!lines[0]!.includes('canary'), lines[0]);
  const { ts, ...line } = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.match(String(ts), /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(line, {
    level: 'warn',
    event: 'session.touch_failed',
    operation: 'fake.draft.read',
    requestId: 'req-test',
  });
});

test('4: throttle answers after authorization and before the body is read', async (t) => {
  const throttled: string[] = [];
  const { handler, calls } = spy();
  const login = fake('auth.session', {
    name: 'fake.login',
    kind: 'command',
    session: false,
    errors: ['rate_limited'],
  });
  const dispatch = owner(
    t,
    [login, fake('publish', { kind: 'command', session: false })],
    doubles(
      { 'fake.login': handler, 'fake.publish': handler },
      {
        throttle: async ({ operation }) => {
          throttled.push(operation.name);
          return errorResult('rate_limited', { headers: { 'retry-after': '60' } });
        },
      },
    ),
  );
  const request = call('POST', 'fake.login', { origin: true, body: '{"note":"x"}' });
  const response = await dispatch(request.request, 'fake.login');
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal((await errorOf(response)).code, 'rate_limited');
  assert.equal(request.read.body, false);

  // Step 4 denies first, so the throttle never sees this one.
  const denied = await dispatch(
    call('POST', 'fake.publish', { origin: true, body: '{}' }).request,
    'fake.publish',
  );
  assert.equal((await errorOf(denied)).code, 'capability_denied');
  assert.deepEqual(throttled, ['fake.login']);
  assert.equal(calls.length, 0);
});

test('4: a throttle can answer a form post with a 303, never with data', async (t) => {
  const login = fake('auth.session', {
    name: 'fake.login',
    kind: 'command',
    session: false,
    bodyTypes: ['json', 'form'],
    errors: ['rate_limited'],
  });
  let answer = redirectResult('/studio/sign-in?state=rate_limited&retryAfter=60');
  const dispatch = owner(t, [login], doubles({}, { throttle: async () => answer }));
  const form = {
    origin: true,
    body: 'password=x',
    contentType: 'application/x-www-form-urlencoded',
  };
  const redirected = await dispatch(call('POST', 'fake.login', form).request, 'fake.login');
  assert.equal(redirected.status, 303);
  assert.equal(
    redirected.headers.get('location'),
    '/studio/sign-in?state=rate_limited&retryAfter=60',
  );
  assert.equal(redirected.headers.get('cache-control'), 'no-store');

  t.mock.method(console, 'log', () => {});
  answer = dataResult({ ok: true });
  const data = await dispatch(call('POST', 'fake.login', form).request, 'fake.login');
  assert.equal((await errorOf(data)).code, 'internal_error');
});

test("4: a throttle answer the entry doesn't declare is a 500", async (t) => {
  t.mock.method(console, 'log', () => {});
  const login = fake('auth.session', { name: 'fake.login', kind: 'command', session: false });
  const dispatch = owner(
    t,
    [login],
    doubles({}, { throttle: async () => errorResult('rate_limited') }),
  );
  const response = await dispatch(
    call('POST', 'fake.login', { origin: true, body: '{}' }).request,
    'fake.login',
  );
  assert.equal((await errorOf(response)).code, 'internal_error');
});

test('5: input outside the schema is 400, and the body is read only here', async (t) => {
  const { handler, calls } = spy();
  const dispatch = owner(
    t,
    [fake('draft.read'), fake('draft.write', { kind: 'command' })],
    doubles({ 'fake.draft.read': handler, 'fake.draft.write': handler }),
  );
  const cases: Array<[string, string, Call, boolean]> = [
    ['GET', 'fake.draft.read', { query: '?path=/srv/canary' }, false],
    ['GET', 'fake.draft.read', { query: '?note=a&note=b' }, false],
    ['POST', 'fake.draft.write', { body: 'not json' }, true],
    ['POST', 'fake.draft.write', { body: '{"note":42}' }, true],
    ['POST', 'fake.draft.write', { body: '{"note":"x"}', contentType: null }, true],
    ['POST', 'fake.draft.write', { body: new Uint8Array([0x7b, 0xff, 0x7d]) }, true],
    ['POST', 'fake.draft.write', { body: `{"note":"${'x'.repeat(1024 * 1024)}"}` }, true],
    // A type the entry doesn't take is refused unread.
    ['POST', 'fake.draft.write', { body: '{"note":"x"}', contentType: 'text/plain' }, false],
    [
      'POST',
      'fake.draft.write',
      { body: 'note=x', contentType: 'application/x-www-form-urlencoded' },
      false,
    ],
  ];
  for (const [method, name, options, read] of cases) {
    const request = call(method, name, { session: 'owner', origin: true, ...options });
    const response = await dispatch(request.request, name);
    const label = `${options.query ?? ''} ${String(options.contentType)} ${String(options.body).slice(0, 40)}`;
    assert.equal(response.status, 400, label);
    const error = await errorOf(response);
    assert.equal(error.code, 'invalid_input');
    assert.ok(!error.message.includes('canary') && !error.message.includes('note'));
    assert.equal(request.read.body, read, label);
  }
  assert.equal(calls.length, 0);
});

test('5: an empty command body is an empty input', async (t) => {
  const { handler, calls } = spy();
  const dispatch = owner(
    t,
    [fake('publish', { kind: 'command' })],
    doubles({ 'fake.publish': handler }),
  );
  for (const contentType of ['application/json', null]) {
    const response = await dispatch(
      call('POST', 'fake.publish', { session: 'owner', origin: true, body: '', contentType })
        .request,
      'fake.publish',
    );
    assert.equal(response.status, 200);
  }
  assert.deepEqual(
    calls.map((entry) => [entry.input, entry.context.inputType]),
    [
      [{}, 'json'],
      [{}, 'json'],
    ],
  );
});

test('5: an entry that takes form posts gets form input, each name once, under its own cap', async (t) => {
  const { handler, calls } = spy();
  const login = fake('auth.session', {
    name: 'fake.login',
    kind: 'command',
    session: false,
    bodyTypes: ['json', 'form'],
    maxBodyBytes: 32,
  });
  const dispatch = owner(
    t,
    [login, fake('draft.read')],
    doubles({ 'fake.login': handler, 'fake.draft.read': handler }),
  );
  const form = 'application/x-www-form-urlencoded; charset=utf-8';
  const post = (body: string, contentType = form) =>
    dispatch(call('POST', 'fake.login', { origin: true, body, contentType }).request, 'fake.login');

  assert.equal((await post('note=hello+there')).status, 200);
  assert.equal((await post('{"note":"json"}', 'application/json')).status, 200);
  assert.equal((await post('note=a&note=b')).status, 400);
  assert.equal((await post(`note=${'x'.repeat(28)}`)).status, 400);
  await dispatch(
    call('GET', 'fake.draft.read', { session: 'owner', query: '?note=q' }).request,
    'fake.draft.read',
  );
  assert.deepEqual(
    calls.map((entry) => [entry.input, entry.context.inputType]),
    [
      [{ note: 'hello there' }, 'form'],
      [{ note: 'json' }, 'json'],
      [{ note: 'q' }, 'search'],
    ],
  );
});

test('6: a stale expected version is 409 before the handler runs', async (t) => {
  const { handler, calls } = spy();
  const seen: unknown[] = [];
  const dispatch = owner(
    t,
    [fake('rollback', { kind: 'command', expects: 'live-revision' })],
    doubles(
      { 'fake.rollback': handler },
      {
        checkVersion: async ({ input, operation }) => {
          seen.push([operation.name, input]);
          return false;
        },
      },
    ),
  );
  const request = call('POST', 'fake.rollback', {
    session: 'owner',
    origin: true,
    body: '{"note":"r1"}',
  });
  const response = await dispatch(request.request, 'fake.rollback');
  assert.equal(response.status, 409);
  assert.equal((await errorOf(response)).code, 'version_conflict');
  assert.deepEqual(seen, [['fake.rollback', { note: 'r1' }]]);
  assert.equal(calls.length, 0);
});

test('7: a failing handler, output outside its schema, or no handler at all is 500', async (t) => {
  const logged = t.mock.method(console, 'log', () => {});
  const dispatch = owner(
    t,
    [fake('draft.read'), fake('history.read'), fake('studio.view')],
    doubles({
      'fake.draft.read': () => {
        throw new Error('canary: /srv/canary/draft.yml');
      },
      'fake.history.read': () => ({ ok: true, path: '/srv/canary' }),
    }),
  );
  for (const name of ['fake.draft.read', 'fake.history.read', 'fake.studio.view']) {
    const response = await dispatch(call('GET', name, { session: 'owner' }).request, name);
    assert.equal(response.status, 500, name);
    const error = await errorOf(response);
    assert.equal(error.code, 'internal_error');
    assert.equal(error.requestId, 'req-test');
  }
  const lines = logged.mock.calls.map((entry) => String(entry.arguments[0]));
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.ok(!line.includes('canary'), line);
    assert.deepEqual(Object.keys(JSON.parse(line)), [
      'ts',
      'level',
      'event',
      'profile',
      'operation',
      'requestId',
    ]);
  }
});

test('7: a handler answers with a status and headers, and every Set-Cookie stays', async (t) => {
  const dispatch = owner(
    t,
    [fake('auth.session', { name: 'fake.login', kind: 'command', session: false })],
    doubles(
      {
        'fake.login': () =>
          dataResult(
            { ok: true },
            {
              status: 201,
              headers: [
                ['set-cookie', 'studio_session=new; HttpOnly; Path=/'],
                ['clear-site-data', '"cache"'],
              ],
            },
          ),
      },
      {
        resolveSession: async () => ({
          session: null,
          headers: { 'set-cookie': 'studio_session=; Max-Age=0; Path=/' },
        }),
      },
    ),
  );
  const response = await dispatch(
    call('POST', 'fake.login', { origin: true, body: '{}' }).request,
    'fake.login',
  );
  assert.equal(response.status, 201);
  assert.deepEqual(response.headers.getSetCookie(), [
    'studio_session=; Max-Age=0; Path=/',
    'studio_session=new; HttpOnly; Path=/',
  ]);
  assert.equal(response.headers.get('clear-site-data'), '"cache"');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { data: { ok: true } });
});

test('7: a handler redirects a form post within the site, and nowhere else', async (t) => {
  let location = '/studio?state=signed_out';
  const dispatch = owner(
    t,
    [fake('auth.session', { name: 'fake.logout', kind: 'command' })],
    doubles({ 'fake.logout': () => redirectResult(location) }),
  );
  const logout = () =>
    dispatch(
      call('POST', 'fake.logout', { session: 'owner', origin: true, body: '' }).request,
      'fake.logout',
    );
  const response = await logout();
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/studio?state=signed_out');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), '');

  t.mock.method(console, 'log', () => {});
  for (location of [
    'https://elsewhere.test/',
    '//elsewhere.test',
    '/\\elsewhere.test',
    'studio',
    '/a b',
  ]) {
    const off = await logout();
    assert.equal(off.status, 500, location);
    assert.equal(off.headers.get('location'), null);
  }
});

test("7: a handler's declared error carries its headers; an undeclared one is a 500", async (t) => {
  t.mock.method(console, 'log', () => {});
  const dispatch = owner(
    t,
    [
      fake('draft.write', { kind: 'command', errors: ['version_conflict'] }),
      fake('publish', { kind: 'command' }),
    ],
    doubles({
      'fake.draft.write': () => errorResult('version_conflict', { headers: { 'x-draft': 'r2' } }),
      'fake.publish': () => errorResult('version_conflict'),
    }),
  );
  const run = (name: string) =>
    dispatch(call('POST', name, { session: 'owner', origin: true, body: '{}' }).request, name);
  const declared = await run('fake.draft.write');
  assert.equal(declared.status, 409);
  assert.equal(declared.headers.get('x-draft'), 'r2');
  assert.equal((await errorOf(declared)).code, 'version_conflict');
  assert.equal((await errorOf(await run('fake.publish'))).code, 'internal_error');
});

test('7: no binding or result replaces a header the dispatcher sets', async (t) => {
  t.mock.method(console, 'log', () => {});
  const fromHandler = owner(
    t,
    [fake('draft.read')],
    doubles({
      'fake.draft.read': () => dataResult({ ok: true }, { headers: { 'cache-control': 'public' } }),
    }),
  );
  const cached = await fromHandler(
    call('GET', 'fake.draft.read', { session: 'owner' }).request,
    'fake.draft.read',
  );
  assert.equal((await errorOf(cached)).code, 'internal_error');

  const fromSession = createDispatcher({
    operations: [fake('draft.read')],
    ...doubles(
      {},
      {
        resolveSession: async () => ({
          session: SESSION,
          headers: { 'content-type': 'text/html' },
        }),
      },
    ),
  });
  const typed = await fromSession(call('GET', 'fake.draft.read').request, 'fake.draft.read');
  assert.equal((await errorOf(typed)).code, 'internal_error');
});

test('the request ID comes from proxy.ts, or a fresh one when the header is missing', async (t) => {
  const dispatch = owner(t, [], doubles({}));
  const fresh = await errorOf(await dispatch(call('GET', 'x', { requestId: null }).request, 'x'));
  assert.match(fresh.requestId, /^[0-9a-f-]{36}$/);
});

test('HEAD runs a query as GET', async (t) => {
  const { handler, calls } = spy();
  const dispatch = owner(t, [fake('draft.read')], doubles({ 'fake.draft.read': handler }));
  const response = await dispatch(
    call('HEAD', 'fake.draft.read', { session: 'owner' }).request,
    'fake.draft.read',
  );
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
});

test('a failure logs the operation only when the registry has it', async (t) => {
  const logged = t.mock.method(console, 'log', () => {});
  // No stored deployment: every request fails before step 1.
  const dispatch = createDispatcher({ operations: [fake('draft.read')], ...doubles({}) });
  await dispatch(call('GET', 'fake.draft.read').request, 'fake.draft.read');
  await dispatch(call('GET', 'canary-name').request, 'canary-name');
  const lines = logged.mock.calls.map((entry) => JSON.parse(String(entry.arguments[0])));
  assert.deepEqual(
    lines.map((line) => [line.event, line.operation]),
    [
      ['operation.failed', 'fake.draft.read'],
      ['operation.failed', undefined],
    ],
  );
});
