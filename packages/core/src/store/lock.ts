import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { recordOwnerModule } from '../load-trace';
import { sleep, StoreError, storageError, type StoreLog } from './common';
import type { FsPort } from './fs-port';
import { tempBeside, type StorePaths } from './layout';

// The publication lock (#3, item 10): publication/lock, held around every
// pointer move and every draft write, so they happen one at a time across
// the server and the CLI. The lock file appears whole: its record is written
// and synced to a temporary file first, then linked into place, which fails
// when the lock is held. A lock is stale when the process that holds it on
// this host is gone or has another start time, or when nobody has touched it
// for 2 minutes; a waiter breaks a stale lock and takes it. To its own
// process, a lock it wrote and no longer holds, as a failed release leaves,
// is stale at once. Waiters give up after 5 s with lock_timeout. A holder
// that runs long touches it every 30 s.
//
// Breaking renames the lock aside, checks it's the stale one, and puts it
// back if it isn't. Three processes racing over one stale lock could still,
// in that instant, leave two holders; with one server and an occasional CLI
// run, that's the risk the 2-minute rule takes.

recordOwnerModule('core/store/lock');

export const LOCK_WAIT_MS = 5_000;
export const LOCK_STALE_MS = 2 * 60_000;
export const LOCK_TOUCH_MS = 30_000;

/** Who a process is, so another can tell whether it's still the one that wrote a record. */
export interface ProcessIdentity {
  readonly pid: number;
  /** An opaque string for when the process started, or null where the platform can't say. */
  readonly startTime: string | null;
  readonly hostname: string;
}

export interface LockRecord extends ProcessIdentity {
  /** What holds it, such as `publish` or `cli:backup`. */
  readonly holder: string;
  /** When it was taken, ISO 8601. */
  readonly at: string;
  /** Random, so no two takings of the lock write the same record. */
  readonly nonce: string;
}

// The records of the locks this process holds now, on globalThis since Next
// can load a server module twice. A record of this process that isn't here
// is one a failed release left behind, and as stale as a dead process's.
const HELD = Symbol.for('keyurgolani.portfolio.store-locks');
type Holder = typeof globalThis & { [HELD]?: Set<string> };
const held = (): Set<string> => ((globalThis as Holder)[HELD] ??= new Set());

/**
 * When process `pid` started, as the platform reports it: on Linux the
 * start time field of /proc/<pid>/stat, in clock ticks since boot; on macOS
 * ps's start time. Null when the process is gone or the platform can't say.
 */
export function processStartTime(pid: number): string | null {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // The command name, field 2, is in parentheses and may hold spaces, so
      // the fields are counted from the last ')'. starttime is field 22.
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null;
    }
    if (process.platform === 'darwin') {
      const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return started === '' ? null : started;
    }
  } catch {
    return null;
  }
  return null;
}

let self: ProcessIdentity | undefined;
/** This process. */
export function thisProcess(): ProcessIdentity {
  self ??= Object.freeze({
    pid: process.pid,
    startTime: processStartTime(process.pid),
    hostname: hostname(),
  });
  return self;
}

/** Whether a process with `pid` runs on this host. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it runs, as another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Why `record` no longer names a running process, or null when it may: its
 * pid on this host is gone, or that pid started at another time. A record
 * from another host can't be checked this way.
 */
export function processGone(record: Partial<ProcessIdentity>): 'gone' | 'restarted' | null {
  if (record.hostname !== hostname() || !Number.isSafeInteger(record.pid)) return null;
  const pid = record.pid as number;
  if (!alive(pid)) return 'gone';
  if (typeof record.startTime === 'string') {
    const started = processStartTime(pid);
    if (started !== null && started !== record.startTime) return 'restarted';
  }
  return null;
}

function parseRecord(text: string): Partial<LockRecord> | null {
  try {
    const record = JSON.parse(text) as unknown;
    return record !== null && typeof record === 'object' ? (record as Partial<LockRecord>) : null;
  } catch {
    return null;
  }
}

export interface HeldLock {
  readonly record: LockRecord;
  /** Marks the lock as still held, for a holder that runs past 30 s. */
  touch(): Promise<void>;
  release(): Promise<void>;
}

export interface LockOptions {
  readonly fs: FsPort;
  readonly paths: StorePaths;
  readonly now?: () => number;
  readonly waitMs?: number;
  readonly staleMs?: number;
  readonly log?: StoreLog;
}

