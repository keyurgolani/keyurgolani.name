import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES } from './capabilities';
import { ERRORS, listOperations, type ErrorCode, type Operation } from './operations';

/** The codes the dispatcher itself can answer `operation` with, from its flags. */
function reachable(operation: Operation): ErrorCode[] {
  const codes: ErrorCode[] = ['not_available_in_profile', 'method_not_allowed'];
  if (operation.session) codes.push('authentication_required');
  if (operation.originCheck) codes.push('request_origin_rejected');
  codes.push('capability_denied', 'invalid_input', 'internal_error');
  return codes;
}

const entry = (name: string) => listOperations().find((operation) => operation.name === name)!;

test("the registry holds config.status, #2's auth entries, #3's store entries, and #7's grant commands", () => {
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
      'preview.grant.mint',
      'preview.grant.renew',
      'preview.grant.revoke',
      'preview.grant.status',
      'live.get',
      'revision.list',
      'revision.get',
      'history.list',
      'draft.getWorking',
      'draft.get',
      'draft.create',
      'draft.save',
      'draft.applyEdits',
      'draft.rebase',
      'draft.importSource',
      'draft.discard',
      'publish',
      'rollback',
      'recover',
    ],
  );
});

// #3, item 22: each store entry's capability, and the codes it can answer
// beyond the dispatcher's own.
const STORE_ENTRIES: Record<string, { capability: string; kind: string; codes: ErrorCode[] }> = {
  'live.get': { capability: 'history.read', kind: 'query', codes: ['storage_unavailable'] },
  'revision.list': { capability: 'history.read', kind: 'query', codes: ['storage_unavailable'] },
  'revision.get': {
    capability: 'history.read',
    kind: 'query',
    codes: ['storage_unavailable', 'not_found'],
  },
  'history.list': { capability: 'history.read', kind: 'query', codes: ['storage_unavailable'] },
  'draft.getWorking': { capability: 'draft.read', kind: 'query', codes: ['storage_unavailable'] },
  'draft.get': {
    capability: 'draft.read',
    kind: 'query',
    codes: ['storage_unavailable', 'not_found'],
  },
  ...Object.fromEntries(
    ['draft.create', 'draft.save', 'draft.applyEdits', 'draft.rebase', 'draft.importSource'].map(
      (name) => [
        name,
        {
          // Item 24: importing the mounted pair is config.import's.
          capability: name === 'draft.importSource' ? 'config.import' : 'draft.write',
          kind: 'command',
          codes: [
            'draft_conflict',
            'live_conflict',
            'payload_too_large',
            'asset_missing',
            'validation_failed',
            'not_found',
            'lock_timeout',
            'lock_lost',
            'storage_unavailable',
            'storage_full',
            'data_dir_in_use',
          ] as ErrorCode[],
        },
      ],
    ),
  ),
  'draft.discard': {
    capability: 'draft.write',
    kind: 'command',
    codes: [
      'draft_conflict',
      'not_found',
      'lock_timeout',
      'lock_lost',
      'storage_unavailable',
      'storage_full',
      'data_dir_in_use',
    ],
  },
  publish: {
    capability: 'publish',
    kind: 'command',
    codes: [
      'live_conflict',
      'draft_conflict',
      'nothing_to_publish',
      'validation_failed',
      'asset_missing',
      'not_found',
      'idempotency_conflict',
      'lock_timeout',
      'lock_lost',
      'storage_unavailable',
      'storage_full',
      'data_dir_in_use',
    ],
  },
  ...Object.fromEntries(
    ['rollback', 'recover'].map((name) => [
      name,
      {
        capability: 'rollback',
        kind: 'command',
        codes: [
          'live_conflict',
          'nothing_to_publish',
          'revision_incompatible',
          'not_found',
          'idempotency_conflict',
          'lock_timeout',
          'lock_lost',
          'storage_unavailable',
          'storage_full',
          'data_dir_in_use',
        ] as ErrorCode[],
      },
    ]),
  ),
};

