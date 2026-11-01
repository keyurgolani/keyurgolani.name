import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { probeDataDirectory } from '../data/layout.mjs';
import { preflight } from '../store/preflight';
import { auditRecord } from './record.mjs';
import {
  aggregateAnonymous,
  filesystemAuditSink,
  memoryAuditSink,
  type AuditEvent,
  type AuditSink,
} from './sink';

const AT = Date.UTC(2026, 9, 31, 23, 59, 30);

async function dataDir(t: TestContext): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'audit-'));
  t.after(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });
  // As owner startup does: the store's preflight makes audit/.
  assert.equal(await probeDataDirectory(dir), null);
  assert.equal(await preflight({ dataDir: dir }), null);
  return dir;
}

const lines = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));

test('an audit record keeps its envelope and only the refs it allows, so no forbidden field is written', () => {
  const canaries = {
    password: 'canary-password-value',
    hash: '$scrypt$ln=17,r=8,p=1$canary',
    cookie: '__Host-studio_session=canary-cookie',
    csrf: 'canary-csrf-token',
    ip: '203.0.113.77',
    agent: 'Mozilla/5.0 (canary agent)',
    body: '{"password":"canary-body"}',
  };
  const record = auditRecord({
    at: AT,
    type: 'login_failed',
    actor: 'anonymous',
    outcome: 'failure',
    refs: {
      // Each allowed ref, holding something it must not.
      sessionRef: canaries.cookie,
      source: canaries.ip,
      command: canaries.body,
      capability: canaries.hash,
      reason: canaries.password,
      requestId: canaries.agent,
      count: -1,
      // And refs that don't exist.
      password: canaries.password,
      cookie: canaries.cookie,
      csrfToken: canaries.csrf,
      userAgent: canaries.agent,
      body: canaries.body,
    },
  });
  assert.deepEqual(record, {
    at: '2026-10-31T23:59:30.000Z',
    type: 'login_failed',
    actor: 'anonymous',
    outcome: 'failure',
    refs: {},
  });
  const text = JSON.stringify(record);
  for (const canary of Object.values(canaries)) assert.ok(!text.includes(canary), canary);

  assert.deepEqual(
    auditRecord({
      at: AT,
      type: 'command_denied',
      actor: 'owner',
      outcome: 'denied',
      refs: {
        sessionRef: '0123abcd',
        source: '203.0.113.0/24',
        command: 'auth.sessions.revokeAll',
        capability: 'studio.view',
        reason: 'origin_mismatch',
        requestId: '0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
        count: 3,
      },
    }).refs,
    {
      sessionRef: '0123abcd',
      source: '203.0.113.0/24',
      command: 'auth.sessions.revokeAll',
      capability: 'studio.view',
      reason: 'origin_mismatch',
      requestId: '0f8e2c1a-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
      count: 3,
    },
  );
  // A reason that isn't one of the real codes, and a command outside the
  // sink's list, are left out.
  const shaped = auditRecord(
    {
      at: AT,
      type: 'command_denied',
      actor: 'anonymous',
      outcome: 'denied',
      refs: { command: 'auth.loginx', reason: 'made_up_reason' },
    },
    { commands: new Set(['auth.login']) },
  );
  assert.deepEqual(shaped.refs, {});
  for (const bad of [
    { type: 'login_maybe', actor: 'owner', outcome: 'success' },
    { type: 'logout', actor: 'admin', outcome: 'success' },
    { type: 'logout', actor: 'owner', outcome: 'partial' },
  ]) {
    assert.throws(
      () => auditRecord({ ...(bad as Parameters<typeof auditRecord>[0]), at: AT }),
      TypeError,
    );
  }
});

test('the filesystem sink appends one synced line to the month file, created 0600', async (t) => {
  const dir = await dataDir(t);
  let now = AT;
  const sink = filesystemAuditSink({ dataDir: dir, now: () => now });
  await sink.record({
    type: 'logout',
    actor: 'owner',
    outcome: 'success',
    refs: { sessionRef: '0123abcd' },
  });
  now += 60_000;
  await sink.record({ type: 'credential_changed', actor: 'operator', outcome: 'success' });
  await sink.record({ type: 'session_revoked', actor: 'owner', outcome: 'success', at: AT + 1 });
  assert.deepEqual(readdirSync(path.join(dir, 'audit')).sort(), ['2026-10.jsonl', '2026-11.jsonl']);
  const october = path.join(dir, 'audit', '2026-10.jsonl');
  assert.equal(statSync(october).mode & 0o777, 0o600);
  assert.deepEqual(lines(october), [
    {
      at: '2026-10-31T23:59:30.000Z',
      type: 'logout',
      actor: 'owner',
      outcome: 'success',
      refs: { sessionRef: '0123abcd' },
    },
    {
      at: '2026-10-31T23:59:30.001Z',
      type: 'session_revoked',
      actor: 'owner',
      outcome: 'success',
      refs: {},
    },
  ]);
  assert.deepEqual(lines(path.join(dir, 'audit', '2026-11.jsonl')), [
    {
      at: '2026-11-01T00:00:30.000Z',
      type: 'credential_changed',
      actor: 'operator',
      outcome: 'success',
      refs: {},
    },
  ]);
});

