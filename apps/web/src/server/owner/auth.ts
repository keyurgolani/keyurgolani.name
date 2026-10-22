import 'server-only';
import {
  aggregateAnonymous,
  createSessions,
  credentialFingerprint,
  csrfToken,
  filesystemAuditSink,
  filesystemSessionStore,
  localPasswordProvider,
  parseHash,
  sessionRef,
  sourcePrefix,
  syncCredentialFingerprint,
  type Activity,
  type AuditSink,
  type LocalPasswordOptions,
  type OwnerLog,
  type Sessions,
} from '@portfolio/core/owner';
import type { DeploymentConfig } from '../config';
import type { Handler, StudioBindings } from '../dispatcher';
import { recordOwnerModule } from '../load-trace';
import { log } from '../log';
import { listOperations, type Operation } from '../operations';
import { signInLocation } from '../return-to';
import type { Session } from '../session';
import type { PageResolution, StudioPages } from '../studio-port';
import { errorResult, redirectResult } from '../studio-result';
import { authHandlers, isFormPost, returnToOf, throttledAnswer, type Held } from './auth-commands';
import { clearedSessionCookie, cookieMode, readCookies, type CookieMode } from './cookie';
import { checkCsrf, checkMutationOrigin, checkRequestOrigin, clientAddress } from './guard';
import { loginLimits, type LoginLimits } from './login-limits';

// The owner's auth provider (#2): the dispatcher's session, origin, touch,
// and throttle bindings, the auth entries' handlers, and the sessions of
// Studio pages, over @portfolio/core's password check, sessions, and audit
// sink, in the data directory. The composition root loads it through
// import() in its owner branch, after the auth.secret and data.directory
// requirements pass, so the hash and the directory are there. Typed by
// shape, so this module doesn't import the composition root.

recordOwnerModule('server/owner/auth');

/** What the provider binds into the dispatcher. */
export type OwnerAuthBindings = Pick<
  StudioBindings,
  'resolveSession' | 'checkOrigin' | 'touchSession' | 'throttle' | 'invalidInput'
> & {
  /** The auth entries' handlers, by operation name. */
  readonly handlers: Readonly<Record<string, Handler>>;
  /** The sessions of Studio pages, for requireOwnerPage. */
  readonly pages: StudioPages;
};

export interface OwnerAuthTools {
  readonly config: DeploymentConfig;
  readonly mintSession: <T extends object>(fields?: T) => Session & Readonly<T>;
}

export interface OwnerAuthOptions {
  /** The clock sessions and the audit log use. Tests pass their own. */
  readonly now?: () => number;
  /** Tests pass their own audit sink; otherwise the data directory's. */
  readonly audit?: AuditSink;
  /** The key derivation behind each verification. Tests count its calls. */
  readonly derive?: LocalPasswordOptions['derive'];
  /** The wait before a verification once failures pile up. Tests pass their own. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Sign-in's limits. Tests pass their own; otherwise they're made on `now`. */
  readonly limits?: LoginLimits;
}

/** Commands that pass every check yet never slide the session: #7's grant renewal. */
const NEVER_SLIDE = new Set(['preview.grant.renew']);

/** Sign-in: the one command without a CSRF token, as it has no session to take one from yet. */
const SIGN_IN = 'auth.login';

/**
 * Signs out with no session to take a token from, when its cookie ended or
 * the store couldn't be read: the exact Origin is all it needs then. With a
 * session that resolved, it needs that session's token like any command.
 */
const SIGN_OUT = 'auth.logout';

const NO_PAGE_SESSION: PageResolution = Object.freeze({ status: 'none' });
const ENDED_PAGE_SESSION: PageResolution = Object.freeze({ status: 'ended' });
const UNREADABLE_PAGE_SESSION: PageResolution = Object.freeze({ status: 'unavailable' });

