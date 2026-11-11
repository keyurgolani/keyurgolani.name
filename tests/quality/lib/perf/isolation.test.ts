// A perf test runs alone on its runner (rc.2, 2026-11-10): its TBT, read at the lab's 4x CPU
// throttle, is the page's own only while nothing else runs beside it. On CI a quality shard runs
// two workers, and preflight 42801199348's raw-grid perf test ran beside the other worker's visual
// screenshots, reading 234 ms where rc.1's, beside light cells, read 132 (and 19-24 ms either way
// on a quiet machine). These pin the lock that keeps them apart.
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const load = () => import('./isolation');
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('a perf test holds the lock alone, and every other quality test shares it', async () => {
  const { isolationFor } = await load();
  assert.equal(isolationFor('/repo/tests/quality/perf.spec.ts'), 'exclusive');
  assert.equal(isolationFor('/repo/tests/quality/cells.spec.ts'), 'shared');
  assert.equal(isolationFor('/repo/tests/quality/visual.spec.ts'), 'shared');
  assert.equal(isolationFor('/repo/tests/quality/harness.spec.ts'), 'shared');
});

test('the exclusive holder waits for a shared one in flight, and a shared one waits for it', async (t) => {
  const { isolationLock } = await load();
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-isolation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lock = isolationLock(dir, { pollMs: 5 });
  const order: string[] = [];
  const cell = await lock.acquire('worker-1', 'shared');
  order.push('cell starts');
  const perf = lock.acquire('worker-2', 'exclusive').then((release) => {
    order.push('perf starts');
    return release;
  });
  await tick(40);
  // The perf test hasn't started while the cell runs.
  assert.deepEqual(order, ['cell starts']);
  // A cell asking after the perf test waits for it: the writer goes first.
  const next = lock.acquire('worker-1', 'shared').then((release) => {
    order.push('next cell starts');
    return release;
  });
  order.push('cell ends');
  cell();
  const releasePerf = await perf;
  await tick(40);
  assert.deepEqual(order, ['cell starts', 'cell ends', 'perf starts']);
  order.push('perf ends');
  releasePerf();
  (await next)();
  assert.deepEqual(order, [
    'cell starts',
    'cell ends',
    'perf starts',
    'perf ends',
    'next cell starts',
  ]);
});

test('two perf tests never run at once, and shared holders run together', async (t) => {
  const { isolationLock } = await load();
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-isolation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lock = isolationLock(dir, { pollMs: 5 });
  const a = await lock.acquire('worker-1', 'shared');
  // A second shared holder doesn't wait for the first.
  const b = await Promise.race([lock.acquire('worker-2', 'shared'), tick(200).then(() => null)]);
  assert.ok(b, 'two cells share the lock');
  a();
  b!();
  const first = await lock.acquire('worker-1', 'exclusive');
  let second = false;
  const waiting = lock.acquire('worker-2', 'exclusive').then((release) => {
    second = true;
    return release;
  });
  await tick(40);
  assert.equal(second, false, "the second perf test waits for the first's release");
  first();
  (await waiting)();
  assert.equal(second, true);
});

test("a holder whose process has gone is stale, so a crashed worker can't hold the lock", async (t) => {
  const { isolationLock } = await load();
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-isolation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // A pid no process has: the kernel's maximum is far below it.
  const gone = 2 ** 30;
  mkdirSync(path.join(dir, 'shared'), { recursive: true });
  writeFileSync(path.join(dir, 'shared', 'worker-9'), String(gone));
  writeFileSync(path.join(dir, 'exclusive'), String(gone));
  const lock = isolationLock(dir, { pollMs: 5 });
  const release = await Promise.race([
    lock.acquire('worker-1', 'exclusive'),
    tick(500).then(() => null),
  ]);
  assert.ok(release, 'the stale holders are passed over');
  release!();
});

