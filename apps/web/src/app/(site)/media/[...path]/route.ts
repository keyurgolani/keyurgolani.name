import { mediaRendition } from '~/server/media-route';
import { served } from '~/server/route-guard';

export const dynamic = 'force-dynamic';

// A rendition of the live revision's media (#10, slice 2 item 5), at
// /media/<assetId>/<sha256>/<rendition>.<ext>. server/media-route.ts says
// what serves and what is a 404.
export const GET = served('/media/[...path]', mediaRendition);
