import test from 'node:test';
import assert from 'node:assert/strict';
import {
  importFiles,
  importTimeout,
  isResult,
  IMPORT_MAX_BYTES,
  IMPORT_TIMEOUT_MS,
  IMPORT_TIMEOUT_RANGE_MS,
} from './index';
import {
  importMessage,
  IMPORT_MAX_BYTES as PIPELINE_MAX_BYTES,
  type ImportInput,
} from './pipeline';
import { CANARY, EXAMPLE, pairFiles } from './test-support/hostile';

// The main-thread API's worker wiring (#9, PR 3), with a fake Worker: one
// worker per import, built as a module worker from import.worker.ts, and
// terminated however the import ends. A worker that can't be built, fails,
// or answers out of shape is worker_unavailable, a timeout or an abort is
// timeout, and nothing ever parses on this thread instead.

type Behavior = 'answer' | 'silent' | 'error' | 'malformed' | 'post-throws' | 'reply';

class FakeWorker {
  static behavior: Behavior = 'answer';
  static built: FakeWorker[] = [];
  /** What the worker answers with under `reply`. */
  static reply: unknown;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: unknown[] = [];
  readonly transferred: unknown[][] = [];
  terminated = 0;
  errorPrevented = false;

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.built.push(this);
  }

  postMessage(message: unknown, transfer: Transferable[] = []) {
    if (this.terminated) throw new Error('posted to a terminated worker');
    // As a browser posts it: cloned, with the transfer list moved, so a
    // transferred buffer is detached on this side.
    const data = structuredClone(message, { transfer });
    this.posted.push(data);
    this.transferred.push(transfer);
    const behavior = FakeWorker.behavior;
    if (behavior === 'post-throws') throw new Error(`DataCloneError ${CANARY}`);
    queueMicrotask(() => {
      if (this.terminated) return;
      if (behavior === 'answer') this.onmessage?.({ data: importMessage(data) });
      if (behavior === 'reply') this.onmessage?.({ data: FakeWorker.reply });
      if (behavior === 'malformed') this.onmessage?.({ data: { kind: 'imported', unit: null } });
      if (behavior === 'error') {
        this.onerror?.({
          preventDefault: () => {
            this.errorPrevented = true;
          },
        });
      }
    });
  }

  terminate() {
    this.terminated++;
  }
}

function useWorker(t: test.TestContext, worker: unknown) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', {
    value: worker,
    configurable: true,
    writable: true,
  });
  FakeWorker.built = [];
  FakeWorker.behavior = 'answer';
  t.after(() => {
    if (had) Object.defineProperty(globalThis, 'Worker', had);
    else delete (globalThis as { Worker?: unknown }).Worker;
  });
}

const files = pairFiles(EXAMPLE.portfolio);

test('an import runs in one module worker built from import.worker.ts, which is terminated once it answers', async (t) => {
  useWorker(t, FakeWorker);
  const result = await importFiles(files);
  assert.equal(result.kind, 'imported');
  const [worker] = FakeWorker.built;
  assert.equal(FakeWorker.built.length, 1);
  assert.match(worker!.url.href, /\/lib\/demo\/import\/import\.worker\.ts$/);
  assert.deepEqual(worker!.options, { type: 'module' });
  // A copy of each file, transferred, never the caller's own buffers.
  assert.deepEqual(worker!.posted, [{ files }]);
  assert.equal(worker!.transferred[0]!.length, files.length);
  for (const buffer of worker!.transferred[0]!) {
    assert.equal((buffer as ArrayBuffer).byteLength, 0, 'the copy moved to the worker');
  }
  for (const { bytes } of files) assert.ok(bytes.byteLength > 0, "the caller's bytes stay");
  assert.equal(worker!.terminated, 1);
  assert.equal(IMPORT_TIMEOUT_MS, 5000);
});

test('the count and each byteLength are checked here before anything is copied, and the worker gets only each file its own bytes', async (t) => {
  useWorker(t, FakeWorker);
  const [portfolio, site] = files as [ImportInput, ImportInput];
  const none = { kind: 'refused', diagnostics: [] };
  assert.deepEqual(await importFiles([portfolio, site, site]), { ...none, code: 'too_many_files' });
  assert.deepEqual(await importFiles([portfolio]), { ...none, code: 'not_one_document' });
  const huge = { name: 'x', bytes: new Uint8Array(IMPORT_MAX_BYTES + 1) };
  assert.deepEqual(await importFiles([portfolio, huge]), { ...none, code: 'too_large' });
  assert.equal(FakeWorker.built.length, 0);
  assert.equal(IMPORT_MAX_BYTES, PIPELINE_MAX_BYTES);

  // A small view of a big buffer: the worker gets the view's bytes alone.
  const big = new Uint8Array(4 * IMPORT_MAX_BYTES);
  big.set(site.bytes, 1000);
  const view = { name: 'site', bytes: big.subarray(1000, 1000 + site.bytes.byteLength) };
  assert.equal((await importFiles([portfolio, view])).kind, 'imported');
  const sent = (FakeWorker.built[0]!.posted[0] as { files: ImportInput[] }).files;
  assert.equal(sent[1]!.bytes.buffer.byteLength, site.bytes.byteLength);
});

