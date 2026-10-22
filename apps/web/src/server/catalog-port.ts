import type { Portfolio, Site } from '@portfolio/schema';

// Types for the CatalogReader port. App code imports them, and getLive(), from
// server/catalog.ts; this module only exists so config-store.ts can name the
// port without importing catalog.ts back.

/**
 * What a revision publishes: the portfolio's content and the site's
 * presentation, and beside them the unit's derived data (#10): its snapshots
 * by kind, such as github, and its media document once slice 2 derives one.
 * Both are plain JSON, which resolvePortfolioView() checks itself.
 */
export interface PublicationUnit {
  readonly portfolio: Portfolio;
  readonly site: Site;
  /** The unit's media document, media/media.json, when it has one. */
  readonly media?: unknown;
  /** Its snapshots by kind, from snapshots/<kind>.json: empty when it has none. */
  readonly snapshots: Readonly<Record<string, unknown>>;
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
