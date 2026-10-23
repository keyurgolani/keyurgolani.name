import { constants, createReadStream, type Stats } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  lutimes,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
} from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { recordOwnerModule } from '../load-trace';
import { readRegularFile, type FileStats, type ReadFs } from './read-fs';

// The file operations the revision store makes (#3), behind a port so a test
// can stand in for them. Every operation that changes the disk names its
// place in the write sequence, a crash point such as
// `publish.live.rename`. This adapter does nothing with the name; only the
// test FsPort does, which throws or kills its process there, so a crash test
// can stop a publish at each write, fsync, and rename.
//
// No file is opened through a symbolic link: a link planted where the store
// reads or writes a file fails with ELOOP, and mkdir() refuses a link where
// a directory should be, rather than chmod what it points at. Nor is one
// read that isn't a regular file: a FIFO, which would wait for a writer,
// fails at once with EFTYPE.
//
// Only commit.ts moves the published pointer (#3, item 20), and this
// adapter holds every other module to that: a rename from or to the
// pointer's paths, or a link made at one, needs the pass commit.ts takes as
// it loads, and fails with EPERM without it. Nothing writes one in place or
// removes one. Those paths are publication/ itself, live.json, events/, and
// an event's own file there; the lock's files and the server's claim beside
// them aren't, nor is a temporary file, whose name starts with a dot.

recordOwnerModule('core/store/fs-port');

/** A named place in a write sequence, such as `publish.live.rename`. */
export type CrashPoint = string;

export type { FileStats, ReadFs };

const POINTER_PASS: unique symbol = Symbol('pointer pass');
/** What a move of the published pointer or its log takes: commit.ts's alone. */
export type PointerPass = typeof POINTER_PASS;
let passTaken = false;

/**
 * The pointer pass, for commit.ts as it loads. It's handed out once, and a
 * later call throws, so no other module holds it.
 */
export function takePointerPass(): PointerPass {
  if (passTaken) throw new Error('commit.ts holds the pointer pass, and no other module may.');
  passTaken = true;
  return POINTER_PASS;
}

/**
 * Whether `target` is one of the published pointer's paths, by the store's
 * layout: publication/ itself, publication/live.json, publication/events/,
 * or an event's own file in it, one moved aside included.
 */
export function isPointerPath(target: string): boolean {
  const parts = path.resolve(target).split(path.sep);
  const [name = '', parent, above] = [parts.at(-1), parts.at(-2), parts.at(-3)];
  if (name === 'publication') return true;
  if (parent === 'publication') return name === 'live.json' || name === 'events';
  return parent === 'events' && above === 'publication' && !name.startsWith('.');
}

/**
 * Whether `target` is the pointer's file or one of its log's: live.json, or
 * an event's own file. publication/ and events/ are directories the store
 * lays out.
 */
function isPointerFile(target: string): boolean {
  const parts = path.resolve(target).split(path.sep);
  const [name, parent] = [parts.at(-1), parts.at(-2)];
  if (name === 'publication' || (name === 'events' && parent === 'publication')) return false;
  return isPointerPath(target);
}

/** An EPERM error, for a move of the pointer's paths without the pass. */
function pointerRefused(target: string): NodeJS.ErrnoException {
  return Object.assign(new Error('Only commit.ts moves the published pointer or its log.'), {
    code: 'EPERM',
    path: target,
  });
}

