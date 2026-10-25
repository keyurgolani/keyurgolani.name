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
import { lstat, open, rename } from 'node:fs/promises';
import {
  authPaths,
  checkPrivateDir,
  preparePrivateDir,
  PrivateDirError,
  privateDirProblem,
  probeDataDirectory,
  writePrivateFile,
} from './layout.mjs';

function scratch(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'layout-'));
  t.after(() => {
    chmodSync(dir, 0o700);
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

const mode = (file: string) => statSync(file).mode & 0o777;

test("owner startup's probe writes, syncs, and renames in a directory of its own, and leaves nothing behind", async (t) => {
  const dir = scratch(t);
  assert.equal(await probeDataDirectory(dir), null);
  // No auth directory: each writer makes its own.
  assert.deepEqual(readdirSync(dir), []);
  // In a data directory that already holds them, they stay as they are.
  const paths = authPaths(dir);
  mkdirSync(paths.sessions, { recursive: true, mode: 0o700 });
  mkdirSync(paths.audit, { mode: 0o700 });
  assert.equal(await probeDataDirectory(dir), null);
  assert.deepEqual(readdirSync(dir).sort(), ['audit', 'ephemeral']);
  assert.deepEqual(readdirSync(paths.auth), ['sessions']);
  assert.deepEqual(readdirSync(paths.sessions), []);
});

test("a probe step that fails is the probe's finding, and its directory is still removed", async (t) => {
  const dir = scratch(t);
  const refused = async () => {
    throw Object.assign(new Error('refused'), { code: 'EXDEV' });
  };
  // The write fails once the file is open: the handle is closed, and the directory removed.
  let opened = 0;
  const failingWrite = (async (file: string, flags: string, fileMode: number) => {
    const handle = await open(file, flags, fileMode);
    opened += 1;
    return { writeFile: refused, sync: () => handle.sync(), close: () => handle.close() };
  }) as unknown as typeof open;
  assert.equal(await probeDataDirectory(dir, { open: failingWrite }), 'data_dir_not_writable');
  assert.equal(opened, 1);
  assert.deepEqual(readdirSync(dir), []);
  // The rename fails, after the file is written and synced.
  let renamed = 0;
  const failingRename = (async (from: string, to: string) => {
    renamed += 1;
    assert.ok(statSync(from).isFile());
    assert.equal(path.dirname(from), path.dirname(to));
    assert.notEqual(path.dirname(from), dir, 'the probe runs in a directory of its own');
    return refused();
  }) as unknown as typeof rename;
  assert.equal(await probeDataDirectory(dir, { rename: failingRename }), 'data_dir_rename_failed');
  assert.equal(renamed, 1);
  assert.deepEqual(readdirSync(dir), []);
  // And with the real rename, nothing either.
  assert.equal(await probeDataDirectory(dir, { rename }), null);
  assert.deepEqual(readdirSync(dir), []);
});

test('given ephemeral/, the probe runs there, on the filesystem the auth state lives on, and leaves it as it was', async (t) => {
  const dir = scratch(t);
  const ephemeral = authPaths(dir).ephemeral;
  mkdirSync(ephemeral, { mode: 0o700 });
  let where = '';
  const watching = (async (from: string, to: string) => {
    where = path.dirname(path.dirname(from));
    return rename(from, to);
  }) as unknown as typeof rename;
  assert.equal(await probeDataDirectory(dir, { within: ephemeral, rename: watching }), null);
  assert.equal(where, ephemeral);
  assert.deepEqual(readdirSync(ephemeral), []);
  assert.deepEqual(readdirSync(dir), ['ephemeral']);
});

test('a writer makes its directory and each one above it at 0700 at its first write, whatever the umask', async (t) => {
  const dir = scratch(t);
  // One that would take the owner's write bit off a plain mkdir.
  const umask = process.umask(0o277);
  t.after(() => process.umask(umask));
  const paths = authPaths(dir);
  await preparePrivateDir(dir, paths.sessions);
  for (const each of [paths.ephemeral, paths.auth, paths.sessions]) {
    assert.equal(mode(each), 0o700, each);
  }
  // Again, with each one there: nothing changes.
  await preparePrivateDir(dir, paths.sessions);
  assert.deepEqual(readdirSync(paths.auth), ['sessions']);
  await assert.rejects(preparePrivateDir(dir, dir), TypeError);
  await assert.rejects(preparePrivateDir(dir, path.join(dir, '..', 'outside')), TypeError);
});

test('a writer puts back a mode an operator loosened or narrowed, on each directory on the way, and refuses one a chmod leaves wrong', async (t) => {
  const dir = scratch(t);
  const paths = authPaths(dir);
  mkdirSync(paths.sessions, { recursive: true, mode: 0o700 });
  chmodSync(paths.ephemeral, 0o755);
  chmodSync(paths.auth, 0o777);
  chmodSync(paths.sessions, 0o500);
  await preparePrivateDir(dir, paths.sessions);
  for (const each of [paths.ephemeral, paths.auth, paths.sessions]) {
    assert.equal(mode(each), 0o700, each);
  }
  // The reader's twin repairs the same way, and makes nothing.
  chmodSync(paths.auth, 0o750);
  await checkPrivateDir(dir, paths.sessions);
  assert.equal(mode(paths.auth), 0o700);
  // A chmod that doesn't take, as on a volume that ignores modes: refused.
  chmodSync(paths.auth, 0o755);
  let chmods = 0;
  const ignoring = (async (file: string, flags: number) => {
    const handle = await open(file, flags);
    return {
      stat: () => handle.stat(),
      chmod: async () => {
        chmods += 1;
      },
      close: () => handle.close(),
    };
  }) as unknown as typeof open;
  await assert.rejects(
    preparePrivateDir(dir, paths.sessions, { open: ignoring }),
    /^PrivateDirError: ephemeral\/auth isn't 0700/,
  );
  assert.equal(chmods, 1);
});

test('the repair opens the directory without following a link, so one swapped in after the lstat is refused and what it points at is never chmodded', async (t) => {
  const dir = scratch(t);
  const paths = authPaths(dir);
  mkdirSync(paths.auth, { recursive: true, mode: 0o700 });
  chmodSync(paths.auth, 0o755);
  // Another loosened directory of ours, which the link points at.
  const elsewhere = scratch(t);
  chmodSync(elsewhere, 0o755);
  let swapped = false;
  const swapping = (async (file: string) => {
    const found = await lstat(file);
    if (file === paths.auth && !swapped) {
      swapped = true;
      rmSync(paths.auth, { recursive: true });
      symlinkSync(elsewhere, paths.auth);
    }
    return found;
  }) as unknown as typeof lstat;
  await assert.rejects(
    preparePrivateDir(dir, paths.sessions, { lstat: swapping }),
    /^PrivateDirError: ephemeral\/auth is a link/,
  );
  assert.ok(swapped);
  assert.equal(mode(elsewhere), 0o755, 'the repair followed the link');
  assert.deepEqual(readdirSync(elsewhere), []);
});

test("the checks run in order, and another user's directory is refused before any chmod, loosened or not", async (t) => {
  const stats = (kind: 'link' | 'file' | 'dir', uid: number, mode: number) => ({
    isSymbolicLink: () => kind === 'link',
    isDirectory: () => kind === 'dir',
    uid,
    mode,
  });
  // A link is a link whatever else it is, then a file, then the owner, then the mode.
  assert.equal(privateDirProblem(stats('link', 2, 0o777), 1), 'link');
  assert.equal(privateDirProblem(stats('file', 2, 0o777), 1), 'not_directory');
  assert.equal(privateDirProblem(stats('dir', 2, 0o777), 1), 'other_owner');
  assert.equal(privateDirProblem(stats('dir', 1, 0o755), 1), 'loose');
  assert.equal(privateDirProblem(stats('dir', 1, 0o700), 1), null);
  assert.equal(privateDirProblem(stats('dir', 2, 0o700), null), null);

  // On disk: a loosened directory another user owns is refused, and its mode left alone.
  const dir = scratch(t);
  const paths = authPaths(dir);
  mkdirSync(paths.ephemeral, { mode: 0o700 });
  chmodSync(paths.ephemeral, 0o755);
  const uid = process.getuid!();
  t.mock.method(process as { getuid: () => number }, 'getuid', () => uid + 1);
  for (const run of [preparePrivateDir, checkPrivateDir]) {
    await assert.rejects(
      run(dir, paths.sessions),
      (error: unknown) =>
        error instanceof PrivateDirError &&
        error.code === 'not_private' &&
        /^ephemeral belongs to another user/.test(error.message),
    );
    assert.equal(mode(paths.ephemeral), 0o755, `${run.name} chmodded another user's directory`);
  }
  assert.deepEqual(readdirSync(paths.ephemeral), []);
});

test('a writer refuses a link, a file, or another user, wherever it stands on the way, and the reader twin refuses the same and makes nothing', async (t) => {
  const paths = (dir: string) => authPaths(dir);
  const cases: [
    what: string,
    arrange: (dir: string, elsewhere: string) => void,
    refusal: RegExp,
  ][] = [
    [
      'ephemeral/ a link',
      (d, e) => symlinkSync(e, paths(d).ephemeral),
      /^PrivateDirError: ephemeral is a link/,
    ],
    [
      'ephemeral/auth/ a link',
      (d, e) => {
        mkdirSync(paths(d).ephemeral, { mode: 0o700 });
        symlinkSync(e, paths(d).auth);
      },
      /^PrivateDirError: ephemeral\/auth is a link/,
    ],
    [
      'ephemeral/auth/ a file',
      (d) => {
        mkdirSync(paths(d).ephemeral, { mode: 0o700 });
        writeFileSync(paths(d).auth, '');
      },
      /^PrivateDirError: ephemeral\/auth isn't a directory/,
    ],
  ];
  for (const [what, arrange, refusal] of cases) {
    const dir = scratch(t);
    const elsewhere = scratch(t);
    arrange(dir, elsewhere);
    await assert.rejects(preparePrivateDir(dir, paths(dir).sessions), refusal, what);
    await assert.rejects(checkPrivateDir(dir, paths(dir).sessions), refusal, what);
    assert.deepEqual(readdirSync(elsewhere), [], `${what}: something was made through it`);
  }
  // Nothing there: the twin reads it as empty and makes nothing.
  const empty = scratch(t);
  await checkPrivateDir(empty, paths(empty).sessions);
  assert.deepEqual(readdirSync(empty), []);
  // Another user's: the server runs as someone else, since only root can chown.
  const dir = scratch(t);
  mkdirSync(paths(dir).ephemeral, { mode: 0o700 });
  const uid = process.getuid!();
  t.mock.method(process as { getuid: () => number }, 'getuid', () => uid + 1);
  await assert.rejects(
    preparePrivateDir(dir, paths(dir).sessions),
    /^PrivateDirError: ephemeral belongs to another user/,
  );
  assert.deepEqual(readdirSync(paths(dir).ephemeral), []);
});

test('a data directory that is missing, a file, or not writable is refused by reason', async (t) => {
  const dir = scratch(t);
  assert.equal(await probeDataDirectory(path.join(dir, 'absent')), 'data_dir_missing');
  const file = path.join(dir, 'file');
  writeFileSync(file, '');
  assert.equal(await probeDataDirectory(file), 'data_dir_missing');
  // Root writes anywhere, so a read-only directory only means something otherwise.
  if (process.getuid?.() !== 0) {
    const readOnly = mkdtempSync(path.join(dir, 'read-only-'));
    chmodSync(readOnly, 0o500);
    try {
      assert.equal(await probeDataDirectory(readOnly), 'data_dir_not_writable');
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
  assert.equal(await probeDataDirectory(loop), 'data_dir_unreachable');
  // A directory under one the server may not look in. Root looks anywhere.
  if (process.getuid?.() !== 0) {
    const closed = path.join(dir, 'closed');
    mkdirSync(path.join(closed, 'data'), { recursive: true });
    chmodSync(closed, 0o000);
    try {
      assert.equal(await probeDataDirectory(path.join(closed, 'data')), 'data_dir_unreachable');
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
