import 'server-only';

// The catalog, as every page and metadata route reads it (#1, item 3): the
// live revision register() built a CatalogReader for, once per request
// (live-revision.ts), and the port's types.

export type { CatalogReader, LiveRevision, PublicationUnit } from './catalog-port';
export { getLive } from './live-revision';