test("a Node Buffer's bytes are copied into a buffer of their own, so the caller's pooled memory is never detached", async (t) => {
  useWorker(t, FakeWorker);
  const [portfolio, site] = files as [ImportInput, ImportInput];
  // Two Buffers on one ArrayBuffer, as Node's pool or a polyfill lays them out.
  const memory = new ArrayBuffer(portfolio.bytes.byteLength + site.bytes.byteLength);
  const pooled = [
    Buffer.from(memory, 0, portfolio.bytes.byteLength),
    Buffer.from(memory, portfolio.bytes.byteLength, site.bytes.byteLength),
  ];
  pooled[0]!.set(portfolio.bytes);
  pooled[1]!.set(site.bytes);
  assert.equal(pooled[0]!.buffer, pooled[1]!.buffer);
  // A Buffer's own slice shares that memory.
  assert.equal(pooled[0]!.slice().buffer, memory);
  const result = await importFiles([
    { name: 'a', bytes: pooled[0]! },
    { name: 'b', bytes: pooled[1]! },
  ]);
  assert.equal(result.kind, 'imported');
  for (const buffer of pooled) {
    assert.ok(buffer.buffer.byteLength > 0, 'the pool is still attached');
    assert.equal(buffer.toString('utf8').length > 0, true);
  }
  assert.deepEqual(Buffer.from(pooled[1]!), Buffer.from(site.bytes));
});

test('an entry out of shape refuses as invalid, never throws, and builds no worker', async (t) => {
  useWorker(t, FakeWorker);
  const [portfolio] = files as [ImportInput];
  const malformed: unknown[] = [
    [portfolio, null],
    [portfolio, undefined],
    [portfolio, { bytes: portfolio.bytes }],
    [portfolio, { name: 42, bytes: portfolio.bytes }],
    [portfolio, { name: 'x', bytes: [1, 2, 3] }],
    [portfolio, { name: 'x', bytes: new ArrayBuffer(4) }],
    [portfolio, { name: 'x', bytes: 'text' }],
    [portfolio, { name: 'x' }],
    [portfolio, 'text'],
    null,
    'files',
  ];
  for (const entries of malformed) {
    const pending = importFiles(entries as ImportInput[]);
    assert.ok(pending instanceof Promise, JSON.stringify(entries));
    assert.deepEqual(
      await pending,
      { kind: 'refused', code: 'invalid', diagnostics: [] },
      JSON.stringify(entries),
    );
  }
  assert.equal(FakeWorker.built.length, 0);
});

test('a reply out of ImportResult shape in any part is worker_unavailable', async (t) => {
  useWorker(t, FakeWorker);
  const good = importMessage({ files });
  assert.equal(good.kind, 'imported');
  const unit = (good as { unit: Record<string, unknown> }).unit;
  const replies: Record<string, unknown> = {
    'an unknown refusal code': { kind: 'refused', code: CANARY, diagnostics: [] },
    'a refusal with no diagnostics': { kind: 'refused', code: 'invalid' },
    'a refusal with a diagnostic out of shape': {
      kind: 'refused',
      code: 'invalid',
      diagnostics: [{ code: 'x' }],
    },
    'an import with no diagnostics': { ...good, diagnostics: undefined },
    'an import with an empty unit': { ...good, unit: {} },
    'an import with a source out of shape': {
      ...good,
      unit: { ...unit, sources: { portfolio: { text: 1 }, site: {} } },
    },
    'an import with no schema versions': { ...good, unit: { ...unit, schemaVersions: {} } },
    'an import with a remote media entry of another kind': {
      ...good,
      remoteImages: [{ document: 'portfolio', kind: 'font', pointer: '/media/0', host: 'x' }],
    },
    'an import with unchecked entries that are not strings': { ...good, unchecked: [1] },
    'another kind': { kind: 'other', diagnostics: [] },
  };
  FakeWorker.behavior = 'reply';
  for (const [name, reply] of Object.entries(replies)) {
    FakeWorker.reply = reply;
    assert.deepEqual(
      await importFiles(files),
      { kind: 'refused', code: 'worker_unavailable', diagnostics: [] },
      name,
    );
  }
  FakeWorker.reply = good;
  assert.deepEqual(await importFiles(files), good);
  assert.equal(isResult(good), true);
});

