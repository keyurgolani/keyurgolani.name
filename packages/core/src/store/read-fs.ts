import { constants, type Stats } from 'node:fs';
import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { recordOwnerModule } from '../load-trace';
import type { FileStats, ReadFs } from './fs-port';

// The reads of node:fs and nothing else (#3, item 19): what the
// RevisionCatalogReader gets in place of the store's FsPort, so the reader
// can't write, rename, or remove a file, the pointer least of all. It reads
// as the store's own port does: never through a symbolic link.

recordOwnerModule('core/store/read-fs');

const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/** A file opened through a link fails with ELOOP. */
const READ_NO_FOLLOW = constants.O_RDONLY | constants.O_NOFOLLOW;

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
  readFile: (file: string) => readFile(file, { flag: READ_NO_FOLLOW }),
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
