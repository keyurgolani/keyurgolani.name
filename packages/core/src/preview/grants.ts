import { recordOwnerModule } from '../load-trace';
import { sessionRef } from '../auth/token';
import type { DraftId } from '../store/layout';
import type { UnitInput } from '../store/unit';
import type { GrantEnvironment, GrantRecord, GrantStore, GrantSubject } from './grant-store';
import { grantDigest, grantRef, isGrantDigest, isGrantToken, newChannelNonce, newGrantToken } from './token';

// Preview grants (#7, Slice 2): what makes one, what keeps it, and what ends
// it. The store holds the records; this decides with them. A grant is bound
// to the #2 session record it was minted under, by digest, never the cookie,
// and to the profile and Studio origin of the deployment that minted it. It
// lasts 15 minutes idle, renewed by Studio's heartbeat, and 2 hours at most,
// or less when its session ends sooner.
//
// Every request re-checks a grant (check()): its hash known, not expired,
// its session still counting, the same profile and origin, and for a draft,
// the draft still there and no newer version of it minted. Events only end
// grants sooner, so status() can say why: #3's `published` and
// `draftDiscarded` supersede draft grants, and #2's onSessionEnded marks a
// session's grants `session_ended`. Revision and fixture grants survive a
// publish. A grant that ends keeps its record, without its documents, until
// its 2-hour cap passes; then sweep() deletes it, and it reads as unknown.

recordOwnerModule('core/preview/grants');

export interface GrantLifetime {
  /** How long a grant lasts without a renewal. */
  readonly idleSeconds: number;
  /** How long it lasts at most, however often renewed. */
  readonly maxSeconds: number;
}

export const GRANT_LIFETIME: GrantLifetime = Object.freeze({ idleSeconds: 900, maxSeconds: 7200 });
/**
 * What PORTFOLIO_PREVIEW_GRANT_IDLE_TTL_SECONDS and
 * PORTFOLIO_PREVIEW_GRANT_MAX_TTL_SECONDS may be set to. The idle limit
 * stays at or under the cap.
 */
export const GRANT_LIFETIME_RANGE = Object.freeze({
  idleSeconds: Object.freeze({ min: 60, max: 3600 }),
  maxSeconds: Object.freeze({ min: 300, max: 43200 }),
});
/**
 * How many grants one session holds active at once. Each frame gets its own,
 * and Studio mints again after every save, so a mint past this supersedes
 * the session's oldest, and an abandoned tab can't pile copies of a draft up
 * in the data directory.
 */
export const MAX_ACTIVE_GRANTS = 16;

/** What preview.grant.status answers, and why a grant renders nothing. */
export type GrantStatus = 'active' | 'superseded' | 'expired' | 'unknown' | 'session_ended';

/** What #2 says of the session a grant is bound to, by its digest. Reading it never slides it. */
export interface GrantSessions {
  resolveDigest(digest: string): Promise<{ readonly status: 'valid' | 'ended' | 'unavailable' }>;
}

/** Whether a draft is still there, from #3's DraftStore. */
export interface GrantDrafts {
  exists(draftId: DraftId): Promise<boolean>;
}

/** One line for the server log: a grant's ref, a count, and a code, never a token or content. */
export interface GrantLogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly event: string;
  /** The first 8 hex characters of the grant's digest. */
  readonly grantRef?: string;
  /** The first 8 hex characters of its session's digest. */
  readonly sessionRef?: string;
  readonly count?: number;
  readonly code?: string;
}
export type GrantLog = (entry: GrantLogEntry) => void;

export interface PreviewGrantsOptions {
  readonly store: GrantStore;
  readonly sessions: GrantSessions;
  readonly drafts: GrantDrafts;
  /** The deployment's profile: a grant counts only under the one it was minted under. */
  readonly profile: string;
  /** The deployment's Studio origin, likewise. */
  readonly studioOrigin: string;
  readonly lifetime?: GrantLifetime;
  readonly now?: () => number;
  readonly log?: GrantLog;
  /** MAX_ACTIVE_GRANTS. */
  readonly maxActive?: number;
}

export type GrantCheck =
  | { readonly status: 'active'; readonly record: GrantRecord }
  | { readonly status: Exclude<GrantStatus, 'active'> }
  /** The data directory couldn't be read: the request renders nothing, and nothing is marked. */
  | { readonly status: 'unavailable' };

