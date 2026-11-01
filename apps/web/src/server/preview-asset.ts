import 'server-only';
import { PREVIEW_STATUS, PREVIEW_STATUS_DOCUMENT, PREVIEW_STATUS_TYPE } from '~/preview/status';
import { getDeploymentState } from './config-store';
import { renditionResponse } from './media-route';

// A draft-only asset under a grant (#7, Slice 2, item 7; #10): a rendition
// the grant's view keeps, at /preview-assets/<grant>/<assetId>/<sha256>/
// <rendition>.<ext>. proxy.ts has already checked the grant and the load's
// destination; the port checks the grant again, reads the media the grant
// pinned, and resolves the rendition as /media does. It answers private,
// no-store, never the public cache's year. Anything it doesn't keep, and a
// grant that isn't active, is the status document.

/** What a served preview rendition answers with besides its type and length. */
export const PREVIEW_RENDITION_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  'accept-ranges': 'none',
});

/** The status document a grant route answers when it serves nothing (#7), private and no-store. */
export function previewStatusDocument(): Response {
  return new Response(PREVIEW_STATUS_DOCUMENT, {
    status: PREVIEW_STATUS,
    headers: { 'content-type': PREVIEW_STATUS_TYPE, 'cache-control': 'private, no-store' },
  });
}

/** The grant and the media path below it, as Next gives them. */
async function paramsOf(
  context: unknown,
): Promise<{ readonly grant: string; readonly segments: readonly string[] }> {
  const params = await (
    context as { params?: Promise<{ grant?: unknown; path?: unknown }> } | undefined
  )?.params;
  return {
    grant: typeof params?.grant === 'string' ? params.grant : '',
    segments: Array.isArray(params?.path) ? params.path.map(String) : [],
  };
}

export async function previewAsset(request: Request, context?: unknown): Promise<Response> {
  const previews = getDeploymentState()?.previews;
  if (!previews) return previewStatusDocument();
  const { grant, segments } = await paramsOf(context);
  const found = await previews.asset(grant, segments).catch(() => null);
  if (!found) return previewStatusDocument();
  const response = await renditionResponse(
    found,
    () => found.open(),
    PREVIEW_RENDITION_HEADERS,
    request.method === 'HEAD',
  );
  // A blob that's gone answers what any refusal does here.
  return response.status === 200 ? response : previewStatusDocument();
}
