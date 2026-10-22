import { randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, rmSync } from 'node:fs';
import { recordOwnerModule } from '../load-trace';
import { storageError, type StoreLog } from './common';
import { nodeFs, type FsPort } from './fs-port';
import { tempBeside, type StorePaths } from './layout';
import {
  processGone,
  publicationLock,
  setClaimLost,
  thisProcess,
  type ProcessIdentity,
  type PublicationLock,
} from './lock';

// One owner server per data directory (#3, item 4). The server that runs
// holds publication/server.json, with its pid, process start time, hostname,
// and a nonce of its own, and touches it every 15 s. It claims the file
// under the publication lock, so of two servers starting at once one claims
// it and the other finds it taken: a second server refuses to start while
// the file is under 45 s old and names a process that's still there, by the
// lock's own test (item 10). Each refresh reads the file first, and once it
// isn't this claim's, the server logs store.server.claim_lost, stops
// refreshing, and every lock over the directory in this process refuses, so
// it writes nothing more there, until a new claim of its own stands. A
// refresh only touches the file, so a claim another server made meanwhile
// always stands, and a removed file never comes back. Refreshes run one at a
// time, and release() waits for one under way. A process holds one claim per
// data directory: a second claimServer() over it, as a composition built
// twice makes, gets the one that stands, never a record of its own over it,
// which the first would read as another server's. The CLI doesn't claim it:
// it runs alongside the server, under the publication lock. The startup
// hook releases the claim as the process exits, which a SIGTERM ends in.

recordOwnerModule('core/store/server-claim');

export const SERVER_REFRESH_MS = 15_000;
export const SERVER_FRESH_MS = 45_000;

export interface ServerRecord extends ProcessIdentity {
  /** When the claim was made, ISO 8601. The file's time is when it was last refreshed. */
  readonly at: string;
  /** This claim's own, so a server tells its claim from another's, even one in its pid's name. */
  readonly nonce: string;
}

export interface ServerClaim {
  readonly record: ServerRecord;
  /** Whether another server took the claim over, so this one may write nothing more. */
  readonly lost: boolean;
  /** Whether it's still the directory's: neither lost nor released. */
  readonly held: boolean;
  /** Stops refreshing and removes server.json, if it's still this claim's. */
  release(): Promise<void>;
  /**
   * The same, at once, for a process that's exiting, where nothing waits for
   * a promise: the startup hook runs it on exit, which Next's own SIGTERM
   * handling ends in.
   */
  releaseSync(): void;
}

export type ClaimResult =
  | { readonly ok: true; readonly claim: ServerClaim }
  | { readonly ok: false; readonly code: 'data_dir_in_use'; readonly holder: ServerRecord };

export interface ClaimOptions {
  /** Defaults to the real filesystem; tests pass a crashing one. */
  readonly fs?: FsPort;
  readonly paths: StorePaths;
  /** The lock the claim is made under, the store's own; by default one over `paths`. */
  readonly lock?: PublicationLock;
  readonly now?: () => number;
  readonly refreshMs?: number;
  readonly freshMs?: number;
  readonly log?: StoreLog;
}

type Found = { readonly record: Partial<ServerRecord> | null; readonly mtimeMs: number };

// The latest claim this process made over each data directory, by its
// resolved root, on globalThis since Next can load a server module twice.
const CLAIMS = Symbol.for('keyurgolani.portfolio.store-server-claims');
type ClaimsHolder = typeof globalThis & { [CLAIMS]?: Map<string, Promise<ClaimResult>> };
const claims = (): Map<string, Promise<ClaimResult>> =>
  ((globalThis as ClaimsHolder)[CLAIMS] ??= new Map());

/**
 * Claims the data directory for this server: the claim this process already
 * holds over it, while that one stands, or a new one, made under the lock,
 * once none does. Calls over one directory take turns, so two at once get
 * the same claim.
 */
export function claimServer(options: ClaimOptions): Promise<ClaimResult> {
  const root = options.paths.root;
  const before = claims().get(root);
  const attempt = (async (): Promise<ClaimResult> => {
    const standing = await before?.catch(() => null);
    if (standing?.ok && standing.claim.held) return standing;
    return claimAnew(options);
  })();
  claims().set(root, attempt);
  return attempt;
}

