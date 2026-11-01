import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { limitSource } from '@portfolio/core/owner';
import { recordOwnerModule } from '../load-trace';

// auth.login's limits (#2). They live in memory and reset on restart, and
// none of them locks the owner out for good.
//
// - Per source, only when a trusted proxy names one: 5 failures in 15
//   minutes block the source for a minute, doubling with each further
//   failure up to 15 minutes. The doubling lasts until the source has been
//   quiet for 15 minutes after its block, and a success clears it. A source
//   is an IPv4 address or an IPv6 /64, kept as an HMAC under a key made per
//   process, so the map holds no address. The map keeps 10,000 sources, and
//   making room in it never drops a source that is still blocked.
// - Per source too: a source has one place, which an attempt holds from
//   before its body is read until it has its answer, so a source holds at
//   most one of the 16 places below and one of the 2 verification slots.
//   Another attempt from it meanwhile gets 429 at once, and being turned
//   away is never a failure, so crowding a source can't get it blocked. Its
//   attempts verify one at a time, each failure counted before the next
//   goes in, so a burst, or a body held open, gets no more verifications
//   than the limit allows.
// - Globally: once the trailing hour has 50 failures, every attempt waits 2
//   seconds before its verification. It waits outside the verification
//   slots, so waiting attempts never hold one, and at most 16 wait at once:
//   another one gets 429 at once. Only the last 50 failures are kept.
// - At most 2 verifications run at once. An attempt that finds both slots
//   taken never runs one.

recordOwnerModule('server/owner/login-limits');

export const LOGIN_LIMITS = Object.freeze({
  sourceWindowMs: 15 * 60_000,
  sourceFailures: 5,
  firstBlockMs: 60_000,
  maxBlockMs: 15 * 60_000,
  sourceAttempts: 1,
  globalWindowMs: 60 * 60_000,
  globalFailures: 50,
  slowdownMs: 2_000,
  maxWaiting: 16,
  maxVerifications: 2,
});

/** How many sources the map keeps before it drops the oldest that aren't blocked. */
const MAX_SOURCES = 10_000;

interface SourceState {
  /** Failures in the last 15 minutes. */
  failures: number[];
  /** How many blocks in a row the source has earned. */
  level: number;
  blockedUntil: number;
  lastFailure: number;
}

/** An attempt let in, with its place to give back, or turned away: why, and for how many seconds. */
export type Admission =
  | { readonly admitted: true; readonly release: () => void }
  | {
      readonly admitted: false;
      readonly reason: 'source_blocked' | 'busy';
      readonly retryAfter: number;
    };

export interface LoginLimits {
  /**
   * Lets an attempt from `address` in, holding its source's place until it
   * calls `release`, or turns it away: its source is blocked, or another
   * attempt holds the place. With no source, at 0 hops, every attempt goes
   * in.
   */
  admit(address: string | null): Admission;
  /** Whole seconds before the block on `address` ends, or 0 when it has none. */
  retryAfter(address: string | null): number;
  /** How long an attempt waits before its verification. */
  delayMs(): number;
  /** Takes one of the 16 places to wait out the slowdown in, or returns false when all are taken. */
  startWaiting(): boolean;
  stopWaiting(): void;
  /** Takes one of the two verification slots, or returns false when both are taken. */
  acquire(): boolean;
  release(): void;
  failed(address: string | null): void;
  succeeded(address: string | null): void;
}

export interface LoginLimitOptions {
  readonly now?: () => number;
  /** The HMAC key for sources. One is made per process. */
  readonly key?: Buffer;
  /** How many sources the map keeps. Tests pass a small one. */
  readonly maxSources?: number;
}

