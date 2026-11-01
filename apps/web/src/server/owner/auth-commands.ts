import 'server-only';
import {
  browserFamily,
  csrfToken,
  sessionRef,
  sourcePrefix,
  type AuditSink,
  type AuthProvider as PasswordCheck,
  type SessionRecord,
  type Sessions,
} from '@portfolio/core/owner';
import { assertAuthorized } from '../authorize';
import type { DeploymentConfig } from '../config';
import type { Handler, HandlerContext } from '../dispatcher';
import { recordOwnerModule } from '../load-trace';
import { log } from '../log';
import type { AuthSessionView } from '../operations';
import type { Session } from '../session';
import { dataResult, errorResult, redirectResult, type StudioResult } from '../studio-result';
import { clearedSessionCookie, readCookies, sessionCookie, type CookieMode } from './cookie';
import { clientAddress } from './guard';
import type { LoginLimits } from './login-limits';
import { safeReturnTo, signInLocation } from '../return-to';

// The auth entries' handlers (#2): auth.login and auth.logout, the current
// session and its extension, and the session list with its revocations.
// Each one checks the token authorize() gave it before it does anything.
// auth.login answers a JSON request in the JSON envelope and the sign-in
// form with a 303, and every credential failure the same way, whatever was
// wrong with it.

recordOwnerModule('server/owner/auth-commands');

/** A session the provider resolved for this request: its token, and its record. */
export interface Held {
  readonly token: string;
  record: SessionRecord;
}

export interface AuthCommandTools {
  readonly config: DeploymentConfig;
  readonly sessions: Sessions;
  readonly audit: AuditSink;
  readonly cookie: CookieMode;
  readonly limits: LoginLimits;
  readonly passwords: PasswordCheck;
  /** The session resolveSession found for a request, by the session it minted. */
  readonly held: (session: Session | null) => Held | undefined;
  /**
   * The Set-Cookie that clears a sign-in's cookie when it named a session
   * that had ended, for every answer but a new session; otherwise none.
   */
  readonly endedCookie: (request: Request) => [string, string][];
  readonly sleep: (ms: number) => Promise<void>;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Whether a command came from the sign-in form rather than a script. */
export function isFormPost(request: Request): boolean {
  const essence = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  return essence === 'application/x-www-form-urlencoded';
}

/**
 * Where a login sends the owner afterwards, made safe: the form's returnTo
 * field when it has one, and otherwise the returnTo in its URL.
 */
export function returnToOf(request: Request, input?: unknown): string {
  const field =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>).returnTo
      : undefined;
  return safeReturnTo(
    typeof field === 'string' ? field : new URL(request.url).searchParams.get('returnTo'),
  );
}

export interface ThrottledOptions {
  /** Where the sign-in page sends the owner afterwards. Before the body is read, the URL's. */
  readonly returnTo?: string;
  readonly headers?: [string, string][];
}

/** A throttled login: 429 with Retry-After, or for the form, the sign-in page saying so. */
export function throttledAnswer(
  request: Request,
  retryAfterSeconds: number,
  { returnTo = returnToOf(request), headers = [] }: ThrottledOptions = {},
): StudioResult {
  return isFormPost(request)
    ? redirectResult(signInLocation('rate_limited', returnTo, retryAfterSeconds), { headers })
    : errorResult('rate_limited', {
        headers: [...headers, ['retry-after', String(retryAfterSeconds)]],
      });
}