test("#3's store entries: their capabilities, a session each, and the codes item 22 lists", () => {
  for (const [name, expected] of Object.entries(STORE_ENTRIES)) {
    const operation = entry(name);
    assert.equal(operation.capability, expected.capability, name);
    assert.equal(operation.kind, expected.kind, name);
    assert.equal(operation.session, true, name);
    assert.deepEqual(
      [...operation.errors].sort(),
      [...reachable(operation), ...expected.codes].sort(),
      name,
    );
  }
  // The statuses item 22 gives them.
  const statuses = Object.fromEntries(
    Object.entries(ERRORS).map(([code, { status }]) => [code, status]),
  );
  assert.deepEqual(
    [
      'draft_conflict',
      'live_conflict',
      'nothing_to_publish',
      'validation_failed',
      'revision_incompatible',
      'asset_missing',
      'payload_too_large',
      'not_found',
      'idempotency_conflict',
      'lock_timeout',
      'lock_lost',
      'storage_unavailable',
      'storage_full',
      'data_dir_in_use',
    ].map((code) => statuses[code]),
    [409, 409, 409, 422, 422, 422, 413, 404, 422, 503, 503, 503, 507, 503],
  );
  // #1's step 6 is gone: the store makes its version checks under the lock,
  // so none of its entries answers version_conflict, which only #7's
  // preview.grant.mint does.
  for (const name of Object.keys(STORE_ENTRIES)) {
    assert.equal(entry(name).errors.includes('version_conflict'), false, name);
  }
});

test('details are declared only for codes that answer 409 or 422', () => {
  for (const operation of listOperations()) {
    for (const code of Object.keys(operation.details ?? {}) as ErrorCode[]) {
      assert.ok(operation.errors.includes(code), `${operation.name} ${code}`);
      assert.ok([409, 422].includes(ERRORS[code].status), `${operation.name} ${code}`);
    }
  }
});

const REVISION = `rev_${'a'.repeat(32)}`;
const DRAFT = `drf_${'b'.repeat(32)}`;
const DOCUMENT = { format: 'yaml', sourceText: 'schemaVersion: 2\n' };

test("the store entries' inputs are strict, so the store never sees a key it doesn't take", () => {
  const accepts = (name: string, input: unknown) => entry(name).input.safeParse(input).success;
  const documents = { portfolio: DOCUMENT, site: DOCUMENT };
  assert.ok(accepts('draft.save', { draftId: DRAFT, expectedVersion: 1, documents }));
  // A document key the store doesn't take, which its TypeError would echo, is a 400 here.
  assert.equal(
    accepts('draft.save', {
      draftId: DRAFT,
      expectedVersion: 1,
      documents: { ...documents, '/srv/canary': DOCUMENT },
    }),
    false,
  );
  assert.equal(
    accepts('draft.save', {
      draftId: DRAFT,
      expectedVersion: 1,
      documents: { ...documents, site: { ...DOCUMENT, name: '../x' } },
    }),
    false,
  );
  for (const draftId of [`${DRAFT}\n`, `${DRAFT}/../x`, 'drf_x']) {
    assert.equal(accepts('draft.get', { draftId }), false, draftId);
  }
  // draft.importSource reads the mounted pair itself: it takes no documents, and no directory.
  assert.ok(accepts('draft.importSource', {}));
  assert.ok(accepts('draft.importSource', { expectedVersion: 1 }));
  for (const input of [
    { expectedVersion: 0 },
    { documents },
    { from: '/srv/other' },
    { sourceHash: `sha256:${'a'.repeat(64)}` },
  ]) {
    assert.equal(accepts('draft.importSource', input), false, JSON.stringify(input));
  }
  assert.ok(accepts('publish', { draftId: DRAFT, draftVersion: 1, expectedLiveRevisionId: null }));
  assert.equal(
    accepts('publish', {
      draftId: DRAFT,
      draftVersion: 1,
      expectedLiveRevisionId: null,
      actor: 'operator',
    }),
    false,
  );
  assert.equal(accepts('rollback', { expectedLiveRevisionId: REVISION }), false);
  assert.ok(accepts('recover', { expectedLiveRevisionId: REVISION }));
  assert.equal(
    accepts('recover', { expectedLiveRevisionId: REVISION, reason: 'x'.repeat(501) }),
    false,
  );
  // Pages: digits only, and a limit of 1 to 100.
  assert.ok(accepts('revision.list', { offset: '50', limit: '100' }));
  for (const page of [
    { limit: '0' },
    { limit: '101' },
    { offset: '-1' },
    { offset: '01' },
    { offset: '1e3' },
  ]) {
    assert.equal(accepts('history.list', page), false, JSON.stringify(page));
  }
});

