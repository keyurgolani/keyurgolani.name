import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuditSink, OwnerLog } from '../audit/sink';
import { recordOwnerModule } from '../load-trace';
import { DIGEST } from './session-files.mjs';
import type { SessionRecord, SessionStore, UaFamily } from './session-store';
import { isSessionToken, newSessionToken, sessionDigest, sessionRef } from './token';

// Owner sessions (#2): what makes one, what keeps it, and what ends it. The
// store holds the records; this decides with them. A session lasts 60
// minutes idle and 12 hours in all by default, at most 5 exist, and one ends
// on logout, revocation, eviction, expiry, a changed password hash, or an
// operator's revoke-sessions run. Each end the process sees fires
// onSessionEnded(digest), for #7. Only a Studio command or a Studio page the
// owner opens slides the idle limit, so a page on a sibling origin, which
// the browser sends the owner's cookie from, can't keep a session alive.

recordOwnerModule('core/auth/sessions');

export interface SessionLifetime {
  /** How long a session lasts without a command or a page the owner opens. */
  readonly idleMinutes: number;
  /** How long it lasts at most, however busy. */
  readonly maxHours: number;
}

export const SESSION_LIFETIME: SessionLifetime = Object.freeze({ idleMinutes: 60, maxHours: 12 });
/** What PORTFOLIO_AUTH_SESSION_IDLE_MINUTES and PORTFOLIO_AUTH_SESSION_MAX_HOURS may be set to. */
export const SESSION_LIFETIME_RANGE = Object.freeze({
  idleMinutes: Object.freeze({ min: 5, max: 120 }),
  maxHours: Object.freeze({ min: 1, max: 24 }),
});
export const MAX_SESSIONS = 5;
/** How often a busy session writes lastSeenAt. */
export const TOUCH_INTERVAL_MS = 60_000;
/**
 * How long a commit may hold its session before the hold lapses (#3). The
 * commit it holds is #3's pointer move alone: one small file written and
 * synced before its final check. A local fsync takes milliseconds, and a
 * disk deep in writeback a second or two; 10 s is well past both, and still
 * short enough that a logout queued behind a stuck commit lands soon.
 */
export const COMMIT_TIMEOUT_MS = 10_000;

/** Headers, as a Request or Next's headers() holds them. */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * What a request with a valid session did, which decides whether it slides
 * the idle limit. A sibling origin is the same site, so the browser sends
 * the owner's cookie with whatever a page there requests: only what such a
 * page can't send counts as the owner's activity.
 */
export type Activity =
  /**
   * A Studio command, which passed the origin and CSRF checks before
   * anything slides. `extend` is auth.session.extend, which writes at once.
   */
  | { readonly kind: 'command'; readonly extend?: boolean }
  /** A Studio query: any same-site page can send one in the background. */
  | { readonly kind: 'query' }
  /** A Studio page, judged by the request's Fetch Metadata. */
  | { readonly kind: 'page'; readonly headers: HeaderReader };

/** The App Router's prefetch headers: a prefetch isn't the owner opening the page. */
const ROUTER_PREFETCH = ['next-router-prefetch', 'next-router-segment-prefetch'];

/**
 * Whether `activity` slides the idle limit. A page counts when the owner
 * opened it: from the owner origin itself or the address bar
 * (`Sec-Fetch-Site: same-origin` or `none`), as a top-level document or the
 * App Router fetching the page it navigates to, and not as a prefetch or a
 * prerender. Without Fetch Metadata, as from a browser too old to send it,
 * nothing tells the owner's request from a sibling's, so a page doesn't
 * count; a command still does.
 */
export function slides(activity: Activity): boolean {
  if (activity.kind === 'command') return true;
  if (activity.kind === 'query') return false;
  const { headers } = activity;
  const site = headers.get('sec-fetch-site');
  if (site !== 'same-origin' && site !== 'none') return false;
  const purpose = `${headers.get('sec-purpose') ?? ''} ${headers.get('purpose') ?? ''}`;
  if (/prefetch|prerender/i.test(purpose)) return false;
  if (ROUTER_PREFETCH.some((name) => headers.get(name) !== null)) return false;
  const dest = headers.get('sec-fetch-dest');
  if (headers.get('sec-fetch-mode') === 'navigate') return dest === 'document';
  // The App Router's RSC request, a custom header a sibling's script can't
  // send without a CORS preflight that nothing here answers.
  return site === 'same-origin' && headers.get('rsc') === '1' && dest === 'empty';
}

