import 'server-only';
import { Readable } from 'node:stream';
import { resolveRendition, type RenditionBlob } from '@portfolio/core';
import { getLive } from './catalog';
import { liveMediaDocument, openMediaBlob } from './live-media';
import { log } from './log';
import { getPublicView } from './public-view';

// GET /media/<assetId>/<sha256>/<rendition>.<ext> (#10, slice 2 item 5): a
// rendition of the live revision's media, for an asset its public view
// keeps, at the revision it holds. Each URL names one immutable file, so it
// caches for a year. Its Content-Type is the record's, never the URL's, and
// there's no Range: images only. A private, unknown, or superseded asset, an
// original, or any other path is the same 404, so a private asset's
// existence never shows, and a 404 is never cached. A rendition the record
// lists whose blob is gone answers 404 too, with no-store, and logs
// media.blob.missing once per asset in this process. Nothing derives or
// fetches here.

/** What a served rendition answers with besides its type and length. */
export const RENDITION_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'cache-control': 'public, max-age=31536000, immutable',
  'x-content-type-options': 'nosniff',
  'accept-ranges': 'none',
});

const reported = new Set<string>();

/** The 404 every path that serves nothing answers. */
export function mediaNotFound(): Response {
  return new Response('Not found.', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/** media.blob.missing, once per asset in this process. */
export function blobMissing(found: RenditionBlob): void {
  if (reported.has(found.assetId)) return;
  reported.add(found.assetId);
  log({ level: 'error', event: 'media.blob.missing', assetId: found.assetId });
}

/** A rendition's response: its blob's bytes under `headers`, or the 404 when the blob is gone. */
export async function renditionResponse(
  found: RenditionBlob,
  open: (hash: `sha256:${string}`) => Promise<Readable | null>,
  headers: Readonly<Record<string, string>>,
  head: boolean,
): Promise<Response> {
  const stream = await open(found.blob).catch(() => null);
  if (!stream) {
    blobMissing(found);
    return mediaNotFound();
  }
  const response = {
    status: 200,
    headers: {
      ...headers,
      'content-type': found.mime,
      'content-length': String(found.bytes),
    },
  };
  if (head) {
    stream.destroy();
    return new Response(null, response);
  }
  return new Response(Readable.toWeb(stream) as ReadableStream, response);
}

/** The route's segments after /media, decoded as Next gives them. */
async function segmentsOf(context: unknown): Promise<readonly string[]> {
  const params = await (context as { params?: Promise<{ path?: unknown }> } | undefined)?.params;
  return Array.isArray(params?.path) ? params.path.map(String) : [];
}

export async function mediaRendition(request: Request, context?: unknown): Promise<Response> {
  const segments = await segmentsOf(context);
  let found: RenditionBlob | null = null;
  try {
    const { unit } = await getLive();
    if (unit) {
      const view = await getPublicView();
      found = resolveRendition(liveMediaDocument(unit), new Set(Object.keys(view.media)), segments);
    }
  } catch {
    found = null;
  }
  if (!found) return mediaNotFound();
  return renditionResponse(found, openMediaBlob, RENDITION_HEADERS, request.method === 'HEAD');
}