test('timeoutMs is 5 seconds when absent and held between 1 and 30 seconds', () => {
  assert.equal(importTimeout(undefined), 5000);
  assert.equal(importTimeout(Number.NaN), 5000);
  assert.equal(importTimeout(2500), 2500);
  assert.equal(importTimeout(10), 1000);
  assert.equal(importTimeout(-5), 1000);
  assert.equal(importTimeout(2 ** 31 - 1), 30_000);
  assert.equal(importTimeout(Number.POSITIVE_INFINITY), 30_000);
  assert.deepEqual(IMPORT_TIMEOUT_RANGE_MS, { min: 1000, max: 30_000 });
});

test('a Worker that throws on construction, or none at all, is worker_unavailable, and nothing parses on this thread', async (t) => {
  useWorker(t, function Blocked() {
    throw new Error(`blocked by policy ${CANARY}`);
  });
  assert.deepEqual(await importFiles(files), {
    kind: 'refused',
    code: 'worker_unavailable',
    diagnostics: [],
  });
  (globalThis as { Worker?: unknown }).Worker = undefined;
  assert.deepEqual(await importFiles(files), {
    kind: 'refused',
    code: 'worker_unavailable',
    diagnostics: [],
  });
});

test('a worker that fails, answers out of shape, or cannot be posted to is worker_unavailable and terminated', async (t) => {
  useWorker(t, FakeWorker);
  for (const behavior of ['error', 'malformed', 'post-throws'] as const) {
    FakeWorker.behavior = behavior;
    FakeWorker.built = [];
    const result = await importFiles(files);
    assert.deepEqual(
      result,
      { kind: 'refused', code: 'worker_unavailable', diagnostics: [] },
      behavior,
    );
    assert.equal(FakeWorker.built[0]!.terminated, 1, behavior);
    assert.equal(JSON.stringify(result).includes(CANARY), false, behavior);
  }
  FakeWorker.behavior = 'error';
  FakeWorker.built = [];
  await importFiles(files);
  assert.equal(FakeWorker.built[0]!.errorPrevented, true);
});

test('a worker that never answers is terminated and refused with timeout, after timeoutMs or 5 seconds', async (t) => {
  useWorker(t, FakeWorker);
  FakeWorker.behavior = 'silent';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timedOut = { kind: 'refused', code: 'timeout', diagnostics: [] };
  const runFor = async (options: { timeoutMs?: number }, fires: number) => {
    FakeWorker.built = [];
    let settled: unknown;
    void importFiles(files, options).then((result) => (settled = result));
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(fires - 1);
    await flush();
    assert.equal(settled, undefined, JSON.stringify(options));
    assert.equal(FakeWorker.built[0]!.terminated, 0);
    t.mock.timers.tick(1);
    await flush();
    assert.deepEqual(settled, timedOut, JSON.stringify(options));
    assert.equal(FakeWorker.built[0]!.terminated, 1);
  };
  // A short timeout fires well before the default, and the default at 5 seconds.
  await runFor({ timeoutMs: 1200 }, 1200);
  await runFor({}, IMPORT_TIMEOUT_MS);
  // Held to the range: 10 ms is a second, and a day is 30 seconds.
  await runFor({ timeoutMs: 10 }, 1000);
  await runFor({ timeoutMs: 86_400_000 }, 30_000);
  t.mock.timers.reset();
});

test('an abort terminates the worker and refuses with timeout, and an aborted signal builds none', async (t) => {
  useWorker(t, FakeWorker);
  FakeWorker.behavior = 'silent';
  // The clock stands still, so only the abort can end the import.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let settled: unknown;
  void importFiles(files, { signal: controller.signal }).then((result) => (settled = result));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, undefined);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(settled, { kind: 'refused', code: 'timeout', diagnostics: [] });
  assert.equal(FakeWorker.built[0]!.terminated, 1);
  t.mock.timers.reset();

  FakeWorker.built = [];
  assert.deepEqual(await importFiles(files, { signal: AbortSignal.abort() }), {
    kind: 'refused',
    code: 'timeout',
    diagnostics: [],
  });
  assert.equal(FakeWorker.built.length, 0);
});

test('a late answer after a timeout changes nothing, and the worker is terminated once', async (t) => {
  useWorker(t, FakeWorker);
  FakeWorker.behavior = 'silent';
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = importFiles(files, { timeoutMs: 1000 });
  t.mock.timers.tick(1000);
  const result = await pending;
  t.mock.timers.reset();
  assert.equal(result.kind, 'refused');
  const [worker] = FakeWorker.built;
  assert.equal(worker!.onmessage, null);
  assert.equal(worker!.terminated, 1);
});
