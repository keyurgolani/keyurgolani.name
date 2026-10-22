import path from 'node:path';
import type { Readable } from 'node:stream';
import { recordOwnerModule } from '../load-trace';
import { storageError } from './common';
import type { CrashPoint, FsPort } from './fs-port';
import { isSha256, tempBeside, type Sha256, type StorePaths } from './layout';
import { sha256 } from '../catalog/unit';

// The AssetStore (#3, item 17): content-addressed blobs under
// assets/sha256/<aa>/<hash>. A blob is written to a temporary file beside its
// place, synced, renamed there, and its directory synced, so one that has
// its name is whole and on disk. Nothing references a blob before put()
// returns, and a draft or a publish that references one that isn't there
// fails with asset_missing. #10's media document says what each blob is; the
// store keeps only the bytes. Puts don't take the publication lock: a blob
// only matters once a draft or a revision references it.

recordOwnerModule('core/store/assets');

export interface AssetStat {
  readonly sha256: Sha256;
  readonly size: number;
}

export interface AssetStore {
  /** Stores `bytes`, or finds them stored already, and returns their hash and size. */
  put(bytes: Uint8Array, mediaType: string): Promise<AssetStat>;
  has(hash: Sha256): Promise<boolean>;
  stat(hash: Sha256): Promise<AssetStat | null>;
  /** The blob's bytes as a stream, or null when it isn't stored. */
  open(hash: Sha256): Promise<Readable | null>;
}

const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

export function filesystemAssetStore({
  fs,
  paths,
}: {
  readonly fs: FsPort;
  readonly paths: StorePaths;
}): AssetStore {
  async function stat(hash: Sha256): Promise<AssetStat | null> {
    if (!isSha256(hash)) return null;
    try {
      // A blob is a regular file under its hash; a link there is none, and a put replaces it.
      const found = await fs.lstat(paths.blob(hash));
      return found?.isFile ? { sha256: hash, size: found.size } : null;
    } catch (error) {
      throw storageError(error);
    }
  }

  return {
    async put(bytes, mediaType) {
      if (!(bytes instanceof Uint8Array)) throw new TypeError('An asset is bytes.');
      if (typeof mediaType !== 'string' || !MEDIA_TYPE.test(mediaType)) {
        throw new TypeError('Not a media type.');
      }
      const hash = sha256(bytes);
      const found = await stat(hash);
      if (found && found.size === bytes.byteLength) return found;
      const file = paths.blob(hash);
      const dir = path.dirname(file);
      const temp = tempBeside(file);
      const point = (step: string): CrashPoint => `asset.${step}`;
      try {
        await fs.mkdir(dir, point('mkdir'));
        await fs.writeFile(temp, bytes, point('write'), { exclusive: true });
        await fs.fsync(temp, point('fsync'));
        await fs.rename(temp, file, point('rename'));
        await fs.fsync(dir, point('dir.fsync'));
        // A new <aa> directory is an entry in assets/sha256/ too.
        await fs.fsync(paths.assets, point('assets.fsync'));
      } catch (error) {
        await fs.remove(temp, point('temp.remove')).catch(() => {});
        throw storageError(error);
      }
      return { sha256: hash, size: bytes.byteLength };
    },
    async has(hash) {
      return (await stat(hash)) !== null;
    },
    stat,
    async open(hash) {
      if (!(await stat(hash))) return null;
      return fs.createReadStream(paths.blob(hash));
    },
  };
}
