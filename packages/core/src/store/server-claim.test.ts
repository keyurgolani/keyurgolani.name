import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { test } from 'node:test';
import { nodeFs } from './fs-port';
import { storePaths } from './layout';
import { processStartTime } from './lock';
import { preflight } from './preflight';
import { claimServer, SERVER_FRESH_MS } from './server-claim';
import { tempDir } from './test-support/fixtures';

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

test('the claim is rewritten on its interval, and release stops that', async (t) => {
  const paths = await pathsIn(t);
  const claimed = await claimServer({ fs: nodeFs, paths, refreshMs: 30 });
  if (!claimed.ok) return assert.fail();
  const first = claimed.claim.record.at;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.notEqual(JSON.parse(readFileSync(paths.server, 'utf8')).at, first);
  await claimed.claim.release();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(existsSync(paths.server), false);
});
