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
// the server and the CLI. Inside one process, acquirers take turns first
// come first served, so a server is one contender however many requests it
// serves. The lock file appears whole: its record is written and synced to a
// temporary file first, then linked into place, which fails when the lock is
// held. A lock is stale when the process that holds it on this host is gone
// or has another start time, or when nobody has touched it for 2 minutes. To
// its own process, a lock it wrote and no longer holds, as a failed release
// leaves, is stale at once. Waiters give up after 5 s with lock_timeout. A
// holder that runs long touches it every 30 s.
//
// One breaker at a time takes a stale lock out of the way: it holds the
// marker publication/lock.break, reads the lock again under it, and moves it
// aside only while it's still the stale one, then checks what it moved and
// puts back a live one. A stale holder that wakes and lets go in that instant,
// while two other acquirers race for the lock, could still leave two holders
// for a moment; fence() stops the one that lost the lock before its commit,
// so nothing moves without it.

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

/** fence() found publication/lock someone else's: nothing may move under it. */
export class LockLostError extends Error {
  constructor() {
    super("The publication lock isn't this holder's any more.");
    this.name = 'LockLostError';
  }
}

// The nonces of the locks and break markers this process holds now, on
// globalThis since Next can load a server module twice. A record of this
// process whose nonce isn't here is one a failed release left behind, and as
// stale as a dead process's.
const HELD = Symbol.for('keyurgolani.portfolio.store-locks');
type Holder = typeof globalThis & { [HELD]?: Set<string> };
const held = (): Set<string> => ((globalThis as Holder)[HELD] ??= new Set());

// Turns at each lock file in this process, first come first served, on
// globalThis for the same reason.
const TURNS = Symbol.for('keyurgolani.portfolio.store-lock-turns');
interface Turns {
  busy: boolean;
  readonly waiting: (() => void)[];
}
type TurnsHolder = typeof globalThis & { [TURNS]?: Map<string, Turns> };
const allTurns = (): Map<string, Turns> => ((globalThis as TurnsHolder)[TURNS] ??= new Map());

/**
 * Waits up to `waitMs` for this process's turn at `file`, behind every
 * acquirer that asked before it. Resolves to what ends the turn, which hands
 * it to the next in line, or null when the wait ran out first.
 */
async function turn(file: string, waitMs: number): Promise<(() => void) | null> {
  const turns: Turns = allTurns().get(file) ?? { busy: false, waiting: [] };
  allTurns().set(file, turns);
  if (turns.busy) {
    const woken = await new Promise<boolean>((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        const at = turns.waiting.indexOf(wake);
        if (at >= 0) turns.waiting.splice(at, 1);
        resolve(false);
      }, waitMs);
      turns.waiting.push(wake);
    });
    if (!woken) return null;
  } else {
    turns.busy = true;
  }
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const next = turns.waiting.shift();
    if (next) {
      next();
    } else {
      turns.busy = false;
      allTurns().delete(file);
    }
  };
}

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
  /**
   * Throws LockLostError unless publication/lock is still the one this
   * lock's holder took. A commit calls it just before the rename that makes
   * it, so a holder whose lock was broken and retaken moves nothing.
   */
  fence(): Promise<void>;
  /** What holds it now, or null. */
  holder(): Promise<LockRecord | null>;
  /** `unlock --force`: removes the lock whoever holds it, and a break marker left with it. */
  forceUnlock(): Promise<boolean>;
}

type Found = { readonly text: string; readonly mtimeMs: number };

