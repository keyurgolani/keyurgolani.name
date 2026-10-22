import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { test } from 'node:test';
import type { StoreError, StoreLogEntry } from './common';
import { nodeFs, type FsPort } from './fs-port';
import { storePaths } from './layout';
import { processStartTime } from './lock';
import { preflight } from './preflight';
import { claimServer, SERVER_FRESH_MS } from './server-claim';
import { newStore, pairInput, tempDir } from './test-support/fixtures';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function pathsIn(t: { after(fn: () => void): void }) {
  const dataDir = tempDir(t);
  assert.equal(await preflight({ dataDir }), null);
  return storePaths(dataDir);
}

/** Another running process, as a second server would be, ended when the test ends. */
function otherProcess(t: { after(fn: () => void): void }) {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], {
    stdio: 'ignore',
  });
  t.after(() => child.kill('SIGKILL'));
  return child;
}

test('a server claims the data directory in server.json, with its pid, start time, and hostname, and releases it', async (t) => {
  const paths = await pathsIn(t);
  const claimed = await claimServer({ fs: nodeFs, paths });
  assert.equal(claimed.ok, true);
  if (!claimed.ok) return;
  const record = JSON.parse(readFileSync(paths.server, 'utf8'));
  assert.equal(record.pid, process.pid);
  assert.equal(record.hostname, hostname());
  assert.equal(record.startTime, processStartTime(process.pid));
  await claimed.claim.release();
  assert.equal(existsSync(paths.server), false);
});

test('a second server refuses while the claim is under 45 s old and its process runs, and takes it otherwise', async (t) => {
  const paths = await pathsIn(t);
  const child = otherProcess(t);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const record = {
    pid: child.pid,
    startTime: processStartTime(child.pid!),
    hostname: hostname(),
    at: new Date().toISOString(),
  };
  writeFileSync(paths.server, JSON.stringify(record));
  const refused = await claimServer({ fs: nodeFs, paths });
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.code, 'data_dir_in_use');

  // The same process, but its claim is past 45 s: it stopped refreshing.
  const old = (Date.now() - SERVER_FRESH_MS - 5_000) / 1000;
  utimesSync(paths.server, old, old);
  const taken = await claimServer({ fs: nodeFs, paths });
  assert.equal(taken.ok, true);
  if (taken.ok) await taken.claim.release();

  // A fresh claim whose process is gone.
  const gone = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
    encoding: 'utf8',
  });
  writeFileSync(
    paths.server,
    JSON.stringify({ ...record, pid: Number(gone.stdout), startTime: null }),
  );
  const again = await claimServer({ fs: nodeFs, paths });
  assert.equal(again.ok, true);
  if (again.ok) await again.claim.release();
});

test('the claim is refreshed on its interval, its record left as it is, and release stops that', async (t) => {
  const paths = await pathsIn(t);
  const claimed = await claimServer({ fs: nodeFs, paths, refreshMs: 30 });
  if (!claimed.ok) return assert.fail();
  const written = readFileSync(paths.server, 'utf8');
  const old = (Date.now() - 60_000) / 1000;
  utimesSync(paths.server, old, old);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(Date.now() - statSync(paths.server).mtimeMs < SERVER_FRESH_MS);
  assert.equal(readFileSync(paths.server, 'utf8'), written);
  await claimed.claim.release();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(existsSync(paths.server), false);
});

test('a release during a refresh waits for it, and the file stays gone', async (t) => {
  const paths = await pathsIn(t);
  let renaming: () => void = () => {};
  const underWay = new Promise<void>((resolve) => {
    renaming = resolve;
  });
  let refreshes = 0;
  const slow: FsPort = {
    ...nodeFs,
    async touch(file, point) {
      if (point === 'server.refresh' && ++refreshes === 1) {
        renaming();
        await sleep(100);
      }
      return nodeFs.touch(file, point);
    },
  };
  const claimed = await claimServer({ fs: slow, paths, refreshMs: 20 });
  if (!claimed.ok) return assert.fail();
  // The claim's timer doesn't hold the process open, so a timer of the test's does.
  let guard: NodeJS.Timeout | undefined;
  await Promise.race([
    underWay,
    new Promise((resolve) => {
      guard = setTimeout(resolve, 5_000);
    }),
  ]);
  clearTimeout(guard);
  assert.equal(refreshes, 1);
  const releasing = Date.now();
  await claimed.claim.release();
  // It waited for the refresh under way, and no other one started meanwhile.
  assert.ok(Date.now() - releasing >= 80);
  assert.equal(refreshes, 1);
  assert.equal(existsSync(paths.server), false);
  await sleep(150);
  assert.equal(existsSync(paths.server), false);
  assert.equal(refreshes, 1);
});

test('a claim another server took over is lost at its next refresh: it stops, and its locks refuse every write', async (t) => {
  const store = await newStore(t);
  const logs: StoreLogEntry[] = [];
  const claimed = await claimServer({
    paths: store.paths,
    lock: store.lock,
    refreshMs: 20,
    log: (entry) => logs.push(entry),
  });
  if (!claimed.ok) return assert.fail();
  const child = otherProcess(t);
  await sleep(100);
  // Another server's claim, as one that found this one's old enough writes it.
  const theirs = {
    pid: child.pid,
    startTime: processStartTime(child.pid!),
    hostname: hostname(),
    at: new Date().toISOString(),
    nonce: 'theirs',
  };
  writeFileSync(store.paths.server, JSON.stringify(theirs));
  await sleep(100);
  assert.equal(claimed.claim.lost, true);
  assert.deepEqual(
    logs.map((entry) => [entry.level, entry.event]),
    [['error', 'store.server.claim_lost']],
  );
  // It stopped refreshing, so the other server's claim stands.
  assert.equal(JSON.parse(readFileSync(store.paths.server, 'utf8')).nonce, 'theirs');
  const refused = (error: unknown) => (error as StoreError).code === 'storage_unavailable';
  await assert.rejects(store.lock.acquire('publish'), refused);
  await assert.rejects(
    store.drafts.create({ documents: pairInput('engineering') }, 'owner'),
    refused,
  );
  // Released, it leaves the other server's file alone.
  await claimed.claim.release();
  assert.equal(JSON.parse(readFileSync(store.paths.server, 'utf8')).nonce, 'theirs');
});

test("a server knows its claim by its nonce: release leaves a claim in its own pid's name that isn't this one", async (t) => {
  const paths = await pathsIn(t);
  const claimed = await claimServer({ paths });
  if (!claimed.ok) return assert.fail();
  const mine = JSON.parse(readFileSync(paths.server, 'utf8'));
  assert.equal(mine.nonce, claimed.claim.record.nonce);
  writeFileSync(paths.server, JSON.stringify({ ...mine, nonce: 'another-claim' }));
  await claimed.claim.release();
  assert.equal(JSON.parse(readFileSync(paths.server, 'utf8')).nonce, 'another-claim');
  // The same pid restarted is another process: its old claim doesn't stop it.
  writeFileSync(
    paths.server,
    JSON.stringify({ ...mine, startTime: 'an earlier start', at: new Date().toISOString() }),
  );
  const again = await claimServer({ paths });
  assert.equal(again.ok, true);
  if (again.ok) await again.claim.release();
});
