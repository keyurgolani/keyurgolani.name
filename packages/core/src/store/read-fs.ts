import { constants, type Stats } from 'node:fs';
import { lstat, open, readdir, stat } from 'node:fs/promises';
import { recordOwnerModule } from '../load-trace';

// The reads of node:fs and nothing else (#3, item 19): what the
// RevisionCatalogReader gets in place of the store's FsPort, so the reader
// can't write, rename, or remove a file, the pointer least of all. It reads
// as the store's own port does, with readRegularFile(): never through a
// symbolic link, and never from anything but a regular file. The FsPort is
// these reads and the writes, so this module imports nothing of it.

recordOwnerModule('core/store/read-fs');

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
  /** The inode, which a rename over the file changes. */
  readonly ino: number;
}

/** The reads alone: what reading revisions and the pointer needs, and all the reader gets. */
export interface ReadFs {
  /**
   * The file's bytes. A symbolic link fails with ELOOP, a directory with
   * EISDIR, and a FIFO or a device with EFTYPE, at once.
   */
  readFile(file: string): Promise<Buffer>;
  /** The names in `dir`, or [] when it doesn't exist. */
  readdir(dir: string): Promise<string[]>;
  /** What's at `target`, following a link, or null when nothing is. */
  stat(target: string): Promise<FileStats | null>;
  /** What's at `target` itself, a link as a link, or null when nothing is. */
  lstat(target: string): Promise<FileStats | null>;
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/**
 * Read only. O_NOFOLLOW: a file opened through a link fails with ELOOP.
 * O_NONBLOCK: a FIFO in a file's place opens at once, where it would wait
 * for a writer, and is refused; a regular file ignores it.
 */
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/**
 * A regular file's bytes. Anything else in its place fails at once: a link
 * with ELOOP, a directory with EISDIR, a FIFO or a device with EFTYPE, and
 * a socket at its open.
 */
export async function readRegularFile(file: string): Promise<Buffer> {
  const handle = await open(file, READ_FLAGS);
  try {
    const found = await handle.stat();
    if (!found.isFile()) {
      throw Object.assign(new Error('Not a regular file.'), {
        code: found.isDirectory() ? 'EISDIR' : 'EFTYPE',
        path: file,
      });
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

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

export const nodeReadFs: ReadFs = Object.freeze({
  readFile: readRegularFile,
  async readdir(dir: string) {
    try {
      return await readdir(dir);
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
  },
  async stat(target: string): Promise<FileStats | null> {
    try {
      return statsOf(await stat(target));
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  },
  async lstat(target: string): Promise<FileStats | null> {
    try {
      return statsOf(await lstat(target));
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  },
});