/** Why the session a request carried no longer counts. */
export type EndedReason =
  /** The cookie isn't a token. */
  | 'malformed'
  /** No record: it ended before, or was never issued. */
  | 'unknown'
  /** The idle or the absolute limit passed. */
  | 'expired'
  /** It signed in under another password hash. */
  | 'credential_changed'
  /** revoke-sessions ran after it was created. */
  | 'revoked';

export type Resolution =
  /** No cookie at all. */
  | { readonly status: 'none' }
  | { readonly status: 'ended'; readonly reason: EndedReason }
  /** The store couldn't be read. The request gets no session, and the cookie stays. */
  | { readonly status: 'unavailable' }
  | { readonly status: 'valid'; readonly token: string; readonly record: SessionRecord };

/** What a session's digest comes to: resolve()'s answers, with no token, which only the cookie holds. */
export type DigestResolution =
  | { readonly status: 'ended'; readonly reason: EndedReason }
  | { readonly status: 'unavailable' }
  | { readonly status: 'valid'; readonly record: SessionRecord };

/** What an audit record may say about the request behind an event. */
export interface AuditContext {
  readonly requestId?: string;
}

declare const held: unique symbol;

/**
 * Proof that a command holds its session's lock, with the session read again
 * and still counting, for as long as its commit runs. Only
 * Sessions.holding() makes one, and it counts only until that commit
 * returns or its time runs out, so #3's pointer advance can ask for it with
 * assertSessionHeld(), and once more with enterCommitPoint() just before it
 * commits.
 */
export interface SessionHold {
  /** The session, as an audit record names it. */
  readonly sessionRef: string;
  readonly [held]: true;
}

/**
 * Where a hold's commit is: `held` while it runs, `committing` once it
 * passed its final check, and `lapsed` once its time ran out first.
 */
type HoldPhase = 'held' | 'committing' | 'lapsed';

// Holds in force, on a globalThis symbol: the provider that makes one and the
// store that checks it can sit in different server bundles.
const HOLDS = Symbol.for('keyurgolani.portfolio.session-holds');
type HoldHolder = typeof globalThis & { [HOLDS]?: WeakMap<object, { phase: HoldPhase }> };
const holds = (): WeakMap<object, { phase: HoldPhase }> =>
  ((globalThis as HoldHolder)[HOLDS] ??= new WeakMap());
const holdOf = (value: unknown) =>
  typeof value === 'object' && value !== null ? holds().get(value) : undefined;

/** Whether `value` is a SessionHold whose commit is still running, and hasn't run out of time. */
export function isSessionHeld(value: unknown): value is SessionHold {
  const hold = holdOf(value);
  return hold !== undefined && hold.phase !== 'lapsed';
}

/** Throws unless `value` is a SessionHold whose commit is still running. */
export function assertSessionHeld(value: unknown): asserts value is SessionHold {
  if (!isSessionHeld(value)) throw new Error('The command does not hold a session that counts.');
}

/**
 * A commit point's final check, made just before the step that commits,
 * such as #3's rename of live.json: true while `value` is a hold that still
 * counts. From then on the session's lock waits for the commit to return,
 * past the commit timeout too, so nothing that ends the session lands
 * between this check and the commit. False once the hold lapsed or its
 * commit returned: the caller must not commit.
 */
export function enterCommitPoint(value: unknown): boolean {
  const hold = holdOf(value);
  if (hold === undefined || hold.phase === 'lapsed') return false;
  hold.phase = 'committing';
  return true;
}

/**
 * What a task gets when it asks for a session's lock that its own async
 * context already holds, such as sessions.list() from inside a commit: it
 * would wait on itself forever, so it fails at once instead.
 */
export class SessionReentryError extends Error {
  constructor() {
    super("A task asked for a session's lock that it already holds.");
    this.name = 'SessionReentryError';
  }
}

/** What holding() did: ran the commit, or found the session no longer counts. */
export type Holding<T> =
  | { readonly status: 'valid'; readonly value: T; readonly record: SessionRecord }
  | Exclude<Resolution, { readonly status: 'valid' }>;

export interface Issued {
  /** For the cookie, and nowhere else. */
  readonly token: string;
  readonly record: SessionRecord;
}

