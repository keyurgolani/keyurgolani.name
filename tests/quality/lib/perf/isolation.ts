// A perf test runs alone on its runner (rc.2, 2026-11-10). Its TBT, read at the lab's 4x CPU
// throttle (lib/perf), is the page's own only while nothing else runs beside it, and a quality
// shard runs two workers (SHARD_WORKERS, lib/pr-shards.ts). This is a readers-writer lock across
// a run's worker processes, in a directory the run names: a perf.spec test holds it exclusively,
// and every other quality test, and each worker's app start, shares it (fixtures.ts).
//
// Writers go first: once an exclusive asker is waiting, no new shared holder starts, so with two
// workers the other one can't take the shared side back to back and starve a perf test. The
// exclusive asker starts when the shared holders in flight have finished.
//
// The lock is files, since workers are processes: `exclusive`, made with O_EXCL, says who holds
// or waits for the exclusive side, and `shared/<id>` says who shares it. Each holds its owner's
// pid, and its owner touches it every HEARTBEAT_MS while it holds or waits. An entry whose pid
// has gone, or whose heartbeat is older than STALE_MS (a crashed worker's, its pid since reused),
// is stale and passed over, so nothing can hold the run up for good. A wait has a ceiling
// (MAX_WAIT_MS): past it, acquire() rejects, and the test fails loudly rather than measuring.
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PERF_SPEC } from '../pr-shards';

export type Isolation = 'exclusive' | 'shared';

/** How often a holder or waiter touches its entry. */
export const HEARTBEAT_MS = 5_000;
/** An entry untouched this long is a crashed worker's, whatever its pid says. */
export const STALE_MS = 30_000;
/** The longest a test waits for the lock: several perf tests' worth, then it fails. */
export const MAX_WAIT_MS = 10 * 60_000;

// How long each test waited for the lock, by its TestInfo. The fixture extends the test's timeout
// by the wait, and a test body that sets a timeout of its own (lib/run-cell.ts) adds the wait back,
// so a test that waited for a perf test still has all of its own budget.
const waits = new WeakMap<object, number>();

/** Records how long a test waited for the lock (fixtures.ts, once it holds it). */
export function recordIsolationWait(testInfo: object, waitedMs: number): void {
  waits.set(testInfo, waitedMs);
}

/** How long a test waited for the lock: 0 for one that didn't, or that has no record. */
export function isolationWaitFor(testInfo: object): number {
  return waits.get(testInfo) ?? 0;
}

/**
 * Sets a test body's own timeout, plus the time the test waited for the lock: Playwright's timeout
 * counts that wait, and a body's setTimeout replaces the fixture's extension. Every test body under
 * tests/quality sets its timeout through this (isolation.test.ts holds them to it).
 */
export function setOwnTimeout(testInfo: { setTimeout(ms: number): void }, ownMs: number): void {
  testInfo.setTimeout(ownMs + isolationWaitFor(testInfo));
}

/** A test file's isolation: a perf test runs alone, and every other test shares the runner. */
export function isolationFor(file: string): Isolation {
  return path.basename(file) === PERF_SPEC ? 'exclusive' : 'shared';
}

export interface IsolationLock {
  /**
   * Takes `isolation` for `id` (a worker's own name), and resolves with its release; rejects
   * when it has waited `maxWaitMs`.
   */
  acquire(id: string, isolation: Isolation, maxWaitMs?: number): Promise<() => void>;
}

export interface IsolationOptions {
  readonly pollMs?: number;
  readonly heartbeatMs?: number;
  readonly staleMs?: number;
  /** With a file (QUALITY_ISOLATION_LOG), each hold's start and release is a line there. */
  readonly log?: string;
}

