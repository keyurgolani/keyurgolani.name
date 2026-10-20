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

test('config.status is the one registered operation', () => {
  assert.deepEqual(
    listOperations().map((operation) => operation.name),
    ['config.status'],
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
  };
  assert.equal(status.output.safeParse(summary).success, true);
  // A secret value, or any field the schema doesn't name, never passes.
  const leaking = { ...summary, secrets: { ...summary.secrets, GITHUB_TOKEN: 'canary-token' } };
  assert.equal(status.output.safeParse(leaking).success, false);
  assert.equal(status.output.safeParse({ ...summary, sourceDir: '/srv' }).success, false);
});