export interface Sessions {
  /**
   * Starts a session at sign-in. The sessions the request's cookies carried,
   * if any, end first, so every sign-in gets a new token. With 5 sessions
   * already, the least recently seen is evicted. A failed write throws.
   */
  issue(input: {
    readonly uaFamily: UaFamily;
    readonly replacing?: string | null | readonly string[];
    readonly context?: AuditContext;
  }): Promise<Issued>;
  /** The session a cookie's token carries. One that no longer counts is deleted. */
  resolve(token: string | null | undefined): Promise<Resolution>;
  /**
   * The session `digest` names, read as resolve() reads a token's, and
   * deleted the same way once it no longer counts. It never slides the
   * session. #7's preview grants keep the digest of the session they were
   * minted under, never its token, and check it on every request.
   */
  resolveDigest(digest: string): Promise<DigestResolution>;
  /**
   * A command's commit point: reads the session again under its lock and,
   * while it still counts, runs `commit` without letting go, so a logout, a
   * revocation, an eviction, or revoke-all in this process waits for the
   * commit, and one that came first stops it before it runs. `commit` gets
   * a SessionHold, good only until it returns. Asking for this session's
   * lock from inside `commit` fails at once with SessionReentryError. A
   * commit still running after COMMIT_TIMEOUT_MS loses its hold, and the
   * lock goes to whatever waits: from then on enterCommitPoint() refuses it,
   * so it can't commit. One already past enterCommitPoint() keeps the lock
   * until it returns. holding() itself returns once `commit` has, and passes
   * on what it threw. revoke-sessions runs in another process, outside this
   * lock: a commit already running when it writes still finishes, and the
   * next request is refused.
   */
  holding<T>(
    token: string | null | undefined,
    commit: (hold: SessionHold, record: SessionRecord) => Promise<T>,
  ): Promise<Holding<T>>;
  /**
   * Slides the idle limit when `activity` does (slides()): writes lastSeenAt
   * once a minute at most, or at once for auth.session.extend. Any other
   * activity leaves the record as it is, unread. A failed write is logged,
   * and the request goes on with the record it had. A session ended
   * meanwhile is never written back, and answers null.
   */
  touch(record: SessionRecord, activity: Activity): Promise<SessionRecord | null>;
  /** Ends one session, as logout or as a revocation. Returns whether it was there. */
  end(digest: string, reason: 'logout' | 'revoked', context?: AuditContext): Promise<boolean>;
  /** Ends every session. Returns how many there were. */
  revokeAll(context?: AuditContext): Promise<number>;
  /** The sessions that count, most recently seen first. */
  list(): Promise<SessionRecord[]>;
  /** Called with the digest of each session that ends in this process. Returns an unsubscribe. */
  onSessionEnded(listener: (digest: string) => void): () => void;
  /** When the session ends if nothing slides it, and when it ends regardless. */
  expiry(record: SessionRecord): {
    readonly idleExpiresAt: number;
    readonly absoluteExpiresAt: number;
  };
  /** The cookie's Max-Age: the absolute lifetime left, in whole seconds. */
  maxAgeSeconds(record: SessionRecord): number;
}

export interface SessionsOptions {
  readonly store: SessionStore;
  readonly audit: AuditSink;
  /** credentialFingerprint() of the configured password hash. */
  readonly fingerprint: string;
  readonly lifetime?: SessionLifetime;
  readonly now?: () => number;
  readonly log?: OwnerLog;
  /** How long a commit holds its session before the hold lapses: COMMIT_TIMEOUT_MS. */
  readonly commitTimeoutMs?: number;
}

const NONE = Object.freeze({ status: 'none' as const });
const UNAVAILABLE = Object.freeze({ status: 'unavailable' as const });
const ended = (reason: EndedReason) => Object.freeze({ status: 'ended' as const, reason });

/**
 * Runs tasks one after another per key, so a touch never writes back a
 * session that a logout, a revocation, or a sign-in has just ended. Each
 * task runs knowing, through its async context, the keys it holds: one that
 * asks for a key it already holds would wait on itself, so it fails at once
 * with SessionReentryError. A task holds its key until the promise it
 * returns settles.
 */
function serializer() {
  const tails = new Map<string, Promise<void>>();
  const holding = new AsyncLocalStorage<ReadonlySet<string>>();
  return function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const held = holding.getStore();
    if (held?.has(key)) return Promise.reject(new SessionReentryError());
    const keys = new Set(held);
    keys.add(key);
    const result = (tails.get(key) ?? Promise.resolve()).then(() => holding.run(keys, task));
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
}

/** Sign-ins and revoke-all take this key, and then a session's own. Nothing takes them the other way. */
const ISSUE = 'issue';

