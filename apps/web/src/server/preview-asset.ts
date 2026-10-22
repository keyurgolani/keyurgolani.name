import 'server-only';
import { PREVIEW_STATUS, PREVIEW_STATUS_DOCUMENT, PREVIEW_STATUS_TYPE } from '~/preview/status';

// A draft-only asset under a grant (#7, Slice 2, item 7). proxy.ts has
// already checked the grant and the load's destination. Until #10 adds the
// rendition lookup behind the same check, every one is the status document.

export async function previewAsset(): Promise<Response> {
  return new Response(PREVIEW_STATUS_DOCUMENT, {
    status: PREVIEW_STATUS,
    headers: { 'content-type': PREVIEW_STATUS_TYPE, 'cache-control': 'private, no-store' },
  });
}
