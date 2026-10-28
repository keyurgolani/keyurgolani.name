// The schema version each document declares (#10, item 1). The portfolio
// moved to 3 with the content model; the site document stays at 2. The
// unversioned one-file format counts as version 1.

/** The portfolio document's `schemaVersion`. */
export const PORTFOLIO_SCHEMA_VERSION = 3;

/** The site document's `schemaVersion`. */
export const SITE_SCHEMA_VERSION = 2;

/** This build's schema version per document. #3's compatibility check and startup read it. */
export const SCHEMA_VERSIONS: Readonly<{ portfolio: number; site: number }> = Object.freeze({
  portfolio: PORTFOLIO_SCHEMA_VERSION,
  site: SITE_SCHEMA_VERSION,
});
