// @portfolio/core: what every profile may load (#3, item 19). The
// CatalogReader port, read-only's SourceCatalogReader, and the publication
// unit it shares with the revision store. Nothing here is owner code: no
// module this entry reaches records itself in the owner load trace, writes a
// file, or imports @portfolio/core/owner, which a test and check:deps both
// enforce. Server code only.
import 'server-only';

export type {
  CatalogReader,
  CatalogStatus,
  LiveRevision,
  PublicationUnit,
  RenderDrift,
  ServingState,
  SetServable,
} from './catalog/port';
export {
  sourceCatalogReader,
  sourceDigest,
  type OpenSourceResult,
  type SourceCatalogOptions,
  type SourceCatalogReader,
  type SourceFinding,
} from './catalog/source';
export {
  isSha256,
  type DocumentInput,
  type DocumentName,
  type Rendering,
  type Sha256,
  type UnitChecks,
  type UnitDiagnostic,
  type UnitInput,
  type Versioned,
} from './catalog/unit';