/** What touchSession slides for, by operation (Activity, in @portfolio/core). */
export function activityOf(operation: Operation): Activity {
  if (operation.kind === 'command' && !NEVER_SLIDE.has(operation.name)) {
    return { kind: 'command', extend: operation.name === 'auth.session.extend' };
  }
  return { kind: 'query' };
}

const ownerLog: OwnerLog = (entry) => log(entry);

export interface OwnerAuth extends OwnerAuthBindings {
  /** The sessions themselves, for the auth commands. */
  readonly sessions: Sessions;
  readonly audit: AuditSink;
  readonly cookie: CookieMode;
}

/** Builds the provider for `config`: an owner deployment with its hash and data directory. */
export async function provider(
  { config, mintSession }: OwnerAuthTools,
  {
    now = Date.now,
    audit: auditOverride,
    derive,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    limits = loginLimits({ now }),
  }: OwnerAuthOptions = {},
): Promise<OwnerAuth> {
  const { dataDir } = config;
  const hash = config.secrets.authPasswordHash;
  const parsed = hash ? parseHash(hash) : undefined;
  // The data.directory and auth.secret requirements refuse startup without them.
  if (!dataDir || !hash || !parsed?.ok) {
    throw new Error('The owner provider needs a data directory and a valid hash.');
  }
  const fingerprint = credentialFingerprint(hash);
  // A record names only an operation the registry has, never a name from a URL.
  const commands = new Set(listOperations().map((operation) => operation.name));
  const audit =
    auditOverride ??
    aggregateAnonymous(filesystemAuditSink({ dataDir, now, log: ownerLog, commands }), { now });
  await syncCredentialFingerprint({ dataDir, fingerprint, audit, now });
  const sessions = createSessions({
    store: filesystemSessionStore(dataDir),
    audit,
    fingerprint,
    lifetime: config.sessionLifetime,
    now,
    log: ownerLog,
  });
  const cookie = cookieMode(config.origin);
  const held = new WeakMap<Session, Held>();
  const clearing = (): [string, string][] => [['set-cookie', clearedSessionCookie(cookie)]];
  // Sign-ins whose cookie named a session that had ended: every answer to
  // one but a new session clears it.
  const ended = new WeakSet<Request>();
  const endedCookie = (request: Request) => (ended.has(request) ? clearing() : []);
  const handlers = authHandlers({
    config,
    sessions,
    audit,
    cookie,
    limits,
    passwords: localPasswordProvider({ hash: parsed.hash, now, derive }),
    held: (session) => (session ? held.get(session) : undefined),
    endedCookie,
    sleep,
  });

  return {
    sessions,
    audit,
    cookie,
    handlers,

    async resolveSession({ request, operation }) {
      const sent = readCookies(request, cookie.name);
      // Two cookies of the name: one is somebody else's, and which can't be
      // told. Neither counts, and neither is cleared, so the owner's survives.
      if (sent.length > 1) return { session: null };
      const resolution = await sessions.resolve(sent[0]);
      if (resolution.status === 'valid') {
        const session = mintSession({ ref: sessionRef(resolution.record.digest) });
        held.set(session, { token: resolution.token, record: resolution.record });
        return { session };
      }
      // A cookie that no longer counts is cleared, and a response sets the
      // cookie once at most. Sign-out always clears it itself, and sign-in
      // on every answer but a new session, which sets its own. One the
      // store couldn't read stays, so a passing fault doesn't sign the owner
      // out.
      if (resolution.status !== 'ended' || operation.name === SIGN_OUT) return { session: null };
      if (operation.name === SIGN_IN) {
        ended.add(request);
        return { session: null };
      }
      return { session: null, headers: clearing() };
    },

    async checkOrigin({ request, requestId, operation, session }) {
      const entry = session ? held.get(session) : undefined;
      // A command, or a query that asks (no registered one does), from the
      // owner origin. A query has no body to check.
      let reason: string | null =
        operation.kind === 'command'
          ? checkMutationOrigin(request, { origin: config.origin, bodyTypes: operation.bodyTypes })
          : checkRequestOrigin(request, config.origin);
      // And its session's CSRF token, with or without a session: only
      // auth.login goes without, and auth.logout when no session resolved.
      const tokenless = operation.name === SIGN_IN || (operation.name === SIGN_OUT && !entry);
      if (reason === null && !tokenless) {
        reason = entry ? checkCsrf(request, entry.token) : 'csrf_missing';
      }
      if (reason === null) return true;
      // Whoever sent it, it isn't known to be the owner: a forged request
      // carries the owner's cookie too. So it counts as anonymous, naming the
      // session as a ref, and a flood of them is aggregated.
      await audit.record({
        type: 'command_denied',
        actor: 'anonymous',
        outcome: 'denied',
        refs: {
          command: operation.name,
          reason,
          requestId,
          sessionRef: entry ? sessionRef(entry.record.digest) : undefined,
          source: sourcePrefix(clientAddress(request.headers, config.trustedProxyHops)),
        },
      });
      return false;
    },

    async touchSession({ operation, session }) {
      const entry = held.get(session);
      if (!entry) return;
      const touched = await sessions.touch(entry.record, activityOf(operation));
      // A session that ended during the request is let go of, so nothing
      // later in it acts on the record it had.
      if (touched) entry.record = touched;
      else held.delete(session);
    },

    // auth.login's per-source limits, before the body is read: its block,
    // and its one place, which an attempt let in holds until the dispatcher
    // has its answer. The verification slots and the global wait are the
    // handler's.
    async throttle({ request, requestId, operation }) {
      if (operation.name !== SIGN_IN) return null;
      const address = clientAddress(request.headers, config.trustedProxyHops);
      const admission = limits.admit(address);
      if (admission.admitted) return admission.release;
      await audit.record({
        type: 'login_throttled',
        actor: 'anonymous',
        outcome: 'denied',
        refs: { reason: admission.reason, source: sourcePrefix(address), requestId },
      });
      return throttledAnswer(request, admission.retryAfter, { headers: endedCookie(request) });
    },

    pages: {
      // A Studio page's session, slid only when the owner opened the page
      // (slides() in @portfolio/core reads its Fetch Metadata), so a page
      // another origin loads in the background never keeps it alive. A
      // page can't set a cookie, so an ended one stays until the next
      // command clears it.
      async resolve(request) {
        const sent = readCookies(request, cookie.name);
        if (sent.length === 0) return NO_PAGE_SESSION;
        // Two cookies of the name: as with commands, neither counts.
        if (sent.length > 1) return ENDED_PAGE_SESSION;
        const resolution = await sessions.resolve(sent[0]);
        if (resolution.status === 'none') return NO_PAGE_SESSION;
        if (resolution.status === 'unavailable') return UNREADABLE_PAGE_SESSION;
        if (resolution.status === 'ended') return ENDED_PAGE_SESSION;
        const touched = await sessions.touch(resolution.record, {
          kind: 'page',
          headers: request.headers,
        });
        if (!touched) return ENDED_PAGE_SESSION;
        return Object.freeze({
          status: 'valid' as const,
          session: mintSession({ ref: sessionRef(touched.digest) }),
          csrfToken: csrfToken(resolution.token),
        });
      },
    },

    // A sign-in form whose body isn't UTF-8, gives a field twice, or is over
    // 4 KB goes back to the sign-in page with the error state, as a failed
    // form does, and runs no verification. A JSON sign-in gets 400
    // invalid_input. Either one clears a cookie whose session ended.
    async invalidInput({ request, operation }) {
      if (operation.name !== SIGN_IN) return null;
      const headers = endedCookie(request);
      return isFormPost(request)
        ? redirectResult(signInLocation('error', returnToOf(request)), { headers })
        : errorResult('invalid_input', { headers });
    },
  };
}
