// The lockfile checks around test:external-variant's add and remove (#12).
//
// The remove must leave git status clean, the lockfile byte for byte. That
// only means "no leftover" when the committed lockfile is what pnpm writes,
// and `pnpm install --frozen-lockfile` doesn't check that: it compares each
// importer's specifiers with its package.json and installs the rest as
// written. #85's lockfile kept an old eslint-plugin-import peer key that
// pnpm no longer resolves, so any remove rewrote it, and the run failed as
// "the remove leaves nothing changed". So the run re-resolves the lockfile
// first (LOCKFILE_REFRESH) and stops there, with the cause, when it changes.
//
// Both checks compare exactly. When one fails, the message
// says whether the lockfile differs in nested peer suffixes alone, with the
// lockfile otherwise the same: `a@1(b@2(c@3))` against `a@1(b@2)`. That's
// the shape of pnpm's cyclic peer rewrite (#82: eslint-plugin-import and
// eslint-import-resolver-typescript peer on each other, and whichever node
// resolvePeers finishes first settles the other's key), not a leftover. It
// still fails: a reader sees which it is, nothing passes on it.
import { parse } from 'yaml';

/** The dependency maps whose values are depPaths, in importers and in snapshots. */
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];

/**
 * `depPath` with each of its peers' own suffixes dropped:
 * `a@1.0.0(b@2.0.0(c@3.0.0))(d@4.0.0)` becomes `a@1.0.0(b@2.0.0)(d@4.0.0)`.
 * Anything that isn't a run of balanced top-level groups after the version,
 * such as a hashed suffix, comes back as it is, so it compares exactly.
 *
 * @param {string} depPath
 * @returns {string}
 */
export function normalisePeers(depPath) {
  if (typeof depPath !== 'string') return depPath;
  const start = depPath.indexOf('(');
  if (start === -1) return depPath;
  let out = depPath.slice(0, start);
  let depth = 0;
  for (const char of depPath.slice(start)) {
    if (char === '(') {
      depth += 1;
      if (depth === 1) out += char;
    } else if (char === ')') {
      if (depth === 0) return depPath;
      if (depth === 1) out += char;
      depth -= 1;
    } else if (depth === 0) {
      return depPath;
    } else if (depth === 1) {
      out += char;
    }
  }
  return depth === 0 ? out : depPath;
}

function normaliseDependencies(entry, normaliseValue) {
  const out = { ...entry };
  for (const field of DEPENDENCY_FIELDS) {
    if (out[field] && typeof out[field] === 'object') {
      out[field] = Object.fromEntries(
        Object.entries(out[field]).map(([name, value]) => [name, normaliseValue(value)]),
      );
    }
  }
  return out;
}

/** Deterministic JSON, keys sorted, so equal snapshots sort and compare equal. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The lockfile's text, parsed, with peer suffixes cut to their first level
 * in importer versions, snapshot keys, and snapshot dependencies. Snapshots
 * whose keys now match stay apart, as a list under that key, so a new
 * snapshot is still one more.
 *
 * @param {string} text
 */
export function normaliseLockfile(text) {
  const lockfile = parse(text) ?? {};
  const importers = Object.fromEntries(
    Object.entries(lockfile.importers ?? {}).map(([id, importer]) => [
      id,
      normaliseDependencies(importer ?? {}, (dependency) =>
        dependency && typeof dependency === 'object'
          ? { ...dependency, version: normalisePeers(dependency.version) }
          : dependency,
      ),
    ]),
  );
  /** @type {Record<string, unknown[]>} */
  const snapshots = {};
  for (const [key, snapshot] of Object.entries(lockfile.snapshots ?? {})) {
    const body = normaliseDependencies(snapshot ?? {}, normalisePeers);
    (snapshots[normalisePeers(key)] ??= []).push(body);
  }
  for (const list of Object.values(snapshots)) {
    list.sort((a, b) => (canonical(a) < canonical(b) ? -1 : 1));
  }
  return { ...lockfile, importers, snapshots };
}