const alive = (pid: number) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process is there, and someone else's.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** The lock in `dir`. */
export function isolationLock(dir: string, options: IsolationOptions = {}): IsolationLock {
  const pollMs = options.pollMs ?? 50;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const staleMs = options.staleMs ?? STALE_MS;
  const log = options.log ?? process.env.QUALITY_ISOLATION_LOG;
  const sharedDir = path.join(dir, 'shared');
  const exclusiveFile = path.join(dir, 'exclusive');
  mkdirSync(sharedDir, { recursive: true });
  const wait = () => new Promise((resolve) => setTimeout(resolve, pollMs));
  const me = String(process.pid);

  /** Whether `file` is a live holder's or waiter's entry; a stale one is removed. */
  const live = (file: string) => {
    let pid: number;
    let touched: number;
    try {
      pid = Number(readFileSync(file, 'utf8'));
      touched = statSync(file).mtimeMs;
    } catch {
      return false;
    }
    if (alive(pid) && Date.now() - touched <= staleMs) return true;
    rmSync(file, { force: true });
    return false;
  };
  const sharers = (id: string) =>
    readdirSync(sharedDir).filter((name) => name !== id && live(path.join(sharedDir, name)));
  const write = (file: string, flags: 'w' | 'wx') => {
    const fd = openSync(file, flags);
    writeSync(fd, me);
    closeSync(fd);
  };
  /** Touches `file` every heartbeat until stopped. */
  const beat = (file: string) => {
    const timer = setInterval(() => {
      try {
        const now = new Date();
        utimesSync(file, now, now);
      } catch {
        // Gone: released, or passed over as stale.
      }
    }, heartbeatMs);
    timer.unref();
    return () => clearInterval(timer);
  };
  const note = (id: string, isolation: Isolation, event: 'start' | 'release') => {
    if (log) appendFileSync(log, `${Date.now()} ${me} ${id} ${isolation} ${event}\n`);
  };
  const held = (id: string, isolation: Isolation, file: string, stop: () => void) => {
    note(id, isolation, 'start');
    return () => {
      note(id, isolation, 'release');
      stop();
      rmSync(file, { force: true });
    };
  };
  const ceiling = (id: string, isolation: Isolation, maxWaitMs: number) =>
    new Error(
      `${id} waited ${Math.round(maxWaitMs / 1000)} s for the perf isolation lock's ${isolation} side, its ceiling (lib/perf/isolation.ts): something holds it too long, so this test fails rather than run or measure beside it.`,
    );

  return {
    async acquire(id, isolation, maxWaitMs = MAX_WAIT_MS) {
      const deadline = Date.now() + maxWaitMs;
      if (isolation === 'shared') {
        const mine = path.join(sharedDir, id);
        for (;;) {
          // Writers go first: none starts while an exclusive asker waits or holds.
          if (!live(exclusiveFile)) {
            write(mine, 'w');
            // An exclusive asker may have come between the check and the write: it goes first.
            if (!live(exclusiveFile)) return held(id, 'shared', mine, beat(mine));
            rmSync(mine, { force: true });
          }
          if (Date.now() >= deadline) throw ceiling(id, isolation, maxWaitMs);
          await wait();
        }
      }
      for (;;) {
        try {
          write(exclusiveFile, 'wx');
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          live(exclusiveFile);
          if (Date.now() >= deadline) throw ceiling(id, isolation, maxWaitMs);
          await wait();
        }
      }
      // Asked: no new shared holder starts. Starts once those in flight have finished.
      const stop = beat(exclusiveFile);
      while (sharers(id).length > 0) {
        if (Date.now() >= deadline) {
          stop();
          rmSync(exclusiveFile, { force: true });
          throw ceiling(id, isolation, maxWaitMs);
        }
        await wait();
      }
      return held(id, 'exclusive', exclusiveFile, stop);
    },
  };
}

/** The run's lock, in a directory its canary names, so concurrent runs on one machine keep apart. */
export function runIsolationDir(canary: string): string {
  const key = createHash('sha256').update(canary).digest('hex').slice(0, 16);
  return path.join(tmpdir(), `quality-isolation-${key}`);
}