test('a failed audit write is logged and never throws', async (t) => {
  const dir = await dataDir(t);
  const logged: unknown[] = [];
  const sink = filesystemAuditSink({
    dataDir: dir,
    now: () => AT,
    log: (entry) => logged.push(entry),
  });
  rmSync(path.join(dir, 'audit'), { recursive: true });
  // Root can write anywhere, so the missing directory is what fails here.
  await sink.record({ type: 'logout', actor: 'owner', outcome: 'success' });
  assert.deepEqual(logged, [{ level: 'error', event: 'audit.write_failed', code: 'logout' }]);
});

test('the sink holds anonymous failures, throttled sign-ins, and denied commands to one record per minute after the first, with a count', async () => {
  let now = Date.UTC(2026, 9, 20, 10, 0, 5);
  const inner = memoryAuditSink(() => now);
  const timers: (() => void)[] = [];
  const sink = aggregateAnonymous(inner, {
    now: () => now,
    schedule: (run) => timers.push(run),
  });
  const failed = (source: string, requestId = 'req-each'): AuditEvent => ({
    type: 'login_failed',
    actor: 'anonymous',
    outcome: 'failure',
    refs: { source, requestId },
  });
  await sink.record(failed('203.0.113.0/24', 'req-first'));
  for (let index = 1; index < 40; index += 1) await sink.record(failed('203.0.113.0/24'));
  await sink.record(failed('198.51.100.0/24', 'req-other'));
  await sink.record({
    type: 'login_throttled',
    actor: 'anonymous',
    outcome: 'denied',
    refs: { source: '203.0.113.0/24', reason: 'source_blocked', requestId: 'req-throttled' },
  });
  // The owner's own events, and other types, are never held.
  await sink.record({ type: 'login_failed', actor: 'owner', outcome: 'failure' });
  await sink.record({ type: 'logout', actor: 'anonymous', outcome: 'success' });
  // The first of each minute is written at once, with its request ID.
  assert.deepEqual(
    inner.records.map(({ type, actor, refs }) => ({ type, actor, refs })),
    [
      {
        type: 'login_failed',
        actor: 'anonymous',
        refs: { source: '203.0.113.0/24', requestId: 'req-first', count: 1 },
      },
      {
        type: 'login_failed',
        actor: 'anonymous',
        refs: { source: '198.51.100.0/24', requestId: 'req-other', count: 1 },
      },
      {
        type: 'login_throttled',
        actor: 'anonymous',
        refs: {
          source: '203.0.113.0/24',
          reason: 'source_blocked',
          requestId: 'req-throttled',
          count: 1,
        },
      },
      { type: 'login_failed', actor: 'owner', refs: {} },
      { type: 'logout', actor: 'anonymous', refs: {} },
    ],
  );
  assert.equal(timers.length, 1, 'one write is scheduled for the end of the minute');
  // The minute ends: the 39 held come out as one record, without a request ID.
  now = Date.UTC(2026, 9, 20, 10, 1, 0, 50);
  timers.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    inner.records.slice(5).map(({ type, refs }) => ({ type, refs })),
    [{ type: 'login_failed', refs: { source: '203.0.113.0/24', count: 39 } }],
  );
  // A new minute starts with its first event written at once again.
  await sink.record(failed('203.0.113.0/24', 'req-next'));
  await sink.flush();
  assert.deepEqual(
    inner.records.slice(6).map(({ type, refs }) => ({ type, refs })),
    [
      {
        type: 'login_failed',
        refs: { source: '203.0.113.0/24', requestId: 'req-next', count: 1 },
      },
    ],
  );
});

