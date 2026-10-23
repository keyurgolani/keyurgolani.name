// Chunk bytes by source package, through source maps (#6, Slice 1). A
// PORTFOLIO_ANALYZE=1 build ships a .map beside each browser chunk; pnpm
// test:trace reads the map of every chunk a page downloaded and splits the
// chunk's bytes among the modules its mappings point at. A mapping covers
// the generated text from its column to the next mapping on its line, so
// bytes no mapping covers, line breaks among them, count as unmapped. The
// (unmapped) bucket stays its own: module wrappers, the bundler's glue, and
// line breaks belong to no package, and slice 3 decides where they count.
// Gzip bytes are shared out in proportion to the raw ones, since a chunk is
// compressed whole. The decoder is this file's own: base64 VLQ, plain maps,
// and index maps with sections, as Turbopack writes.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGITS = new Map([...BASE64].map((char, index) => [char.charCodeAt(0), index]));

/** The bucket for bytes no mapping covers. */
export const UNMAPPED = '(unmapped)';

/**
 * A map's `mappings`, decoded: one segment per mapping, in the order
 * written, with its generated line and column and the index of its source,
 * or -1 for a segment that names none.
 *
 * @param {string} mappings
 * @returns {{ line: number, column: number, source: number }[]}
 */
export function decodeMappings(mappings) {
  const segments = [];
  let line = 0;
  let column = 0;
  let source = 0;
  let index = 0;
  const fields = [];
  while (index < mappings.length) {
    const char = mappings.charCodeAt(index);
    if (char === 59 /* ; */) {
      line += 1;
      column = 0;
      index += 1;
      continue;
    }
    if (char === 44 /* , */) {
      index += 1;
      continue;
    }
    fields.length = 0;
    while (index < mappings.length) {
      const next = mappings.charCodeAt(index);
      if (next === 44 || next === 59) break;
      let value = 0;
      let scale = 1;
      let digit;
      do {
        digit = DIGITS.get(mappings.charCodeAt(index));
        if (digit === undefined) {
          throw new Error(`Not a base64 VLQ digit at ${index}: ${mappings[index] ?? 'the end'}`);
        }
        index += 1;
        value += (digit & 31) * scale;
        scale *= 32;
      } while (digit & 32);
      fields.push(value % 2 === 1 ? -Math.floor(value / 2) : Math.floor(value / 2));
    }
    if (fields.length !== 1 && fields.length !== 4 && fields.length !== 5) {
      throw new Error(`A mapping has ${fields.length} fields, not 1, 4, or 5 (line ${line})`);
    }
    column += fields[0];
    if (fields.length === 1) {
      segments.push({ line, column, source: -1 });
    } else {
      source += fields[1];
      segments.push({ line, column, source });
    }
  }
  return segments;
}

/** `source` under `root`, as a map's sourceRoot prefixes it. */
function rooted(root, source) {
  if (!root || /^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('/')) return source;
  return root.endsWith('/') ? `${root}${source}` : `${root}/${source}`;
}

/**
 * A source map, plain or indexed, as one list of sources and its segments
 * at their absolute generated positions, sorted. Each section of an index
 * map starts with a segment that names no source, so a section's leading
 * bytes never count for the module before it.
 *
 * @param {any} map
 * @returns {{ sources: (string | null)[], segments: { line: number, column: number, source: number }[] }}
 */
export function flattenMap(map) {
  if (!map || typeof map !== 'object') throw new Error('A source map is an object.');
  if (Array.isArray(map.sections)) {
    const sources = [];
    const segments = [];
    for (const section of map.sections) {
      if (!section.map) throw new Error('An index map section without an inline map.');
      const { line: offsetLine = 0, column: offsetColumn = 0 } = section.offset ?? {};
      const inner = flattenMap(section.map);
      const base = sources.length;
      sources.push(...inner.sources);
      segments.push({ line: offsetLine, column: offsetColumn, source: -1 });
      for (const segment of inner.segments) {
        segments.push({
          line: segment.line + offsetLine,
          column: segment.line === 0 ? segment.column + offsetColumn : segment.column,
          source: segment.source < 0 ? -1 : segment.source + base,
        });
      }
    }
    return { sources, segments: sortSegments(segments) };
  }
  const root = typeof map.sourceRoot === 'string' ? map.sourceRoot : '';
  const sources = (map.sources ?? []).map((source) =>
    typeof source === 'string' ? rooted(root, source) : null,
  );
  return { sources, segments: sortSegments(decodeMappings(map.mappings ?? '')) };
}

