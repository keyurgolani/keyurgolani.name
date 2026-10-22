import type { Principal } from '../auth/provider';
import type { RenderDrift } from '../catalog/port';
import { recordOwnerModule } from '../load-trace';

// What the revision store's modules share (#3): who acts, the errors that
// stop an operation outright, the in-process events #7 listens for, and the
// log the composition root passes in.

recordOwnerModule('core/store/common');

/**
 * Who wrote a revision, a draft, or an event: #2's principal for a Studio
 * session, or `operator` for the CLI.
 */
export type StoreActor = Principal['id'] | 'operator';
export const STORE_ACTORS: readonly StoreActor[] = Object.freeze(['owner', 'operator']);
export const isStoreActor = (value: unknown): value is StoreActor =>
  value === 'owner' || value === 'operator';

/**
 * Why an operation couldn't run at all, as opposed to an outcome it
 * returns. Each has its HTTP status in #3's item 22: `lock_timeout` and
 * `storage_unavailable` are 503, `storage_full` 507.
 */
/**
 * `data_dir_in_use`: another owner server took this process's claim on the
 * data directory, so it writes nothing more there.
 */
export type StoreErrorCode =
  'lock_timeout' | 'storage_unavailable' | 'storage_full' | 'data_dir_in_use';

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StoreError';
    this.code = code;
  }
}

/**
 * Whether a read failed for what's there, so asking again can't help: a
 * link in a file's place (ELOOP), or a directory or anything else that
 * isn't a regular file (EISDIR, ENOTDIR, EFTYPE). Any other failure, such
 * as EACCES, EMFILE, or EIO, may pass.
 */
export function isPermanentReadError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'ELOOP' || code === 'EISDIR' || code === 'ENOTDIR' || code === 'EFTYPE';
}

/** A file system failure as the store reports it: a full disk is its own code. */
export function storageError(error: unknown): StoreError {
  if (error instanceof StoreError) return error;
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'ENOSPC' || code === 'EDQUOT'
    ? new StoreError('storage_full', 'The data directory is full.', { cause: error })
    : new StoreError('storage_unavailable', "The data directory can't be written.", {
        cause: error,
      });
}

/** One line for the server log: IDs, seq, stage, and duration, never content. */
export interface StoreLogEntry {
  readonly level: 'info' | 'warn' | 'error';
  /** Such as `store.publish.committed`. */
  readonly event: string;
  readonly revisionId?: string;
  /** For `store.catalog.degraded`: the last known good, served in the live revision's place. */
  readonly servingRevisionId?: string;
  readonly seq?: number;
  readonly stage?: string;
  readonly durationMs?: number;
  readonly code?: string;
  /**
   * For `store.catalog.degraded` and `store.catalog.incompatible`: the
   * command that serves the live revision again, when an older build wrote it.
   */
  readonly command?: string;
  /** For `store.render-drift`: the IDs and versions that differ from the build's. */
  readonly drift?: readonly RenderDrift[];
}
export type StoreLog = (entry: StoreLogEntry) => void;

export type StoreEventName =
  'published' | 'rolledBack' | 'recovered' | 'draftSaved' | 'draftDiscarded';

export interface StoreEvent {
  readonly name: StoreEventName;
  readonly revisionId?: string;
  readonly seq?: number;
  readonly draftId?: string;
  readonly version?: number;
}

type Listener = (event: StoreEvent) => void;

// On globalThis, since Next can load a server module twice and both copies
// must reach the same listeners.
const EVENTS = Symbol.for('keyurgolani.portfolio.store-events');
type Holder = typeof globalThis & { [EVENTS]?: Set<Listener> };
const listeners = (): Set<Listener> => {
  const holder = globalThis as Holder;
  return (holder[EVENTS] ??= new Set());
};

/** Listens for what the store does, such as #7 revoking a grant once a draft changes. Returns the unsubscribe. */
export function onStoreEvent(listener: Listener): () => void {
  listeners().add(listener);
  return () => listeners().delete(listener);
}

export function emitStoreEvent(event: StoreEvent): void {
  for (const listener of listeners()) {
    try {
      listener(Object.freeze({ ...event }));
    } catch {
      // A listener's failure is its own; the operation already happened.
    }
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
