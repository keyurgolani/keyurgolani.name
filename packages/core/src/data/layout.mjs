// The owner's data directory, PORTFOLIO_DATA_DIR (#2, then #3): where auth
// state and the audit log live, and how files are written there. Plain ESM
// with node:* imports only, so apps/web/bin/owner.mjs runs it in the repo and
// in the image with no build step.
//
//   ephemeral/auth/sessions/<digest>.json   one session record each (#2)
//   ephemeral/auth/revoked-before           the last revoke-sessions run
//   ephemeral/auth/fingerprint              the configured hash's fingerprint
//   audit/<yyyy-mm>.jsonl                   AuditSink (#2, #3)
//
// Directories are 0700 and files 0600. ephemeral/ is never backed up (#3).
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

// The owner load trace (#1, item 14), by the symbol load-trace.ts uses.
const TRACE = Symbol.for('keyurgolani.portfolio.owner-modules');
/** @type {{ [key: symbol]: Set<string> | undefined }} */
const holder = /** @type {any} */ (globalThis);
(holder[TRACE] ??= new Set()).add('core/data/layout');

/**
 * @typedef {object} AuthPaths
 * @property {string} ephemeral
 * @property {string} auth
 * @property {string} sessions
 * @property {string} revokedBefore
 * @property {string} fingerprint
 * @property {string} audit
 */

/**
 * The auth and audit paths under `dataDir`.
 *
 * @param {string} dataDir
 * @returns {Readonly<AuthPaths>}
 */
export function authPaths(dataDir) {
  const ephemeral = path.join(dataDir, 'ephemeral');
  const auth = path.join(ephemeral, 'auth');
  return Object.freeze({
    ephemeral,
    auth,
    sessions: path.join(auth, 'sessions'),
    revokedBefore: path.join(auth, 'revoked-before'),
    fingerprint: path.join(auth, 'fingerprint'),
    audit: path.join(dataDir, 'audit'),
  });
}

/**
 * Creates `dir` if it's missing and sets it to 0700 either way, so a mode
 * an operator loosened is put back at the next start.
 *
 * @param {string} dir
 */
export async function ensurePrivateDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
}

/**
 * Makes ephemeral/, ephemeral/auth/, ephemeral/auth/sessions/, and audit/
 * under `dataDir`, each 0700.
 *
 * @param {string} dataDir
 */
export async function ensureAuthDirectories(dataDir) {
  const paths = authPaths(dataDir);
  for (const dir of [paths.ephemeral, paths.auth, paths.sessions, paths.audit]) {
    await ensurePrivateDir(dir);
  }
}

/** A name for a temporary file beside `file`, which no listing mistakes for a record. */
const tempBeside = (/** @type {string} */ file) =>
  path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`);

/**
 * Writes `text` to `file` as a whole or not at all: a new 0600 temporary
 * file in the same directory, synced, then renamed over `file`.
 *
 * @param {string} file
 * @param {string} text
 */
export async function writePrivateFile(file, text) {
  const temp = tempBeside(file);
  try {
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Gets the data directory ready for auth state at owner startup: creates
 * ephemeral/, ephemeral/auth/, ephemeral/auth/sessions/, and audit/ at 0700,
 * then writes, syncs, and renames a probe file the way session records are
 * written. Returns null when it's ready, or why it isn't:
 * `data_dir_missing` (nothing there, or a file), `data_dir_unreachable`
 * (the server may not look, or a link loops), `data_dir_not_writable`, or
 * `data_dir_rename_failed`.
 *
 * @param {string} dataDir
 * @returns {Promise<'data_dir_missing' | 'data_dir_unreachable' | 'data_dir_not_writable' | 'data_dir_rename_failed' | null>}
 */
export async function prepareAuthDirectories(dataDir) {
  try {
    if (!(await stat(dataDir)).isDirectory()) return 'data_dir_missing';
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error)?.code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'data_dir_missing' : 'data_dir_unreachable';
  }
  const paths = authPaths(dataDir);
  try {
    await ensureAuthDirectories(dataDir);
  } catch {
    return 'data_dir_not_writable';
  }
  const probe = path.join(paths.auth, `.probe-${randomBytes(6).toString('hex')}`);
  try {
    const handle = await open(probe, 'wx', 0o600);
    try {
      await handle.writeFile('probe\n');
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    await rm(probe, { force: true }).catch(() => {});
    return 'data_dir_not_writable';
  }
  try {
    await rename(probe, `${probe}.renamed`);
  } catch {
    return 'data_dir_rename_failed';
  } finally {
    await rm(probe, { force: true }).catch(() => {});
    await rm(`${probe}.renamed`, { force: true }).catch(() => {});
  }
  return null;
}
