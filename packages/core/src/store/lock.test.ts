import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { StoreError } from './common';
import { nodeFs, type FsPort } from './fs-port';
import { storePaths, type StorePaths } from './layout';
import {
  LOCK_STALE_MS,
  LOCK_TOUCH_MS,
  LockLostError,
  processGone,
  publicationLock,
  thisProcess,
  type HeldLock,
} from './lock';
import { preflight } from './preflight';
import { tempDir } from './test-support/fixtures';

async function lockIn(t: { after(fn: () => void): void }, waitMs = 300) {
  const dataDir = tempDir(t);
  assert.equal(await preflight({ dataDir }), null);
  const paths = storePaths(dataDir);
  return { paths, lock: publicationLock({ fs: nodeFs, paths, waitMs }) };
}

/** The pid of a process that ran and is gone. */
function goneProcessPid(): number {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
    encoding: 'utf8',
  });
  return Number(child.stdout);
}

/** A lock whose holder's process is gone, as a CLI killed holding it leaves one. */
function staleLock(paths: StorePaths, pid = goneProcessPid()) {
  writeFileSync(
    paths.lock,
    JSON.stringify({
      pid,
      startTime: null,
      hostname: hostname(),
      holder: 'cli:backup',
      at: new Date().toISOString(),
    }),
  );
}

/**
 * The same data directory by another path, through a link. Locks over it
 * don't take turns with locks over the first, as another process's wouldn't.
 */
