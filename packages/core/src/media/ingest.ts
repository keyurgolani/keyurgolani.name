import { createHash } from 'node:crypto';
import {
  isHttpsMediaUrl,
  isMediaRootPath,
  isPlainObject,
  isSectionId,
  parseMediaDocument,
  type MediaAvailability,
  type MediaDocument,
  type MediaRecord,
  type MediaRecordSource,
  type MediaUnavailableReason,
} from '@portfolio/schema';
import { recordOwnerModule } from '../load-trace';
import type { AssetStore } from '../store/assets';
import { ALGORITHM_VERSION, deriveImage, loadSharp, type SharpLoad } from './derive';
import { MediaSourceError } from './limits';
import type { LocalMediaRoot } from './local';
import type { RemoteFetcher } from './remote';

// Media ingestion (#10, items 5 and 6), owner only: the media document a
// draft takes, from its portfolio's `media` entries and the records it had.
// For each image entry, in authored order, it reads the source (a path
// under the media root, or, when the caller may fetch, an https URL),
// derives its renditions, writes the source and every rendition to #3's
// AssetStore, and records one asset revision. The AssetStore keeps the
// original for retention, never to serve it.
//
// What the draft had stays until a replacement validates (item 6):
// - the same bytes keep their revision, renditions and all, whatever the
//   file is called now (a rename), and a source that was gone and is back
//   with the same bytes is available again (restored);
// - new bytes (a replacement, or a metadata edit) become the revision only
//   once they derive and the record checks;
// - a source that is missing, unreachable, refused, or invalid leaves the
//   last revision in place, marked unavailable since it first went;
// - when sharp won't load, nothing new derives and every revision stays.
// It never touches a published revision: those are frozen in their own
// media documents, over blobs the AssetStore never rewrites.
//
// A remote source is fetched again only when its URL changed or its last
// read failed, so saving a draft doesn't refetch every image. One ingestion
// runs at a time, one asset at a time. Audio, video, and documents aren't
// ingested here (images only).

recordOwnerModule('core/media/ingest');

/** One thing ingestion found about an asset: the reason its source wasn't used, and the detail. */
export interface MediaFinding {
  readonly assetId: string;
  readonly reason: MediaUnavailableReason | 'renditions_unavailable';
  readonly code: string;
  /** Whether the asset still has a revision: the last good one. */
  readonly kept: boolean;
}

export interface IngestInput {
  /** The draft's portfolio model, as parsed; its `media` entries are read leniently. */
  readonly portfolio: unknown;
  /** The media document the draft had, or null. */
  readonly previous: MediaDocument | null;
  /** Whether this call may fetch remote sources (#1's media.fetchRemote). */
  readonly fetchRemote: boolean;
}

export interface IngestResult {
  readonly document: MediaDocument;
  readonly findings: readonly MediaFinding[];
  /** The assets that derived a new revision this time. */
  readonly derived: readonly string[];
}

export interface MediaIngestion {
  ingest(input: IngestInput): Promise<IngestResult>;
}

/** One line for the server log: the asset's id, its hash, and codes, never a path, a URL, or bytes. */
export interface MediaLogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly event: 'media.asset.derived' | 'media.source.unused';
  readonly assetId: string;
  readonly sha256?: string;
  readonly reason?: string;
  readonly code?: string;
}

export interface MediaIngestionOptions {
  readonly assets: AssetStore;
  /** PORTFOLIO_MEDIA_ROOT, when set. Without one, every local source is unreachable. */
  readonly root?: LocalMediaRoot;
  /** The remote fetcher. Without one, every remote source is unreachable. */
  readonly fetchRemote?: RemoteFetcher;
  /** Tests pass a loader that fails, as on a platform without sharp's binary. */
  readonly sharp?: () => Promise<SharpLoad>;
  readonly now?: () => number;
  readonly log?: (entry: MediaLogEntry) => void;
}

/** An authored media entry as far as ingestion reads it. */
interface Entry {
  readonly id: string;
  readonly source: MediaRecordSource;
}

const hexOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The image entries of a portfolio model, in order, each id once; anything malformed is skipped. */
function imageEntries(portfolio: unknown): Entry[] {
  const media = isPlainObject(portfolio) ? portfolio.media : undefined;
  if (!Array.isArray(media)) return [];
  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const item of media) {
    if (!isPlainObject(item) || item.kind !== 'image') continue;
    const { id, source } = item;
    if (typeof id !== 'string' || !isSectionId(id) || seen.has(id)) continue;
    if (typeof source !== 'string') continue;
    seen.add(id);
    if (/^https:/i.test(source)) {
      if (isHttpsMediaUrl(source)) entries.push({ id, source: { kind: 'remote', url: source } });
    } else if (isMediaRootPath(source)) {
      entries.push({ id, source: { kind: 'local', path: source } });
    }
  }
  return entries;
}

const sameSource = (a: MediaRecordSource, b: MediaRecordSource) =>
  a.kind === b.kind &&
  (a.kind === 'local' ? a.path === (b as typeof a).path : a.url === (b as typeof a).url);

