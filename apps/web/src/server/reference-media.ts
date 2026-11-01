import 'server-only';
import { Readable } from 'node:stream';
import { resolveRendition } from '@portfolio/core';
import { servedReference } from './config-store';
import { mediaNotFound, renditionResponse, RENDITION_HEADERS } from './media-route';

// GET /reference/media/<assetId>/<sha256>/<rendition>.<ext> (#9): a
// rendition of the demo's read-only reference, under demo alone. It answers
// for an asset the reference's public view keeps, at exactly the revision
// its media document holds, and a rendition that record lists, as /media
// does for the live site. The bytes are the ones startup verified against
// the bundle and holds in memory: the request's path is only looked up in
// the view and the media document, never joined onto the mount, and the
// mount is never read here. Its Content-Type is the record's, with nosniff,
// cached for a year. Anything else is the same no-store 404: a private,
// unplaced, unknown, or superseded asset, an original, a malformed name, or
// no reference at all.

/** The route's segments after /reference/media, decoded as Next gives them. */
async function segmentsOf(context: unknown): Promise<readonly string[]> {
  const params = await (context as { params?: Promise<{ path?: unknown }> } | undefined)?.params;
  return Array.isArray(params?.path) ? params.path.map(String) : [];
}

export async function referenceRendition(request: Request, context?: unknown): Promise<Response> {
  const reference = servedReference();
  if (!reference) return mediaNotFound();
  const found = resolveRendition(
    reference.media,
    new Set(Object.keys(reference.view.media)),
    await segmentsOf(context),
  );
  const bytes = found ? reference.blob(found.blob) : undefined;
  if (!found || !bytes || bytes.byteLength !== found.bytes) return mediaNotFound();
  return renditionResponse(
    found,
    async () => Readable.from([Buffer.from(bytes)]),
    RENDITION_HEADERS,
    request.method === 'HEAD',
  );
}