export interface MintInput {
  /** The session the mint request came with: its digest, and when it ends regardless. */
  readonly session: { readonly digest: string; readonly absoluteExpiresAt: number };
  readonly subject: GrantSubject;
  /** A draft grant's pinned version, which the caller read and checked. Only a draft grant has one. */
  readonly documents?: UnitInput;
  /** The frame's appearance override, which the caller checked against #4's schema. */
  readonly appearance?: Readonly<Record<string, unknown>>;
  readonly environment: GrantEnvironment;
}

export interface Minted {
  /** For the frame's URL, and nowhere else. */
  readonly token: string;
  readonly record: GrantRecord;
}

export interface GrantExpiry {
  /** When the grant ends if nothing renews it. */
  readonly idleExpiresAt: number;
  /** When it ends regardless. */
  readonly absoluteExpiresAt: number;
}

export type Renewal =
  | { readonly status: 'active'; readonly expiry: GrantExpiry }
  | { readonly status: Exclude<GrantStatus, 'active'> };

export interface PreviewGrants {
  /** A new grant, active at once. A draft grant supersedes the draft's grants for older versions. */
  mint(input: MintInput): Promise<Minted>;
  /** The per-request check: everything a grant must still be to render, read again. */
  check(token: string): Promise<GrantCheck>;
  /**
   * Slides the idle limit of the caller's own active grant, up to its cap.
   * It never slides the session. Anyone else's grant reads as unknown.
   */
  renew(token: string, sessionDigest: string): Promise<Renewal>;
  /** Ends the caller's own active grant as superseded, for rotation and unmount. Returns whether it did. */
  revoke(token: string, sessionDigest: string): Promise<boolean>;
  /** What the caller's own grant is now. Anyone else's reads as unknown. */
  status(token: string, sessionDigest: string): Promise<GrantStatus>;
  /** Supersedes every grant of `draftId`, on #3's `draftDiscarded`. Returns how many it ended. */
  supersedeDraft(draftId: DraftId): Promise<number>;
  /** Supersedes every draft grant, on #3's `published`. Revision and fixture grants stay. */
  supersedeDraftGrants(): Promise<number>;
  /** Marks a session's grants `session_ended`, on #2's onSessionEnded. */
  endSession(sessionDigest: string): Promise<number>;
  /** Deletes the records past their 2-hour cap, and drops the documents of grants that ended. */
  sweep(): Promise<number>;
  expiry(record: GrantRecord): GrantExpiry;
}

const UNKNOWN = Object.freeze({ status: 'unknown' as const });
const EXPIRED = Object.freeze({ status: 'expired' as const });
const SUPERSEDED = Object.freeze({ status: 'superseded' as const });
const SESSION_ENDED = Object.freeze({ status: 'session_ended' as const });
const UNAVAILABLE = Object.freeze({ status: 'unavailable' as const });

