import path from 'node:path';
import { recordOwnerModule } from '../load-trace';
import { storageError, StoreError, type StoreActor } from './common';
import { draftIds } from './drafts';
import type { FsPort } from './fs-port';
import { isRevisionId, type RevisionId, type Sha256, type StorePaths } from './layout';
import { LockLostError, type PublicationLock } from './lock';
import { DamagedPointerError, readEvents, readLive } from './pointer';
import { isTombstoned, readManifest, revisionIds } from './revisions';
import { writeTombstone } from './tombstone';
import type { UnitChecks } from '../catalog/unit';

// `portfolio-store retention` (#3, item 26), under the publication lock.
// With no flag it removes no revision: it deletes the blobs nothing
// references that are older than 24 hours, and the audit files whose every
// line is more than 12 months old. `keep` removes the unprotected revisions
// beyond the newest n, and `remove` one revision. Protected, always: the
// live revision, the 10 most recently live before it, and every draft's
// base. A removed revision leaves revisions/<id>.tombstone.json, written and
// synced before its directory goes, so a crash between the two leaves a
// revision that counts as removed, and the next run finishes it. Before each
// removal it checks the lock is still its own: a run whose lock another
// process broke and took stops there, since what it protects may have moved.
// It acts only on what lstat calls a directory or a regular file.

recordOwnerModule('core/store/retention');

/** How many of the most recently live revisions before the live one stay. */
export const RECENTLY_LIVE_KEPT = 10;
/** How old an unreferenced blob must be to go: an upload a draft hasn't referenced yet stays. */
export const BLOB_GRACE_MS = 24 * 60 * 60_000;
/** How many months an audit file stays once its month ends. */
export const AUDIT_MONTHS_KEPT = 12;

export type Protection = 'live' | 'recently-live' | 'draft-base';

export interface RetentionInput {
  /** Removes the unprotected revisions beyond the newest `keep`. */
  readonly keep?: number;
  /** Removes this one revision. */
  readonly remove?: RevisionId;
  /** Says what it would remove, and removes nothing. */
  readonly dryRun?: boolean;
}

export interface RetentionReport {
  readonly dryRun: boolean;
  readonly removedRevisions: readonly RevisionId[];
  /** Revisions a crash left half removed, their tombstone written, whose directories go now. */
  readonly finishedRevisions: readonly RevisionId[];
  /** The protected revisions, and why each one is. */
  readonly protected: ReadonlyMap<RevisionId, Protection>;
  readonly removedBlobs: readonly Sha256[];
  /** Why no blob was considered, when none was: a revision whose manifest can't be read. */
  readonly blobsKept?: 'manifest_unreadable';
  /** The audit files removed, by name, such as 2025-08.jsonl. */
  readonly removedAudit: readonly string[];
  /** Why it stopped before it was done, when it did: another process took the lock. */
  readonly stopped?: 'lock_lost';
}

export type RetentionOutcome =
  | { readonly kind: 'done'; readonly report: RetentionReport }
  | {
      readonly kind: 'refused';
      readonly code: 'protected' | 'not_found';
      readonly revisionId: RevisionId;
      readonly protection?: Protection;
    };

export interface RetentionOptions {
  readonly fs: FsPort;
  readonly paths: StorePaths;
  readonly lock: PublicationLock;
  readonly checks: Pick<UnitChecks, 'referencedBlobs'>;
  readonly actor: StoreActor;
  readonly now?: () => number;
}

const AUDIT_FILE = /^(\d{4})-(0[1-9]|1[0-2])\.jsonl$/;
const BLOB_FILE = /^[0-9a-f]{64}$/;

/** Whether an audit file's month ended more than AUDIT_MONTHS_KEPT months before `now`. */
export function auditExpired(name: string, now: number): boolean {
  const match = AUDIT_FILE.exec(name);
  if (!match) return false;
  // Date.UTC takes a 0-based month, so the file's 1-based one is the month after it.
  const ended = Date.UTC(Number(match[1]), Number(match[2]), 1);
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - AUDIT_MONTHS_KEPT);
  return ended <= cutoff.getTime();
}

