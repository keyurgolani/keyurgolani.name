import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES } from './capabilities';
import { ERRORS, listOperations, type ErrorCode, type Operation } from './operations';

/** The codes the dispatcher itself can answer `operation` with, from its flags. */
function reachable(operation: Operation): ErrorCode[] {
  const codes: ErrorCode[] = ['not_available_in_profile', 'method_not_allowed'];
  if (operation.session) codes.push('authentication_required');
  if (operation.originCheck) codes.push('request_origin_rejected');
  codes.push('capability_denied', 'invalid_input');
  if (operation.expects) codes.push('version_conflict');
  codes.push('internal_error');
  return codes;
}

test("the registry holds config.status and #2's auth entries", () => {
  assert.deepEqual(
    listOperations().map((operation) => operation.name),
    [
      'config.status',
      'auth.session',
      'auth.login',
      'auth.logout',
      'auth.session.extend',
      'auth.sessions.list',
      'auth.sessions.revoke',
      'auth.sessions.revokeAll',
    ],
  );
});

const entry = (name: string) => listOperations().find((operation) => operation.name === name)!;

test('auth.login needs no session, takes JSON or the sign-in form up to 4 KB, and any password at all', () => {
  const login = entry('auth.login');
  assert.equal(login.kind, 'command');
  assert.equal(login.session, false);
  assert.equal(login.capability, 'auth.session');
  assert.deepEqual(login.bodyTypes, ['json', 'form']);
  assert.equal(login.maxBodyBytes, 4096);
  for (const code of ['credentials_rejected', 'rate_limited', 'unavailable'] as const) {
    assert.ok(login.errors.includes(code), code);
  }
  // A missing, empty, malformed, or overlong password is a credential
  // failure for the handler, never invalid_input.
  for (const body of [{}, { password: '' }, { password: 42 }, { password: 'x'.repeat(900) }]) {
    assert.equal(login.input.safeParse(body).success, true, JSON.stringify(body));
  }
  assert.equal(login.input.safeParse({ password: 'p', returnTo: '/studio' }).success, true);
});

test('auth.logout needs no session, so it signs out whatever the cookie carries, and still checks the Origin', () => {
  const logout = entry('auth.logout');
  assert.equal(logout.kind, 'command');
  assert.equal(logout.session, false);
  assert.equal(logout.originCheck, true);
  assert.equal(logout.capability, 'auth.session');
  assert.deepEqual(logout.errors, reachable(logout));
  assert.equal(logout.output.safeParse({ signedOut: true }).success, true);
  assert.equal(logout.output.safeParse({ signedOut: false }).success, false);
});

test('the other auth entries need a session, and the session list never shows a token or a digest', () => {
  for (const name of [
    'auth.session',
    'auth.session.extend',
    'auth.sessions.list',
    'auth.sessions.revoke',
    'auth.sessions.revokeAll',
  ]) {
    const operation = entry(name);
    assert.equal(operation.session, true, name);
    assert.deepEqual(operation.errors, reachable(operation), name);
    assert.equal(
      operation.capability,
      name.startsWith('auth.sessions.') ? 'studio.view' : 'auth.session',
      name,
    );
  }
  const list = entry('auth.sessions.list');
  const summary = {
    ref: '0123abcd',
    browser: 'firefox',
    createdAt: '2026-10-20T09:00:00.000Z',
    lastSeenAt: '2026-10-20T09:00:00.000Z',
    current: true,
  };
  assert.equal(list.output.safeParse({ sessions: [summary] }).success, true);
  assert.equal(
    list.output.safeParse({ sessions: [{ ...summary, digest: 'a'.repeat(64) }] }).success,
    false,
  );
  assert.equal(
    entry('auth.sessions.revoke').input.safeParse({ ref: 'a'.repeat(64) }).success,
    false,
  );
});

for (const operation of listOperations()) {
  test(`${operation.name} is well formed`, () => {
    assert.ok(CAPABILITIES.includes(operation.capability), operation.capability);
    assert.equal(
      operation.originCheck,
      operation.kind === 'command',
      'commands, and only commands, check origin and CSRF',
    );
    // Each code the dispatcher can reach, plus any its handler or throttle answers with.
    for (const code of reachable(operation)) assert.ok(operation.errors.includes(code), code);
    for (const code of operation.errors) assert.ok(Object.hasOwn(ERRORS, code), code);
    assert.equal(new Set(operation.errors).size, operation.errors.length);
  });
}

test('every error code has its own status and a fixed message', () => {
  for (const [code, { status, message }] of Object.entries(ERRORS)) {
    assert.match(code, /^[a-z]+(_[a-z]+)*$/);
    assert.ok(status >= 400 && status < 600, code);
    assert.ok(message.length > 0, code);
  }
  assert.equal(ERRORS.rate_limited.status, 429);
});

test('operation names are unique', () => {
  const names = listOperations().map((operation) => operation.name);
  assert.equal(new Set(names).size, names.length);
});

test('config.status takes no input and returns the redacted summary', () => {
  const status = listOperations().find((operation) => operation.name === 'config.status')!;
  assert.equal(status.kind, 'query');
  assert.deepEqual(status.errors, reachable(status));
  assert.equal(status.session, true);
  assert.equal(status.input.safeParse({}).success, true);
  assert.equal(status.input.safeParse({ path: '/srv' }).success, false);
  const summary = {
    profile: 'owner',
    origin: 'https://rowan.test',
    previewOrigin: null,
    proxyHops: 0,
    capabilities: [{ id: 'config.status', access: 'session' }],
    adapters: { catalog: 'documents' },
    secrets: { PORTFOLIO_AUTH_PASSWORD_HASH: 'set', GITHUB_TOKEN: 'unset' },
    // How the live site's variant renders (#5).
    variant: { status: 'degraded', requested: 'missing-variant', rendered: 'fallback' },
  };
  assert.equal(status.output.safeParse(summary).success, true);
  assert.equal(
    status.output.safeParse({ ...summary, variant: { ...summary.variant, status: 'broken' } })
      .success,
    false,
  );
  assert.equal(
    status.output.safeParse({ ...summary, variant: { ...summary.variant, path: '/srv' } }).success,
    false,
  );
  // A secret value, or any field the schema doesn't name, never passes.
  const leaking = { ...summary, secrets: { ...summary.secrets, GITHUB_TOKEN: 'canary-token' } };
  assert.equal(status.output.safeParse(leaking).success, false);
  assert.equal(status.output.safeParse({ ...summary, sourceDir: '/srv' }).success, false);
});