/** Runs tasks one after another per key, so no two writes to one record race. */
function serializer() {
  const tails = new Map<string, Promise<void>>();
  return function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const result = (tails.get(key) ?? Promise.resolve()).then(task);
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

/** A record without the copy of a draft it no longer renders. */
function withoutDocuments(record: GrantRecord): GrantRecord {
  if (!record.documents) return record;
  const { documents: _documents, ...rest } = record;
  return Object.freeze(rest);
}

export function createPreviewGrants({
  store,
  sessions,
  drafts,
  profile,
  studioOrigin,
  lifetime = GRANT_LIFETIME,
  now = Date.now,
  log = () => {},
  maxActive = MAX_ACTIVE_GRANTS,
}: PreviewGrantsOptions): PreviewGrants {
  const idleMs = lifetime.idleSeconds * 1000;
  const maxMs = lifetime.maxSeconds * 1000;
  const run = serializer();

  // A record keeps the cap it was minted with, and a lower setting applies to it too.
  const absoluteEnd = (record: GrantRecord) =>
    Math.min(record.absoluteExpiresAt, record.createdAt + maxMs);
  const expiry = (record: GrantRecord): GrantExpiry => {
    const absoluteExpiresAt = absoluteEnd(record);
    return Object.freeze({
      idleExpiresAt: Math.min(record.renewedAt + idleMs, absoluteExpiresAt),
      absoluteExpiresAt,
    });
  };
  const expired = (record: GrantRecord, at: number) => at >= expiry(record).idleExpiresAt;
  /** When the record goes: its 2-hour cap, which outlasts every way it ends. */
  const capped = (record: GrantRecord, at: number) => at >= record.createdAt + maxMs;

  /**
   * Ends an active grant as `state`, without its documents. Under the
   * record's own turn, read again first, so an end is never undone by a
   * renewal that read the record before it. Returns whether it ended it.
   */
  function end(digest: string, state: 'superseded' | 'session_ended'): Promise<boolean> {
    return run(digest, async () => {
      const current = await store.get(digest);
      if (!current || current.state !== 'active') return false;
      await store.put(Object.freeze({ ...withoutDocuments(current), state }));
      log({ level: 'info', event: `preview.grant.${state}`, grantRef: grantRef(digest) });
      return true;
    });
  }

  /** end(), whose failure the caller's answer doesn't wait on: it is logged, and the next check finds it again. */
  async function endQuietly(digest: string, state: 'superseded' | 'session_ended') {
    try {
      await end(digest, state);
    } catch {
      log({ level: 'warn', event: 'preview.grant.mark_failed', grantRef: grantRef(digest) });
    }
  }

  /** Ends every active grant `select` picks. */
  async function endEvery(
    select: (record: GrantRecord) => boolean,
    state: 'superseded' | 'session_ended',
  ): Promise<number> {
    let ended = 0;
    for (const record of await store.list()) {
      if (record.state === 'active' && select(record) && (await end(record.digest, state))) {
        ended++;
      }
    }
    return ended;
  }

  async function check(token: string): Promise<GrantCheck> {
    if (!isGrantToken(token)) return UNKNOWN;
    const digest = grantDigest(token);
    let record: GrantRecord | null;
    try {
      record = await store.get(digest);
    } catch {
      log({ level: 'error', event: 'preview.grant.read_failed', grantRef: grantRef(digest) });
      return UNAVAILABLE;
    }
    if (!record) return UNKNOWN;
    if (record.state === 'superseded') return SUPERSEDED;
    if (record.state === 'session_ended') return SESSION_ENDED;
    if (expired(record, now())) return EXPIRED;
    // A grant from another deployment's profile or origin: as if its session ended.
    if (record.profile !== profile || record.studioOrigin !== studioOrigin) {
      await endQuietly(digest, 'session_ended');
      return SESSION_ENDED;
    }
    const session = await sessions.resolveDigest(record.sessionDigest);
    if (session.status === 'unavailable') return UNAVAILABLE;
    if (session.status === 'ended') {
      await endQuietly(digest, 'session_ended');
      return SESSION_ENDED;
    }
    if (record.subject.kind === 'draft') {
      const { draftId, version } = record.subject;
      let current: boolean;
      try {
        const newest = await store.newestDraftVersion(draftId);
        current = (newest === null || newest <= version) && (await drafts.exists(draftId));
      } catch {
        log({ level: 'error', event: 'preview.grant.read_failed', grantRef: grantRef(digest) });
        return UNAVAILABLE;
      }
      if (!current) {
        await endQuietly(digest, 'superseded');
        return SUPERSEDED;
      }
    }
    return { status: 'active', record };
  }

  /** sweep(), over `records` when the caller has just listed them. */
  async function sweep(records?: readonly GrantRecord[]): Promise<number> {
    const at = now();
    let removed = 0;
    const kept = new Set<DraftId>();
    for (const record of records ?? (await store.list())) {
      if (capped(record, at)) {
        await run(record.digest, () => store.delete(record.digest));
        removed++;
        continue;
      }
      if (record.subject.kind === 'draft') kept.add(record.subject.draftId);
      // Ended or expired: it never renders again, so its copy of the draft goes.
      if (record.documents && (record.state !== 'active' || expired(record, at))) {
        await run(record.digest, async () => {
          const current = await store.get(record.digest);
          if (current?.documents && (current.state !== 'active' || expired(current, at))) {
            await store.put(withoutDocuments(current));
          }
        });
      }
    }
    // A draft no grant names any more needs no newest version.
    for (const draftId of await store.listDraftMarkers()) {
      if (!kept.has(draftId)) await run(`draft:${draftId}`, () => store.deleteDraftMarker(draftId));
    }
    return removed;
  }

  /** The caller's own record for `token`, or null for anyone else's, or none. */
  async function own(token: string, sessionDigest: string): Promise<GrantRecord | null> {
    if (!isGrantToken(token)) return null;
    const record = await store.get(grantDigest(token));
    return record && record.sessionDigest === sessionDigest ? record : null;
  }

  return {
    async mint({ session, subject, documents, appearance, environment }) {
      if (!isGrantDigest(session.digest)) throw new TypeError('Not a session digest.');
      if ((subject.kind === 'draft') !== (documents !== undefined)) {
        throw new TypeError('A draft grant, and only a draft grant, pins documents.');
      }
      const at = now();
      const absoluteExpiresAt = Math.min(at + maxMs, session.absoluteExpiresAt);
      if (absoluteExpiresAt <= at) throw new TypeError('The session has ended.');
      if (subject.kind === 'draft') {
        const { draftId, version } = subject;
        // The newest version goes down first, so a grant of an older one
        // stops at its next check even if what follows doesn't finish.
        await run(`draft:${draftId}`, async () => {
          const newest = await store.newestDraftVersion(draftId);
          if (newest !== null && newest > version) {
            throw new TypeError('A newer version of the draft has a grant already.');
          }
          if (newest !== version) await store.setNewestDraftVersion(draftId, version);
        });
      }
      const token = newGrantToken();
      const digest = grantDigest(token);
      const record: GrantRecord = Object.freeze({
        digest,
        sessionDigest: session.digest,
        profile,
        studioOrigin,
        nonce: newChannelNonce(),
        subject,
        ...(documents ? { documents } : {}),
        ...(appearance ? { appearance } : {}),
        environment,
        createdAt: at,
        renewedAt: at,
        absoluteExpiresAt,
        state: 'active' as const,
      });
      await run(digest, () => store.put(record));
      log({
        level: 'info',
        event: 'preview.grant.minted',
        grantRef: grantRef(digest),
        sessionRef: sessionRef(session.digest),
      });
      // The draft's grants for older versions, and the session's oldest
      // past its limit, end now rather than at their next check.
      const all = await store.list();
      const active = all.filter((each) => each.state === 'active' && each.digest !== digest);
      const ending = new Set<string>();
      if (subject.kind === 'draft') {
        for (const each of active) {
          if (
            each.subject.kind === 'draft' &&
            each.subject.draftId === subject.draftId &&
            each.subject.version < subject.version
          ) {
            ending.add(each.digest);
          }
        }
      }
      const theirs = active
        .filter((each) => each.sessionDigest === session.digest && !ending.has(each.digest))
        .sort((a, b) => a.createdAt - b.createdAt || a.digest.localeCompare(b.digest));
      // This grant counts toward the limit too.
      for (const each of theirs.slice(0, Math.max(0, theirs.length + 1 - maxActive))) {
        ending.add(each.digest);
      }
      for (const each of ending) await end(each, 'superseded');
      await sweep(all);
      return Object.freeze({ token, record });
    },

    check,

    async renew(token, sessionDigest) {
      const mine = await own(token, sessionDigest);
      if (!mine) return UNKNOWN;
      const checked = await check(token);
      if (checked.status === 'unavailable') throw new Error('The grant store is unavailable.');
      if (checked.status !== 'active') return checked;
      return run(mine.digest, async (): Promise<Renewal> => {
        const current = await store.get(mine.digest);
        if (!current) return UNKNOWN;
        if (current.state !== 'active') return { status: current.state };
        const at = now();
        if (expired(current, at)) return EXPIRED;
        const renewed: GrantRecord = Object.freeze({
          ...current,
          renewedAt: Math.min(at, absoluteEnd(current)),
        });
        await store.put(renewed);
        return { status: 'active', expiry: expiry(renewed) };
      });
    },

    async revoke(token, sessionDigest) {
      const mine = await own(token, sessionDigest);
      if (!mine) return false;
      return end(mine.digest, 'superseded');
    },

    async status(token, sessionDigest) {
      const mine = await own(token, sessionDigest);
      if (!mine) return 'unknown';
      const checked = await check(token);
      if (checked.status === 'unavailable') throw new Error('The grant store is unavailable.');
      return checked.status;
    },

    async supersedeDraft(draftId) {
      const ended = await endEvery(
        (record) => record.subject.kind === 'draft' && record.subject.draftId === draftId,
        'superseded',
      );
      await run(`draft:${draftId}`, () => store.deleteDraftMarker(draftId));
      return ended;
    },

    supersedeDraftGrants() {
      return endEvery((record) => record.subject.kind === 'draft', 'superseded');
    },

    async endSession(sessionDigest) {
      const ended = await endEvery(
        (record) => record.sessionDigest === sessionDigest,
        'session_ended',
      );
      if (ended > 0) {
        log({
          level: 'info',
          event: 'preview.grant.session_ended',
          sessionRef: sessionRef(sessionDigest),
          count: ended,
        });
      }
      return ended;
    },

    sweep: () => sweep(),
    expiry,
  };
}