export function publicationLock({
  fs,
  paths,
  now = Date.now,
  waitMs = LOCK_WAIT_MS,
  staleMs = LOCK_STALE_MS,
  log = () => {},
}: LockOptions): PublicationLock {
  const lockFile = paths.lock;
  const breakFile = paths.lockBreak;
  // What this lock's holder took, while it holds it: one at a time, since
  // acquirers in this process take turns.
  let current: LockRecord | null = null;

  /** The file's text and its age, or null when it isn't there. */
  async function read(file = lockFile): Promise<Found | null> {
    try {
      const stats = await fs.stat(file);
      if (!stats) return null;
      return { text: (await fs.readFile(file)).toString('utf8'), mtimeMs: stats.mtimeMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Whether a lock or a break marker is stale, by its record and its age. */
  function stale(found: Found): boolean {
    const record = parseRecord(found.text) ?? {};
    const self = thisProcess();
    const orphan =
      record.pid === self.pid &&
      record.hostname === self.hostname &&
      record.startTime === self.startTime &&
      !held().has(String(record.nonce));
    return orphan || processGone(record) !== null || now() - found.mtimeMs > staleMs;
  }

  function newRecord(holder: string): { readonly record: LockRecord; readonly text: string } {
    const record: LockRecord = Object.freeze({
      ...thisProcess(),
      holder,
      at: new Date(now()).toISOString(),
      nonce: randomBytes(8).toString('hex'),
    });
    return { record, text: `${JSON.stringify(record)}\n` };
  }

  /**
   * Takes the break marker, so this is the one breaker. Null while another
   * breaker holds it; a stale marker, one a breaker left as it died, is
   * cleared first.
   */
  async function takeMarker(): Promise<{ release(): Promise<void> } | null> {
    const { record, text } = newRecord('break');
    const temp = tempBeside(breakFile);
    try {
      await fs.writeFile(temp, text, 'lock.break.write');
      await fs.fsync(temp, 'lock.break.fsync');
      for (let tries = 0; tries < 2; tries++) {
        held().add(record.nonce);
        try {
          await fs.link(temp, breakFile, 'lock.break.link');
          return {
            async release() {
              try {
                const mine = await read(breakFile).catch(() => null);
                if (mine?.text === text) await fs.remove(breakFile, 'lock.break.release');
              } finally {
                held().delete(record.nonce);
              }
            },
          };
        } catch (error) {
          held().delete(record.nonce);
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        const other = await read(breakFile);
        if (other && !stale(other)) return null;
        if (other) await clearMarker(other);
      }
      return null;
    } finally {
      await fs.remove(temp, 'lock.break.temp.remove').catch(() => {});
    }
  }

  /** Moves a stale break marker aside, and puts back a live one it finds there instead. */
  async function clearMarker(left: Found): Promise<void> {
    const aside = tempBeside(breakFile);
    try {
      await fs.rename(breakFile, aside, 'lock.break.clear');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const cleared = await read(aside);
    if (cleared?.text !== left.text) {
      await fs.link(aside, breakFile, 'lock.break.unclear').catch(() => {});
    }
    await fs.remove(aside, 'lock.break.clear.remove');
  }

  /**
   * Takes a stale lock out of the way, holding the break marker, and deciding
   * again under it. True when the lock is gone, so the caller may try again.
   */
  async function breakStale(found: Found): Promise<boolean> {
    const marker = await takeMarker();
    if (!marker) return false;
    try {
      return await moveStaleAside(found);
    } finally {
      await marker.release();
    }
  }

  /** Under the break marker: moves the lock aside if it's still the stale one. */
  async function moveStaleAside(found: Found): Promise<boolean> {
    const again = await read();
    if (!again) return true;
    if (again.text !== found.text || !stale(again)) return false;
    const aside = tempBeside(lockFile);
    try {
      await fs.rename(lockFile, aside, 'lock.break.rename');
    } catch (error) {
      // Its holder released it first.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw error;
    }
    const moved = await read(aside);
    if (moved?.text === found.text) {
      await fs.remove(aside, 'lock.break.remove');
      return true;
    }
    // A live lock was taken in the instant between: put it back.
    try {
      await fs.link(aside, lockFile, 'lock.break.restore');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    await fs.remove(aside, 'lock.break.remove');
    return false;
  }

  async function acquire(holder: string): Promise<HeldLock> {
    const { record, text } = newRecord(holder);
    const deadline = now() + waitMs;
    // This process's turn first, so its own acquirers never race on disk.
    const leave = await turn(lockFile, waitMs);
    if (!leave) throw new StoreError('lock_timeout', 'Another publication is in progress.');
    const temp = tempBeside(lockFile);
    try {
      await fs.writeFile(temp, text, 'lock.write');
      await fs.fsync(temp, 'lock.fsync');
      for (;;) {
        try {
          held().add(record.nonce);
          await fs.link(temp, lockFile, 'lock.link');
          break;
        } catch (error) {
          held().delete(record.nonce);
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
      leave();
      if (error instanceof StoreError) throw error;
      throw storageError(error);
    } finally {
      await fs.remove(temp, 'lock.temp.remove').catch(() => {});
    }
    current = record;
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
          held().delete(record.nonce);
          if (current === record) current = null;
          leave();
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
    async fence() {
      const mine = current;
      const found = mine ? await read() : null;
      if (!mine || !found || parseRecord(found.text)?.nonce !== mine.nonce) {
        throw new LockLostError();
      }
    },
    async holder() {
      const found = await read();
      return found ? ((parseRecord(found.text) as LockRecord | null) ?? null) : null;
    },
    async forceUnlock() {
      const found = await read();
      await fs.remove(breakFile, 'lock.force');
      if (!found) return false;
      await fs.remove(lockFile, 'lock.force');
      return true;
    },
  };
}
