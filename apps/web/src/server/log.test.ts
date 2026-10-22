import test from 'node:test';
import assert from 'node:assert/strict';
import { log, logLine } from './log';

// server/log.ts (#1, item 21): one JSON line per entry, allowlisted fields only.

const NOW = new Date('2026-01-02T03:04:05.000Z');
const parse = (line: string) => JSON.parse(line) as Record<string, unknown>;

test('a line starts with the time and keeps only the fields every event may carry', () => {
  const line = logLine(
    {
      level: 'error',
      event: 'operation.failed',
      requestId: 'req-1',
      profile: 'owner',
      route: '/api/studio/[name]',
      operation: 'config.status',
      capability: 'config.status',
      status: 500,
      code: 'internal_error',
      key: 'PORTFOLIO_ORIGIN',
      digest: '1234',
      // None of these may reach the log.
      body: 'canary-body',
      cookie: 'canary-cookie',
      authorization: 'Bearer canary-token',
      url: 'https://rowan.test/?canary',
      value: 'canary-value',
      message: 'canary message',
      origin: 'https://canary.test',
    },
    NOW,
  );
  assert.ok(line.endsWith('\n'));
  assert.ok(!line.includes('canary'), line);
  assert.deepEqual(Object.keys(parse(line)), [
    'ts',
    'level',
    'event',
    'requestId',
    'profile',
    'route',
    'operation',
    'capability',
    'status',
    'code',
    'key',
    'digest',
  ]);
  assert.equal(parse(line).ts, '2026-01-02T03:04:05.000Z');
});

test('config.fatal adds where the finding is and its fixed text', () => {
  const fields = {
    file: 'portfolio.yml',
    document: 'portfolio',
    path: '/sections/2/title',
    line: 3,
    column: 9,
    stableId: 'essays',
    message: '/sections/2/title should be string, not number.',
    remediation: 'Change the value at this pointer to what the schema expects.',
  };
  const fatal = parse(logLine({ level: 'fatal', event: 'config.fatal', key: 'K', ...fields }, NOW));
  assert.deepEqual(fatal, {
    ts: fatal.ts,
    level: 'fatal',
    event: 'config.fatal',
    key: 'K',
    ...fields,
  });
  // Another event can't carry them.
  assert.deepEqual(
    Object.keys(parse(logLine({ level: 'error', event: 'feed.failed', ...fields }))),
    ['ts', 'level', 'event'],
  );
});

test('deployment.config adds the redacted summary, and only it does', () => {
  const summary = {
    origin: 'https://rowan.test',
    previewOrigin: null,
    proxyHops: 0,
    capabilities: [{ id: 'catalog.read', access: 'public' }],
    adapters: { catalog: 'documents' },
    secrets: { GITHUB_TOKEN: 'unset' },
  };
  const line = parse(
    logLine({ level: 'info', event: 'deployment.config', profile: 'read-only', ...summary }, NOW),
  );
  assert.deepEqual(line, {
    ts: line.ts,
    level: 'info',
    event: 'deployment.config',
    profile: 'read-only',
    ...summary,
  });
  assert.deepEqual(Object.keys(parse(logLine({ level: 'info', event: 'other', ...summary }))), [
    'ts',
    'level',
    'event',
  ]);
});

test("a preview grant's events add its ref, its session's, and a count, and no other event carries them (#7)", () => {
  const fields = { grantRef: '0123abcd', sessionRef: '89abcdef', count: 2 };
  for (const event of [
    'preview.grant.minted',
    'preview.grant.superseded',
    'preview.grant.session_ended',
    'preview.grant.mark_failed',
    'preview.grant.read_failed',
    'preview.render_failed',
  ]) {
    const line = parse(
      logLine({ level: 'info', event, ...fields, token: 'canary-token', url: '/preview/x' }, NOW),
    );
    assert.deepEqual(line, { ts: line.ts, level: 'info', event, ...fields }, event);
  }
  assert.deepEqual(Object.keys(parse(logLine({ level: 'info', event: 'other', ...fields }))), [
    'ts',
    'level',
    'event',
  ]);
});

test('store.source.drift adds the two sourceHashes, and only it does', () => {
  const hashes = {
    mountedSourceHash: `sha256:${'a'.repeat(64)}`,
    importedSourceHash: `sha256:${'b'.repeat(64)}`,
  };
  const line = parse(
    logLine(
      { level: 'warn', event: 'store.source.drift', ...hashes, sourceDir: '/srv/portfolio' },
      NOW,
    ),
  );
  assert.deepEqual(line, { ts: line.ts, level: 'warn', event: 'store.source.drift', ...hashes });
  assert.deepEqual(
    Object.keys(parse(logLine({ level: 'info', event: 'store.import.first_start', ...hashes }))),
    ['ts', 'level', 'event'],
  );
});

test('an empty field is left out', () => {
  assert.deepEqual(
    Object.keys(parse(logLine({ level: 'warn', event: 'x', requestId: undefined, code: 'c' }))),
    ['ts', 'level', 'event', 'code'],
  );
});

test('log() writes one line to stdout', (t) => {
  const written = t.mock.method(console, 'log', () => {});
  log({ level: 'info', event: 'probe', code: 'c', secret: 'canary' });
  assert.equal(written.mock.callCount(), 1);
  const line = String(written.mock.calls[0]!.arguments[0]);
  assert.ok(!line.includes('\n') && !line.includes('canary'), line);
  assert.equal(parse(line).event, 'probe');
});
