import { liveSchemeStylesheet } from '~/server/generated-schemes';
import { served } from '~/server/route-guard';

export const dynamic = 'force-dynamic';

// A live revision's generated scheme (#20, #19's Slice 4 route), at
// /_portfolio/scheme/<schemeId>.<sha256-12>.css. server/generated-schemes.ts
// says what serves, compiled from the live revision's stored schemes, and
// what is a 404.
export const GET = served('/_portfolio/scheme/[file]', liveSchemeStylesheet);
