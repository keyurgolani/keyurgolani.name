// The cache rule for the files registry generation names by content hash
// under public/_portfolio/ (#6, item 8): pack stylesheets, fonts, variant
// stylesheets, the images those name, and catalog stills. Each one's URL
// carries the first 12 hex digits of its SHA-256, so its bytes never change
// there, and a build that changes them writes a new URL. next.config.ts
// sends IMMUTABLE on exactly the spelling CONTENT_HASHED matches, and
// proxy.ts answers anything else under /_portfolio/, a hashed name the
// registry never wrote included, with its plain no-store 404 before Next
// serves a file. Documents, /api, /preview, and Studio keep their own rules.

/** A year, immutable: a browser never asks again for the same URL. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * A content-hashed file's path, as a Next header source: one of the served
 * directories, then `<id>.<sha256-12>.<ext>`, or an image's `<sha256-12>.<ext>`.
 */
export const CONTENT_HASHED =
  '/_portfolio/:kind(pack|font|variant|asset|still)/:file((?:[a-z_][a-z0-9-]*\\.)?[0-9a-f]{12}\\.(?:css|woff2|avif|gif|jpeg|jpg|png|svg|webp))';
