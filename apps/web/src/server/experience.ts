import { FALLBACK_VARIANT_ID } from '@portfolio/schema/ids';
import { VARIANTS } from '../lib/generated/registry.meta';
import { sampleVariant } from '../lib/sample';
import { isWorkPath, rendersWorkPage, type WorkRouteManifest } from '../lib/work-page';
import type { Profile } from './capabilities';
import { liveComposition, servedReference } from './config-store';
import { EXPERIENCE_SEGMENT } from './route-header';

// The experience segments (#6, Slice 2). Registry generation writes one route
// segment per registered variant, the fallback composition's included:
// app/(site)/%5Fexperience/<id>/[[...route]]/page.tsx, which imports that
// variant and no other, so the client chunks of a page that renders it hold
// no other variant's code. Turbopack gives every page one client chunk group
// of every client module its server graph reaches, so one page that could
// load any variant put every variant's client code on every visitor's wire.
//
// proxy.ts marks each GET or HEAD of a visitor page with the segment of the
// composition that renders, from segmentFor(), which reads memory only: the
// live composition config-store holds, which the composition root's reader
// writes on every getLive(), and the request's own query. A work's own page
// goes to the fallback composition's segment when the composition leaves
// that page to the host (lib/work-page.ts, #10b). next.config.ts
// rewrites the request there. The page there reads the same value again,
// after it has read the live revision, and answers a 307 to the same URL
// when the revision changed in between. A request for a segment's own path,
// in any spelling, answers as a path no route matches. This module imports
// nothing that reads a request or a file, so proxy.ts can.

/** The route table's pattern for the experience segment of the registered variant `id`. */
export function experiencePattern<Id extends string>(id: Id) {
  return `/${EXPERIENCE_SEGMENT}/${id}/[[...route]]` as const;
}

/** The pattern of /sample's routes, where a request's query picks the variant. */
export const SAMPLE_PATTERN = '/sample/[[...path]]';

/**
 * The pattern of the demo's read-only reference (#9), whose query picks the
 * variant as /sample's does, and whose own selection is the reference's.
 */
export const REFERENCE_PATTERN = '/reference/[[...path]]';

/**
 * Whether a request's path is an experience segment's, however it's spelled:
 * in any case, percent-encoded, %5F and an encoded slash included, or with
 * a `.rsc` suffix. Only next.config.ts's rewrite of a request proxy.ts
 * marked reaches one, and it rewrites after proxy.ts has run.
 */
export function isExperiencePath(pathname: string): boolean {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // A path that doesn't decode is read as sent.
  }
  const first = decoded.split('/').find((segment) => segment !== '') ?? '';
  return first.replace(/\.rsc$/i, '').toLowerCase() === EXPERIENCE_SEGMENT;
}

/** The variants a segment can be: their ids, and how each takes the work route. */
export type RegisteredSegments = readonly { readonly manifest: WorkRouteManifest }[];

/** A visitor page's request, as segmentFor() reads it. */
export interface SegmentRequest {
  readonly profile: Profile;
  /** The route table's pattern for the path. */
  readonly pattern: string;
  /** The path's decoded segments, as the route table reads them. */
  readonly segments: readonly string[];
  readonly query: URLSearchParams;
}

const WORK_PATTERN = '/work/[slug]';

/**
 * Whether a visitor page is a work's own page (#10b): /work/<slug>, or
 * /sample/work/<slug> and /reference/work/<slug> under demo. A view below one, such as
 * /work/<slug>/credits, isn't.
 */
export function isWorkPage(request: Pick<SegmentRequest, 'pattern' | 'segments'>): boolean {
  if (request.pattern === WORK_PATTERN) return true;
  return (
    (request.pattern === SAMPLE_PATTERN || request.pattern === REFERENCE_PATTERN) &&
    isWorkPath(request.segments.slice(1))
  );
}

/**
 * The experience segment a visitor page renders in. Under demo, /sample's
 * and /reference's `?variant=` names it, when it names one variant this build registers; any
 * other value there falls back to the sample site's own selection, as no
 * value does, and the page sends the visitor on to the URL without it (#9).
 * Without one, /reference renders the composition the reference's site
 * selects (#9). Everywhere else it's the live composition config-store holds, or the
 * fallback composition's when it holds none this build registers. Owner and
 * read-only never read the query. On a work's own page, a composition that
 * leaves that page to the host gives way to the fallback composition (#10b).
 * #19 adds the visitor's variant from its
 * preference cookie here, for a site whose visitor controls make the
 * variant selectable.
 */
export function segmentFor(
  request: SegmentRequest,
  registered: RegisteredSegments = VARIANTS,
): string {
  const chosen = selectedSegment(request, registered);
  if (!isWorkPage(request)) return chosen;
  const manifest = registered.find((variant) => variant.manifest.id === chosen)?.manifest;
  return manifest && rendersWorkPage(manifest) ? chosen : FALLBACK_VARIANT_ID;
}

/** The segment of the composition a request selects, before the work page's rule. */
function selectedSegment(request: SegmentRequest, registered: RegisteredSegments): string {
  const known = (id: string | undefined): id is string =>
    id !== undefined &&
    id !== FALLBACK_VARIANT_ID &&
    registered.some(({ manifest }) => manifest.id === id);
  const queried = request.pattern === SAMPLE_PATTERN || request.pattern === REFERENCE_PATTERN;
  if (request.profile === 'demo' && queried) {
    const named = sampleVariant(request.query, registered);
    if (named !== undefined) return named;
  }
  // The reference renders its own site's composition, never the sample's.
  if (request.profile === 'demo' && request.pattern === REFERENCE_PATTERN) {
    const own = servedReference()?.composition;
    return known(own) ? own : FALLBACK_VARIANT_ID;
  }
  const live = liveComposition();
  return known(live) ? live : FALLBACK_VARIANT_ID;
}