function sortSegments(segments) {
  // Stable, so a section's leading segment stays ahead of one at its offset.
  return segments
    .map((segment, order) => ({ segment, order }))
    .sort(
      (a, b) =>
        a.segment.line - b.segment.line || a.segment.column - b.segment.column || a.order - b.order,
    )
    .map(({ segment }) => segment);
}

/** The lines of `code` with where each starts, in bytes, and how long its text is (no line break). */
function lineTable(code) {
  const lines = [];
  let start = 0;
  let bytes = 0;
  while (start <= code.length) {
    let end = code.indexOf('\n', start);
    if (end === -1) end = code.length;
    const textEnd = end > start && code.charCodeAt(end - 1) === 13 ? end - 1 : end;
    const text = code.slice(start, textEnd);
    const ascii = !/[^\x00-\x7f]/.test(text);
    const textBytes = ascii ? text.length : Buffer.byteLength(text);
    lines.push({ byteStart: bytes, text, ascii, textBytes });
    const breakBytes = end < code.length ? end + 1 - textEnd : 0;
    bytes += textBytes + breakBytes;
    if (end === code.length) break;
    start = end + 1;
  }
  return { lines, total: bytes };
}

/**
 * UTF-8 bytes of `text` from code unit `from` to `to`, as Buffer.byteLength
 * counts them: a surrogate pair's 4 bytes count at its first half, and a
 * lone surrogate is 3.
 */