async function claimAnew({
  fs = nodeFs,
  paths,
  lock,
  now = Date.now,
  refreshMs = SERVER_REFRESH_MS,
  freshMs = SERVER_FRESH_MS,
  log = () => {},
}: ClaimOptions): Promise<ClaimResult> {
  const self = thisProcess();
  const nonce = randomBytes(8).toString('hex');
  const ours = (found: Found | null) => found?.record?.nonce === nonce;
  // This very process, by its start time too: a restarted server can come
  // back with the pid its last run had.
  const thisServer = (record: Partial<ServerRecord>) =>
    record.pid === self.pid &&
    record.hostname === self.hostname &&
    record.startTime === self.startTime;

  async function read(): Promise<Found | null> {
    const stats = await fs.stat(paths.server);
    if (!stats) return null;
    let record: unknown = null;
    try {
      record = JSON.parse((await fs.readFile(paths.server)).toString('utf8'));
    } catch {
      record = null;
    }
    return {
      record:
        record !== null && typeof record === 'object' ? (record as Partial<ServerRecord>) : null,
      mtimeMs: stats.mtimeMs,
    };
  }

  async function write(): Promise<ServerRecord> {
    const next: ServerRecord = Object.freeze({
      ...self,
      at: new Date(now()).toISOString(),
      nonce,
    });
    const temp = tempBeside(paths.server);
    try {
      await fs.writeFile(temp, `${JSON.stringify(next)}\n`, 'server.write');
      await fs.fsync(temp, 'server.fsync');
      await fs.rename(temp, paths.server, 'server.rename');
    } catch (error) {
      await fs.remove(temp, 'server.temp.remove').catch(() => {});
      throw error;
    }
    return next;
  }

  let claimed: ClaimResult | ServerRecord;
  try {
    // Under the lock, the look and the write are one step to every other
    // claimant. It's taken even while an earlier claim of this process's is
    // lost, which only a claim that stands again clears.
    claimed = await (lock ?? publicationLock({ fs, paths, now, log })).withLock(
      'server.claim',
      async (): Promise<ClaimResult | ServerRecord> => {
        const found = await read();
        const holder = found?.record;
        if (
          found &&
          holder &&
          !thisServer(holder) &&
          now() - found.mtimeMs < freshMs &&
          processGone(holder) === null
        ) {
          return { ok: false, code: 'data_dir_in_use', holder: holder as ServerRecord };
        }
        return write();
      },
      { claiming: true },
    );
  } catch (error) {
    throw storageError(error);
  }
  if ('ok' in claimed) return claimed;
  const record = claimed;
  let lost = false;
  let released = false;
  // One refresh at a time, so release() can wait for the one under way.
  let refreshing: Promise<void> | null = null;
  setClaimLost(paths.root, false);

  async function refresh() {
    let found: Found | null;
    try {
      found = await read();
    } catch {
      // Unreadable just now: the next refresh tries again.
      return;
    }
    if (released) return;
    if (!ours(found)) {
      lost = true;
      clearInterval(timer);
      setClaimLost(paths.root, true);
      log({ level: 'error', event: 'store.server.claim_lost', code: 'data_dir_in_use' });
      return;
    }
    // Fresh again by its time. The record isn't written again, so another
    // server's claim made since the read stands, and so does a release.
    await fs.touch(paths.server, 'server.refresh');
  }

  const timer = setInterval(() => {
    if (released || lost || refreshing) return;
    refreshing = refresh()
      .catch(() => {})
      .finally(() => {
        refreshing = null;
      });
  }, refreshMs);
  timer.unref();
  return {
    ok: true,
    claim: {
      get record() {
        return record;
      },
      get lost() {
        return lost;
      },
      get held() {
        return !lost && !released;
      },
      async release() {
        released = true;
        clearInterval(timer);
        // A refresh under way finishes first, so nothing of it lands after the file is gone.
        await refreshing;
        try {
          if (ours(await read())) await fs.remove(paths.server, 'server.release');
        } catch {
          // Gone already, or not readable: nothing of this claim's to remove.
        }
      },
      releaseSync() {
        // On exit nothing waits, and nothing under way finishes after it.
        released = true;
        clearInterval(timer);
        try {
          // Never through a link, nor from a FIFO, which would hold the exit
          // until a writer came: as the store's own reads.
          const fd = openSync(
            paths.server,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          let text: string;
          try {
            if (!fstatSync(fd).isFile()) return;
            text = readFileSync(fd, 'utf8');
          } finally {
            closeSync(fd);
          }
          if ((JSON.parse(text) as Partial<ServerRecord>).nonce === nonce) {
            rmSync(paths.server, { force: true });
          }
        } catch {
          // Gone already, or not readable: nothing of this claim's to remove.
        }
      },
    },
  };
}
