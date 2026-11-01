import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MediaSourceError } from './limits';
import { localMediaRoot, procOpenedPath } from './local';

// Local sources (#10, slice 2 item 3): a path resolves only under the media
// root. Absolute paths, `..`, and links whose real path leaves the root are
// refused; a file outside the root is never read, whatever names it.

const SECRET = 'outside-canary-91c2';

function fixture(t: { after(fn: () => void): void }) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'kgn-media-local-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'media');
  mkdirSync(path.join(root, 'atlas', 'deep'), { recursive: true });
  writeFileSync(path.join(root, 'atlas', 'cover.jpg'), 'cover bytes');
  writeFileSync(path.join(root, 'atlas', 'deep', 'plate.png'), 'plate bytes');
  // Outside the root, beside it: what an escape would reach.
  writeFileSync(path.join(base, 'secret.txt'), SECRET);
  mkdirSync(path.join(base, 'media-other'));
  writeFileSync(path.join(base, 'media-other', 'x.jpg'), SECRET);
  return { base, root };
}

const refusal = (reason: string, code?: string) => (error: unknown) => {
  assert.ok(error instanceof MediaSourceError, String(error));
  assert.equal(error.reason, reason);
  if (code !== undefined) assert.equal(error.code, code);
  assert.ok(!error.message.includes(SECRET));
  return true;
};

test('a path under the root reads its file', async (t) => {
  const { root } = fixture(t);
  const media = localMediaRoot(root);
  assert.equal(Buffer.from(await media.read('atlas/cover.jpg')).toString(), 'cover bytes');
  assert.equal(Buffer.from(await media.read('atlas/deep/plate.png')).toString(), 'plate bytes');
});

test('absolute paths, `..`, `.`, backslashes, and URL-like paths are refused before any read', async (t) => {
  const { base, root } = fixture(t);
  const media = localMediaRoot(root);
  for (const source of [
    path.join(base, 'secret.txt'),
    '/etc/passwd',
    '../secret.txt',
    'atlas/../../secret.txt',
    'atlas/./cover.jpg',
    './atlas/cover.jpg',
    'atlas//cover.jpg',
    'atlas\\..\\..\\secret.txt',
    '..',
    '',
    'file:secret.txt',
    'atlas/cover.jpg?x',
    'atlas/cover.jpg#x',
    'atlas/cover.jpg\0.png',
  ]) {
    await assert.rejects(media.read(source), refusal('refused', 'path_invalid'), source);
  }
});

test('a link whose real path leaves the root is refused; one that stays inside is read', async (t) => {
  const { base, root } = fixture(t);
  symlinkSync(path.join(base, 'secret.txt'), path.join(root, 'escape.jpg'));
  symlinkSync('../../secret.txt', path.join(root, 'atlas', 'relative-escape.jpg'));
  symlinkSync(base, path.join(root, 'up'));
  // A sibling whose name starts like the root's is still outside it.
  symlinkSync(path.join(base, 'media-other'), path.join(root, 'other'));
  symlinkSync('cover.jpg', path.join(root, 'atlas', 'alias.jpg'));
  symlinkSync(path.join(root, 'atlas', 'deep'), path.join(root, 'plates'));
  const media = localMediaRoot(root);
  for (const source of [
    'escape.jpg',
    'atlas/relative-escape.jpg',
    'up/secret.txt',
    'other/x.jpg',
  ]) {
    await assert.rejects(media.read(source), refusal('refused', 'path_escape'), source);
  }
  assert.equal(Buffer.from(await media.read('atlas/alias.jpg')).toString(), 'cover bytes');
  assert.equal(Buffer.from(await media.read('plates/plate.png')).toString(), 'plate bytes');
});