const segment = (key) => (/^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function differences(before, after, at, out) {
  if (canonical(before) === canonical(after)) return out;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) {
      out.push(`${at}: ${before.length} before, ${after.length} after`);
      return out;
    }
    before.forEach((item, index) => differences(item, after[index], `${at}[${index}]`, out));
    return out;
  }
  if (isObject(before) && isObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const path = `${at}${segment(key)}`;
      if (!(key in after)) out.push(`${path}: removed`);
      else if (!(key in before)) out.push(`${path}: added`);
      else differences(before[key], after[key], path, out);
    }
    return out;
  }
  out.push(`${at}: ${JSON.stringify(before)} before, ${JSON.stringify(after)} after`);
  return out;
}

/**
 * How `after` differs from `before` once peer suffixes are cut to their
 * first level, one line per difference, as `path: what changed`. Empty when
 * nothing but nested peer suffixes moved. For the failure message only:
 * no check passes on it.
 *
 * @param {string} before pnpm-lock.yaml's text before
 * @param {string} after its text after
 * @returns {string[]}
 */
export function lockfileDrift(before, after) {
  if (before === after) return [];
  return differences(normaliseLockfile(before), normaliseLockfile(after), 'lockfile', []);
}

/**
 * Re-resolves pnpm-lock.yaml from the workspace and writes it, installing
 * nothing. Each flag is there for a reason, in pnpm 10.33:
 * - `--frozen-lockfile` accepts a lockfile with a key pnpm wouldn't write;
 *   it checks specifiers against each package.json alone.
 * - `--lockfile-only` alone is a no-op on an up-to-date lockfile: with
 *   prefer-frozen-lockfile on, as it is by default, it writes the lockfile
 *   back as read. `--no-prefer-frozen-lockfile` makes it resolve.
 * - `--offline` fails on CI's metadata cache, empty after a frozen install
 *   (ERR_PNPM_NO_OFFLINE_META). `--prefer-offline` reads the registry's
 *   metadata where the cache has none, as the add does.
 */
export const LOCKFILE_REFRESH = [
  'install',
  '--lockfile-only',
  '--no-prefer-frozen-lockfile',
  '--prefer-offline',
  '--ignore-scripts',
];

/** The status line git prints for a modified lockfile. */
export const LOCKFILE_MODIFIED = ' M pnpm-lock.yaml';

/**
 * What changed, for a failure message: the status, and either the
 * lockfile's real differences or, when nested peer suffixes alone moved,
 * what that likely is and what to do.
 */
function describe(status, before, after) {
  const changed = `git status shows ${status.map((line) => line.trim()).join(', ')}`;
  if (!status.includes(LOCKFILE_MODIFIED)) return changed;
  const drift = lockfileDrift(before, after);
  if (drift.length === 0) {
    return (
      `${changed}. Only nested peer suffixes moved in pnpm-lock.yaml; possibly pnpm's ` +
      'cyclic peer resolution race (#82). Re-run, and if it persists, run pnpm install ' +
      'and commit pnpm-lock.yaml'
    );
  }
  return `${changed}. pnpm-lock.yaml differs in ${drift.join('; ')}`;
}

/**
 * Why the committed lockfile isn't what pnpm writes, after LOCKFILE_REFRESH
 * ran, or null when it is.
 *
 * @param {{ status: string[], before: string, after: string }} refresh
 *   `git status --porcelain` after it, as lines, and the lockfile's text at
 *   HEAD and after it
 * @returns {string | null}
 */
export function canonicalLockfileProblem({ status, before, after }) {
  if (status.length === 0) return null;
  return (
    "pnpm-lock.yaml isn't what pnpm writes: run pnpm install and commit it. " +
    describe(status, before, after)
  );
}

/**
 * What the remove left behind, or null when git status is clean.
 *
 * @param {{ status: string[], before: string, after: string }} removal
 *   `git status --porcelain` after the remove, as lines, and the lockfile's
 *   text at HEAD and after the remove
 * @returns {string | null}
 */
export function removalProblem({ status, before, after }) {
  if (status.length === 0) return null;
  return `the remove leaves nothing changed, but ${describe(status, before, after)}`;
}