export function createSessions({
  store,
  audit,
  fingerprint,
  lifetime = SESSION_LIFETIME,
  now = Date.now,
  log = () => {},
  commitTimeoutMs = COMMIT_TIMEOUT_MS,
}: SessionsOptions): Sessions {
  const idleMs = lifetime.idleMinutes * 60_000;
  const maxMs = lifetime.maxHours * 3_600_000;
  const listeners = new Set<(digest: string) => void>();
  const run = serializer();

  // A record keeps the limit it was issued with, and a lower setting applies
  // to it too.
  const absoluteEnd = (record: SessionRecord) =>
    Math.min(record.absoluteExpiresAt, record.createdAt + maxMs);

  function announce(digest: string): void {
    for (const listener of listeners) {
      try {
        listener(digest);
      } catch {
        log({ level: 'error', event: 'session.listener_failed' });
      }
    }
  }

  function problem(
    record: SessionRecord,
    revokedBefore: number | null,
    at: number,
  ): EndedReason | null {
    if (revokedBefore !== null && record.createdAt <= revokedBefore) return 'revoked';
    if (record.credentialFingerprint !== fingerprint) return 'credential_changed';
    if (at >= absoluteEnd(record) || at >= record.lastSeenAt + idleMs) return 'expired';
    return null;
  }

  /** Deletes a record, holding its key already, and tells the listeners if it was there. */
  async function dropHeld(digest: string): Promise<boolean> {
    const existed = await store.delete(digest);
    if (existed) announce(digest);
    return existed;
  }
  const drop = (digest: string) => run(digest, () => dropHeld(digest));

  /** The records that count, deleting the rest. */
  async function live(at: number): Promise<SessionRecord[]> {
    const revokedBefore = await store.revokedBefore();
    const kept: SessionRecord[] = [];
    for (const record of await store.list()) {
      if (problem(record, revokedBefore, at)) await drop(record.digest);
      else kept.push(record);
    }
    return kept;
  }

  return {
    issue({ uaFamily, replacing, context }) {
      return run(ISSUE, async () => {
        const sent = typeof replacing === 'string' ? [replacing] : (replacing ?? []);
        for (const token of sent) if (isSessionToken(token)) await drop(sessionDigest(token));
        const at = now();
        const others = (await live(at)).sort((a, b) => a.lastSeenAt - b.lastSeenAt);
        while (others.length >= MAX_SESSIONS) {
          const oldest = others.shift();
          if (oldest && (await drop(oldest.digest))) {
            await audit.record({
              type: 'session_evicted',
              actor: 'owner',
              outcome: 'success',
              refs: { sessionRef: sessionRef(oldest.digest), requestId: context?.requestId },
            });
          }
        }
        const token = newSessionToken();
        const record: SessionRecord = Object.freeze({
          digest: sessionDigest(token),
          createdAt: at,
          lastSeenAt: at,
          absoluteExpiresAt: at + maxMs,
          credentialFingerprint: fingerprint,
          uaFamily,
        });
        await store.put(record);
        return Object.freeze({ token, record });
      });
    },

    async resolve(token) {
      if (token === undefined || token === null || token === '') return NONE;
      if (!isSessionToken(token)) return ended('malformed');
      const digest = sessionDigest(token);
      return run(digest, async () => {
        try {
          const record = await store.get(digest);
          if (!record) return ended('unknown');
          const reason = problem(record, await store.revokedBefore(), now());
          if (reason) {
            await dropHeld(digest);
            return ended(reason);
          }
          return Object.freeze({ status: 'valid' as const, token, record });
        } catch {
          log({ level: 'error', event: 'session.read_failed' });
          return UNAVAILABLE;
        }
      });
    },

    async resolveDigest(digest) {
      if (typeof digest !== 'string' || !DIGEST.test(digest)) return ended('malformed');
      return run(digest, async (): Promise<DigestResolution> => {
        try {
          const record = await store.get(digest);
          if (!record) return ended('unknown');
          const reason = problem(record, await store.revokedBefore(), now());
          if (reason) {
            await dropHeld(digest);
            return ended(reason);
          }
          return Object.freeze({ status: 'valid' as const, record });
        } catch {
          log({ level: 'error', event: 'session.read_failed' });
          return UNAVAILABLE;
        }
      });
    },

    async holding<T>(
      token: string | null | undefined,
      commit: (hold: SessionHold, record: SessionRecord) => Promise<T>,
    ): Promise<Holding<T>> {
      if (token === undefined || token === null || token === '') return NONE;
      if (!isSessionToken(token)) return ended('malformed');
      const digest = sessionDigest(token);
      type Settled =
        { readonly ok: true; readonly value: T } | { readonly ok: false; error: unknown };
      // The lock is held from the read until the commit returns, or until its
      // time runs out first, whichever is sooner; holding() itself waits for
      // the commit either way.
      const locked = await run(
        digest,
        async (): Promise<
          | Exclude<Holding<T>, { readonly status: 'valid' }>
          | { readonly status: 'held'; readonly record: SessionRecord; settled: Promise<Settled> }
        > => {
          let record: SessionRecord | null;
          try {
            record = await store.get(digest);
            if (!record) return ended('unknown');
            const reason = problem(record, await store.revokedBefore(), now());
            if (reason) {
              await dropHeld(digest);
              return ended(reason);
            }
          } catch {
            log({ level: 'error', event: 'session.read_failed' });
            return UNAVAILABLE;
          }
          const hold = Object.freeze({ sessionRef: sessionRef(digest) }) as unknown as SessionHold;
          const state: { phase: HoldPhase } = { phase: 'held' };
          holds().set(hold, state);
          const current = record;
          const settled = (async (): Promise<Settled> => {
            try {
              return { ok: true, value: (await commit(hold, current)) as T };
            } catch (error) {
              return { ok: false, error };
            } finally {
              holds().delete(hold);
            }
          })();
          let timer: ReturnType<typeof setTimeout> | undefined;
          const lapsed = new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              // A commit past its final check keeps the lock until it returns.
              if (state.phase !== 'held') return;
              state.phase = 'lapsed';
              log({ level: 'error', event: 'session.commit_timeout' });
              resolve();
            }, commitTimeoutMs);
          });
          await Promise.race([settled, lapsed]);
          clearTimeout(timer);
          return { status: 'held', record: current, settled };
        },
      );
      if (locked.status !== 'held') return locked;
      const settled = await locked.settled;
      if (!settled.ok) throw settled.error;
      return Object.freeze({
        status: 'valid' as const,
        value: settled.value,
        record: locked.record,
      });
    },

    touch(record, activity) {
      if (!slides(activity)) return Promise.resolve(record);
      const force = activity.kind === 'command' && activity.extend === true;
      return run(record.digest, async () => {
        try {
          const current = await store.get(record.digest);
          if (!current) return null;
          const at = now();
          if (!force && at - current.lastSeenAt < TOUCH_INTERVAL_MS) return current;
          const next: SessionRecord = Object.freeze({ ...current, lastSeenAt: at });
          await store.put(next);
          return next;
        } catch {
          log({ level: 'warn', event: 'session.touch_failed' });
          return record;
        }
      });
    },

    end(digest, reason, context) {
      return run(digest, async () => {
        const existed = await dropHeld(digest);
        if (existed) {
          await audit.record({
            type: reason === 'logout' ? 'logout' : 'session_revoked',
            actor: 'owner',
            outcome: 'success',
            refs: { sessionRef: sessionRef(digest), requestId: context?.requestId },
          });
        }
        return existed;
      });
    },

    revokeAll(context) {
      return run(ISSUE, async () => {
        // Each session's own lock too, in a fixed order: a touch already
        // running finishes first, and one queued behind finds no record to
        // write back.
        const held = (await store.list()).map((record) => record.digest).sort();
        const revoke = held.reduceRight<() => Promise<string[]>>(
          (inner, digest) => () => run(digest, inner),
          () => store.revokeAll(now()),
        );
        const digests = await revoke();
        for (const digest of digests) announce(digest);
        await audit.record({
          type: 'sessions_revoked_all',
          actor: 'owner',
          outcome: 'success',
          refs: { count: digests.length, requestId: context?.requestId },
        });
        return digests.length;
      });
    },

    async list() {
      return (await live(now())).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    },

    onSessionEnded(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    expiry(record) {
      const absoluteExpiresAt = absoluteEnd(record);
      return Object.freeze({
        idleExpiresAt: Math.min(record.lastSeenAt + idleMs, absoluteExpiresAt),
        absoluteExpiresAt,
      });
    },

    maxAgeSeconds(record) {
      return Math.max(0, Math.floor((absoluteEnd(record) - now()) / 1000));
    },
  };
}

/**
 * The coarse browser family a session list shows, from a User-Agent
 * header. The header itself is never stored.
 */
export function browserFamily(userAgent: string | null | undefined): UaFamily {
  if (!userAgent) return 'other';
  if (/\bEdg(?:e|A|iOS)?\//.test(userAgent)) return 'edge';
  if (/\b(?:Firefox|FxiOS)\//.test(userAgent)) return 'firefox';
  if (/\b(?:Chrome|CriOS|Chromium)\//.test(userAgent)) return 'chrome';
  if (/\bVersion\/[\d.]+.*\bSafari\//.test(userAgent)) return 'safari';
  return 'other';
}
