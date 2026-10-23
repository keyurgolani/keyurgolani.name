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
// Both checks compare exactly, which holds only while what pnpm writes is
// the same on every run. A peer cycle breaks that: pnpm 10.33's
// resolvePeers sets a cyclic peer's key from whichever node it finishes
// first, so #82's run wrote next's eslint-plugin-import keys short where
// the committed ones were long. .pnpmfile.cjs drops the edge that closed
// that cycle, and peerCycles() keeps a new one out of the committed
// lockfile (ci/lockfile-drift.test.mjs). When a check still fails with
// nested peer suffixes alone moved, `a@1(b@2(c@3))` against `a@1(b@2)`, the
// message says that's the shape of a cycle. It still fails: nothing passes
// on the normalised comparison.
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

const CYCLE_SHAPE =
  'Only nested peer suffixes moved in pnpm-lock.yaml: the shape of a peer cycle, ' +
  'which pnpm resolves differently from run to run (#12), not a leftover.';

/** `name@version(peers)` as its name and its first-level peers' names. */
function keyPeers(key) {
  const start = key.indexOf('(');
  const base = start === -1 ? key : key.slice(0, start);
  const name = base.slice(0, base.lastIndexOf('@'));
  const groups =
    start === -1
      ? []
      : (normalisePeers(key)
          .slice(start)
          .match(/\(([^()]*)\)/g) ?? []);
  const peers = groups
    .map((group) => group.slice(1, -1))
    .map((peer) => peer.slice(0, peer.lastIndexOf('@')))
    .filter(Boolean);
  return { name, peers };
}

/**
 * The peer cycles in a lockfile's snapshot keys: each a sorted list of the
 * package names that peer on each other, directly or around a loop. pnpm
 * can write any key in one of two ways from run to run, so a committed lockfile
 * should have none.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function peerCycles(text) {
  /** @type {Map<string, Set<string>>} */
  const graph = new Map();
  for (const key of Object.keys(parse(text)?.snapshots ?? {})) {
    const { name, peers } = keyPeers(key);
    const edges = graph.get(name) ?? new Set();
    for (const peer of peers) edges.add(peer);
    graph.set(name, edges);
  }
  // Tarjan's strongly connected components: a component of two or more, or
  // a package that peers on itself, is a cycle.
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];
  const visit = (node) => {
    index.set(node, index.size);
    low.set(node, index.get(node));
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node), low.get(next)));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node), index.get(next)));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (component.length > 1 || graph.get(node)?.has(node)) cycles.push(component.sort());
  };
  for (const node of graph.keys()) if (!index.has(node)) visit(node);
  return cycles.sort();
}

/** The lockfile's differences, or the cycle shape when nested peer suffixes alone moved. */
function lockfileChange(before, after) {
  const drift = lockfileDrift(before, after);
  return drift.length === 0 ? null : `pnpm-lock.yaml differs in ${drift.join('; ')}`;
}

/**
 * Why the committed lockfile isn't what pnpm writes, after LOCKFILE_REFRESH
 * ran, or null when it is. git status itself is for the caller to print.
 *
 * @param {{ status: string[], before: string, after: string }} refresh
 *   `git status --porcelain` after it, as lines, and the lockfile's text at
 *   HEAD and after it
 * @returns {string | null}
 */
export function canonicalLockfileProblem({ status, before, after }) {
  if (status.length === 0) return null;
  if (!status.includes(LOCKFILE_MODIFIED)) {
    return 'the lockfile refresh changes nothing but pnpm-lock.yaml';
  }
  const change = lockfileChange(before, after);
  if (change === null) {
    return (
      `${CYCLE_SHAPE} Re-run. If it repeats, pnpm-lock.yaml isn't what pnpm writes: ` +
      'run pnpm install, commit it, and look for a new cycle (ci/lockfile-drift.test.mjs)'
    );
  }
  return `pnpm-lock.yaml isn't what pnpm writes: run pnpm install and commit it. ${change}`;
}

/**
 * What the remove left behind, or null when git status is clean. git status
 * itself is for the caller to print.
 *
 * @param {{ status: string[], before: string, after: string }} removal
 *   `git status --porcelain` after the remove, as lines, and the lockfile's
 *   text at HEAD and after the remove
 * @returns {string | null}
 */
export function removalProblem({ status, before, after }) {
  if (status.length === 0) return null;
  const expected = 'the remove leaves nothing changed';
  if (!status.includes(LOCKFILE_MODIFIED)) return expected;
  const change = lockfileChange(before, after);
  return `${expected}. ${change ?? `${CYCLE_SHAPE} Re-run it`}`;
}
