import path from 'node:path';
import { recordOwnerModule } from '../load-trace';
import type { FsPort } from './fs-port';

// What's under a directory, by lstat, never through a link (#3, item 26, and
// the PR #50 review's F3): the regular files, and apart from them whatever
// is neither a regular file nor a directory, such as a symlink, a FIFO, or a
// socket. A store and a backup hold only directories and regular files, so
// anything else in one was put there by hand. A backup copies none of it,
// and a restore refuses a backup that holds any: followed, a link reads or
// writes outside the directory, and a FIFO blocks the read for good.

recordOwnerModule('core/store/walk');

export interface Walk {
  /** The regular files, relative to the directory walked, with / between names, in name order. */
  readonly files: readonly string[];
  /** What is neither a regular file nor a directory, relative the same way. A linked directory is one. */
  readonly other: readonly string[];
}

/** Every regular file under `dir`, and everything else that isn't a directory, without following a link. */
export async function walk(fs: FsPort, dir: string, prefix = ''): Promise<Walk> {
  const files: string[] = [];
  const other: string[] = [];
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    // A file where the directory should be: nothing to walk.
    if ((error as NodeJS.ErrnoException)?.code === 'ENOTDIR') return { files, other };
    throw error;
  }
  for (const name of names.sort()) {
    const full = path.join(dir, name);
    const relative = `${prefix}${name}`;
    const found = await fs.lstat(full);
    if (!found) continue;
    if (found.isDirectory) {
      const inner = await walk(fs, full, `${relative}/`);
      files.push(...inner.files);
      other.push(...inner.other);
    } else if (found.isFile) {
      files.push(relative);
    } else {
      other.push(relative);
    }
  }
  return { files, other };
}
