import { constants, createReadStream } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  parseMediaDocument,
  RENDITION_TYPES,
  resolvePortfolioView,
  type ContentExtension,
} from '@portfolio/schema';
import { recordOwnerModule } from '../load-trace';
import {
  BUNDLE_LIMITS,
  verifyBundle,
  type BundleEntry,
  type BundleFiles,
  type BundleProblem,
  type VerifiedBundle,
} from '../catalog/bundle';
import type { PublicationUnit } from '../catalog/port';
import type { Sha256, UnitChecks } from '../catalog/unit';

// A full export's directory as the store-free bundle reader reads it (#9,
// #3's export format 1), for `portfolio-store verify-revision` and for the
// check `export-revision` makes of what it wrote before it lets it go. The
// checks themselves are catalog/bundle.ts's verifyBundle(), the one the
// demo's read-only reference starts with: this module only reads.
//
// It reads below the directory and nothing else. A link, a FIFO, a device,
// or a socket is never opened or followed: the listing names it as
// something other than a file, which the reader refuses, and a read opens
// a regular file alone, through directories that are directories, with
// O_NOFOLLOW and O_NONBLOCK. The bundle's own directories are snapshots/,
// media/, and media/blobs/; any other directory is an entry the reader
// refuses, and is never walked. Every read stops one byte past the limit
// the reader gives, so a file over it shows without being read whole.

recordOwnerModule('core/store/bundle-files');

/** The directories a bundle lays out. Any other is an unexpected entry. */
const LAYOUT_DIRECTORIES: ReadonlySet<string> = new Set(['snapshots', 'media', 'media/blobs']);

/** Read only, never through a link, and a FIFO opens at once rather than wait for a writer. */
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** A path bundle.json may name: names joined by /, none empty, `.`, or `..`. */
const isRelativePath = (file: string) =>
  file
    .split('/')
    .every((name) => name !== '' && name !== '.' && name !== '..' && !name.includes('\\'));

export interface BundleDirectoryOptions {
  /**
   * Tests' hook, run after a file's checks and before it opens, where a
   * swap for a link would land: the open still follows none.
   */
  readonly beforeOpen?: (file: string) => Promise<void> | void;
}

/** `dir` as verifyBundle()'s port. `dir` itself is the caller's to check (bundleDirectoryProblem()). */
export function bundleDirectory(dir: string, options: BundleDirectoryOptions = {}): BundleFiles {
  const at = (file: string) => path.join(dir, ...file.split('/'));
  return {
    async list() {
      const entries: BundleEntry[] = [];
      const walk = async (relative: string): Promise<void> => {
        const names = (await readdir(relative === '' ? dir : at(relative))).sort();
        for (const name of names) {
          // Past the file limit the reader refuses it anyway: stop listing.
          if (entries.length > BUNDLE_LIMITS.files) return;
          const file = relative === '' ? name : `${relative}/${name}`;
          const found = await lstat(at(file));
          if (found.isDirectory() && LAYOUT_DIRECTORIES.has(file)) {
            await walk(file);
          } else {
            const isFile = found.isFile();
            entries.push({
              path: file,
              type: isFile ? 'file' : 'other',
              size: isFile ? found.size : 0,
            });
          }
        }
      };
      await walk('');
      return entries;
    },
    async read(file, limit) {
      if (!isRelativePath(file)) throw new Error('Not a path in the bundle.');
      // Each directory on the way is one, not a link to one: O_NOFOLLOW
      // covers the last name alone.
      const names = file.split('/');
      for (let depth = 1; depth < names.length; depth += 1) {
        if (!(await lstat(at(names.slice(0, depth).join('/')))).isDirectory()) {
          throw new Error('Not a directory in the bundle.');
        }
      }
      if (!(await lstat(at(file))).isFile()) throw new Error('Not a regular file.');
      // A link swapped in since the lstat fails the open (O_NOFOLLOW), and a
      // FIFO opens and ends at once (O_NONBLOCK).
      await options.beforeOpen?.(file);
      const chunks: Buffer[] = [];
      let length = 0;
      const stream = createReadStream(at(file), {
        // node:fs opens with numeric flags as well as strings, which is all
        // its types allow here: O_NOFOLLOW has no string form.
        flags: READ_FLAGS as unknown as string,
        start: 0,
        end: limit,
      });
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
        length += (chunk as Buffer).byteLength;
      }
      return new Uint8Array(Buffer.concat(chunks, length));
    },
  };
}

/**
 * The blobs a full export holds (#9, #10): each rendition of each asset the
 * unit's public view keeps, which is exactly what /media under read-only
 * and the demo's /reference/media serve, and what the demo's reference
 * holds. A private or unplaced asset's renditions stay out, and so does
 * every original, an image's or any other asset's, since no route serves
 * one. The view is #10's resolvePortfolioView(), with the build's content
 * extensions, as the server builds it. A media document that doesn't check
 * holds none. Sorted, each once.
 */
export function servedBlobs(
  unit: PublicationUnit,
  extensions: readonly ContentExtension[] = [],
): readonly Sha256[] {
  const parsed = parseMediaDocument(unit.media);
  if (!parsed.ok) return [];
  const view = resolvePortfolioView(
    unit,
    { media: unit.media, snapshots: unit.snapshots },
    { mediaBase: '/media', extensions },
  );
  const visible = new Set(Object.keys(view.media));
  const blobs = new Set<Sha256>();
  for (const record of parsed.value.assets) {
    if (!visible.has(record.assetId)) continue;
    for (const rendition of record.renditions) {
      if (rendition.sha256 === record.sha256) continue;
      if (!(RENDITION_TYPES as readonly string[]).includes(rendition.mime)) continue;
      blobs.add(`sha256:${rendition.sha256}`);
    }
  }
  return [...blobs].sort();
}

/**
 * Why `dir` can't be verified at all: it isn't a directory, or it's
 * reached through a symbolic link, at its own name or above it. Null when
 * it can be. `dir` is absolute.
 */
export async function bundleDirectoryProblem(
  dir: string,
): Promise<'missing' | 'not_directory' | 'linked' | null> {
  let found;
  try {
    found = await lstat(dir);
  } catch {
    return 'missing';
  }
  if (found.isSymbolicLink()) return 'linked';
  if (!found.isDirectory()) return 'not_directory';
  try {
    return (await realpath(dir)) === path.resolve(dir) ? null : 'linked';
  } catch {
    return 'missing';
  }
}

/**
 * `verify-revision <dir>`: the full export in `dir`, through the store-free
 * reader with the build's checks, with every blob servedBlobs() names
 * listed (blob_unlisted), as an export writes them. Every problem is the
 * reader's, with paths relative to `dir`.
 */
export function verifyExport(
  dir: string,
  checks: UnitChecks,
  extensions: readonly ContentExtension[] = [],
): Promise<VerifiedBundle> {
  return verifyBundle(bundleDirectory(dir), {
    checks,
    keep: (unit) => new Set(servedBlobs(unit, extensions)),
  });
}

export type { BundleProblem };