export interface PublicationLock {
  acquire(holder: string): Promise<HeldLock>;
  /** Runs `body` holding the lock, touching it every 30 s, and releases it however `body` ends. */
  withLock<T>(holder: string, body: (lock: HeldLock) => Promise<T>): Promise<T>;
  /** What holds it now, or null. */
  holder(): Promise<LockRecord | null>;
  /** `unlock --force`: removes the lock whoever holds it. */
  forceUnlock(): Promise<boolean>;
}

export function publicationLock({
  fs,
  paths,
  now = Date.now,
  waitMs = LOCK_WAIT_MS,
  staleMs = LOCK_STALE_MS,
  log = () => {},
}: LockOptions): PublicationLock {
  const lockFile = paths.lock;
  const key = (text: string) => `${lockFile}
${text}`;

  /** The held lock's text and its age, or null when nothing holds it. */
  async function read(file = lockFile): Promise<{ text: string; mtimeMs: number } | null> {
    try {
      const stats = await fs.stat(file);
      if (!stats) return null;
      return { text: (await fs.readFile(file)).toString('utf8'), mtimeMs: stats.mtimeMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  function stale(found: { text: string; mtimeMs: number }): boolean {
    const record = parseRecord(found.text) ?? {};
    const self = thisProcess();
    const orphan =
      record.pid === self.pid &&
      record.hostname === self.hostname &&
      record.startTime === self.startTime &&
      !held().has(key(found.text));
    return orphan || processGone(record) !== null || now() - found.mtimeMs > staleMs;
  }

  /** Takes a stale lock out of the way. True when it did, so the caller may try again. */
  async function breakStale(found: { text: string; mtimeMs: number }): Promise<boolean> {
    const aside = tempBeside(lockFile);
    try {
      await fs.rename(lockFile, aside, 'lock.break.rename');
    } catch (error) {
      // Someone else broke or released it first.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw error;
    }
    const moved = await read(aside);
    if (moved?.text === found.text) {
      await fs.remove(aside, 'lock.break.remove');
      return true;
    }
    // A live lock was taken in the meantime: put it back.
    try {
      await fs.link(aside, lockFile, 'lock.break.restore');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    await fs.remove(aside, 'lock.break.remove');
    return false;
  }

  async function acquire(holder: string): Promise<HeldLock> {
    const record: LockRecord = Object.freeze({
      ...thisProcess(),
      holder,
      at: new Date(now()).toISOString(),
      nonce: randomBytes(8).toString('hex'),
    });
    const text = `${JSON.stringify(record)}\n`;
    const deadline = now() + waitMs;
    const temp = tempBeside(lockFile);
    try {
      await fs.writeFile(temp, text, 'lock.write');
      await fs.fsync(temp, 'lock.fsync');
      for (;;) {
        try {
          held().add(key(text));
          await fs.link(temp, lockFile, 'lock.link');
          break;
        } catch (error) {
          held().delete(key(text));
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        const found = await read();
        if (found && stale(found) && (await breakStale(found))) continue;
        if (!found) continue;
        if (now() >= deadline) {
          throw new StoreError('lock_timeout', 'Another publication is in progress.');
        }
        await sleep(20 + Math.floor(Math.random() * 30));
      }
    } catch (error) {
      if (error instanceof StoreError) throw error;
      throw storageError(error);
    } finally {
      await fs.remove(temp, 'lock.temp.remove').catch(() => {});
    }
    let released = false;
    return {
      record,
      async touch() {
        if (!released) await fs.touch(lockFile, 'lock.touch');
      },
      async release() {
        if (released) return;
        released = true;
        try {
          // Only its own: a lock someone broke and retook stays theirs.
          const found = await read().catch(() => null);
          if (found?.text === text) await fs.remove(lockFile, 'lock.release');
        } finally {
          held().delete(key(text));
        }
      },
    };
  }

  return {
    acquire,
    async withLock(holder, body) {
      const lock = await acquire(holder);
      const toucher = setInterval(() => {
        lock.touch().catch(() => {});
      }, LOCK_TOUCH_MS);
      toucher.unref();
      try {
        return await body(lock);
      } finally {
        clearInterval(toucher);
        // A failed release doesn't undo what the body did: the lock it
        // leaves is stale to this process at once and to others once it
        // ends or 2 minutes pass.
        await lock.release().catch(() => {
          log({ level: 'error', event: 'store.lock.release_failed', code: 'lock_release_failed' });
        });
      }
    },
    async holder() {
      const found = await read();
      return found ? ((parseRecord(found.text) as LockRecord | null) ?? null) : null;
    },
    async forceUnlock() {
      const found = await read();
      if (!found) return false;
      await fs.remove(lockFile, 'lock.force');
      return true;
    },
  };
}
