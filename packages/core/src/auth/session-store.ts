import { recordOwnerModule } from '../load-trace';
import {
  deleteSessionFile,
  DIGEST,
  listSessionDigests,
  readRevokedBefore,
  readSessionFile,
  revokeAllSessionFiles,
  UA_FAMILIES,
  writeSessionFile,
} from './session-files.mjs';

// The SessionStore port (#2), with a memory adapter for tests and the
// filesystem adapter the owner server runs on: one file per session under
// <data>/ephemeral/auth/sessions/, and no cache in the process, so what
// owner.mjs revoke-sessions changes on disk counts at the next request.

recordOwnerModule('core/auth/session-store');

export type UaFamily = (typeof UA_FAMILIES)[number];

export interface SessionRecord {
  /** The hex SHA-256 digest of the token. The token itself is never stored. */
  readonly digest: string;
  /** Times in milliseconds since the epoch. */
  readonly createdAt: number;
  readonly lastSeenAt: number;
  readonly absoluteExpiresAt: number;
  /** credentialFingerprint() of the hash the session signed in under. */
  readonly credentialFingerprint: string;
  /** A coarse browser family for the session list (#8). */
  readonly uaFamily: UaFamily;
}

export interface SessionStore {
  /** Writes `record`, replacing any under its digest. */
  put(record: SessionRecord): Promise<void>;
  get(digest: string): Promise<SessionRecord | null>;
  /** Deletes the record. Returns whether there was one. */
  delete(digest: string): Promise<boolean>;
  list(): Promise<SessionRecord[]>;
  /**
   * When every session was last revoked, or null: sessions created at or
   * before it are refused. Throws when it can't tell.
   */
  revokedBefore(): Promise<number | null>;
  /** Records `at` as revokedBefore, then deletes every record. Returns the digests it deleted. */
  revokeAll(at: number): Promise<string[]>;
}

function checkDigest(digest: string): void {
  if (!DIGEST.test(digest)) throw new TypeError('Not a session digest.');
}

/** A store in memory, for tests. */
export function memorySessionStore(): SessionStore {
  const records = new Map<string, SessionRecord>();
  let revokedBefore: number | null = null;
  return {
    async put(record) {
      checkDigest(record.digest);
      records.set(record.digest, Object.freeze({ ...record }));
    },
    async get(digest) {
      checkDigest(digest);
      return records.get(digest) ?? null;
    },
    async delete(digest) {
      checkDigest(digest);
      return records.delete(digest);
    },
    async list() {
      return [...records.values()];
    },
    async revokedBefore() {
      return revokedBefore;
    },
    async revokeAll(at) {
      revokedBefore = at;
      const digests = [...records.keys()];
      records.clear();
      return digests;
    },
  };
}

/** The store on disk under `dataDir`, which owner startup has prepared. */
export function filesystemSessionStore(dataDir: string): SessionStore {
  return {
    put: (record) => writeSessionFile(dataDir, record),
    get: (digest) => readSessionFile(dataDir, digest),
    delete: (digest) => deleteSessionFile(dataDir, digest),
    async list() {
      const records = await Promise.all(
        (await listSessionDigests(dataDir)).map((digest) => readSessionFile(dataDir, digest)),
      );
      return records.filter((record): record is SessionRecord => record !== null);
    },
    revokedBefore: () => readRevokedBefore(dataDir),
    revokeAll: (at) => revokeAllSessionFiles(dataDir, at),
  };
}
