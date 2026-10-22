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
  stat,
} from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { recordOwnerModule } from '../load-trace';

// The file operations the revision store makes (#3), behind a port so a test
// can stand in for them. Every operation that changes the disk names its
// place in the write sequence, a crash point such as
// `publish.live.rename`. This adapter does nothing with the name; only the
// test FsPort does, which throws or kills its process there, so a crash test
// can stop a publish at each write, fsync, and rename.
//
// No file is opened through a symbolic link: a link planted where the store
// reads or writes a file fails with ELOOP, and mkdir() refuses a link where
// a directory should be, rather than chmod what it points at.

recordOwnerModule('core/store/fs-port');

/** A named place in a write sequence, such as `publish.live.rename`. */
export type CrashPoint = string;

export interface FileStats {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  /** Only lstat() sees a link; stat() reports what it points at. */
  readonly isSymbolicLink: boolean;
  readonly size: number;
  readonly mtimeMs: number;
  readonly mode: number;
  /** The owner's uid. */
  readonly uid: number;
}

export interface FsPort {
  /** The file's bytes. A symbolic link fails with ELOOP. */
  readFile(file: string): Promise<Buffer>;
  /** A stream of the file's bytes, for a blob too big to read whole. A link fails with ELOOP. */
  createReadStream(file: string): Readable;
  /** The names in `dir`, or [] when it doesn't exist. */
  readdir(dir: string): Promise<string[]>;
  /** What's at `target`, following a link, or null when nothing is. */
  stat(target: string): Promise<FileStats | null>;
  /** What's at `target` itself, a link as a link, or null when nothing is. */
  lstat(target: string): Promise<FileStats | null>;
  /**
   * Makes `dir` and its parents, each 0700, and sets `dir` to 0700 either
   * way. A symbolic link at `dir` fails with ELOOP and is left as it is.
   */
  mkdir(dir: string, point: CrashPoint): Promise<void>;
  /**
   * Writes `data` to a new or truncated 0600 file, without syncing it. With
   * `exclusive`, it fails with EEXIST when the file is there. A symbolic
   * link at `file` fails with ELOOP, and nothing is written through it.
   */
  writeFile(
    file: string,
    data: string | Uint8Array,
    point: CrashPoint,
    options?: { readonly exclusive?: boolean },
  ): Promise<void>;
  /** Syncs a file or a directory to disk. */
  fsync(target: string, point: CrashPoint): Promise<void>;
  /** Renames within one directory tree, replacing what `to` held. */
  rename(from: string, to: string, point: CrashPoint): Promise<void>;
  /** Makes `created` a second name for `existing`, failing with EEXIST when it's taken. */
  link(existing: string, created: string, point: CrashPoint): Promise<void>;
  /** Removes a file or a directory tree, a link as a link, and nothing when nothing is there. */
  remove(target: string, point: CrashPoint): Promise<void>;
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
  async readFile(file: string) {
    const handle = await open(file, constants.O_RDONLY | NO_FOLLOW);
    try {
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  },
  createReadStream: (file: string) =>
    // open() takes numeric flags, though the stream's options are typed as a string.
    createReadStream(file, { flags: (constants.O_RDONLY | NO_FOLLOW) as unknown as string }),
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
  rename: (from: string, to: string) => rename(from, to),
  link: (existing: string, created: string) => link(existing, created),
  remove: (target: string) => rm(target, { recursive: true, force: true }),
  async touch(file: string) {
    const now = new Date();
    await lutimes(file, now, now);
  },
});
