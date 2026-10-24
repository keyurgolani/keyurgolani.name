// @portfolio/core: what every profile may load (#3, item 19). The
// CatalogReader port, read-only's SourceCatalogReader, the publication unit
// it shares with the revision store, and #10's media pipeline, which owner
// runs into its AssetStore and read-only and demo run once at startup.
// Nothing here is owner code: no module this entry reaches records itself in
// the owner load trace or imports @portfolio/core/owner, which a test and
// check:deps both enforce, and the only files it writes are read-only's and
// demo's startup media cache, in a temp directory of their own. Server code
// only.
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
  contentHash,
  isSha256,
  unitHashOf,
  type DocumentInput,
  type DocumentName,
  type Rendering,
  type Sha256,
  type UnitChecks,
  type UnitDiagnostic,
  type UnitInput,
  type Versioned,
} from './catalog/unit';
// #10's generated schemes (10h): the generators a build hands the store in
// UnitChecks.schemes. Types only, from a module that holds no code.
export type {
  GeneratorDeclaration,
  SchemeGenerators,
  SchemeInput,
  SchemeRun,
} from './catalog/schemes';

// #10's media pipeline: startup derivation for read-only and demo, and what
// it's made of, which owner's ingestion shares.
export {
  deriveStartupMedia,
  directoryBlobStore,
  MEDIA_CACHE_DIR,
  MediaCacheError,
  type StartupMedia,
  type StartupMediaLogEntry,
  type StartupMediaOptions,
} from './catalog/media/startup';
export { type MediaBlobStore, type MediaFinding, type MediaLogEntry } from './catalog/media/ingest';
export { localMediaRoot, type LocalMediaRoot } from './catalog/media/local';
export { remoteImageFetcher, type RemoteFetcher } from './catalog/media/remote';
export { resolveRendition, type RenditionBlob } from './catalog/media/resolve';

// A full export's bundle, verified without a store (#9's read-only reference;
// #3's provisional bundle format 1).
export {
  BUNDLE_FILE,
  BUNDLE_FORMAT,
  BUNDLE_LIMITS,
  parseBundle,
  verifyBundle,
  type Bundle,
  type BundleDocument,
  type BundleEntry,
  type BundleFiles,
  type BundleProblem,
  type BundleProblemCode,
  type VerifiedBundle,
  type VerifyBundleOptions,
} from './catalog/bundle';
