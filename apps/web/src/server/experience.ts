import { FALLBACK_VARIANT_ID } from '@portfolio/schema/ids';
import { VARIANTS } from '../lib/generated/registry.meta';
import type { RegisteredIds } from '../lib/sample';
import type { Profile } from './capabilities';
import { liveComposition } from './config-store';

// The experience segments (#6, Slice 2). Registry generation writes one route
// segment per registered variant, the fallback composition's included:
// app/(site)/%5Fexperience/<id>/[[...route]]/page.tsx, which imports that
// variant and no other, so the client chunks of a page that renders it hold
// no other variant's code. Turbopack gives every page one client chunk group
// of every client module its server graph reaches, so one page that could
// load any variant put every variant's client code on every visitor's wire.
//
// proxy.ts rewrites each GET or HEAD of a visitor page to the segment of
// the composition that renders, from segmentFor(), which reads memory only:
// the live composition config-store holds, which the composition root's
// reader writes on every getLive(), and the request's own query. The page
// there reads the same value again, after it has read the live revision,
// and answers a 307 to the same URL when the revision changed in between.
// A request for a segment's own path, in any spelling, answers as a path no
// route matches. This module imports nothing that reads a request or a file,
// so proxy.ts can.

/** The first segment of every experience segment's path, which the contract reserves. */
export const EXPERIENCE_SEGMENT = '_experience';

/** The route table's pattern for the experience segment of the registered variant `id`. */
export function experiencePattern<Id extends string>(id: Id) {
  return `/${EXPERIENCE_SEGMENT}/${id}/[[...route]]` as const;
}

/** The pattern of /sample's routes, the one place a request's query picks the variant. */
export const SAMPLE_PATTERN = '/sample/[[...path]]';

/**
 * Whether a request's path is an experience segment's, however it's spelled:
 * in any case, percent-encoded, %5F and an encoded slash included, or with
 * a `.rsc` suffix. Nobody asks for one but proxy.ts's own rewrite, which
 * never comes back through proxy.ts.
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

/**
 * The experience segment a visitor page renders in. Under demo, /sample's
 * `?variant=` names it, when it names one variant this build registers; any
 * other value there is the fallback composition's, and the page answers it
 * as /sample always has. Everywhere else it's the live composition
 * config-store holds, or the fallback composition's when it holds none this
 * build registers. Owner and read-only never read the query. #19 adds the
 * visitor's variant from its preference cookie here, for a site whose
 * visitor controls make the variant selectable.
 */
export function segmentFor(
  request: { readonly profile: Profile; readonly pattern: string; readonly query: URLSearchParams },
  registered: RegisteredIds = VARIANTS,
): string {
  const known = (id: string | undefined): id is string =>
    id !== undefined &&
    id !== FALLBACK_VARIANT_ID &&
    registered.some(({ manifest }) => manifest.id === id);
  if (
    request.profile === 'demo' &&
    request.pattern === SAMPLE_PATTERN &&
    request.query.has('variant')
  ) {
    const named = request.query.getAll('variant');
    const [only] = named;
    return named.length === 1 && known(only) ? only : FALLBACK_VARIANT_ID;
  }
  const live = liveComposition();
  return known(live) ? live : FALLBACK_VARIANT_ID;
}
