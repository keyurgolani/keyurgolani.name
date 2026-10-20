import type { Portfolio } from '@portfolio/schema';

// Types for the CatalogReader port. App code imports them, and getLive(), from
// server/catalog.ts; this module only exists so config-store.ts can name the
// port without importing catalog.ts back.

/** The documents a revision publishes. */
export interface PublicationUnit {
  readonly portfolio: Portfolio;
}

/** The revision the public site renders. */
export interface LiveRevision {
  /** For the documents adapter, `doc-` plus 12 hex digits of the source's SHA-256. */
  readonly revisionId: string;
  readonly unit: PublicationUnit;
}

/**
 * Where the published catalog comes from. register() builds one adapter per
 * deployment: the mounted documents for `read-only`, today.
 */
export interface CatalogReader {
  getLive(): Promise<LiveRevision>;
}