/** The protected revisions: the live one, the most recently live before it, and every draft's base. */
async function protectedRevisions(
  fs: FsPort,
  paths: StorePaths,
): Promise<Map<RevisionId, Protection>> {
  const protection = new Map<RevisionId, Protection>();
  let pointer;
  try {
    pointer = await readLive(fs, paths);
  } catch (error) {
    // Nothing goes while what's live can't be told.
    if (error instanceof DamagedPointerError) {
      throw new StoreError('storage_unavailable', error.message, { cause: error });
    }
    throw error;
  }
  if (pointer) protection.set(pointer.revisionId, 'live');
  const events = await readEvents(fs, paths);
  if (pointer && !events.some((event) => event.seq === pointer.seq)) events.push(pointer.event);
  events.sort((a, b) => b.seq - a.seq);
  let recent = 0;
  for (const event of events) {
    if (recent >= RECENTLY_LIVE_KEPT) break;
    if (protection.has(event.revisionId)) continue;
    protection.set(event.revisionId, 'recently-live');
    recent += 1;
  }
  // A draft and its previous version, either of which the store may read
  // back, each keep their base.
  for (const id of await draftIds(fs, paths)) {
    for (const file of [paths.draft(id), paths.draftPrevious(id)]) {
      const base = await draftBase(fs, file);
      if (base && !protection.has(base)) protection.set(base, 'draft-base');
    }
  }
  return protection;
}

async function draftBase(fs: FsPort, file: string): Promise<RevisionId | null> {
  try {
    const base = (JSON.parse((await fs.readFile(file)).toString('utf8')) as Record<string, unknown>)
      ?.baseRevisionId;
    return isRevisionId(base) ? base : null;
  } catch {
    return null;
  }
}

/** The blobs a draft's media document, or its previous version's, references. */
async function draftBlobs(
  fs: FsPort,
  paths: StorePaths,
  checks: Pick<UnitChecks, 'referencedBlobs'>,
): Promise<Set<Sha256>> {
  const blobs = new Set<Sha256>();
  for (const id of await draftIds(fs, paths)) {
    for (const file of [paths.draft(id), paths.draftPrevious(id)]) {
      let media: unknown;
      try {
        const draft = JSON.parse((await fs.readFile(file)).toString('utf8')) as {
          documents?: { media?: { model?: unknown } };
        };
        media = draft?.documents?.media?.model;
      } catch {
        continue;
      }
      if (media === undefined || media === null) continue;
      for (const blob of checks.referencedBlobs?.(media) ?? []) blobs.add(blob);
    }
  }
  return blobs;
}

