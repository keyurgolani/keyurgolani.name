// @portfolio/core/owner: the package's only entry, and all of it owner code
// (#1, item 14). Only the web app's server/owner/ modules import it, which
// check:deps enforces, so demo and read-only never load it.
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
  browserFamily,
  createSessions,
  MAX_SESSIONS,
  SESSION_LIFETIME,
  SESSION_LIFETIME_RANGE,
  slides,
  TOUCH_INTERVAL_MS,
  type Activity,
  type AuditContext,
  type EndedReason,
  type HeaderReader,
  type Issued,
  type Resolution,
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
export { sourcePrefix } from './audit/source';
export { authPaths, prepareAuthDirectories } from './data/layout.mjs';
