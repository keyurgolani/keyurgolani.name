// The CatalogReader port's types, which @portfolio/core defines (#3, item
// 19). App code imports them, and getLive(), from server/catalog.ts; this
// module only exists so config-store.ts can name the port without importing
// catalog.ts back. Types only: it loads nothing.

export type {
  CatalogReader,
  CatalogStatus,
  LiveRevision,
  PublicationUnit,
  RenderDrift,
  ServingState,
} from '@portfolio/core';