export function authHandlers(tools: AuthCommandTools): Readonly<Record<string, Handler>> {
  const { config, sessions, audit, cookie, limits, passwords, held, endedCookie, sleep } = tools;

  const expiry = (record: SessionRecord) => {
    const { idleExpiresAt, absoluteExpiresAt } = sessions.expiry(record);
    return { idleExpiresAt: iso(idleExpiresAt), absoluteExpiresAt: iso(absoluteExpiresAt) };
  };
  const view = (token: string, record: SessionRecord): AuthSessionView => ({
    principal: { id: 'owner', method: 'password', authTime: iso(record.createdAt) },
    csrfToken: csrfToken(token),
    ...expiry(record),
  });
  /** The session this request resolved, or undefined once it ended during the request. */
  const current = (context: HandlerContext): Held | undefined => held(context.session);
  const cleared = (): [string, string][] => [['set-cookie', clearedSessionCookie(cookie)]];
  /** The answer for a session that ended while its request was on the way. */
  const gone = () => errorResult('authentication_required', { headers: cleared() });

  async function login(input: unknown, context: HandlerContext): Promise<StudioResult> {
    const { request, requestId } = context;
    const form = context.inputType === 'form';
    // Checked and serialized before any session exists, so a returnTo the
    // redirect can't carry never leaves a session behind.
    const returnTo = returnToOf(request, input);
    const address = clientAddress(request.headers, config.trustedProxyHops);
    const source = sourcePrefix(address);
    // Every answer but a new session clears a cookie whose session ended.
    const headers = endedCookie(request);
    const turnedAway = async (reason: 'source_blocked' | 'busy', seconds: number) => {
      await audit.record({
        type: 'login_throttled',
        actor: 'anonymous',
        outcome: 'denied',
        refs: { reason, source, requestId },
      });
      return throttledAnswer(request, seconds, { returnTo, headers });
    };
    // The slowdown is waited out before a verification slot is taken, in a
    // room of its own, so attempts that wait never hold a slot.
    const delay = limits.delayMs();
    if (delay > 0) {
      if (!limits.startWaiting()) return turnedAway('busy', 1);
      try {
        await sleep(delay);
      } finally {
        limits.stopWaiting();
      }
    }
    // The throttle let this attempt in before its body came. A block on its
    // source that started since still holds.
    const blocked = limits.retryAfter(address);
    if (blocked > 0) return turnedAway('source_blocked', blocked);
    if (!limits.acquire()) return turnedAway('busy', 1);
    try {
      const { password } = input as { password?: unknown };
      const verification = await passwords.verify({ password });
      if (!verification.ok) {
        limits.failed(address);
        await audit.record({
          type: 'login_failed',
          actor: 'anonymous',
          outcome: 'failure',
          refs: { source, requestId },
        });
        return form
          ? redirectResult(signInLocation('failed', returnTo), { headers })
          : errorResult('credentials_rejected', { headers });
      }
      limits.succeeded(address);
      let issued;
      try {
        issued = await sessions.issue({
          uaFamily: browserFamily(request.headers.get('user-agent')),
          // Every cookie of the name it carried, so a planted one ends too.
          replacing: readCookies(request, cookie.name),
          context: { requestId },
        });
      } catch {
        // No new cookie: the session it would carry was never stored.
        log({ level: 'error', event: 'login.store_failed', requestId });
        return form
          ? redirectResult(signInLocation('error', returnTo), { headers })
          : errorResult('unavailable', { headers });
      }
      await audit.record({
        type: 'login_succeeded',
        actor: 'owner',
        outcome: 'success',
        refs: { sessionRef: sessionRef(issued.record.digest), source, requestId },
      });
      // The new cookie takes the place of one that ended, so it is the only Set-Cookie.
      const signedIn: [string, string][] = [
        ['set-cookie', sessionCookie(cookie, issued.token, sessions.maxAgeSeconds(issued.record))],
      ];
      return form
        ? redirectResult(returnTo, { headers: signedIn })
        : dataResult(view(issued.token, issued.record), { headers: signedIn });
    } finally {
      limits.release();
    }
  }

  return Object.freeze({
    'auth.session': (authorized, _input, context) => {
      assertAuthorized(authorized, 'auth.session');
      const entry = current(context);
      return entry ? view(entry.token, entry.record) : gone();
    },

    'auth.login': (authorized, input, context) => {
      assertAuthorized(authorized, 'auth.session');
      return login(input, context);
    },

    'auth.logout': async (authorized, _input, context) => {
      assertAuthorized(authorized, 'auth.session');
      // Always signed out: the cookie cleared and the cache too, whether a
      // session resolved, ended before or during the request, or the store
      // couldn't be read. A session that resolved ends. One the store can't
      // end is logged, and ends at its idle limit, with no cookie left to
      // carry it.
      const { requestId } = context;
      const entry = current(context);
      if (entry) {
        try {
          await sessions.end(entry.record.digest, 'logout', { requestId });
        } catch {
          log({ level: 'error', event: 'logout.store_failed', requestId });
        }
      }
      return dataResult(
        { signedOut: true },
        { headers: [...cleared(), ['clear-site-data', '"cache"']] },
      );
    },

    'auth.session.extend': (authorized, _input, context) => {
      assertAuthorized(authorized, 'auth.session');
      // touchSession already wrote lastSeenAt, at once, for this entry.
      const entry = current(context);
      return entry ? expiry(entry.record) : gone();
    },

    'auth.sessions.list': async (authorized, _input, context) => {
      assertAuthorized(authorized, 'studio.view');
      const entry = current(context);
      if (!entry) return gone();
      const mine = entry.record.digest;
      return {
        sessions: (await sessions.list()).map((record) => ({
          ref: sessionRef(record.digest),
          browser: record.uaFamily,
          createdAt: iso(record.createdAt),
          lastSeenAt: iso(record.lastSeenAt),
          current: record.digest === mine,
        })),
      };
    },

    'auth.sessions.revoke': async (authorized, input, context) => {
      assertAuthorized(authorized, 'studio.view');
      const entry = current(context);
      if (!entry) return gone();
      const { ref } = input as { ref: string };
      const target = (await sessions.list()).find((record) => sessionRef(record.digest) === ref);
      if (!target) return { revoked: false };
      const revoked = await sessions.end(target.digest, 'revoked', {
        requestId: context.requestId,
      });
      // Revoking its own session signs this browser out too.
      return target.digest === entry.record.digest
        ? dataResult({ revoked }, { headers: cleared() })
        : { revoked };
    },

    'auth.sessions.revokeAll': async (authorized, _input, context) => {
      assertAuthorized(authorized, 'studio.view');
      if (!current(context)) return gone();
      const revoked = await sessions.revokeAll({ requestId: context.requestId });
      return dataResult({ revoked }, { headers: cleared() });
    },
  });
}
