// Audit records (#2, in #3's format): one JSON line per event in
// audit/<yyyy-mm>.jsonl, shaped {at, type, actor, outcome, refs}. Plain ESM
// with node:* imports only, so owner.mjs revoke-sessions writes its own
// record the way the server does.
//
// A record never holds a password, hash, cookie, CSRF token, full IP
// address, user agent, or request body. auditRecord() enforces that by
// shape: it keeps only the refs below, each matching its pattern, so a value
// of any other kind is dropped before anything is written.
import { open } from 'node:fs/promises';
import path from 'node:path';

// The owner load trace (#1, item 14), by the symbol load-trace.ts uses.
const TRACE = Symbol.for('keyurgolani.portfolio.owner-modules');
/** @type {{ [key: symbol]: Set<string> | undefined }} */
const holder = /** @type {any} */ (globalThis);
(holder[TRACE] ??= new Set()).add('core/audit/record');

export const AUDIT_TYPES = Object.freeze(
  /** @type {const} */ ([
    'login_succeeded',
    'login_failed',
    'login_throttled',
    'logout',
    'session_revoked',
    'sessions_revoked_all',
    'session_evicted',
    'credential_changed',
    'command_denied',
  ]),
);
export const AUDIT_ACTORS = Object.freeze(
  /** @type {const} */ (['owner', 'anonymous', 'operator']),
);
export const AUDIT_OUTCOMES = Object.freeze(
  /** @type {const} */ (['success', 'failure', 'denied']),
);

/**
 * @typedef {typeof AUDIT_TYPES[number]} AuditType
 * @typedef {typeof AUDIT_ACTORS[number]} AuditActor
 * @typedef {typeof AUDIT_OUTCOMES[number]} AuditOutcome
 */

/**
 * @typedef {object} AuditRefs
 * @property {string} [sessionRef] the first 8 hex characters of the session's digest
 * @property {string} [source] an IPv4 /24 or IPv6 /48 prefix, or `unknown`
 * @property {string} [command] the operation's name
 * @property {string} [capability]
 * @property {string} [reason] one of AUDIT_REASONS, such as `origin_mismatch`
 * @property {string} [requestId]
 * @property {number} [count] how many events an aggregated record stands for
 */

/**
 * @typedef {object} AuditRecord
 * @property {string} at ISO 8601
 * @property {AuditType} type
 * @property {AuditActor} actor
 * @property {AuditOutcome} outcome
 * @property {Readonly<AuditRefs>} refs
 */

/** Why a request was denied or throttled: the only reasons a record may give. */
export const AUDIT_REASONS = Object.freeze(
  /** @type {const} */ ([
    'origin_missing',
    'origin_mismatch',
    'fetch_site',
    'content_type',
    'csrf_missing',
    'csrf_mismatch',
    'source_blocked',
    'busy',
  ]),
);
const REASONS = new Set(/** @type {readonly string[]} */ (AUDIT_REASONS));

/** Each ref a record may carry, and the shape its value must have. */
const REFS = Object.freeze({
  sessionRef: /^[0-9a-f]{8}$/,
  source: /^(?:(?:\d{1,3}\.){3}0\/24|[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,2}::\/48|unknown)$/,
  command: /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)*$/,
  capability: /^[a-z][a-z]*(?:\.[a-z][a-z]*)*$/,
  reason: /^[a-z][a-z0-9_]{0,63}$/,
  requestId: /^[A-Za-z0-9-]{1,64}$/,
  count: null,
});

/**
 * The record for one event, at `at`. Refs it doesn't know, or whose value
 * doesn't have the shape it must, are left out, and so is a `reason` that
 * isn't one of AUDIT_REASONS, and a `command` outside `commands` when it's
 * given: the operation registry's names, which this module doesn't know.
 *
 * @param {{ at: Date | number, type: AuditType, actor: AuditActor, outcome: AuditOutcome, refs?: Readonly<Record<string, unknown>> }} event
 * @param {{ commands?: ReadonlySet<string> }} [options]
 * @returns {Readonly<AuditRecord>}
 */
export function auditRecord({ at, type, actor, outcome, refs = {} }, { commands } = {}) {
  if (!AUDIT_TYPES.includes(type)) throw new TypeError('Not an audit event type.');
  if (!AUDIT_ACTORS.includes(actor)) throw new TypeError('Not an audit actor.');
  if (!AUDIT_OUTCOMES.includes(outcome)) throw new TypeError('Not an audit outcome.');
  /** @type {Record<string, string | number>} */
  const kept = {};
  for (const [key, pattern] of Object.entries(REFS)) {
    const value = refs[key];
    if (key === 'count') {
      if (Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0) {
        kept[key] = /** @type {number} */ (value);
      }
    } else if (typeof value === 'string' && pattern?.test(value)) {
      if (key === 'reason' && !REASONS.has(value)) continue;
      if (key === 'command' && commands && !commands.has(value)) continue;
      kept[key] = value;
    }
  }
  return Object.freeze({
    at: new Date(at).toISOString(),
    type,
    actor,
    outcome,
    refs: Object.freeze(kept),
  });
}

/**
 * The month's file for a record at `at`, in UTC: audit/2026-10.jsonl.
 *
 * @param {string} dataDir
 * @param {Date | number | string} at
 */
export function auditFile(dataDir, at) {
  const date = new Date(at);
  const month = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return path.join(dataDir, 'audit', `${month}.jsonl`);
}

/**
 * Appends `record` as one line to its month's file, created 0600, and syncs
 * it. It throws when it can't; callers log that, and their decision stands.
 *
 * @param {string} dataDir
 * @param {Readonly<AuditRecord>} record
 */
export async function appendAuditRecord(dataDir, record) {
  const handle = await open(auditFile(dataDir, record.at), 'a', 0o600);
  try {
    await handle.write(`${JSON.stringify(record)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