export async function runRetention(
  { fs, paths, lock, checks, actor, now = Date.now }: RetentionOptions,
  input: RetentionInput = {},
): Promise<RetentionOutcome> {
  if (input.keep !== undefined && (!Number.isSafeInteger(input.keep) || input.keep < 0)) {
    throw new TypeError('keep is a whole number of revisions.');
  }
  if (input.remove !== undefined && !isRevisionId(input.remove)) {
    throw new TypeError('Not a revision ID.');
  }
  if (input.keep !== undefined && input.remove !== undefined) {
    throw new TypeError('Give keep or remove, not both.');
  }
  const dryRun = input.dryRun === true;
  return lock.withLock('cli:retention', async () => {
    try {
      const protection = await protectedRevisions(fs, paths);
      const ids = await revisionIds(fs, paths);
      const live: RevisionId[] = [];
      const finished: RevisionId[] = [];
      for (const id of ids) {
        if (await isTombstoned(fs, paths, id)) finished.push(id);
        else live.push(id);
      }

      let removing: RevisionId[] = [];
      if (input.remove !== undefined) {
        const id = input.remove;
        if (!live.includes(id)) return { kind: 'refused', code: 'not_found', revisionId: id };
        const reason = protection.get(id);
        if (reason)
          return { kind: 'refused', code: 'protected', revisionId: id, protection: reason };
        removing = [id];
      } else if (input.keep !== undefined) {
        // Newest first, by when each was made; one whose manifest can't be
        // read counts as the oldest.
        const made = new Map<RevisionId, string>();
        for (const id of live) made.set(id, (await readManifest(fs, paths, id))?.createdAt ?? '');
        const newest = [...live].sort(
          (a, b) => made.get(b)!.localeCompare(made.get(a)!) || a.localeCompare(b),
        );
        removing = newest.slice(input.keep).filter((id) => !protection.has(id));
      }

      // Whether the lock is still this run's, as it removes the next thing.
      let stopped: RetentionReport['stopped'];
      const still = async () => {
        if (stopped) return false;
        try {
          await lock.fence();
          return true;
        } catch (error) {
          if (!(error instanceof LockLostError)) throw error;
          stopped = 'lock_lost';
          return false;
        }
      };

      const stamp = () => new Date(now()).toISOString();
      const removed: RevisionId[] = [];
      const finishedNow: RevisionId[] = [];
      if (!dryRun) {
        for (const id of removing) {
          if (!(await still())) break;
          await writeTombstone(
            fs,
            paths,
            { revisionId: id, removedAt: stamp(), actor },
            'retention',
          );
          await fs.remove(paths.revision(id), 'retention.revision.remove');
          await fs.fsync(paths.revisions, 'retention.revisions.fsync');
          removed.push(id);
        }
        for (const id of finished) {
          if (!(await still())) break;
          await fs.remove(paths.revision(id), 'retention.revision.remove');
          await fs.fsync(paths.revisions, 'retention.revisions.fsync');
          finishedNow.push(id);
        }
      }

      // Blobs: what's left of the revisions, and every draft, keep theirs.
      const gone = dryRun ? removing : removed;
      const remaining = live.filter((id) => !gone.includes(id));
      const referenced = await draftBlobs(fs, paths, checks);
      let blobsKept: RetentionReport['blobsKept'];
      for (const id of remaining) {
        const manifest = await readManifest(fs, paths, id);
        if (!manifest) {
          blobsKept = 'manifest_unreadable';
          break;
        }
        for (const blob of manifest.blobs) referenced.add(blob);
      }
      const removedBlobs: Sha256[] = [];
      if (!blobsKept && !stopped) {
        for (const shard of (await fs.readdir(paths.assets)).sort()) {
          if (stopped) break;
          if (!/^[0-9a-f]{2}$/.test(shard)) continue;
          const dir = path.join(paths.assets, shard);
          // Never into a linked shard: what it lists isn't the store's.
          if (!(await fs.lstat(dir))?.isDirectory) continue;
          let removedHere = false;
          for (const name of (await fs.readdir(dir)).sort()) {
            if (!BLOB_FILE.test(name)) continue;
            const hash = `sha256:${name}` as Sha256;
            if (referenced.has(hash)) continue;
            const found = await fs.lstat(path.join(dir, name));
            if (!found?.isFile || now() - found.mtimeMs <= BLOB_GRACE_MS) continue;
            if (!dryRun) {
              if (!(await still())) break;
              await fs.remove(path.join(dir, name), 'retention.blob.remove');
              removedHere = true;
            }
            removedBlobs.push(hash);
          }
          if (removedHere) await fs.fsync(dir, 'retention.blobs.fsync');
        }
      }

      const removedAudit: string[] = [];
      let auditRemoved = false;
      for (const name of (await fs.readdir(paths.audit)).sort()) {
        if (stopped) break;
        if (!auditExpired(name, now())) continue;
        if (!dryRun) {
          if (!(await still())) break;
          await fs.remove(path.join(paths.audit, name), 'retention.audit.remove');
          auditRemoved = true;
        }
        removedAudit.push(name);
      }
      if (auditRemoved) await fs.fsync(paths.audit, 'retention.audit.fsync');

      return {
        kind: 'done',
        report: {
          dryRun,
          removedRevisions: gone,
          finishedRevisions: dryRun ? finished : finishedNow,
          protected: protection,
          removedBlobs,
          ...(blobsKept ? { blobsKept } : {}),
          removedAudit,
          ...(stopped ? { stopped } : {}),
        },
      };
    } catch (error) {
      if (error instanceof TypeError) throw error;
      throw storageError(error);
    }
  });
}