test("the quality fixtures take the lock: every test by its file's isolation, and a worker's server start shared", async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../fixtures.ts', import.meta.url), 'utf8');
  // An auto test fixture, so no test runs outside it.
  assert.match(
    source,
    /isolation: \[\s*async \(\{\}, provide, testInfo\) =>[\s\S]*?isolationFor\(testInfo\.file\)[\s\S]*?\{ auto: true \}/,
  );
  // The wait gets room up to the ceiling, then the test's timeout grows by exactly the wait, which it
  // records, so a test body's own timeout (setOwnTimeout) adds it back.
  assert.match(
    source,
    /testInfo\.setTimeout\(own \+ MAX_WAIT_MS\)[\s\S]*?const waited = Date\.now\(\) - asked;[\s\S]*?recordIsolationWait\(testInfo, waited\);[\s\S]*?testInfo\.setTimeout\(own \+ waited\)/,
  );
  // The app's start, a build-sized burst of CPU, is shared too, so no server boots beside a perf test.
  assert.match(
    source,
    /app: \[[\s\S]*?runIsolation\(\)\.acquire\([^)]*'shared',?\s*\)[\s\S]*?startApp\(/,
  );
});

test('writers go first: a shared asker arriving while a perf test waits blocks until it has run', async (t) => {
  const { isolationLock } = await load();
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-isolation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lock = isolationLock(dir, { pollMs: 5 });
  // Worker 1 is mid-cell; worker 2's perf test asks and waits for it.
  const cell = await lock.acquire('worker-1', 'shared');
  let perfRan = false;
  const perf = lock.acquire('worker-2', 'exclusive').then((release) => {
    perfRan = true;
    return release;
  });
  await tick(30);
  // Worker 1 ends its cell and asks for its next one back to back: it mustn't slip in first.
  cell();
  let nextRan = false;
  const next = lock.acquire('worker-1', 'shared').then((release) => {
    assert.equal(perfRan, true, 'the next cell started before the waiting perf test');
    nextRan = true;
    return release;
  });
  const releasePerf = await perf;
  await tick(30);
  assert.equal(nextRan, false, 'the next cell runs beside the perf test');
  releasePerf();
  (await next)();
  assert.equal(nextRan, true);
});

test("an entry whose heartbeat has stopped is stale, even when its pid is some live process's", async (t) => {
  const { isolationLock } = await load();
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-isolation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'shared'), { recursive: true });
  // This process is live, as a reused pid would be, but the entry hasn't been touched in a minute.
  const entry = path.join(dir, 'shared', 'worker-9');
  writeFileSync(entry, String(process.pid));
  const old = new Date(Date.now() - 60_000);
  utimesSync(entry, old, old);
  const lock = isolationLock(dir, { pollMs: 5, staleMs: 1_000 });
  const release = await Promise.race([
    lock.acquire('worker-1', 'exclusive'),
    tick(500).then(() => null),
  ]);
  assert.ok(release, 'the silent entry is passed over');
  release!();
});

test('a held entry keeps its heartbeat, so a long perf test is never taken for stale', async (t) => {
  const { isolationLock } = await load();
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-isolation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lock = isolationLock(dir, { pollMs: 5, heartbeatMs: 20, staleMs: 100 });
  const perf = await lock.acquire('worker-1', 'exclusive');
  // Several stale windows later, the holder's heartbeat still keeps a cell out.
  const cell = await Promise.race([lock.acquire('worker-2', 'shared'), tick(400).then(() => null)]);
  assert.equal(cell, null, 'a cell ran beside a held perf test');
  perf();
});

test('a wait has a ceiling: past it the asker fails loudly, and leaves nothing that holds the lock', async (t) => {
  const { isolationLock } = await load();
  const dir = mkdtempSync(path.join(tmpdir(), 'quality-isolation-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lock = isolationLock(dir, { pollMs: 5 });
  const cell = await lock.acquire('worker-1', 'shared');
  await assert.rejects(
    lock.acquire('worker-2', 'exclusive', 60),
    /worker-2 waited 0 s for the perf isolation lock's exclusive side, its ceiling/,
  );
  // The failed asker's claim is gone: the next cell starts at once.
  const next = await Promise.race([lock.acquire('worker-3', 'shared'), tick(200).then(() => null)]);
  assert.ok(next, "a failed asker's claim still held the lock");
  next!();
  cell();
  const perf = await lock.acquire('worker-2', 'exclusive');
  await assert.rejects(lock.acquire('worker-1', 'shared', 60), /its ceiling/);
  perf();
});

test("a test body's own timeout adds the time its test waited for the lock, and one that waited nothing keeps exactly its own", async () => {
  const { recordIsolationWait, setOwnTimeout } = await load();
  const set: number[] = [];
  const waited = { setTimeout: (ms: number) => void set.push(ms) };
  recordIsolationWait(waited, 90_000);
  setOwnTimeout(waited, 120_000);
  const none = { setTimeout: (ms: number) => void set.push(ms) };
  setOwnTimeout(none, 120_000);
  const zero = { setTimeout: (ms: number) => void set.push(ms) };
  recordIsolationWait(zero, 0);
  setOwnTimeout(zero, 330_000);
  assert.deepEqual(set, [210_000, 120_000, 330_000]);
});

// Push B's CI (42951677137): runCell's absolute setTimeout replaced the fixture's extension, so a cell
// that waited for a perf test timed out at exactly 240,000 ms. perf.spec's two tests did the same.
test('no test body under tests/quality sets an absolute timeout: each goes through setOwnTimeout, so the lock wait stays on top', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
  const own = new Set([
    path.join(root, 'fixtures.ts'),
    path.join(root, 'lib', 'perf', 'isolation.ts'),
  ]);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const at = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(at);
      else if (
        /\.(ts|mts|mjs|js)$/.test(entry.name) &&
        !/\.test\./.test(entry.name) &&
        !own.has(at)
      )
        files.push(at);
    }
  };
  walk(root);
  const absolute: string[] = [];
  for (const file of files) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, at) => {
        if (/\b(?:testInfo|test|info\(\))\.setTimeout\(/.test(line))
          absolute.push(`${path.relative(root, file)}:${at + 1}`);
      });
  }
  assert.ok(files.length > 50, `walked ${files.length} files`);
  assert.deepEqual(absolute, []);
});
