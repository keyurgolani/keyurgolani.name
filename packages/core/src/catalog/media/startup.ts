import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isPlainObject, type MediaDocument } from '@portfolio/schema';
import type { SharpLoad } from './derive';
import {
  mediaIngestion,
  type MediaBlobStore,
  type MediaFinding,
  type MediaLogEntry,
} from './ingest';
import type { LocalMediaRoot } from './local';
import type { RemoteFetcher } from './remote';

// Startup derivation for read-only and demo (#10, slice 2 item 3, Risk 3).
// With no exported media/ beside the pair, they derive the media document
// once, as the server starts, into a media cache of their own: the
// renditions and sources by hash, under a directory only this user can
// read. read-only reads local sources under PORTFOLIO_MEDIA_ROOT and fetches
// https ones; demo reads its bundled media and fetches nothing. Nothing
// derives or fetches on a visitor request. Since a changed media file
// changes the page on the next start, the log lists every asset's hash as
// it derives, so a restart's change is on record.

/** The cache read-only and demo derive into: a directory of their own in the temp directory. */
export const MEDIA_CACHE_DIR = path.join(os.tmpdir(), 'portfolio-media');

const HASH = /^sha256:([0-9a-f]{64})$/;

/**
 * A content-addressed blob directory, `<dir>/sha256/<aa>/<hex>`: the blobs a
 * startup derivation writes. Each is written to a temporary file beside its
 * place, then renamed there, so one with its name is whole. The directory
 * is made 0700 and each file 0600; a link or anything but a regular file
 * at a blob's name is no blob.
 */
export function directoryBlobStore(dir: string): MediaBlobStore & {
  /** Where a blob is, or null when it isn't stored. */
  file(hash: `sha256:${string}`): Promise<string | null>;
} {
  if (!path.isAbsolute(dir)) throw new TypeError('The media cache is an absolute path.');
  const place = (hash: string) => {
    const hex = HASH.exec(hash)?.[1];
    if (!hex) throw new TypeError('Not a SHA-256 digest.');
    return path.join(dir, 'sha256', hex.slice(0, 2), hex);
  };
  const stored = async (hash: `sha256:${string}`) => {
    const file = place(hash);
    const found = await lstat(file).catch(() => null);
    return found?.isFile() ? file : null;
  };
  return {
    async put(bytes) {
      const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}` as const;
      if (await stored(hash)) return { sha256: hash };
      const file = place(hash);
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temp = path.join(path.dirname(file), `.${randomBytes(6).toString('hex')}.tmp`);
      const handle = await open(
        temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(bytes);
      } finally {
        await handle.close();
      }
      try {
        await rename(temp, file);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
      return { sha256: hash };
    },
    async has(hash) {
      return (await stored(hash)) !== null;
    },
    file: stored,
  };
}

/** The media cache isn't a directory of this user's own, closed to everyone else. */
export class MediaCacheError extends Error {
  readonly code = 'media_cache_unsafe';
  constructor() {
    super("The media cache isn't a directory only this user owns and can open.");
    this.name = 'MediaCacheError';
  }
}

export interface StartupMediaOptions {
  /** The pair's portfolio model. */
  readonly portfolio: unknown;
  /** Where local sources resolve: PORTFOLIO_MEDIA_ROOT, or demo's bundled media. */
  readonly root?: LocalMediaRoot;
  /** read-only's fetcher. demo passes none, so it fetches nothing. */
  readonly fetchRemote?: RemoteFetcher;
  /** The media cache. Defaults to MEDIA_CACHE_DIR. */
  readonly cacheDir?: string;
  readonly sharp?: () => Promise<SharpLoad>;
  readonly now?: () => number;
  readonly log?: (entry: MediaLogEntry | StartupMediaLogEntry) => void;
}

/** The startup log's line for each asset revision derived (Risk 3): its id and its hash. */
export interface StartupMediaLogEntry {
  readonly level: 'info';
  readonly event: 'media.startup.asset';
  readonly assetId: string;
  readonly sha256: string;
}

export interface StartupMedia {
  readonly document: MediaDocument;
  readonly findings: readonly MediaFinding[];
  /** The blob store the document's blobs are in, for serving them. */
  readonly blobs: ReturnType<typeof directoryBlobStore>;
}

/** Derives the pair's media document at startup, into the media cache. */
export async function deriveStartupMedia({
  portfolio,
  root,
  fetchRemote,
  cacheDir = MEDIA_CACHE_DIR,
  sharp,
  now,
  log = () => {},
}: StartupMediaOptions): Promise<StartupMedia> {
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  // In a shared temp directory, someone else could have made it first, or
  // put a link there: only this user's own directory, closed to others, is
  // the cache.
  const found = await lstat(cacheDir);
  const uid = process.getuid?.();
  if (
    !found.isDirectory() ||
    (uid !== undefined && found.uid !== uid) ||
    (found.mode & 0o077) !== 0
  ) {
    throw new MediaCacheError();
  }
  const blobs = directoryBlobStore(cacheDir);
  const ingestion = mediaIngestion({
    assets: blobs,
    ...(root ? { root } : {}),
    ...(fetchRemote ? { fetchRemote } : {}),
    ...(sharp ? { sharp } : {}),
    ...(now ? { now } : {}),
    log,
  });
  const { document, findings } = await ingestion.ingest({
    portfolio,
    previous: null,
    fetchRemote: fetchRemote !== undefined,
  });
  // A private asset's id and hash stay out of the log: ingestion counted them.
  const media = isPlainObject(portfolio) ? portfolio.media : undefined;
  const hidden = new Set(
    (Array.isArray(media) ? media : [])
      .filter((item) => isPlainObject(item) && item.visibility === 'private')
      .map((item) => (item as { id?: unknown }).id),
  );
  for (const record of document.assets) {
    if (hidden.has(record.assetId)) continue;
    log({
      level: 'info',
      event: 'media.startup.asset',
      assetId: record.assetId,
      sha256: record.sha256,
    });
  }
  return { document, findings, blobs };
}
