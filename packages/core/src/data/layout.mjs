// The owner's data directory, PORTFOLIO_DATA_DIR (#2, then #3): where auth
// state and the audit log live, and how files are written there. Plain ESM
// with node:* imports only, so apps/web/bin/owner.mjs runs it in the repo and
// in the image with no build step.
//
//   ephemeral/auth/sessions/<digest>.json   one session record each (#2)
//   ephemeral/auth/revoked-before           the last revoke-sessions run
//   ephemeral/auth/fingerprint              the configured hash's fingerprint
//   ephemeral/preview/grants/<digest>.json  one preview grant each (#7)
//   ephemeral/preview/drafts/<draftId>.json the newest version a grant names
//   audit/<yyyy-mm>.jsonl                   AuditSink (#2, #3)
//
// Directories are 0700 and files 0600. ephemeral/ is never backed up (#3).
// The store's preflight makes ephemeral/ and audit/ at owner startup, and
// nothing below ephemeral/ is made then: each writer makes its directory at
// its first write, through preparePrivateDir(), so a start that's refused
// leaves the empty store and nothing more.
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, open, rename, rm, stat } from 'node:fs/promises';
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

/** @param {unknown} error */
const errorCode = (error) => /** @type {NodeJS.ErrnoException} */ (error)?.code;

/**
 * Makes `dir`, and each directory between `dataDir` and it that's missing,
 * at 0700, for a writer at its first write. Each one, made now or already
 * there, is then checked with lstat: a link, anything but a directory, one
 * another user owns, or one whose mode isn't 0700 throws, so nothing is
 * written through it. `dataDir` itself is the operator's mount, which the
 * store's preflight checks at startup.
 *
 * @param {string} dataDir
 * @param {string} dir under `dataDir`
 */
export async function preparePrivateDir(dataDir, dir) {
  const root = path.resolve(dataDir);
  const relative = path.relative(root, path.resolve(dir));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TypeError('Not a directory under the data directory.');
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  let at = root;
  for (const part of relative.split(path.sep)) {
    at = path.join(at, part);
    const name = path.relative(root, at);
    let made = true;
    try {
      await mkdir(at, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
      made = false;
    }
    let found = await lstat(at);
    if (found.isSymbolicLink()) throw new Error(`${name} is a link.`);
    if (!found.isDirectory()) throw new Error(`${name} isn't a directory.`);
    // A umask can take bits off a new directory's mode. One made here is
    // put right, then checked like any other.
    if (made && (found.mode & 0o777) !== 0o700) {
      await chmod(at, 0o700);
      found = await lstat(at);
    }
    if (uid !== null && found.uid !== uid) throw new Error(`${name} belongs to another user.`);
    if ((found.mode & 0o777) !== 0o700) throw new Error(`${name} isn't 0700.`);
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
 * The auth half of owner startup's data.directory check (#2): the data
 * directory is a directory, and a write, a sync, and a rename work in it,
 * the way session records are written. The probe runs in a temporary
 * directory of its own, removed however the probe ends, so the check makes
 * nothing that outlasts it. Returns null when it's ready, or why it isn't:
 * `data_dir_missing` (nothing there, or a file), `data_dir_unreachable`
 * (the server may not look, or a link loops), `data_dir_not_writable`, or
 * `data_dir_rename_failed`. Tests pass `io` to make a step fail.
 *
 * @param {string} dataDir
 * @param {{ readonly open?: typeof open, readonly rename?: typeof rename }} [io]
 * @returns {Promise<'data_dir_missing' | 'data_dir_unreachable' | 'data_dir_not_writable' | 'data_dir_rename_failed' | null>}
 */
export async function probeDataDirectory(dataDir, io = {}) {
  const openFile = io.open ?? open;
  const renameFile = io.rename ?? rename;
  try {
    if (!(await stat(dataDir)).isDirectory()) return 'data_dir_missing';
  } catch (error) {
    const code = errorCode(error);
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'data_dir_missing' : 'data_dir_unreachable';
  }
  const dir = path.join(dataDir, `.probe-${randomBytes(6).toString('hex')}`);
  try {
    await mkdir(dir, { mode: 0o700 });
  } catch {
    return 'data_dir_not_writable';
  }
  try {
    const probe = path.join(dir, 'probe');
    try {
      const handle = await openFile(probe, 'wx', 0o600);
      try {
        await handle.writeFile('probe\n');
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {
      return 'data_dir_not_writable';
    }
    try {
      await renameFile(probe, `${probe}.renamed`);
    } catch {
      return 'data_dir_rename_failed';
    }
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
