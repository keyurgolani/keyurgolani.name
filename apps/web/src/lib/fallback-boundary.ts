import {
  boundaryAttributes,
  stylesheetHrefs,
  type BoundaryAttributes,
} from '@portfolio/appearance';
import { FALLBACK_ID } from '@portfolio/variant-contract';
import { APPEARANCE_STYLESHEETS } from './appearance-registry';
import { documentAppearance } from './document-appearance';

// The boundary a page with no site renders in (#19, Slice 4): the 503 while
// nothing serves, and the error page when a page fails. It's the platform's
// fallback packs on every axis, in the system's display mode, so it reads
// nothing that could be what failed: no site, no cookie, no query. The
// error page is a client component, so the site's layout hands it this as
// plain data (app/_chrome/fallback-boundary.tsx).

/** A fallback-pack boundary's attributes and stylesheets, as plain data. */
export interface FallbackBoundaryData {
  readonly attributes: BoundaryAttributes;
  readonly stylesheets: readonly string[];
}

/** The fallback packs' document boundary. */
export function fallbackBoundary(): FallbackBoundaryData {
  const appearance = documentAppearance({ site: null, variant: FALLBACK_ID, profile: 'read-only' });
  return {
    attributes: boundaryAttributes(appearance, 'document'),
    stylesheets: stylesheetHrefs(appearance.selection, APPEARANCE_STYLESHEETS),
  };
}