export function loginLimits({
  now = Date.now,
  key = randomBytes(32),
  maxSources = MAX_SOURCES,
}: LoginLimitOptions = {}): LoginLimits {
  const sources = new Map<string, SourceState>();
  // Each source's attempts let in and not yet answered. An entry lasts only
  // as long as its attempts, so the map is never bigger than the requests
  // in flight.
  const inFlight = new Map<string, number>();
  // The last 50 failures from anywhere, oldest first: all the slowdown asks about.
  const recent: number[] = [];
  let busy = 0;
  let waiting = 0;

  const id = (address: string | null): string | null => {
    const source = limitSource(address);
    return source === null ? null : createHmac('sha256', key).update(source).digest('hex');
  };
  /** Whether the source has been quiet for a whole window since its last failure and block. */
  const quiet = (state: SourceState, at: number) =>
    at - Math.max(state.lastFailure, state.blockedUntil) >= LOGIN_LIMITS.sourceWindowMs;
  const refuse = (reason: 'source_blocked' | 'busy', retryAfter: number): Admission => ({
    admitted: false,
    reason,
    retryAfter,
  });

  /**
   * Keeps the map at its size. It holds sources in the order of their last
   * failure, so the oldest go first, and the walk stops once the map fits.
   * A source still blocked is never dropped, so filling the map never lifts
   * a block. A source new to the map has one failure and no block, so there
   * is always one that can go, if only the new one.
   */
  function trim(at: number): void {
    for (const [source, state] of sources) {
      if (sources.size <= maxSources) return;
      if (state.blockedUntil <= at) sources.delete(source);
    }
  }

  return {
    admit(address) {
      const source = id(address);
      if (source === null) return { admitted: true, release: () => {} };
      const at = now();
      const state = sources.get(source);
      const wait = state ? state.blockedUntil - at : 0;
      if (wait > 0) return refuse('source_blocked', Math.ceil(wait / 1000));
      const attempts = inFlight.get(source) ?? 0;
      if (attempts >= LOGIN_LIMITS.sourceAttempts) return refuse('busy', 1);
      inFlight.set(source, attempts + 1);
      let held = true;
      return {
        admitted: true,
        release() {
          if (!held) return;
          held = false;
          const left = (inFlight.get(source) ?? 1) - 1;
          if (left > 0) inFlight.set(source, left);
          else inFlight.delete(source);
        },
      };
    },

    retryAfter(address) {
      const state = sources.get(id(address) ?? '');
      const wait = state ? state.blockedUntil - now() : 0;
      return wait > 0 ? Math.ceil(wait / 1000) : 0;
    },

    delayMs() {
      // The 50th failure back still inside the hour: the hour has 50.
      const oldest = recent.length >= LOGIN_LIMITS.globalFailures ? recent[0] : undefined;
      return oldest !== undefined && now() - oldest < LOGIN_LIMITS.globalWindowMs
        ? LOGIN_LIMITS.slowdownMs
        : 0;
    },

    startWaiting() {
      if (waiting >= LOGIN_LIMITS.maxWaiting) return false;
      waiting += 1;
      return true;
    },

    stopWaiting() {
      waiting = Math.max(0, waiting - 1);
    },

    acquire() {
      if (busy >= LOGIN_LIMITS.maxVerifications) return false;
      busy += 1;
      return true;
    },

    release() {
      busy = Math.max(0, busy - 1);
    },

    failed(address) {
      const at = now();
      recent.push(at);
      if (recent.length > LOGIN_LIMITS.globalFailures) recent.shift();
      const source = id(address);
      if (source === null) return;
      const known = sources.get(source);
      const state =
        known && !quiet(known, at)
          ? known
          : { failures: [], level: 0, blockedUntil: 0, lastFailure: 0 };
      state.failures = state.failures.filter((time) => at - time < LOGIN_LIMITS.sourceWindowMs);
      state.failures.push(at);
      state.lastFailure = at;
      if (state.level > 0 || state.failures.length >= LOGIN_LIMITS.sourceFailures) {
        state.level += 1;
        const block = LOGIN_LIMITS.firstBlockMs * 2 ** (state.level - 1);
        state.blockedUntil = at + Math.min(LOGIN_LIMITS.maxBlockMs, block);
      }
      sources.delete(source);
      sources.set(source, state);
      trim(at);
    },

    succeeded(address) {
      const source = id(address);
      if (source !== null) sources.delete(source);
    },
  };
}