export function mediaIngestion({
  assets,
  root,
  fetchRemote,
  sharp = loadSharp,
  now = Date.now,
  log = () => {},
}: MediaIngestionOptions): MediaIngestion {
  const stamp = () => new Date(now()).toISOString();
  let queue: Promise<unknown> = Promise.resolve();

  async function read(source: MediaRecordSource, mayFetch: boolean): Promise<Uint8Array> {
    if (source.kind === 'local') {
      if (!root) {
        throw new MediaSourceError('unreachable', 'root_unset', 'PORTFOLIO_MEDIA_ROOT is not set.');
      }
      return root.read(source.path);
    }
    if (!mayFetch || !fetchRemote) {
      throw new MediaSourceError(
        'unreachable',
        'fetch_denied',
        'Remote sources are not fetched here.',
      );
    }
    return fetchRemote(source.url);
  }

  /** Whether every blob a record names is in the AssetStore. */
  async function stored(record: MediaRecord): Promise<boolean> {
    for (const hash of [record.sha256, ...record.renditions.map(({ sha256 }) => sha256)]) {
      if (!(await assets.has(`sha256:${hash}`))) return false;
    }
    return true;
  }

  /** `record`, unavailable for `reason` since it first was. */
  function unavailable(record: MediaRecord, reason: MediaUnavailableReason): MediaRecord {
    const was = record.availability;
    const availability: MediaAvailability =
      was.state === 'unavailable' && was.reason === reason
        ? was
        : { state: 'unavailable', reason, since: stamp() };
    return { ...record, availability };
  }

  /** Derives `bytes` and writes every blob: the record, or a MediaSourceError. */
  async function derive(
    entry: Entry,
    bytes: Uint8Array,
    hash: string,
    sharpFn: Extract<SharpLoad, { ok: true }>['sharp'],
  ): Promise<MediaRecord> {
    const image = await deriveImage(sharpFn, bytes);
    const renditions = [];
    for (const rendition of image.renditions) {
      renditions.push({
        name: rendition.name,
        ext: rendition.ext,
        mime: rendition.mime,
        bytes: rendition.bytes.byteLength,
        width: rendition.width,
        height: rendition.height,
        sha256: hexOf(rendition.bytes),
      });
    }
    const record: MediaRecord = {
      assetId: entry.id,
      sha256: hash,
      mime: image.mime,
      bytes: bytes.byteLength,
      width: image.width,
      height: image.height,
      aspectRatio: image.aspectRatio,
      dominantColor: image.dominantColor,
      renditions,
      derivedAt: stamp(),
      algorithmVersion: ALGORITHM_VERSION,
      source: entry.source,
      availability: { state: 'available' },
    };
    // The metadata validates before any blob is written, and before the draft sees it.
    if (!parseMediaDocument({ assets: [record] }).ok) {
      throw new MediaSourceError('invalid', 'record_invalid', 'The derived record does not check.');
    }
    await assets.put(bytes, image.mime);
    for (const rendition of image.renditions) await assets.put(rendition.bytes, rendition.mime);
    return record;
  }

  async function run({
    portfolio,
    previous,
    fetchRemote: mayFetch,
  }: IngestInput): Promise<IngestResult> {
    const before = new Map((previous?.assets ?? []).map((record) => [record.assetId, record]));
    const records: MediaRecord[] = [];
    const findings: MediaFinding[] = [];
    const derived: string[] = [];
    let sharpLoad: SharpLoad | undefined;

    for (const entry of imageEntries(portfolio)) {
      const last = before.get(entry.id);
      const keep = (reason: MediaFinding['reason'], code: string, record = last) => {
        findings.push({ assetId: entry.id, reason, code, kept: record !== undefined });
        log({ level: 'warn', event: 'media.source.unused', assetId: entry.id, reason, code });
        if (record) records.push(record);
      };
      // An unchanged remote source that last read fine isn't fetched again.
      if (
        last &&
        entry.source.kind === 'remote' &&
        sameSource(last.source, entry.source) &&
        last.availability.state === 'available'
      ) {
        records.push(last);
        continue;
      }
      let bytes: Uint8Array;
      try {
        bytes = await read(entry.source, mayFetch);
      } catch (error) {
        if (!(error instanceof MediaSourceError)) throw error;
        keep(error.reason, error.code, last && unavailable(last, error.reason));
        continue;
      }
      const hash = hexOf(bytes);
      if (last && last.sha256 === hash && last.algorithmVersion === ALGORITHM_VERSION) {
        if (await stored(last)) {
          // The same revision: renamed, restored, or untouched.
          records.push({ ...last, source: entry.source, availability: { state: 'available' } });
          continue;
        }
      }
      sharpLoad ??= await sharp();
      if (!sharpLoad.ok) {
        keep('renditions_unavailable', sharpLoad.code);
        continue;
      }
      try {
        records.push(await derive(entry, bytes, hash, sharpLoad.sharp));
        derived.push(entry.id);
        log({ level: 'info', event: 'media.asset.derived', assetId: entry.id, sha256: hash });
      } catch (error) {
        if (!(error instanceof MediaSourceError)) throw error;
        keep(error.reason, error.code, last && unavailable(last, error.reason));
      }
    }
    return { document: { assets: records }, findings, derived };
  }

  return {
    ingest(input) {
      const next = queue.then(() => run(input));
      queue = next.catch(() => {});
      return next;
    },
  };
}
