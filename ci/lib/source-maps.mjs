// The one rule for what a default build's static tree may hold of source
// maps (#6, Slice 1), shared by ci/check-source-maps.mjs on the runner and by
// the image smoke inside the container (ci/lib/container.mjs's MAPS_SNIPPET).
//
// No .map file may hold anything of a source. The one map that passes is an
// empty one: Turbopack in Next 16.4.1 writes
// `{"version":3,"sources":[],"sections":[]}` beside the bundle of a
// `new Worker(new URL(...))` module worker, the import's, whatever
// productionBrowserSourceMaps says. A map passes only if it parses to
// version 3 with no sources, no sourcesContent, no names, no mappings, and
// only sections that are themselves such maps. Anything else fails as
// before, a map that doesn't parse included. And no shipped script or
// stylesheet may point at a map with a sourceMappingURL comment, so an
// empty map is never wired to anything: one at the start of a line, or on
// the file's last line after a statement's end or a space, where a minifier
// leaves it. A string that only mentions one mid-line, as postcss's does,
// isn't one. Nor may the tree hold a symlink of any kind: the scan reads
// only regular files, so a link could put a map or a source where it never
// looks.
//
// scanSourceMaps reads the filesystem through process.getBuiltinModule and
// closes over nothing, since the image smoke runs its source in the
// container, where none of ci/ is.

/**
 * What a static tree holds of source maps. `maps` are the .map files the
 * rule fails, `empty` the ones it lets through, `linked` the .js and .css
 * files with a sourceMappingURL comment, and `symlinks` every symlink, each
 * relative to `root` and sorted.
 *
 * @param {string} root
 * @returns {{ exists: boolean, maps: string[], empty: string[], linked: string[], symlinks: string[] }}
 */
export function scanSourceMaps(root) {
  const fs = process.getBuiltinModule('node:fs');
  const path = process.getBuiltinModule('node:path');
  /** Whether a parsed map is version 3 and holds nothing of any source. */
  const isEmpty = (map) => {
    if (!map || typeof map !== 'object' || Array.isArray(map) || map.version !== 3) return false;
    const none = (value) => value === undefined || (Array.isArray(value) && value.length === 0);
    if (!none(map.sources) || 'sourcesContent' in map || !none(map.names)) return false;
    if (map.mappings !== undefined && map.mappings !== '') return false;
    if (map.sections === undefined) return true;
    return (
      Array.isArray(map.sections) &&
      map.sections.every(
        (section) => section !== null && typeof section === 'object' && isEmpty(section.map),
      )
    );
  };
  /** A comment that names a map, at the start of a line, as a bundler writes it. */
  const COMMENT = /^[ \t]*(?:\/\/|\/\*)[#@][ \t]*sourceMappingURL=/m;
  /** One on the last line, after a statement's end, a block's, or a space, as a minifier leaves it. */
  const TRAILING = /(?:^|[;}\s])(?:\/\/|\/\*)[#@]\s*sourceMappingURL=/;
  const points = (text) => COMMENT.test(text) || TRAILING.test(text.trimEnd().split('\n').at(-1));
  const result = { exists: fs.existsSync(root), maps: [], empty: [], linked: [], symlinks: [] };
  if (!result.exists) return result;
  // A walk of its own: readdirSync's recursive option goes into a symlinked
  // directory, so a link would bring another tree's files in under this one.
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) result.symlinks.push(path.relative(root, full));
      else if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(path.relative(root, full));
    }
  };
  walk(root);
  result.symlinks.sort();
  files.sort();
  for (const file of files) {
    const read = () => fs.readFileSync(path.join(root, file), 'utf8');
    if (file.endsWith('.map')) {
      let map;
      try {
        map = JSON.parse(read());
      } catch {
        map = null;
      }
      (isEmpty(map) ? result.empty : result.maps).push(file);
    } else if (/\.(?:m?js|css)$/.test(file) && points(read())) {
      result.linked.push(file);
    }
  }
  return result;
}
