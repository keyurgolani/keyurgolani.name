import { previewSchemeStylesheet } from '~/server/generated-schemes';
import { served } from '~/server/route-guard';

export const dynamic = 'force-dynamic';

// A generated scheme a grant's subject stored (#20), at
// /preview-assets/<grant>/_appearance/<schemeId>.<sha256-12>.css. proxy.ts
// admits only a style load for an active grant; server/generated-schemes.ts
// compiles it from the grant's schemes, private and no-store, and answers
// anything else with the status document.
export const GET = served('/preview-assets/[grant]/_appearance/[file]', previewSchemeStylesheet);
