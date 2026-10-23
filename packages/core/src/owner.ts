// @portfolio/core/owner: the owner code (#1, item 14). Only the web app's
// server/owner/ modules and the composition root's owner branch import it,
// which check:deps enforces, so demo and read-only never load it. What every
// profile may load is @portfolio/core, src/index.ts. Server code only.
import 'server-only';
import { recordOwnerModule } from './load-trace';

recordOwnerModule('core/owner');

export {
  credentialFingerprint,
  formatHash,
  HASH_CEILING,
  HASH_FLOOR,
  hashPassword,
  parameterProblem,
  parseHash,
  type PasswordHash,
  type ScryptParams,
} from './auth/phc.mjs';
export {
  localPasswordProvider,
  type AuthProvider,
  type LocalPasswordOptions,
  type Principal,
  type Verification,
} from './auth/provider';
export { syncCredentialFingerprint } from './auth/fingerprint';
export {
  filesystemSessionStore,
  memorySessionStore,
  type SessionRecord,
  type SessionStore,
  type UaFamily,
} from './auth/session-store';
export {
  assertSessionHeld,
  browserFamily,
  COMMIT_TIMEOUT_MS,
  createSessions,
  enterCommitPoint,
  isSessionHeld,
  MAX_SESSIONS,
  SESSION_LIFETIME,
  SESSION_LIFETIME_RANGE,
  SessionReentryError,
  slides,
  TOUCH_INTERVAL_MS,
  type Activity,
  type AuditContext,
  type DigestResolution,
  type EndedReason,
  type HeaderReader,
  type Holding,
  type Issued,
  type Resolution,
  type SessionHold,
  type SessionLifetime,
  type Sessions,
  type SessionsOptions,
} from './auth/sessions';
export {
  csrfMatches,
  csrfToken,
  isSessionToken,
  newSessionToken,
  sessionDigest,
  sessionRef,
} from './auth/token';
export {
  AUDIT_TYPES,
  type AuditActor,
  type AuditOutcome,
  type AuditRecord,
  type AuditRefs,
  type AuditType,
} from './audit/record.mjs';
export {
  aggregateAnonymous,
  filesystemAuditSink,
  memoryAuditSink,
  type AuditEvent,
  type AuditSink,
  type MemoryAuditSink,
  type OwnerLog,
} from './audit/sink';
export { limitSource, sourcePrefix } from './audit/source';
export { authPaths, ensurePrivateDir, prepareAuthDirectories } from './data/layout.mjs';

// Preview grants (#7, Slice 2), beside the sessions they're bound to.
export {
  grantDigest,
  grantRef,
  isGrantDigest,
  isGrantToken,
  newChannelNonce,
  newGrantToken,
} from './preview/token';
export {
  asEnvironment,
  asSubject,
  filesystemGrantStore,
  isFixtureId,
  memoryGrantStore,
  previewPaths,
  type GrantEnvironment,
  type GrantRecord,
  type GrantStore,
  type GrantSubject,
  type RecordedState,
} from './preview/grant-store';
export {
  createPreviewGrants,
  GRANT_LIFETIME,
  GRANT_LIFETIME_RANGE,
  MAX_ACTIVE_GRANTS,
  type GrantCheck,
  type GrantDrafts,
  type GrantExpiry,
  type GrantLifetime,
  type GrantLog,
  type GrantLogEntry,
  type GrantSessions,
  type GrantStatus,
  type MintInput,
  type Minted,
  type PreviewGrants,
  type PreviewGrantsOptions,
  type Renewal,
} from './preview/grants';

// The revision store (#3). Owner serves it through RevisionCatalogReader; an
// empty one serves nothing until owner's first-start import commits.
export { openStore, type Store, type StoreOptions } from './store/store';
export {
  revisionCatalogReader,
  UNIT_CACHE_SIZE,
  type RevisionCatalogOptions,
  type RevisionCatalogReader,
} from './store/reader';
export { nodeReadFs } from './store/read-fs';
export {
  onStoreEvent,
  StoreError,
  type StoreActor,
  type StoreErrorCode,
  type StoreEvent,
  type StoreEventName,
  type StoreLog,
  type StoreLogEntry,
} from './store/common';
// The port's types only: openStore() defaults to node:fs, and apps/web gets
// no port it could write files through.
export { type CrashPoint, type FileStats, type FsPort, type ReadFs } from './store/fs-port';
export {
  isDraftId,
  isRevisionId,
  isSha256,
  STORE_LAYOUT,
  type DraftId,
  type RevisionId,
  type Sha256,
  type StorePaths,
} from './store/layout';
export {
  LOCK_STALE_MS,
  LOCK_TOUCH_MS,
  LOCK_WAIT_MS,
  type LockRecord,
  type PublicationLock,
} from './store/lock';
export {
  claimServer,
  SERVER_FRESH_MS,
  SERVER_REFRESH_MS,
  type ClaimResult,
  type ServerClaim,
  type ServerRecord,
} from './store/server-claim';
export { preflight, type PreflightCode, type PreflightOptions } from './store/preflight';
export {
  EVENT_TYPES,
  hasHistory,
  isIdempotencyKey,
  type EventType,
  type LivePointer,
  type PublicationEvent,
} from './store/pointer';
export {
  type DocumentInput,
  type DocumentName,
  type Rendering,
  type Unit,
  type UnitChecks,
  type UnitDiagnostic,
  type UnitDocument,
  type UnitInput,
  type Versioned,
} from './catalog/unit';
export {
  type HealthPurpose,
  type Manifest,
  type ManifestDocument,
  type RevisionHealth,
  type RevisionRead,
  type RevisionSource,
  type RevisionStore,
} from './store/revisions';
export {
  type CreateDraftInput,
  type DiscardOutcome,
  type Draft,
  type DraftConflict,
  type DraftDocument,
  type DraftDocuments,
  type DraftEdit,
  type DraftOutcome,
  type DraftRejection,
  type DraftStore,
  type LiveConflict,
} from './store/drafts';
export { type AssetStat, type AssetStore } from './store/assets';
export {
  IDEMPOTENCY_WINDOW,
  type HeldMove,
  type ListPage,
  type LiveStatus,
  type PublicationContext,
  type PublicationOutcome,
  type PublicationRejection,
  type PublicationService,
  type PublishInput,
  type RecoverInput,
  type RepairReport,
  type RevisionDetail,
  type RevisionSummary,
  type RollbackInput,
  type ServingState,
} from './store/publication';
// The mounted pair as an import reads it, and owner's first-start import
// (#3, item 24).
export {
  importAtFirstStart,
  importRefusal,
  mountedSource,
  type MountedSource,
  type SourceFile,
} from './store/source';
