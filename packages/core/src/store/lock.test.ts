import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { test } from 'node:test';
import { StoreError } from './common';
import { nodeFs, type FsPort } from './fs-port';
import { storePaths } from './layout';
import { LOCK_STALE_MS, processGone, publicationLock, thisProcess } from './lock';
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
