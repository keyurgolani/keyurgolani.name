import type { MediaUnavailableReason } from '@portfolio/schema';

// The media pipeline's limits and its one error (#10, slice 2 item 3). Each
// source is read whole, at most 20 MiB, and decoded at most 100 megapixels,
// so a decompression bomb stops before it is decoded; a remote one gets 15 s
// and 3 redirects in all. Images only: JPEG, PNG, WebP, and AVIF.

export const MEDIA_LIMITS = Object.freeze({
  /** The most a source may hold: 20 MiB. */
  sourceBytes: 20 * 1024 * 1024,
  /** The most pixels a source may decode to. */
  pixels: 100_000_000,
  /** How long one remote fetch may take, redirects and DNS included. */
  remoteTimeoutMs: 15_000,
  /** How many redirects one remote fetch may follow. */
  redirects: 3,
});

/** The image types a source may be, by what its bytes say. */
export const IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif';

/**
 * Why one source can't be used. `reason` is what the record says (#10's
 * availability), `code` the finding's detail, such as `path_escape` or
 * `address_blocked`. The message never holds the path, URL, or address.
 */
export class MediaSourceError extends Error {
  readonly reason: MediaUnavailableReason;
  readonly code: string;
  constructor(reason: MediaUnavailableReason, code: string, message: string) {
    super(message);
    this.name = 'MediaSourceError';
    this.reason = reason;
    this.code = code;
  }
}

export const refused = (code: string, message: string) =>
  new MediaSourceError('refused', code, message);
