import { recordOwnerModule } from '../load-trace';
import { storageError } from './common';
import type { FsPort } from './fs-port';
import { tempBeside, type StorePaths } from './layout';
import { processGone, thisProcess, type ProcessIdentity } from './lock';

// One owner server per data directory (#3, item 4). The server that runs
// holds publication/server.json, with its pid, process start time, and
// hostname, and rewrites it every 15 s. A second server refuses to start
// while the file is under 45 s old and names a process that's still there,
// by the lock's own test (item 10). The CLI doesn't claim it: it runs
// alongside the server, under the publication lock. The startup hook
// releases the claim on SIGTERM.

recordOwnerModule('core/store/server-claim');

export const SERVER_REFRESH_MS = 15_000;
export const SERVER_FRESH_MS = 45_000;

export interface ServerRecord extends ProcessIdentity {
  /** When it was last written, ISO 8601. */
  readonly at: string;
}

export interface ServerClaim {
  readonly record: ServerRecord;
  /** Stops refreshing and removes server.json, if it's still this server's. */
  release(): Promise<void>;
}

export type ClaimResult =
  | { readonly ok: true; readonly claim: ServerClaim }
  | { readonly ok: false; readonly code: 'data_dir_in_use'; readonly holder: ServerRecord };

export interface ClaimOptions {
  readonly fs: FsPort;
  readonly paths: StorePaths;
  readonly now?: () => number;
  readonly refreshMs?: number;
  readonly freshMs?: number;
}

export async function claimServer({
  fs,
  paths,
  now = Date.now,
  refreshMs = SERVER_REFRESH_MS,
  freshMs = SERVER_FRESH_MS,
}: ClaimOptions): Promise<ClaimResult> {
  try {
    const stats = await fs.stat(paths.server);
    if (stats) {
      let found: ServerRecord | null = null;
      try {
        found = JSON.parse((await fs.readFile(paths.server)).toString('utf8')) as ServerRecord;
      } catch {
        found = null;
      }
      const self = thisProcess();
      const ours = found?.pid === self.pid && found.hostname === self.hostname;
      if (found && !ours && now() - stats.mtimeMs < freshMs && processGone(found) === null) {
        return { ok: false, code: 'data_dir_in_use', holder: found };
      }
    }
    let record = await write();
    const timer = setInterval(() => {
      write()
        .then((next) => {
          record = next;
        })
        .catch(() => {});
    }, refreshMs);
    timer.unref();
    return {
      ok: true,
      claim: {
        get record() {
          return record;
        },
        async release() {
          clearInterval(timer);
          try {
            const text = (await fs.readFile(paths.server)).toString('utf8');
            const current = JSON.parse(text) as Partial<ServerRecord>;
            if (current.pid === record.pid && current.hostname === record.hostname) {
              await fs.remove(paths.server, 'server.release');
            }
          } catch {
            // Gone already, or not readable: nothing of this server's to remove.
          }
        },
      },
    };
  } catch (error) {
    throw storageError(error);
  }

  async function write(): Promise<ServerRecord> {
    const record: ServerRecord = Object.freeze({
      ...thisProcess(),
      at: new Date(now()).toISOString(),
    });
    const temp = tempBeside(paths.server);
    await fs.writeFile(temp, `${JSON.stringify(record)}\n`, 'server.write');
    await fs.fsync(temp, 'server.fsync');
    await fs.rename(temp, paths.server, 'server.rename');
    return record;
  }
}
