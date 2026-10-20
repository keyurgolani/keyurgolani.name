import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { authPaths, prepareAuthDirectories, writePrivateFile } from './layout.mjs';

function scratch(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'layout-'));
  t.after(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

const mode = (file: string) => statSync(file).mode & 0o777;

test('owner startup makes the auth and audit directories 0700, and puts back a mode an operator loosened', async (t) => {
  const dir = scratch(t);
  assert.equal(await prepareAuthDirectories(dir), null);
  const paths = authPaths(dir);
  for (const directory of [paths.ephemeral, paths.auth, paths.sessions, paths.audit]) {
    assert.equal(mode(directory), 0o700, directory);
  }
  // The probe leaves nothing behind.
  assert.deepEqual(readdirSync(paths.auth), ['sessions']);
  chmodSync(paths.sessions, 0o755);
  chmodSync(paths.audit, 0o777);
  assert.equal(await prepareAuthDirectories(dir), null);
  assert.equal(mode(paths.sessions), 0o700);
  assert.equal(mode(paths.audit), 0o700);
});

test('a data directory that is missing, a file, or not writable is refused by reason', async (t) => {
  const dir = scratch(t);
  assert.equal(await prepareAuthDirectories(path.join(dir, 'absent')), 'data_dir_missing');
  const file = path.join(dir, 'file');
  writeFileSync(file, '');
  assert.equal(await prepareAuthDirectories(file), 'data_dir_missing');
  // Root writes anywhere, so a read-only directory only means something otherwise.
  if (process.getuid?.() !== 0) {
    const readOnly = mkdtempSync(path.join(dir, 'read-only-'));
    chmodSync(readOnly, 0o500);
    try {
      assert.equal(await prepareAuthDirectories(readOnly), 'data_dir_not_writable');
    } finally {
      chmodSync(readOnly, 0o700);
    }
  }
});

test("a data directory the server can't reach is its own finding, apart from a missing one", async (t) => {
  const dir = scratch(t);
  // A link that loops.
  const loop = path.join(dir, 'loop');
  symlinkSync(loop, loop);
  assert.equal(await prepareAuthDirectories(loop), 'data_dir_unreachable');
  // A directory under one the server may not look in. Root looks anywhere.
  if (process.getuid?.() !== 0) {
    const closed = path.join(dir, 'closed');
    mkdirSync(path.join(closed, 'data'), { recursive: true });
    chmodSync(closed, 0o000);
    try {
      assert.equal(await prepareAuthDirectories(path.join(closed, 'data')), 'data_dir_unreachable');
    } finally {
      chmodSync(closed, 0o700);
    }
  }
});

test('a private file is replaced whole at 0600, and no temporary file is left', async (t) => {
  const dir = scratch(t);
  const file = path.join(dir, 'state');
  await writePrivateFile(file, 'first\n');
  await Promise.all(
    Array.from({ length: 10 }, (_, index) => writePrivateFile(file, `write ${index}\n`)),
  );
  assert.match(readFileSync(file, 'utf8'), /^write \d\n$/);
  assert.equal(mode(file), 0o600);
  assert.deepEqual(readdirSync(dir), ['state']);
});
