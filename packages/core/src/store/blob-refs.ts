import { recordOwnerModule } from '../load-trace';
import type { Sha256 } from './layout';

// The blobs a draft's media document names, read the way retention and
// verify need them (#10): by shape alone. A document this build's schema
// would refuse, such as one a newer build wrote with a field this one
// doesn't know, still names its blobs, and dropping them because it no
// longer checks would lose what only that draft holds. Every `sha256` of a
// record and of its renditions that is 64 lowercase hex counts, whatever
// else the record holds.

recordOwnerModule('core/store/blob-refs');

const HEX = /^[0-9a-f]{64}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The `sha256:` blobs a media document names, or null when it isn't a
 * media document's shape at all (no `assets` list), so nothing can be said
 * about what it keeps.
 */
export function scanMediaBlobs(media: unknown): Sha256[] | null {
  if (!isObject(media) || !Array.isArray(media.assets)) return null;
  const blobs = new Set<Sha256>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && HEX.test(value)) blobs.add(`sha256:${value}` as Sha256);
  };
  for (const record of media.assets) {
    if (!isObject(record)) continue;
    add(record.sha256);
    if (!Array.isArray(record.renditions)) continue;
    for (const rendition of record.renditions) {
      if (isObject(rendition)) add(rendition.sha256);
    }
  }
  return [...blobs];
}