test('an aggregated record keeps every ref but the request ID, and different reasons, commands, and sessions count apart', async () => {
  const now = Date.UTC(2026, 9, 20, 10, 0, 5);
  const inner = memoryAuditSink(() => now);
  const sink = aggregateAnonymous(inner, { now: () => now, schedule: () => {} });
  const denied = (refs: Record<string, string>): AuditEvent => ({
    type: 'command_denied',
    actor: 'anonymous',
    outcome: 'denied',
    refs: { source: '203.0.113.0/24', requestId: 'req-each', ...refs },
  });
  const kinds: Record<string, string>[] = [
    { command: 'auth.logout', reason: 'origin_mismatch' },
    { command: 'auth.logout', reason: 'csrf_missing' },
    { command: 'auth.sessions.revokeAll', reason: 'origin_mismatch' },
    { command: 'auth.logout', reason: 'origin_mismatch', sessionRef: '0123abcd' },
  ];
  for (const refs of kinds) {
    for (let index = 0; index < 3; index += 1) await sink.record(denied(refs));
  }
  await sink.flush();
  const held = inner.records.filter((record) => record.refs.count !== 1);
  assert.deepEqual(
    held.map((record) => record.refs),
    kinds.map((refs) => ({ source: '203.0.113.0/24', ...refs, count: 2 })),
  );
  // Every event is counted once: 4 written at once, and 4 records of 2.
  assert.equal(
    inner.records.reduce((sum, record) => sum + (record.refs.count ?? 0), 0),
    12,
  );
});

test('no count is lost at a minute boundary, even while the last minute is being written', async () => {
  let now = Date.UTC(2026, 9, 20, 10, 0, 5);
  const written: AuditEvent[] = [];
  // An inner sink that takes a while to write, as a synced file does.
  const slow = {
    async record(event: AuditEvent) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      written.push(event);
    },
    async flush() {},
  };
  const sink = aggregateAnonymous(slow, { now: () => now, schedule: () => {} });
  const failed: AuditEvent = {
    type: 'login_failed',
    actor: 'anonymous',
    outcome: 'failure',
    refs: { source: '203.0.113.0/24' },
  };
  for (let index = 0; index < 10; index += 1) await sink.record(failed);
  // The next minute: ten arrive together, while the first minute's record is written.
  now = Date.UTC(2026, 9, 20, 10, 1, 5);
  await Promise.all(Array.from({ length: 10 }, () => sink.record(failed)));
  await sink.flush();
  assert.equal(
    written.reduce((sum, event) => sum + Number(event.refs?.count ?? 0), 0),
    20,
  );
});

test("a minute's end racing the next minute's events writes each count once", async () => {
  let now = Date.UTC(2026, 9, 20, 10, 0, 5);
  const written: AuditEvent[] = [];
  // An inner sink whose writes wait while `hold` is set, as a slow disk's do.
  let hold: Promise<void> | null = null;
  const inner: AuditSink = {
    async record(event) {
      if (hold) await hold;
      written.push(event);
    },
    async flush() {},
  };
  const timers: (() => void)[] = [];
  const sink = aggregateAnonymous(inner, {
    now: () => now,
    schedule: (run) => timers.push(run),
  });
  const failed = (source: string): AuditEvent => ({
    type: 'login_failed',
    actor: 'anonymous',
    outcome: 'failure',
    refs: { source },
  });
  const sources = ['203.0.113.0/24', '198.51.100.0/24', '192.0.2.0/24'];
  for (const source of sources) {
    for (let index = 0; index < 5; index += 1) await sink.record(failed(source));
  }
  let release: () => void = () => {};
  hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The minute ends, and the first kind's count is being written...
  now = Date.UTC(2026, 9, 20, 10, 1, 0, 50);
  timers.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  // ...when two events of the next minute arrive for each kind.
  const next = sources.flatMap((source) => [
    sink.record(failed(source)),
    sink.record(failed(source)),
  ]);
  hold = null;
  release();
  await Promise.all(next);
  await sink.flush();
  const counted = (source: string) =>
    written
      .filter((event) => event.refs?.source === source)
      .reduce((sum, event) => sum + Number(event.refs?.count ?? 0), 0);
  assert.deepEqual(sources.map(counted), [7, 7, 7]);
});

test('the memory sink drops an event it cannot build, and never throws', async () => {
  const sink = memoryAuditSink();
  await sink.record({
    type: 'not_a_type',
    actor: 'owner',
    outcome: 'success',
  } as unknown as AuditEvent);
  assert.deepEqual(sink.records, []);
});
