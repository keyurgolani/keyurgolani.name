import { previewAsset } from '~/server/preview-asset';
import { served } from '~/server/route-guard';

export const dynamic = 'force-dynamic';

// A draft-only asset under a grant (#7, Slice 2, item 7), at #10's path:
// /preview-assets/<grant>/<assetId>/<sha256>/<rendition>.<ext>. proxy.ts
// admits only an image, video, audio, track, or font load for an active
// grant. The rendition is #10's, from the media the grant pinned, served
// private and no-store; anything else is the status document.
export const GET = served('/preview-assets/[grant]/[...path]', previewAsset);