/** The reads, read-fs.ts's, and the writes. */
export interface FsPort extends ReadFs {
  /** A stream of the file's bytes, for a blob too big to read whole. A link fails with ELOOP. */
  createReadStream(file: string): Readable;
  /**
   * Makes `dir` and its parents, each 0700, and sets `dir` to 0700 either
   * way. A symbolic link at `dir` fails with ELOOP and is left as it is.
   * At live.json's name or an event's, or under one, it fails with EPERM.
   */
  mkdir(dir: string, point: CrashPoint): Promise<void>;
  /**
   * Writes `data` to a new or truncated 0600 file, without syncing it. With
   * `exclusive`, it fails with EEXIST when the file is there. A symbolic
   * link at `file` fails with ELOOP, and nothing is written through it. One
   * of the pointer's paths fails with EPERM: it's written beside, and moved.
   */
  writeFile(
    file: string,
    data: string | Uint8Array,
    point: CrashPoint,
    options?: { readonly exclusive?: boolean },
  ): Promise<void>;
  /** Syncs a file or a directory to disk. */
  fsync(target: string, point: CrashPoint): Promise<void>;
  /**
   * Renames within one directory tree, replacing what `to` held. From or to
   * one of the pointer's paths, it needs `pass`, and fails with EPERM
   * without it.
   */
  rename(from: string, to: string, point: CrashPoint, pass?: PointerPass): Promise<void>;
  /**
   * Makes `created` a second name for `existing`, failing with EEXIST when
   * it's taken. From or at one of the pointer's paths, it needs `pass`, as
   * a rename does.
   */
  link(existing: string, created: string, point: CrashPoint, pass?: PointerPass): Promise<void>;
  /**
   * Removes a file or a directory tree, a link as a link, and nothing when
   * nothing is there. One of the pointer's paths fails with EPERM.
   */
  remove(target: string, point: CrashPoint): Promise<void>;
  /**
   * Removes `dir` when it's an empty directory, and nothing when nothing is
   * there. One that isn't empty fails with ENOTEMPTY and stays, whatever
   * landed in it since anyone looked. One of the pointer's paths fails with
   * EPERM.
   */
  rmdir(dir: string, point: CrashPoint): Promise<void>;
  /** Sets the modification time of `file` itself, not what a link points at, to now. */
  touch(file: string, point: CrashPoint): Promise<void>;
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

const NO_FOLLOW = constants.O_NOFOLLOW;

function statsOf(found: Stats): FileStats {
  return {
    isFile: found.isFile(),
    isDirectory: found.isDirectory(),
    isSymbolicLink: found.isSymbolicLink(),
    size: found.size,
    mtimeMs: found.mtimeMs,
    mode: found.mode & 0o777,
    uid: found.uid,
    ino: found.ino,
  };
}

/** An ELOOP error, as open() with O_NOFOLLOW gives for a link. */
function linkError(target: string): NodeJS.ErrnoException {
  return Object.assign(new Error('A symbolic link where the store expects a directory.'), {
    code: 'ELOOP',
    path: target,
  });
}

/** The node:fs adapter. Crash points are names only here. */
export const nodeFs: FsPort = Object.freeze({
  readFile: readRegularFile,
  createReadStream: (file: string) =>
    // open() takes numeric flags, though the stream's options are typed as a
    // string. O_NONBLOCK: a FIFO swapped in for a blob after its lstat opens
    // at once rather than waiting for a writer, and its read ends or fails
    // at once too.
    createReadStream(file, {
      flags: (constants.O_RDONLY | NO_FOLLOW | constants.O_NONBLOCK) as unknown as string,
    }),
  async readdir(dir: string) {
    try {
      return await readdir(dir);
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
  },
  async stat(target: string) {
    try {
      return statsOf(await stat(target));
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  },
  async lstat(target: string) {
    try {
      return statsOf(await lstat(target));
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  },
  async mkdir(dir: string) {
    // A directory at live.json's name, or an event's, or above one, would
    // stand where the next pointer move writes. Nothing makes one.
    for (let at = path.resolve(dir); at !== path.dirname(at); at = path.dirname(at)) {
      if (isPointerFile(at)) throw pointerRefused(at);
    }
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // chmod follows a link, so a link here is refused before it.
    if (!(await lstat(dir)).isDirectory()) throw linkError(dir);
    await chmod(dir, 0o700);
  },
  async writeFile(
    file: string,
    data: string | Uint8Array,
    _point: CrashPoint,
    options: { readonly exclusive?: boolean } = {},
  ) {
    if (isPointerPath(file)) throw pointerRefused(file);
    const flags = options.exclusive
      ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NO_FOLLOW
      : constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NO_FOLLOW;
    const handle = await open(file, flags, 0o600);
    try {
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
  },
  async fsync(target: string) {
    // The data directory itself may be a link to the operator's volume, and a
    // sync changes nothing, so this one follows.
    const handle = await open(target, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  async rename(from: string, to: string, _point: CrashPoint, pass?: PointerPass) {
    for (const target of [from, to]) {
      if (pass !== POINTER_PASS && isPointerPath(target)) throw pointerRefused(target);
    }
    await rename(from, to);
  },
  async link(existing: string, created: string, _point: CrashPoint, pass?: PointerPass) {
    // A second name for live.json or an event would let a write in place
    // through it, so a link from one takes the pass too.
    for (const target of [existing, created]) {
      if (pass !== POINTER_PASS && isPointerPath(target)) throw pointerRefused(target);
    }
    await link(existing, created);
  },
  async remove(target: string) {
    if (isPointerPath(target)) throw pointerRefused(target);
    await rm(target, { recursive: true, force: true });
  },
  async rmdir(dir: string) {
    if (isPointerPath(dir)) throw pointerRefused(dir);
    try {
      await rmdir(dir);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  },
  async touch(file: string) {
    const now = new Date();
    await lutimes(file, now, now);
  },
});
