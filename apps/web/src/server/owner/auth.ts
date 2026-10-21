import 'server-only';
import {
  aggregateAnonymous,
  createSessions,
  credentialFingerprint,
  filesystemAuditSink,
  filesystemSessionStore,
  sessionRef,
  sourcePrefix,
  syncCredentialFingerprint,
  type Activity,
  type AuditSink,
  type OwnerLog,
  type SessionRecord,
  type Sessions,
} from '@portfolio/core/owner';
import type { DeploymentConfig } from '../config';
import type { StudioBindings } from '../dispatcher';
import { recordOwnerModule } from '../load-trace';
import { log } from '../log';
import { listOperations, type Operation } from '../operations';
import type { Session } from '../session';
import { clearedSessionCookie, cookieMode, readCookies, type CookieMode } from './cookie';
import { checkCsrf, checkMutationOrigin, checkRequestOrigin, clientAddress } from './guard';

// The owner's auth provider (#2): the dispatcher's session, origin, and
// touch bindings over @portfolio/core's sessions and audit sink, in the data
// directory. The composition root loads it through import() in its owner
// branch, after the auth.secret and data.directory requirements pass, so the
// hash and the directory are there. Typed by shape, so this module doesn't
// import the composition root.

recordOwnerModule('server/owner/auth');

/** What the provider binds into the dispatcher. */
export type OwnerAuthBindings = Pick<
  StudioBindings,
  'resolveSession' | 'checkOrigin' | 'touchSession'
>;

export interface OwnerAuthTools {
  readonly config: DeploymentConfig;
  readonly mintSession: <T extends object>(fields?: T) => Session & Readonly<T>;
}

export interface OwnerAuthOptions {
  /** The clock sessions and the audit log use. Tests pass their own. */
  readonly now?: () => number;
  /** Tests pass their own audit sink; otherwise the data directory's. */
  readonly audit?: AuditSink;
}

/** Commands that pass every check yet never slide the session: #7's grant renewal. */
const NEVER_SLIDE = new Set(['preview.grant.renew']);

/** The one command without a CSRF token: it has no session to take one from yet. */
const NO_CSRF = 'auth.login';

/** What touchSession slides for, by operation (Activity, in @portfolio/core). */
export function activityOf(operation: Operation): Activity {
  if (operation.kind === 'command' && !NEVER_SLIDE.has(operation.name)) {
    return { kind: 'command', extend: operation.name === 'auth.session.extend' };
  }
  return { kind: 'query' };
}

const ownerLog: OwnerLog = (entry) => log(entry);

/** A session the provider resolved: its token, for the CSRF check, and its record, for the touch. */
interface Held {
  readonly token: string;
  record: SessionRecord;
}

export interface OwnerAuth extends OwnerAuthBindings {
  /** The sessions themselves, for the auth commands. */
  readonly sessions: Sessions;
  readonly audit: AuditSink;
  readonly cookie: CookieMode;
}

/** Builds the provider for `config`: an owner deployment with its hash and data directory. */
export async function provider(
  { config, mintSession }: OwnerAuthTools,
  { now = Date.now, audit: auditOverride }: OwnerAuthOptions = {},
): Promise<OwnerAuth> {
  const { dataDir } = config;
  const hash = config.secrets.authPasswordHash;
  // The data.directory and auth.secret requirements refuse startup without them.
  if (!dataDir || !hash) throw new Error('The owner provider needs a data directory and a hash.');
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

  return {
    sessions,
    audit,
    cookie,

    async resolveSession({ request }) {
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
      // A cookie that no longer counts is cleared. One the store couldn't
      // read stays, so a passing fault doesn't sign the owner out.
      if (resolution.status === 'ended') {
        return { session: null, headers: [['set-cookie', clearedSessionCookie(cookie)]] };
      }
      return { session: null };
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
      // auth.login goes without.
      if (reason === null && operation.name !== NO_CSRF) {
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
  };
}