test('the grant commands need a session and preview.grant, take a grant only in the body, and answer only what the grant may say (#7)', () => {
  const grant = 'g_7Hk-2abcdefghijklmnop'.slice(0, 22);
  for (const name of [
    'preview.grant.mint',
    'preview.grant.renew',
    'preview.grant.revoke',
    'preview.grant.status',
  ]) {
    const operation = entry(name);
    assert.equal(operation.kind, 'command', `${name}: a grant never travels in a query`);
    assert.equal(operation.session, true, name);
    assert.equal(operation.originCheck, true, name);
    assert.equal(operation.capability, 'preview.grant', name);
    if (name !== 'preview.grant.mint') {
      assert.equal(operation.input.safeParse({ grant }).success, true, name);
      for (const input of [{}, { grant: `${grant}=` }, { grant, extra: 1 }, { grant: 42 }]) {
        assert.equal(
          operation.input.safeParse(input).success,
          false,
          `${name} ${JSON.stringify(input)}`,
        );
      }
    }
  }
  assert.deepEqual(entry('preview.grant.mint').errors, [
    ...reachable(entry('preview.grant.mint')),
    'not_found',
    'version_conflict',
  ]);

  const mint = entry('preview.grant.mint');
  const environment = {
    displayMode: 'dark',
    contrast: 'more',
    motion: 'reduce',
    enhancement: 'off',
  };
  for (const subject of [
    { draft: `drf_${'a'.repeat(32)}`, version: 3 },
    { revision: `rev_${'b'.repeat(32)}` },
    { fixture: 'complete' },
  ]) {
    assert.equal(
      mint.input.safeParse({ subject, environment }).success,
      true,
      JSON.stringify(subject),
    );
  }
  for (const input of [
    { subject: { draft: '../drafts/x', version: 1 }, environment },
    { subject: { draft: `drf_${'a'.repeat(32)}`, version: 0 }, environment },
    { subject: { revision: `rev_${'b'.repeat(32)}`, draft: `drf_${'a'.repeat(32)}` }, environment },
    { subject: { path: '/srv/config/portfolio.yml' }, environment },
    { subject: { fixture: 'complete' }, environment: { ...environment, motion: 'full' } },
    { subject: { fixture: 'complete' } },
    { subject: { fixture: 'complete' }, environment, yaml: 'identity: {}' },
  ]) {
    assert.equal(mint.input.safeParse(input).success, false, JSON.stringify(input));
  }
  const at = '2026-10-22T12:00:00.000Z';
  const active = {
    status: 'active',
    grant,
    nonce: grant,
    idleExpiresAt: at,
    absoluteExpiresAt: at,
  };
  assert.equal(mint.output.safeParse(active).success, true);
  assert.equal(mint.output.safeParse({ status: 'preview_blocked', diagnostics: 2 }).success, true);
  assert.equal(mint.output.safeParse({ ...active, digest: 'a'.repeat(64) }).success, false);
  assert.equal(mint.output.safeParse({ status: 'preview_blocked', diagnostics: 0 }).success, false);

  const renew = entry('preview.grant.renew');
  assert.equal(
    renew.output.safeParse({ status: 'active', idleExpiresAt: at, absoluteExpiresAt: at }).success,
    true,
  );
  for (const status of ['superseded', 'expired', 'unknown', 'session_ended']) {
    assert.equal(renew.output.safeParse({ status }).success, true, status);
    assert.equal(entry('preview.grant.status').output.safeParse({ status }).success, true, status);
  }
  assert.equal(renew.output.safeParse({ status: 'active' }).success, false);
  assert.equal(
    entry('preview.grant.status').output.safeParse({ status: 'revoked' }).success,
    false,
  );
});

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
    // What serves (#3, item 23).
    catalog: {
      state: 'degraded',
      liveRevisionId: `rev_${'1'.repeat(32)}`,
      servingRevisionId: `rev_${'0'.repeat(32)}`,
      renderDrift: [{ kind: 'variant', id: 'missing-variant', revision: '1.0.0', build: null }],
    },
    // Whether owner writes go through (#3).
    writes: { state: 'open' },
    // Whether the mounted pair changed since the last import (#3, item 24).
    source: {
      state: 'unchanged',
      mountedSourceHash: `sha256:${'a'.repeat(64)}`,
      importedSourceHash: `sha256:${'a'.repeat(64)}`,
    },
  };
  assert.equal(status.output.safeParse(summary).success, true);
  for (const code of ['data_dir_in_use', 'data_dir_unclaimed', 'store_repair_failed']) {
    const stopped = { ...summary, writes: { state: 'stopped', code } };
    assert.equal(status.output.safeParse(stopped).success, true, code);
  }
  // Writes stop for a reason the schema names, and with nothing more.
  for (const writes of [
    { state: 'stopped' },
    { state: 'stopped', code: 'EACCES' },
    { state: 'open', code: 'data_dir_in_use' },
    { state: 'stopped', code: 'data_dir_in_use', holder: 'pid 1234' },
  ]) {
    assert.equal(status.output.safeParse({ ...summary, writes }).success, false);
  }
  // An empty store serves nothing, and never the mounted documents: a
  // doc- revision, a path, or a reason never passes.
  const empty = {
    ...summary,
    catalog: { state: 'empty', liveRevisionId: null, servingRevisionId: null, renderDrift: null },
  };
  assert.equal(status.output.safeParse(empty).success, true);
  for (const catalog of [
    { ...empty.catalog, state: 'live', servingRevisionId: 'doc-0123456789ab' },
    { ...summary.catalog, reason: 'damaged:hash_mismatch' },
    { ...summary.catalog, servingRevisionId: '/srv/data/revisions/x' },
    { ...summary.catalog, state: 'broken' },
  ]) {
    assert.equal(status.output.safeParse({ ...summary, catalog }).success, false);
  }
  assert.equal(
    status.output.safeParse({ ...summary, variant: { ...summary.variant, status: 'broken' } })
      .success,
    false,
  );
  assert.equal(
    status.output.safeParse({ ...summary, variant: { ...summary.variant, path: '/srv' } }).success,
    false,
  );
  // Drift says the message, with both hashes; nothing to compare says neither.
  for (const source of [
    {
      state: 'changed',
      message: 'Source files changed since the live revision',
      mountedSourceHash: `sha256:${'b'.repeat(64)}`,
      importedSourceHash: `sha256:${'a'.repeat(64)}`,
    },
    { state: 'unknown', mountedSourceHash: `sha256:${'b'.repeat(64)}`, importedSourceHash: null },
    { state: 'unknown', mountedSourceHash: null, importedSourceHash: null },
  ]) {
    assert.equal(status.output.safeParse({ ...summary, source }).success, true, source.state);
  }
  for (const source of [
    {
      state: 'changed',
      mountedSourceHash: `sha256:${'b'.repeat(64)}`,
      importedSourceHash: `sha256:${'a'.repeat(64)}`,
    },
    {
      state: 'changed',
      message: 'Something else',
      mountedSourceHash: `sha256:${'b'.repeat(64)}`,
      importedSourceHash: `sha256:${'a'.repeat(64)}`,
    },
    { ...summary.source, message: 'Source files changed since the live revision' },
    { ...summary.source, sourceDir: '/srv/portfolio' },
    { ...summary.source, mountedSourceHash: '/srv/portfolio/portfolio.yml' },
  ]) {
    assert.equal(
      status.output.safeParse({ ...summary, source }).success,
      false,
      JSON.stringify(source),
    );
  }
  assert.equal(status.output.safeParse({ ...summary, source: undefined }).success, false);
  // A secret value, or any field the schema doesn't name, never passes.
  const leaking = { ...summary, secrets: { ...summary.secrets, GITHUB_TOKEN: 'canary-token' } };
  assert.equal(status.output.safeParse(leaking).success, false);
  assert.equal(status.output.safeParse({ ...summary, sourceDir: '/srv' }).success, false);
});
