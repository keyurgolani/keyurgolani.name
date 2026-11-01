import { recordOwnerModule } from '../load-trace';
import { isStoreActor, type StoreActor } from './common';
import type { CrashPoint, FsPort } from './fs-port';
import { isRevisionId, tempBeside, type RevisionId, type StorePaths } from './layout';

// What a revision retention removed leaves (#3, item 26):
// revisions/<id>.tombstone.json, {revisionId, removedAt, actor}. With it
// there, the revision counts as removed whatever is left of its directory:
// verify, the last-known-good walk, and rollback skip it.

recordOwnerModule('core/store/tombstone');

export interface Tombstone {
  readonly revisionId: RevisionId;
  /** ISO 8601. */
  readonly removedAt: string;
  readonly actor: StoreActor;
}

/** The tombstone in `value` for `id`, or null when it isn't one. */
export function asTombstone(value: unknown, id: RevisionId): Tombstone | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const ok =
    record.revisionId === id &&
    isRevisionId(record.revisionId) &&
    typeof record.removedAt === 'string' &&
    !Number.isNaN(Date.parse(record.removedAt)) &&
    isStoreActor(record.actor);
  return ok ? (record as unknown as Tombstone) : null;
}

/**
 * Writes revisions/<id>.tombstone.json through a synced temporary file
 * renamed into place, then syncs revisions/. The caller holds the lock, and
 * removes the revision's directory only after this returns.
 */
export async function writeTombstone(
  fs: FsPort,
  paths: StorePaths,
  tombstone: Tombstone,
  operation: string,
): Promise<void> {
  const file = paths.tombstone(tombstone.revisionId);
  const temp = tempBeside(file);
  const point = (step: string): CrashPoint => `${operation}.tombstone.${step}`;
  const record = {
    revisionId: tombstone.revisionId,
    removedAt: tombstone.removedAt,
    actor: tombstone.actor,
  };
  try {
    await fs.writeFile(temp, `${JSON.stringify(record)}\n`, point('write'));
    await fs.fsync(temp, point('fsync'));
    await fs.rename(temp, file, point('rename'));
  } catch (error) {
    await fs.remove(temp, point('temp.remove')).catch(() => {});
    throw error;
  }
  await fs.fsync(paths.revisions, `${operation}.revisions.fsync`);
}
