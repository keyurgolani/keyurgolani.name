import { referenceRendition } from '~/server/reference-media';
import { served } from '~/server/route-guard';

export const dynamic = 'force-dynamic';

// A rendition of the demo's read-only reference (#9), at
// /reference/media/<assetId>/<sha256>/<rendition>.<ext>, under demo alone.
// server/reference-media.ts says what serves and what is a 404.
export const GET = served('/reference/media/[...path]', referenceRendition);
