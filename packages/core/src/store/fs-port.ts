import { constants, createReadStream } from 'node:fs';
import {
  chmod,
  link,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
} from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { recordOwnerModule } from '../load-trace';

// The file operations the revision store makes (#3), behind a port so a test
// can stand in for them. Every operation that changes the disk names its
// place in the write sequence, a crash point such as
// `publish.live.rename`. This adapter does nothing with the name; only the
// test FsPort does, which throws or kills its process there, so a crash test
// can stop a publish at each write, fsync, and rename.

recordOwnerModule('core/store/fs-port');

/** A named place in a write sequence, such as `publish.live.rename`. */
export type CrashPoint = string;

export interface FileStats {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly size: number;
  readonly mtimeMs: number;
  readonly mode: number;
}

export interface FsPort {
  readFile(file: string): Promise<Buffer>;
  /** A stream of the file's bytes, for a blob too big to read whole. */
  createReadStream(file: string): Readable;
  /** The names in `dir`, or [] when it doesn't exist. */
  readdir(dir: string): Promise<string[]>;
  /** What's at `target`, or null when nothing is. */
  stat(target: string): Promise<FileStats | null>;
  /** Makes `dir` and its parents, each 0700, and sets `dir` to 0700 either way. */
  mkdir(dir: string, point: CrashPoint): Promise<void>;
  /**
   * Writes `data` to a new or truncated 0600 file, without syncing it. With
   * `exclusive`, it fails with EEXIST when the file is there.
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
  /** Removes a file or a directory tree, and nothing when nothing is there. */
  remove(target: string, point: CrashPoint): Promise<void>;
  /** Sets a file's modification time to now. */
  touch(file: string, point: CrashPoint): Promise<void>;
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/** The node:fs adapter. Crash points are names only here. */
export const nodeFs: FsPort = Object.freeze({
  readFile: (file: string) => readFile(file),
  createReadStream: (file: string) => createReadStream(file),
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
      const found = await stat(target);
      return {
        isFile: found.isFile(),
        isDirectory: found.isDirectory(),
        size: found.size,
        mtimeMs: found.mtimeMs,
        mode: found.mode & 0o777,
      };
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  },
  async mkdir(dir: string) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
  },
  async writeFile(
    file: string,
    data: string | Uint8Array,
    _point: CrashPoint,
    options: { readonly exclusive?: boolean } = {},
  ) {
    const flags = options.exclusive
      ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      : constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC;
    const handle = await open(file, flags, 0o600);
    try {
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
  },
  async fsync(target: string) {
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
    await utimes(file, now, now);
  },
});
