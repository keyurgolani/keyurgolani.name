import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isMediaRootPath } from '@portfolio/schema';
import { MEDIA_LIMITS, MediaSourceError, refused } from './limits';

// Local media sources (#10, slice 2 item 3): a path resolves only under the
// read-only PORTFOLIO_MEDIA_ROOT. An absolute path, a `..` or `.` segment, a
// backslash, or anything a URL would read differently is refused before the
// file system is asked, and so is any path whose real path (every link
// followed) leaves the root's real path. A link that stays inside the root
// is fine. What's read is a regular file, opened without following a final
// link and without waiting on a FIFO, and at most 20 MiB. Nothing here
// writes, and nothing mounts the root into public/.

export interface LocalMediaRoot {
  /** The bytes at `source` under the root, or a MediaSourceError that says why not. */
  read(source: string): Promise<Uint8Array>;
}

export interface LocalMediaRootOptions {
  /** The most bytes a source may hold. Defaults to 20 MiB. */
  readonly maxBytes?: number;
}

const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

const missing = () =>
  new MediaSourceError('missing', 'not_found', 'No file is at this path under the media root.');

/** Whether `target` is `root` itself or under it. */
function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function localMediaRoot(
  root: string,
  { maxBytes = MEDIA_LIMITS.sourceBytes }: LocalMediaRootOptions = {},
): LocalMediaRoot {
  if (!path.isAbsolute(root)) throw new TypeError('The media root is an absolute path.');
  return {
    async read(source) {
      if (typeof source !== 'string' || !isMediaRootPath(source)) {
        throw refused('path_invalid', 'A local source is a relative path inside the media root.');
      }
      let realRoot: string;
      try {
        realRoot = await realpath(root);
      } catch {
        throw new MediaSourceError(
          'unreachable',
          'root_unreachable',
          "The media root can't be read.",
        );
      }
      let real: string;
      try {
        real = await realpath(path.join(realRoot, ...source.split('/')));
      } catch (error) {
        if (code(error) === 'ENOENT' || code(error) === 'ENOTDIR') throw missing();
        if (code(error) === 'ELOOP') throw refused('link_loop', 'The path loops through links.');
        throw new MediaSourceError('unreachable', 'read_failed', "The file can't be read.");
      }
      if (!inside(realRoot, real)) {
        throw refused('path_escape', 'The path leaves the media root through a link.');
      }
      let handle;
      try {
        // O_NOFOLLOW: a link swapped in since realpath() isn't followed.
        // O_NONBLOCK: a FIFO can't hold the read open.
        handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      } catch (error) {
        if (code(error) === 'ENOENT') throw missing();
        if (code(error) === 'ELOOP') throw refused('path_escape', 'The file is a link.');
        throw new MediaSourceError('unreachable', 'read_failed', "The file can't be read.");
      }
      try {
        const stats = await handle.stat();
        if (!stats.isFile())
          throw refused('not_a_file', 'The path names something other than a file.');
        if (stats.size > maxBytes) throw refused('too_large', 'The file is larger than 20 MiB.');
        // Read one byte past the cap, so a file that grew since stat() is refused too.
        const buffer = Buffer.alloc(Math.min(stats.size, maxBytes) + 1);
        let length = 0;
        while (length < buffer.length) {
          const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
          if (bytesRead === 0) break;
          length += bytesRead;
        }
        if (length > maxBytes) throw refused('too_large', 'The file is larger than 20 MiB.');
        return new Uint8Array(buffer.buffer, buffer.byteOffset, length);
      } catch (error) {
        if (error instanceof MediaSourceError) throw error;
        throw new MediaSourceError('unreachable', 'read_failed', "The file can't be read.");
      } finally {
        await handle.close();
      }
    },
  };
}
