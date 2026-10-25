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
// leaves the empty store and nothing more. Each reader, and startup, checks
// the same directories through checkPrivateDir(), which makes nothing.
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
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
 * A directory under the data directory that the server won't read or write
 * through: `linked` when it's a symbolic link or not a directory,
 * `not_private` when another user owns it or a chmod left its mode wrong.
 * The message names the directory relative to the data directory, never the
 * data directory's own path.
 */
export class PrivateDirError extends Error {
  /**
   * @param {'linked' | 'not_private'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'PrivateDirError';
    /** @readonly */
    this.code = code;
  }
}

/** @param {unknown} error @returns {error is PrivateDirError} */
export const isPrivateDirError = (error) => error instanceof PrivateDirError;

/**
 * What's wrong with a directory the server keeps private, from its stats,
 * in the order it's checked: a link, then anything but a directory, then
 * another user's, then a mode other than 0700 (`loose`, which the server
 * puts right). Null when it's fine.
 *
 * @param {{ isSymbolicLink(): boolean, isDirectory(): boolean, uid: number, mode: number }} found
 * @param {number | null} uid the server's own, or null where there is none
 * @returns {'link' | 'not_directory' | 'other_owner' | 'loose' | null}
 */
export function privateDirProblem(found, uid) {
  if (found.isSymbolicLink()) return 'link';
  if (!found.isDirectory()) return 'not_directory';
  if (uid !== null && found.uid !== uid) return 'other_owner';
  if ((found.mode & 0o777) !== 0o700) return 'loose';
  return null;
}

const NO_FOLLOW_DIR = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

/**
 * @typedef {object} PrivateDirIo Tests pass these to make a step misbehave.
 * @property {typeof lstat} [lstat]
 * @property {typeof open} [open]
 */

/**
 * Checks one directory, `at`, named `name` in errors, and puts a loosened
 * mode back to 0700. False when nothing is there.
 *
 * In order: a link, anything but a directory, and another user's are
 * refused; then, for a mode other than 0700, the directory is opened with
 * O_NOFOLLOW and O_DIRECTORY, checked again through the handle, and
 * chmodded through it, so a link swapped in after the lstat is refused and
 * never followed, and root never repairs another user's directory. A last
 * lstat checks the path still names that directory, at 0700.
 *
 * @param {string} at
 * @param {string} name
 * @param {PrivateDirIo} io
 * @returns {Promise<boolean>}
 */
async function settlePrivateDir(at, name, io) {
  const lstatOf = io.lstat ?? lstat;
  const openDir = io.open ?? open;
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  /** @param {ReturnType<typeof privateDirProblem>} problem */
  const refuse = (problem) => {
    switch (problem) {
      case 'link':
        throw new PrivateDirError('linked', `${name} is a link.`);
      case 'not_directory':
        throw new PrivateDirError('linked', `${name} isn't a directory.`);
      case 'other_owner':
        throw new PrivateDirError('not_private', `${name} belongs to another user.`);
      case 'loose':
        throw new PrivateDirError('not_private', `${name} isn't 0700.`);
      default:
    }
  };
  let found;
  try {
    found = await lstatOf(at);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
  const problem = privateDirProblem(found, uid);
  if (problem !== 'loose') {
    refuse(problem);
    return true;
  }
  let handle;
  try {
    handle = await openDir(at, NO_FOLLOW_DIR);
  } catch (error) {
    const code = errorCode(error);
    // A link or a file swapped in after the lstat.
    if (code === 'ELOOP' || code === 'ENOTDIR' || code === 'EMLINK') refuse('link');
    throw error;
  }
  try {
    const held = await handle.stat();
    const again = privateDirProblem(
      {
        isSymbolicLink: () => false,
        isDirectory: () => held.isDirectory(),
        uid: held.uid,
        mode: held.mode,
      },
      uid,
    );
    if (again !== 'loose') refuse(again);
    else {
      await handle.chmod(0o700);
      const after = await lstatOf(at);
      const last = privateDirProblem(after, uid);
      // The path must still name the directory the handle holds.
      if (last === 'link' || last === 'not_directory') refuse(last);
      if (after.ino !== held.ino || after.dev !== held.dev) refuse('link');
      refuse(last);
    }
  } finally {
    await handle.close();
  }
  return true;
}

/**
 * Makes `dir`, and each directory between `dataDir` and it that's missing,
 * at 0700, for a writer at its first write. Each one, made now or already
 * there, is then checked as settlePrivateDir() checks it: a link, anything
 * but a directory, or another user's throws a PrivateDirError, so nothing is
 * written through it, and a mode other than 0700, from a umask or an
 * operator who loosened it, is put back, as startup used to do. `dataDir`
 * itself is the operator's mount, which the store's preflight checks at
 * startup.
 *
 * @param {string} dataDir
 * @param {string} dir under `dataDir`
 * @param {PrivateDirIo} [io]
 */
export async function preparePrivateDir(dataDir, dir, io = {}) {
  for (const [at, name] of chain(dataDir, dir)) {
    try {
      await mkdir(at, { mode: 0o700 });
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
    if (!(await settlePrivateDir(at, name, io))) {
      throw Object.assign(new Error(`${name} went missing.`), { code: 'ENOENT' });
    }
  }
}

/**
 * preparePrivateDir()'s twin for a reader, and for startup: the same checks
 * on `dir` and each directory between `dataDir` and it, making nothing. A
 * missing one ends the walk, since nothing below it can be there, and reads
 * as empty. A link, anything but a directory, or another user's throws a
 * PrivateDirError, so nothing is read through it; a loosened mode is put
 * back to 0700.
 *
 * @param {string} dataDir
 * @param {string} dir under `dataDir`
 * @param {PrivateDirIo} [io]
 */
export async function checkPrivateDir(dataDir, dir, io = {}) {
  for (const [at, name] of chain(dataDir, dir)) {
    if (!(await settlePrivateDir(at, name, io))) return;
  }
}

/**
 * Each directory from just below `dataDir` down to `dir`, with its name
 * relative to `dataDir`.
 *
 * @param {string} dataDir
 * @param {string} dir
 * @returns {[at: string, name: string][]}
 */
function chain(dataDir, dir) {
  const root = path.resolve(dataDir);
  const relative = path.relative(root, path.resolve(dir));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TypeError('Not a directory under the data directory.');
  }
  /** @type {[string, string][]} */
  const found = [];
  let at = root;
  for (const part of relative.split(path.sep)) {
    at = path.join(at, part);
    found.push([at, path.relative(root, at)]);
  }
  return found;
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
 * directory of its own, `.probe-<hex>/` in `io.within`, or else in the data
 * directory, removed however the probe ends, so the check makes nothing
 * that outlasts it. Owner startup passes ephemeral/ once the store's
 * preflight has made it, so the probe tests the filesystem the auth state
 * lives on. Returns null when it's ready, or why it isn't:
 * `data_dir_missing` (nothing there, or a file), `data_dir_unreachable`
 * (the server may not look, or a link loops), `data_dir_not_writable`, or
 * `data_dir_rename_failed`. Tests pass `io.open` or `io.rename` to make a
 * step fail.
 *
 * @param {string} dataDir
 * @param {{ readonly within?: string, readonly open?: typeof open, readonly rename?: typeof rename }} [io]
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
  const dir = path.join(io.within ?? dataDir, `.probe-${randomBytes(6).toString('hex')}`);
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
