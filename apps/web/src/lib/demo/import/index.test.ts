import test from 'node:test';
import assert from 'node:assert/strict';
import { importFiles, IMPORT_TIMEOUT_MS } from './index';
import { importMessage } from './pipeline';
import { CANARY, EXAMPLE, pairFiles } from './test-support/hostile';

// The main-thread API's worker wiring (#9, PR 3), with a fake Worker: one
// worker per import, built as a module worker from import.worker.ts, and
// terminated however the import ends. A worker that can't be built, fails,
// or answers out of shape is worker_unavailable, a timeout or an abort is
// timeout, and nothing ever parses on this thread instead.

type Behavior = 'answer' | 'silent' | 'error' | 'malformed' | 'post-throws';

class FakeWorker {
  static behavior: Behavior = 'answer';
  static built: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posted: unknown[] = [];
  terminated = 0;
  errorPrevented = false;

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.built.push(this);
  }

  postMessage(data: unknown) {
    if (this.terminated) throw new Error('posted to a terminated worker');
    this.posted.push(data);
    const behavior = FakeWorker.behavior;
    if (behavior === 'post-throws') throw new Error(`DataCloneError ${CANARY}`);
    queueMicrotask(() => {
      if (this.terminated) return;
      if (behavior === 'answer') this.onmessage?.({ data: importMessage(data) });
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
  assert.deepEqual(worker!.posted, [{ files }]);
  assert.equal(worker!.terminated, 1);
  assert.equal(IMPORT_TIMEOUT_MS, 5000);
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
  const started = Date.now();
  const result = await importFiles(files, { timeoutMs: 30 });
  assert.deepEqual(result, { kind: 'refused', code: 'timeout', diagnostics: [] });
  assert.ok(Date.now() - started >= 25);
  assert.equal(FakeWorker.built[0]!.terminated, 1);

  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeWorker.built = [];
  const pending = importFiles(files);
  t.mock.timers.tick(IMPORT_TIMEOUT_MS - 1);
  await Promise.resolve();
  assert.equal(FakeWorker.built[0]!.terminated, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(await pending, { kind: 'refused', code: 'timeout', diagnostics: [] });
  assert.equal(FakeWorker.built[0]!.terminated, 1);
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
  const result = await importFiles(files, { timeoutMs: 5 });
  assert.equal(result.kind, 'refused');
  const [worker] = FakeWorker.built;
  assert.equal(worker!.onmessage, null);
  assert.equal(worker!.terminated, 1);
});
