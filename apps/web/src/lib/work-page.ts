import { FALLBACK_VARIANT_ID } from '@portfolio/schema/ids';

// Which composition renders a work's own page, /work/<slug> (#10b). A
// variant whose manifest says `routes.work: bespoke` renders it itself. One
// that says `shared` leaves the page to the host, which renders it through
// the fallback composition: the kit's CaseStudy as the page's one h1, and
// the way home. So every registered composition has case-study pages, and a
// composition that lays out only a home never shows that home at a work's
// address. A view a variant declares under work, such as
// /work/<slug>/credits, is that variant's own and renders in it either way.
// proxy.ts, through segmentFor(), and the page, through
// resolveVisitorPath(), both ask this, so the segment the proxy names is
// the one the page renders in.

/** What the rule reads from a variant's manifest: its id and how it takes the work route. */
export interface WorkRouteManifest {
  readonly id: string;
  readonly routes: { readonly work: 'bespoke' | 'shared' };
}

/**
 * Whether the composition of `manifest` renders a work's own page itself:
 * the fallback composition does, and so does a variant whose `routes.work`
 * is `bespoke`. For any other, the fallback composition renders it.
 */
export function rendersWorkPage(manifest: WorkRouteManifest): boolean {
  return manifest.id === FALLBACK_VARIANT_ID || manifest.routes.work === 'bespoke';
}