test('what was opened is checked against the root too, as a directory swapped for a link would lead elsewhere', async (t) => {
  const { base, root } = fixture(t);
  const opened: number[] = [];
  // The open landed outside the root, as it would through a directory swapped in
  // between realpath() and open().
  const swapped = localMediaRoot(root, {
    openedPath: async (fd) => {
      opened.push(fd);
      return path.join(realpathSync(base), 'secret.txt');
    },
  });
  await assert.rejects(swapped.read('atlas/cover.jpg'), refusal('refused', 'path_escape'));
  assert.equal(opened.length, 1);
  // Where it landed inside, the file reads.
  const inside = localMediaRoot(root, {
    openedPath: async () => path.join(realpathSync(root), 'atlas', 'cover.jpg'),
  });
  assert.equal(Buffer.from(await inside.read('atlas/cover.jpg')).toString(), 'cover bytes');
  // Where that can't be told: refused on Linux, where /proc always tells, as
  // for a file unlinked since it opened; read where there's no /proc to ask.
  const untold = (requireOpenedPath: boolean) =>
    localMediaRoot(root, { openedPath: async () => null, requireOpenedPath });
  await assert.rejects(untold(true).read('atlas/cover.jpg'), refusal('refused', 'path_unchecked'));
  assert.equal(Buffer.from(await untold(false).read('atlas/cover.jpg')).toString(), 'cover bytes');
  // Linux is the one that requires it.
  const fallback = localMediaRoot(root, { openedPath: async () => null });
  if (process.platform === 'linux') {
    await assert.rejects(fallback.read('atlas/cover.jpg'), refusal('refused', 'path_unchecked'));
  } else {
    assert.equal(Buffer.from(await fallback.read('atlas/cover.jpg')).toString(), 'cover bytes');
  }

  // The real check: /proc/self/fd on Linux, where the server runs; nothing elsewhere.
  const handle = await open(path.join(root, 'atlas', 'cover.jpg'));
  t.after(() => handle.close());
  assert.equal(
    await procOpenedPath(handle.fd),
    process.platform === 'linux' ? realpathSync(path.join(root, 'atlas', 'cover.jpg')) : null,
  );
});

test('a root reached through a link still contains what is under it', async (t) => {
  const { base, root } = fixture(t);
  const linked = path.join(base, 'linked-root');
  symlinkSync(root, linked);
  const media = localMediaRoot(linked);
  assert.equal(Buffer.from(await media.read('atlas/cover.jpg')).toString(), 'cover bytes');
  symlinkSync(path.join(base, 'secret.txt'), path.join(root, 'escape.jpg'));
  await assert.rejects(media.read('escape.jpg'), refusal('refused', 'path_escape'));
});

test('a missing file is missing, and a directory, a FIFO, or a link loop is refused', async (t) => {
  const { root } = fixture(t);
  const media = localMediaRoot(root);
  await assert.rejects(media.read('atlas/gone.jpg'), refusal('missing'));
  await assert.rejects(media.read('nowhere/gone.jpg'), refusal('missing'));
  await assert.rejects(media.read('atlas/cover.jpg/inner'), refusal('missing'));
  await assert.rejects(media.read('atlas'), refusal('refused', 'not_a_file'));
  execFileSync('mkfifo', [path.join(root, 'pipe.jpg')]);
  await assert.rejects(media.read('pipe.jpg'), refusal('refused', 'not_a_file'));
  symlinkSync('loop-b.jpg', path.join(root, 'loop-a.jpg'));
  symlinkSync('loop-a.jpg', path.join(root, 'loop-b.jpg'));
  await assert.rejects(media.read('loop-a.jpg'), refusal('refused'));
});

test('a source over the cap is refused, without reading it whole', async (t) => {
  const { root } = fixture(t);
  writeFileSync(path.join(root, 'big.jpg'), Buffer.alloc(65));
  writeFileSync(path.join(root, 'fits.jpg'), Buffer.alloc(64));
  const media = localMediaRoot(root, { maxBytes: 64 });
  await assert.rejects(media.read('big.jpg'), refusal('refused', 'too_large'));
  assert.equal((await media.read('fits.jpg')).byteLength, 64);
});

test('a root that is gone is unreachable, and a relative root is a mistake', async (t) => {
  const { base } = fixture(t);
  const media = localMediaRoot(path.join(base, 'no-such-root'));
  await assert.rejects(media.read('atlas/cover.jpg'), refusal('unreachable', 'root_unreachable'));
  assert.throws(() => localMediaRoot('media'), TypeError);
});
