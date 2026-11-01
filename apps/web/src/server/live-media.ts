import 'server-only';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { getDeploymentState } from './config-store';
import { settledStartupMedia } from './startup-media';

// The media the live unit shows (#10), whichever profile serves it. owner's
// comes with its revision, its blobs in the data directory's AssetStore,
// which the owner composition binds as DeploymentState.mediaBlobs. A pair
// read-only or demo serves has none of its own until startup derivation
// finishes; then its document and its blobs are the media cache's. Nothing
// here derives or fetches: a request only reads what's there.

/** The media document the live unit shows: its own, or the startup derivation's once it finished. */
export function liveMediaDocument(unit: { readonly media?: unknown }): unknown {
  if (unit.media !== undefined) return unit.media;
  return settledStartupMedia()?.document;
}

/** The bytes of a blob the live media names, or null when it isn't stored. */
export async function openMediaBlob(hash: `sha256:${string}`): Promise<Readable | null> {
  const bound = getDeploymentState()?.mediaBlobs;
  if (bound) return bound(hash);
  const file = await settledStartupMedia()?.blobs.file(hash);
  return file ? createReadStream(file) : null;
}
