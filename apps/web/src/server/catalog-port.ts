import type { Portfolio, Site } from '@portfolio/schema';

// Types for the CatalogReader port. App code imports them, and getLive(), from
// server/catalog.ts; this module only exists so config-store.ts can name the
// port without importing catalog.ts back.

/** The documents a revision publishes: the portfolio's content and the site's presentation. */
export interface PublicationUnit {
  readonly portfolio: Portfolio;
  readonly site: Site;
}

/** The revision the public site renders. */
export interface LiveRevision {
  /**
   * `doc-` for the documents adapter and `sample-` for the sample's, plus 12
   * hex digits of a SHA-256 over both documents' names and text.
   */
  readonly revisionId: string;
  readonly unit: PublicationUnit;
}

/**
 * Where the published catalog comes from. register() builds one adapter per
 * deployment: the mounted documents for `read-only` and, until #3, `owner`,
 * and the bundled sample for `demo`.
 */
export interface CatalogReader {
  getLive(): Promise<LiveRevision>;
}