function utf8Bytes(text, from, to) {
  let bytes = 0;
  for (let index = from; index < to; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      bytes += next >= 0xdc00 && next <= 0xdfff ? 4 : 3;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      const previous = index > 0 ? text.charCodeAt(index - 1) : 0;
      bytes += previous >= 0xd800 && previous <= 0xdbff ? 0 : 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Bytes from the start of `line` to `column` (UTF-16 units, as maps count).
 * A non-ASCII line keeps where the last call stopped and reads on from
 * there, so its segments, which come in column order, cost one pass over it.
 */
function columnBytes(line, column) {
  const clamped = Math.min(column, line.text.length);
  if (line.ascii) return clamped;
  if (!line.cursor || clamped < line.cursor.column) line.cursor = { column: 0, bytes: 0 };
  line.cursor.bytes += utf8Bytes(line.text, line.cursor.column, clamped);
  line.cursor.column = clamped;
  return line.cursor.bytes;
}

/**
 * How many bytes of `code` each source of `map` accounts for, and how many
 * no mapping covers. The counts add up to the code's UTF-8 length.
 *
 * @param {string} code a chunk, as served
 * @param {any} map its source map
 * @returns {{ bytes: number, unmapped: number, sources: Map<string, number> }}
 */
export function attributeCode(code, map) {
  const { sources, segments } = flattenMap(map);
  const { lines, total } = lineTable(code);
  const bySource = new Map();
  let mapped = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const line = lines[segment.line];
    if (!line || segment.source < 0) continue;
    const name = sources[segment.source];
    if (name === null || name === undefined) continue;
    const next = segments[index + 1];
    const endColumn = next && next.line === segment.line ? next.column : Infinity;
    const from = columnBytes(line, segment.column);
    const to = endColumn === Infinity ? line.textBytes : columnBytes(line, endColumn);
    if (to <= from) continue;
    bySource.set(name, (bySource.get(name) ?? 0) + (to - from));
    mapped += to - from;
  }
  return { bytes: total, unmapped: total - mapped, sources: bySource };
}

/**
 * A source path as a map names it, with the bundler's prefixes taken off:
 * `turbopack:///[project]/packages/kit/src/a.ts` and
 * `webpack://_N_E/../../packages/kit/src/a.ts` both read
 * `packages/kit/src/a.ts`. Bundler runtime modules keep their
 * `[turbopack]/` or `[next]/` prefix.
 *
 * @param {string} source
 */
export function normalizeSource(source) {
  let path = source;
  try {
    path = decodeURI(path);
  } catch {
    // A malformed escape stays as written.
  }
  path = path.replace(/^webpack:\/\/[^/]*\//, '');
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/\/?/i, '');
  path = path.replace(/^\[project\]\//, '');
  path = path.replace(/[?#].*$/, '');
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      if (parts.length > 0 && parts.at(-1) !== '..') parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

/**
 * React's packages, which Next vendors under next/dist/compiled/ (the
 * experimental builds too) and the app router loads from there.
 */
const VENDORED_BY_NEXT = /^dist\/compiled\/(react|react-dom|scheduler)(?:-experimental)?\//;

/**
 * The package a normalized source belongs to: the npm name after its last
 * `node_modules/`, with React, React DOM, and the scheduler as themselves
 * where Next vendors them, `apps/<name>` for an app, the workspace
 * package's name for `packages/<dir>/`, the deepest directory `workspace`
 * maps to a name, such as `budget-fixtures/fixture-variant-light` (#6), and
 * `next` for Next's own runtime: the bundler runtime it ships and the
 * @swc/helpers its compiled client imports. Anything else is `(other)`.
 *
 * @param {string} source normalized, as normalizeSource returns it
 * @param {Record<string, string>} [workspace] package names by directory under packages/
 */
export function packageOf(source, workspace = {}) {
  const modules = source.lastIndexOf('node_modules/');
  if (modules !== -1) {
    const rest = source.slice(modules + 'node_modules/'.length).split('/');
    const scoped = rest[0]?.startsWith('@');
    const name = scoped ? rest.slice(0, 2).join('/') : rest[0];
    if (name === 'next') {
      const vendored = VENDORED_BY_NEXT.exec(rest.slice(1).join('/'));
      if (vendored) return vendored[1];
    }
    // The helpers Next's own compiled client imports: Next's runtime.
    if (name === '@swc/helpers') return 'next';
    if (name && name !== '.pnpm') return name;
  }
  if (/^\[(turbopack|next)\]\//.test(source)) return 'next';
  const app = /(?:^|\/)apps\/([^/]+)\//.exec(source);
  if (app) return `apps/${app[1]}`;
  const pkg = /(?:^|\/)packages\/(.+)$/.exec(source);
  if (pkg) {
    const rest = pkg[1];
    const dir = Object.keys(workspace)
      .filter((key) => rest.startsWith(`${key}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (dir) return workspace[dir];
    const first = /^([^/]+)\//.exec(rest);
    if (first) return `packages/${first[1]}`;
  }
  return '(other)';
}

/**
 * The workspace's package names by their directory under `root`/packages,
 * for packageOf: each of packages/* and packages/budget-fixtures/* that has
 * a package.json, as pnpm-workspace.yaml lists them.
 *
 * @param {string} root
 * @returns {Record<string, string>}
 */
export function workspacePackages(root) {
  const names = {};
  const packages = path.join(root, 'packages');
  for (const parent of ['', 'budget-fixtures']) {
    let entries;
    try {
      entries = readdirSync(path.join(packages, parent), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = parent ? `${parent}/${entry.name}` : entry.name;
      try {
        const { name } = JSON.parse(readFileSync(path.join(packages, dir, 'package.json'), 'utf8'));
        if (typeof name === 'string') names[dir] = name;
      } catch {
        // A directory with no package.json is no package.
      }
    }
  }
  return names;
}

/** gzip at level 9, as #6 measures JS and CSS: bytes. */
export function gzipBytes(content) {
  return gzipSync(content, { level: 9 }).length;
}

/**
 * One chunk's attribution: its bytes, gzip bytes, and per module and per
 * package bytes, gzip shared out by raw share. Modules are sorted by bytes,
 * largest first, then by name.
 *
 * @param {object} options
 * @param {string} options.url
 * @param {string} options.code
 * @param {any} options.map
 * @param {Record<string, string>} [options.workspace]
 */
export function attributeChunk({ url, code, map, workspace = {} }) {
  const { bytes, unmapped, sources } = attributeCode(code, map);
  const gzip = gzipBytes(code);
  const share = (part) => (bytes === 0 ? 0 : Math.round((gzip * part) / bytes));
  const modules = [...sources.entries()]
    .map(([raw, moduleBytes]) => {
      const source = normalizeSource(raw);
      return { source, package: packageOf(source, workspace), bytes: moduleBytes };
    })
    .sort((a, b) => b.bytes - a.bytes || a.source.localeCompare(b.source));
  return {
    url,
    bytes,
    gzipBytes: gzip,
    unmappedBytes: unmapped,
    modules: modules.map((module) => ({ ...module, gzipBytes: share(module.bytes) })),
    packages: sumPackages([
      ...modules.map((module) => ({
        package: module.package,
        bytes: module.bytes,
        gzipBytes: share(module.bytes),
      })),
      ...(unmapped > 0 ? [{ package: UNMAPPED, bytes: unmapped, gzipBytes: share(unmapped) }] : []),
    ]),
  };
}

/** Where Next keeps the legacy-browser polyfills it ships whole, in its own package. */
export const NEXT_POLYFILL = 'next/dist/build/polyfills/polyfill-nomodule.js';

/**
 * The attribution of a chunk Next ships whole from its own package, with no
 * map: its legacy-browser polyfills, which a document names in a <script
 * nomodule> that a browser running modules never fetches (#6, Slice 2). It
 * matches `polyfill`, that file's text in the app's next package, byte for
 * byte, and all of it is next's. Null for any other chunk.
 *
 * @param {object} options
 * @param {string} options.url
 * @param {string} options.code the chunk, as served
 * @param {string} options.polyfill next's polyfill-nomodule.js
 */
export function frameworkChunk({ url, code, polyfill }) {
  if (code !== polyfill) return null;
  const bytes = Buffer.byteLength(code);
  const gzip = gzipBytes(code);
  return {
    url,
    bytes,
    gzipBytes: gzip,
    unmappedBytes: 0,
    modules: [{ source: NEXT_POLYFILL, package: 'next', bytes, gzipBytes: gzip }],
    packages: [{ package: 'next', bytes, gzipBytes: gzip }],
  };
}

/**
 * Bytes and gzip bytes per package over `entries`, largest first.
 *
 * @param {{ package: string, bytes: number, gzipBytes: number }[]} entries
 */
export function sumPackages(entries) {
  const totals = new Map();
  for (const entry of entries) {
    const total = totals.get(entry.package) ?? { package: entry.package, bytes: 0, gzipBytes: 0 };
    total.bytes += entry.bytes;
    total.gzipBytes += entry.gzipBytes;
    totals.set(entry.package, total);
  }
  return [...totals.values()].sort(
    (a, b) => b.bytes - a.bytes || a.package.localeCompare(b.package),
  );
}

/**
 * Where a chunk's map is, from its last sourceMappingURL comment, resolved
 * against the chunk's URL; null when it names none. An inline data: map
 * comes back as is.
 *
 * @param {string} code
 * @param {string} url the chunk's own URL
 */
export function sourceMapUrl(code, url) {
  const tail = code.slice(-4096);
  const matches = [...tail.matchAll(/(?:\/\/|\/\*)[#@]\s*sourceMappingURL=([^\s*'"]+)/g)];
  const last = matches.at(-1)?.[1];
  if (!last) return null;
  try {
    return new URL(last, url).href;
  } catch {
    return null;
  }
}

/** A data: URL's source map, decoded, or null for any other URL. */
export function inlineSourceMap(url) {
  const match = /^data:application\/json(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(url);
  if (!match) return null;
  const text = match[1]
    ? Buffer.from(match[2], 'base64').toString('utf8')
    : decodeURIComponent(match[2]);
  return JSON.parse(text);
}
