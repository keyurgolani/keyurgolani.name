// Session records on disk (#2): one JSON file per session under
// ephemeral/auth/sessions/, named for the SHA-256 digest of its token, so the
// directory never holds a token. Each writer makes its directory at its first
// write; a reader takes a missing one as empty. Plain ESM with node:* imports
// only, so owner.mjs revoke-sessions shares it with the server.
import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { authPaths, preparePrivateDir, writePrivateFile } from '../data/layout.mjs';

// The owner load trace (#1, item 14), by the symbol load-trace.ts uses.
const TRACE = Symbol.for('keyurgolani.portfolio.owner-modules');
/** @type {{ [key: symbol]: Set<string> | undefined }} */
const holder = /** @type {any} */ (globalThis);
(holder[TRACE] ??= new Set()).add('core/auth/session-files');

/** A session's key: the hex SHA-256 digest of its token. */
export const DIGEST = /^[0-9a-f]{64}$/;
/** The browser family a session list shows (#8), never the user agent itself. */
export const UA_FAMILIES = Object.freeze(
  /** @type {const} */ (['chrome', 'edge', 'firefox', 'safari', 'other']),
);
/** The format credentialFingerprint() writes: 16 bytes of base64url. */
const FINGERPRINT = /^[A-Za-z0-9_-]{22}$/;
const RECORD_FILE = /^([0-9a-f]{64})\.json$/;

/**
 * @typedef {object} SessionRecord
 * @property {string} digest the hex SHA-256 digest of the token
 * @property {number} createdAt in milliseconds since the epoch
 * @property {number} lastSeenAt
 * @property {number} absoluteExpiresAt
 * @property {string} credentialFingerprint of the hash it was signed in under
 * @property {typeof UA_FAMILIES[number]} uaFamily
 */

/**
 * The record's file. The digest is checked before it joins a path.
 *
 * @param {string} dataDir
 * @param {string} digest
 */
function recordFile(dataDir, digest) {
  if (!DIGEST.test(digest)) throw new TypeError('Not a session digest.');
  return path.join(authPaths(dataDir).sessions, `${digest}.json`);
}

/**
 * The file's text: the times in ISO 8601, and no digest, which is the name.
 *
 * @param {SessionRecord} record
 * @returns {string}
 */
export function serializeSession(record) {
  return `${JSON.stringify({
    v: 1,
    createdAt: new Date(record.createdAt).toISOString(),
    lastSeenAt: new Date(record.lastSeenAt).toISOString(),
    absoluteExpiresAt: new Date(record.absoluteExpiresAt).toISOString(),
    credentialFingerprint: record.credentialFingerprint,
    uaFamily: record.uaFamily,
  })}\n`;
}

/**
 * The record a file's text holds, or null when it isn't one.
 *
 * @param {string} digest
 * @param {string} text
 * @returns {SessionRecord | null}
 */
export function parseSession(digest, text) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const fields = /** @type {Record<string, unknown>} */ (value);
  const time = (/** @type {unknown} */ field) =>
    typeof field === 'string' && Number.isFinite(Date.parse(field)) ? Date.parse(field) : null;
  const createdAt = time(fields['createdAt']);
  const lastSeenAt = time(fields['lastSeenAt']);
  const absoluteExpiresAt = time(fields['absoluteExpiresAt']);
  const fingerprint = fields['credentialFingerprint'];
  const uaFamily = fields['uaFamily'];
  if (
    fields['v'] !== 1 ||
    !DIGEST.test(digest) ||
    createdAt === null ||
    lastSeenAt === null ||
    absoluteExpiresAt === null ||
    typeof fingerprint !== 'string' ||
    !FINGERPRINT.test(fingerprint) ||
    typeof uaFamily !== 'string' ||
    !(/** @type {readonly string[]} */ (UA_FAMILIES).includes(uaFamily))
  ) {
    return null;
  }
  return Object.freeze({
    digest,
    createdAt,
    lastSeenAt,
    absoluteExpiresAt,
    credentialFingerprint: fingerprint,
    uaFamily: /** @type {typeof UA_FAMILIES[number]} */ (uaFamily),
  });
}

/** @param {unknown} error */
const missing = (error) => /** @type {NodeJS.ErrnoException} */ (error)?.code === 'ENOENT';

/**
 * The record for `digest`, or null when there is none. A file that isn't a
 * record is deleted and counts as none, so a damaged file never signs
 * anyone in.
 *
 * @param {string} dataDir
 * @param {string} digest
 * @returns {Promise<SessionRecord | null>}
 */
export async function readSessionFile(dataDir, digest) {
  const file = recordFile(dataDir, digest);
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  const record = parseSession(digest, text);
  if (record === null) await rm(file, { force: true });
  return record;
}

/**
 * @param {string} dataDir
 * @param {SessionRecord} record
 */
export async function writeSessionFile(dataDir, record) {
  await preparePrivateDir(dataDir, authPaths(dataDir).sessions);
  await writePrivateFile(recordFile(dataDir, record.digest), serializeSession(record));
}

/**
 * Deletes the record for `digest`. Returns whether there was one.
 *
 * @param {string} dataDir
 * @param {string} digest
 * @returns {Promise<boolean>}
 */
export async function deleteSessionFile(dataDir, digest) {
  try {
    await rm(recordFile(dataDir, digest));
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

/**
 * The digest of every record on disk.
 *
 * @param {string} dataDir
 * @returns {Promise<string[]>}
 */
export async function listSessionDigests(dataDir) {
  let names;
  try {
    names = await readdir(authPaths(dataDir).sessions);
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
  return names.flatMap((name) => {
    const match = RECORD_FILE.exec(name);
    return match?.[1] ? [match[1]] : [];
  });
}

/**
 * When revoke-sessions last ran, in milliseconds, or null when it never has.
 * The server refuses every session created at or before it, so a record
 * written back after the run still signs no one in. A file that holds no
 * time throws, as an unreadable one does: a damaged file must never read as
 * "nothing was revoked". revoke-sessions writes it again.
 *
 * @param {string} dataDir
 * @returns {Promise<number | null>}
 */
export async function readRevokedBefore(dataDir) {
  let text;
  try {
    text = await readFile(authPaths(dataDir).revokedBefore, 'utf8');
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  const at = Date.parse(text.trim());
  if (!Number.isFinite(at)) throw new Error('ephemeral/auth/revoked-before holds no time.');
  return at;
}

/**
 * Ends every session: writes `at` to revoked-before first, then deletes each
 * record. Returns the digests it deleted.
 *
 * @param {string} dataDir
 * @param {number} at
 * @returns {Promise<string[]>}
 */
export async function revokeAllSessionFiles(dataDir, at) {
  await preparePrivateDir(dataDir, authPaths(dataDir).auth);
  await writePrivateFile(authPaths(dataDir).revokedBefore, `${new Date(at).toISOString()}\n`);
  const deleted = [];
  for (const digest of await listSessionDigests(dataDir)) {
    if (await deleteSessionFile(dataDir, digest)) deleted.push(digest);
  }
  return deleted;
}