function anotherSpelling(t: TestContext, paths: StorePaths): StorePaths {
  const alias = path.join(tempDir(t, 'store-alias-'), 'data');
  symlinkSync(paths.root, alias);
  return storePaths(alias);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A body that counts how many bodies run at once. */
function counting() {
  let inside = 0;
  const seen = { most: 0 };
  const body = (ms: number) => async () => {
    inside += 1;
    seen.most = Math.max(seen.most, inside);
    await sleep(ms);
    inside -= 1;
  };
  return { seen, body };
}

const timedOut = (error: unknown) => (error as StoreError).code === 'lock_timeout';

test('the lock holds pid, process start time, hostname, holder, and time, at 0600, until it is released', async (t) => {
  const { paths, lock } = await lockIn(t);
  const held = await lock.acquire('publish');
  const record = JSON.parse(readFileSync(paths.lock, 'utf8'));
  assert.deepEqual(Object.keys(record).sort(), [
    'at',
    'holder',
    'hostname',
    'nonce',
    'pid',
    'startTime',
  ]);
  assert.equal(record.pid, process.pid);
  assert.equal(record.hostname, hostname());
  assert.equal(record.holder, 'publish');
  assert.equal(record.startTime, thisProcess().startTime);
  assert.notEqual(record.startTime, null);
  assert.equal(statSync(paths.lock).mode & 0o777, 0o600);
  assert.equal((await lock.holder())?.holder, 'publish');
  await held.release();
  assert.equal(await lock.holder(), null);
  // No temporary file is left beside it.
  assert.deepEqual(
    (await nodeFs.readdir(paths.publication)).filter((name) => name.endsWith('.tmp')),
    [],
  );
});

test('a waiter gives up after its wait with lock_timeout, and gets the lock once it is free', async (t) => {
  const { lock } = await lockIn(t, 200);
  const held = await lock.acquire('backup');
  const started = Date.now();
  await assert.rejects(lock.acquire('publish'), (error: unknown) => {
    assert.ok(error instanceof StoreError);
    assert.equal(error.code, 'lock_timeout');
    return true;
  });
  assert.ok(Date.now() - started >= 200);
  const waiting = lock.acquire('publish');
  setTimeout(() => void held.release(), 50);
  const next = await waiting;
  assert.equal(next.record.holder, 'publish');
  await next.release();
});

test('withLock releases the lock however its body ends', async (t) => {
  const { lock } = await lockIn(t);
  await assert.rejects(
    lock.withLock('publish', async () => {
      throw new Error('the body failed');
    }),
    /the body failed/,
  );
  assert.equal(await lock.holder(), null);
  assert.equal(await lock.withLock('publish', async () => 'done'), 'done');
  assert.equal(await lock.holder(), null);
});

test('a lock whose process is gone, or runs with another start time, is stale and taken', async (t) => {
  const { paths, lock } = await lockIn(t);
  const gone = goneProcessPid();
  assert.equal(processGone({ pid: gone, hostname: hostname(), startTime: null }), 'gone');
  writeFileSync(
    paths.lock,
    JSON.stringify({
      pid: gone,
      startTime: null,
      hostname: hostname(),
      holder: 'publish',
      at: new Date().toISOString(),
    }),
  );
  const taken = await lock.acquire('rollback');
  assert.equal(taken.record.holder, 'rollback');
  await taken.release();

  const restarted = { pid: process.pid, startTime: 'another start', hostname: hostname() };
  assert.equal(processGone(restarted), 'restarted');
  writeFileSync(
    paths.lock,
    JSON.stringify({ ...restarted, holder: 'publish', at: new Date().toISOString() }),
  );
  const again = await lock.acquire('rollback');
  assert.equal(again.record.pid, process.pid);
  assert.equal(again.record.startTime, thisProcess().startTime);
  await again.release();
});

test('a lock from a process it cannot check is stale once nobody touched it for 2 minutes', async (t) => {
  const { paths, lock } = await lockIn(t, 150);
  const elsewhere = {
    pid: 1,
    startTime: 'x',
    hostname: 'another-host',
    holder: 'publish',
    at: new Date().toISOString(),
  };
  writeFileSync(paths.lock, JSON.stringify(elsewhere));
  assert.equal(processGone(elsewhere), null);
  await assert.rejects(
    lock.acquire('rollback'),
    (error: unknown) => (error as StoreError).code === 'lock_timeout',
  );
  const old = (Date.now() - LOCK_STALE_MS - 5_000) / 1000;
  utimesSync(paths.lock, old, old);
  const taken = await lock.acquire('rollback');
  assert.equal(taken.record.holder, 'rollback');
  // Touching it is what keeps a long holder's lock from going stale.
  utimesSync(paths.lock, old, old);
  await taken.touch();
  assert.ok(Date.now() - statSync(paths.lock).mtimeMs < 60_000);
  await taken.release();
});

test("release leaves a lock that's someone else's now, and unlock --force clears any", async (t) => {
  const { paths, lock } = await lockIn(t);
  const held = await lock.acquire('publish');
  const other = {
    pid: 1,
    startTime: 'x',
    hostname: 'another-host',
    holder: 'cli:backup',
    at: new Date().toISOString(),
  };
  writeFileSync(paths.lock, JSON.stringify(other));
  await held.release();
  assert.equal((await lock.holder())?.holder, 'cli:backup');
  assert.equal(await lock.forceUnlock(), true);
  assert.equal(await lock.holder(), null);
  assert.equal(await lock.forceUnlock(), false);
});

test('a lock a failed release left is stale to its own process at once, and withLock still returns', async (t) => {
  const { paths } = await lockIn(t, 200);
  const failing: FsPort = {
    ...nodeFs,
    async remove(target, point) {
      if (point === 'lock.release') throw Object.assign(new Error('I/O error'), { code: 'EIO' });
      return nodeFs.remove(target, point);
    },
  };
  const logs: string[] = [];
  const lock = publicationLock({
    fs: failing,
    paths,
    waitMs: 200,
    log: (entry) => logs.push(entry.event),
  });
  assert.equal(await lock.withLock('publish', async () => 'committed'), 'committed');
  assert.deepEqual(logs, ['store.lock.release_failed']);
  assert.equal((await lock.holder())?.holder, 'publish');
  const next = await publicationLock({ fs: nodeFs, paths, waitMs: 200 }).acquire('rollback');
  assert.equal(next.record.holder, 'rollback');
  await next.release();
});

test('acquirers in one process take turns in the order they asked, and only the one whose turn it is tries the lock file', async (t) => {
  const dataDir = tempDir(t);
  assert.equal(await preflight({ dataDir }), null);
  const paths = storePaths(dataDir);
  let links = 0;
  const counted: FsPort = {
    ...nodeFs,
    async link(existing, created, point) {
      if (point === 'lock.link') links += 1;
      return nodeFs.link(existing, created, point);
    },
  };
  const lock = publicationLock({ fs: counted, paths, waitMs: 5_000 });
  // Another lock over the same directory shares the turns.
  const same = publicationLock({ fs: counted, paths: storePaths(dataDir), waitMs: 5_000 });
  const order: string[] = [];
  const body = (name: string) => async () => {
    order.push(name);
    await sleep(15);
  };
  await Promise.all([
    lock.withLock('a', body('a')),
    same.withLock('b', body('b')),
    lock.withLock('c', body('c')),
    same.withLock('d', body('d')),
  ]);
  assert.deepEqual(order, ['a', 'b', 'c', 'd']);
  assert.equal(links, 4);
  // A turn that doesn't come in time is lock_timeout, and leaves the line.
  const slow = publicationLock({ fs: nodeFs, paths, waitMs: 100 });
  const held = await lock.acquire('backup');
  await assert.rejects(slow.acquire('publish'), timedOut);
  await held.release();
  const next = await slow.acquire('publish');
  await next.release();
});

test('six acquirers in one process meeting a stale lock never hold it at once', async (t) => {
  const { paths } = await lockIn(t);
  const lock = publicationLock({ fs: nodeFs, paths, waitMs: 5_000 });
  const gone = goneProcessPid();
  // Before acquirers took turns, about one trial in six let two bodies run.
  for (let trial = 0; trial < 30; trial++) {
    staleLock(paths, gone);
    const { seen, body } = counting();
    await Promise.all(Array.from({ length: 6 }, (_, at) => lock.withLock(`c${at}`, body(15))));
    assert.equal(seen.most, 1, `trial ${trial}`);
  }
});

test('a breaker that finds a live lock where the stale one was puts it back, and waits for it', async (t) => {
  const { paths } = await lockIn(t);
  const live = publicationLock({ fs: nodeFs, paths, waitMs: 1_000 });
  staleLock(paths);
  let taken: HeldLock | undefined;
  // After the breaker read the stale lock again under the marker, its holder
  // lets go and another process takes the lock, just before the breaker moves it.
  const meddling: FsPort = {
    ...nodeFs,
    async rename(from, to, point) {
      if (point === 'lock.break.rename' && !taken) {
        rmSync(paths.lock);
        taken = await live.acquire('publish');
      }
      return nodeFs.rename(from, to, point);
    },
  };
  const breaker = publicationLock({ fs: meddling, paths: anotherSpelling(t, paths), waitMs: 300 });
  await assert.rejects(breaker.acquire('rollback'), timedOut);
  assert.ok(taken);
  await live.fence();
  assert.equal((await live.holder())?.holder, 'publish');
  await taken.release();
  const next = await breaker.acquire('rollback');
  assert.equal(next.record.holder, 'rollback');
  await next.release();
});

test('a breaker that finds a live lock in place of the stale one once it holds the marker leaves it where it is', async (t) => {
  const { paths } = await lockIn(t);
  const live = publicationLock({ fs: nodeFs, paths, waitMs: 1_000 });
  const third = publicationLock({ fs: nodeFs, paths: anotherSpelling(t, paths), waitMs: 1_000 });
  staleLock(paths);
  let taken: HeldLock | undefined;
  let intruder: HeldLock | undefined;
  const meddling: FsPort = {
    ...nodeFs,
    async writeFile(file, data, point, options) {
      // The breaker found the lock stale. Before it holds the marker, another
      // process breaks the lock and takes it.
      if (point === 'lock.break.write' && !taken) {
        rmSync(paths.lock);
        taken = await live.acquire('publish');
      }
      return nodeFs.writeFile(file, data, point, options);
    },
    async rename(from, to, point) {
      await nodeFs.rename(from, to, point);
      // Had the breaker moved the live lock aside, a third acquirer would link into the gap.
      if (point === 'lock.break.rename') {
        intruder = await third.acquire('recover').catch(() => undefined);
      }
    },
  };
  const breaker = publicationLock({ fs: meddling, paths: anotherSpelling(t, paths), waitMs: 300 });
  await assert.rejects(breaker.acquire('rollback'), timedOut);
  assert.ok(taken);
  assert.equal(intruder, undefined);
  await live.fence();
  assert.equal((await live.holder())?.holder, 'publish');
  await taken.release();
});

test('of two breakers at once, one slow, and a third acquirer, only one holds the lock at a time', async (t) => {
  for (let round = 0; round < 3; round++) {
    const { paths } = await lockIn(t);
    staleLock(paths);
    // The slow breaker's move comes after the other has broken and retaken the
    // lock, and its look at what it moved takes a while: the window a third
    // acquirer used to link into.
    let slowAside = '';
    const slow: FsPort = {
      ...nodeFs,
      async rename(from, to, point) {
        if (point === 'lock.break.rename' && slowAside === '') {
          await sleep(30);
          slowAside = to;
        }
        return nodeFs.rename(from, to, point);
      },
      async stat(target) {
        if (target === slowAside) await sleep(40);
        return nodeFs.stat(target);
      },
    };
    const a = publicationLock({ fs: nodeFs, paths, waitMs: 5_000 });
    const b = publicationLock({ fs: slow, paths: anotherSpelling(t, paths), waitMs: 5_000 });
    const c = publicationLock({ fs: nodeFs, paths: anotherSpelling(t, paths), waitMs: 5_000 });
    const { seen, body } = counting();
    await Promise.all([
      a.withLock('A', body(100)),
      b.withLock('B', body(100)),
      sleep(45).then(() => c.withLock('C', body(100))),
    ]);
    assert.equal(seen.most, 1, `round ${round}`);
  }
});

test("a lock this process holds isn't stale to it under another spelling of the data directory", async (t) => {
  const { paths, lock } = await lockIn(t);
  const other = publicationLock({ fs: nodeFs, paths: anotherSpelling(t, paths), waitMs: 200 });
  const held = await lock.acquire('publish');
  await assert.rejects(other.acquire('rollback'), timedOut);
  await lock.fence();
  await held.release();
  const next = await other.acquire('rollback');
  await next.release();
});

test("fence() passes while the lock is its holder's, and throws LockLostError once it is anyone else's or released", async (t) => {
  const { paths, lock } = await lockIn(t);
  await assert.rejects(lock.fence(), LockLostError);
  const held = await lock.acquire('publish');
  await lock.fence();
  const theirs = {
    pid: 1,
    startTime: 'x',
    hostname: 'another-host',
    holder: 'cli:backup',
    at: new Date().toISOString(),
    nonce: 'theirs',
  };
  writeFileSync(paths.lock, JSON.stringify(theirs));
  await assert.rejects(lock.fence(), LockLostError);
  await held.release();
  assert.equal((await lock.holder())?.holder, 'cli:backup');
  rmSync(paths.lock);
  await assert.rejects(lock.fence(), LockLostError);
});

test('a holder that runs long touches the lock every 30 s', async (t) => {
  const { paths } = await lockIn(t);
  let touches = 0;
  const counted: FsPort = {
    ...nodeFs,
    async touch(file, point) {
      if (point === 'lock.touch') touches += 1;
      return nodeFs.touch(file, point);
    },
  };
  t.mock.timers.enable({ apis: ['setInterval'] });
  const lock = publicationLock({ fs: counted, paths, waitMs: 1_000 });
  await lock.withLock('cli:backup', async () => {
    t.mock.timers.tick(LOCK_TOUCH_MS - 1);
    await sleep(10);
    assert.equal(touches, 0);
    t.mock.timers.tick(1);
    await sleep(10);
    assert.equal(touches, 1);
    t.mock.timers.tick(2 * LOCK_TOUCH_MS);
    await sleep(10);
    assert.equal(touches, 3);
  });
  // Released, it stops.
  t.mock.timers.tick(LOCK_TOUCH_MS);
  await sleep(10);
  assert.equal(touches, 3);
});
