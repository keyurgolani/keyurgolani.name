// What `pnpm remove` left in pnpm-lock.yaml (#12). test:external-variant adds
// the reference variant and removes it, and the lockfile must come back as
// it was. pnpm doesn't always write it back byte for byte: where peers form
// a cycle (eslint-plugin-import and eslint-import-resolver-typescript peer on
// each other), the first of the two nodes resolvePeers finishes settles the
// other's depPath, so a key can come back with one level of the cycle spelled
// out or cut short. #82's run rewrote
//
//   eslint-plugin-import@2.32.0(…)(eslint-import-resolver-typescript@3.10.1(eslint-plugin-import@2.32.0(…)(eslint@9.39.5))(eslint@9.39.5))(eslint@9.39.5)
//
// as
//
//   eslint-plugin-import@2.32.0(…)(eslint-import-resolver-typescript@3.10.1)(eslint@9.39.5)
//
// The same packages at the same versions, wired the same way. So the check
// compares the two lockfiles with every peer suffix cut to its first level:
// each peer's name and version stay, the peers' own suffixes go. Everything
// else compares exactly: the settings, every importer's specifiers and
// versions, every package entry with its integrity, and every snapshot,
// counted, with its dependencies.
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
 * the only change is a rewritten peer suffix.
 *
 * @param {string} before pnpm-lock.yaml's text before
 * @param {string} after its text after
 * @returns {string[]}
 */
export function lockfileDrift(before, after) {
  if (before === after) return [];
  return differences(normaliseLockfile(before), normaliseLockfile(after), 'lockfile', []);
}

/** The status line git prints for a modified lockfile. */
export const LOCKFILE_MODIFIED = ' M pnpm-lock.yaml';

/**
 * What the remove left behind: every changed path but the lockfile, and
 * the lockfile's drift. Empty when nothing is left. `rewritten` says the
 * lockfile's bytes differ, by peer suffixes alone when there are no
 * problems.
 *
 * @param {{ status: string[], before: string, after: string }} removal
 *   `git status --porcelain` after the remove, as lines, and the lockfile's
 *   text at HEAD and after the remove
 * @returns {{ problems: string[], rewritten: boolean }}
 */
export function removalLeftovers({ status, before, after }) {
  const problems = status.filter((line) => line !== LOCKFILE_MODIFIED);
  const rewritten = status.includes(LOCKFILE_MODIFIED);
  if (rewritten) problems.push(...lockfileDrift(before, after));
  return { problems, rewritten };
}
