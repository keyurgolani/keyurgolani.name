import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  attributeChunk,
  attributeCode,
  decodeMappings,
  flattenMap,
  gzipBytes,
  inlineSourceMap,
  normalizeSource,
  packageOf,
  sourceMapUrl,
  sumPackages,
  UNMAPPED,
  workspacePackages,
} from './attribution.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** One base64 VLQ value, as the source map format writes it. */
function vlq(value) {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = rest & 31;
    rest >>>= 5;
    if (rest > 0) digit |= 32;
    out += BASE64[digit];
  } while (rest > 0);
  return out;
}

/**
 * A mappings string from absolute segments, one array per generated line:
 * [column] for a segment with no source, [column, source] for one with.
 */
function mappings(lines) {
  let source = 0;
  let sourceLine = 0;
  return lines
    .map((segments) => {
      let column = 0;
      return segments
        .map(([col, src]) => {
          const fields = [col - column];
          column = col;
          if (src !== undefined) {
            fields.push(src - source, 0 - sourceLine, 0);
            source = src;
            sourceLine = 0;
          }
          return fields.map(vlq).join('');
        })
        .join(',');
    })
    .join(';');
}

test('base64 VLQ decodes signs, several digits, and segments with no source', () => {
  assert.equal(vlq(16), 'gB');
  assert.equal(vlq(-1), 'D');
  assert.equal(vlq(123), '2H');
  assert.deepEqual(decodeMappings('AAAA,gBAAgB;3HCAD,E'), [
    { line: 0, column: 0, source: 0 },
    { line: 0, column: 16, source: 0 },
    { line: 1, column: -123, source: 1 },
    { line: 1, column: -121, source: -1 },
  ]);
  assert.deepEqual(decodeMappings(';;AAAA'), [{ line: 2, column: 0, source: 0 }]);
  assert.deepEqual(decodeMappings(''), []);
});

test('a malformed mapping fails with where it is', () => {
  assert.throws(() => decodeMappings('AA!A'), /Not a base64 VLQ digit at 2: !/);
  assert.throws(() => decodeMappings('AA'), /2 fields, not 1, 4, or 5/);
  assert.throws(() => decodeMappings('g'), /Not a base64 VLQ digit at 1: the end/);
});

test('an index map flattens its sections at their offsets, sources numbered after the ones before', () => {
  const flat = flattenMap({
    version: 3,
    sections: [
      {
        offset: { line: 0, column: 0 },
        map: { sources: ['a.js'], mappings: mappings([[[0, 0]]]) },
      },
      {
        offset: { line: 0, column: 10 },
        map: { sources: ['b.js', 'c.js'], mappings: mappings([[[2, 1]], [[3, 0]]]) },
      },
    ],
  });
  assert.deepEqual(flat.sources, ['a.js', 'b.js', 'c.js']);
  assert.deepEqual(flat.segments, [
    { line: 0, column: 0, source: -1 },
    { line: 0, column: 0, source: 0 },
    { line: 0, column: 10, source: -1 },
    { line: 0, column: 12, source: 2 },
    { line: 1, column: 3, source: 1 },
  ]);
});

test('a plain map prefixes its sourceRoot, and keeps a null source as null', () => {
  const flat = flattenMap({
    sourceRoot: 'src',
    sources: ['a.js', null, 'webpack://x/b.js'],
    mappings: '',
  });
  assert.deepEqual(flat.sources, ['src/a.js', null, 'webpack://x/b.js']);
  assert.throws(
    () => flattenMap({ sections: [{ offset: { line: 0, column: 0 } }] }),
    /without an inline map/,
  );
});

test('each mapping covers its line up to the next one, and the rest is unmapped', () => {
  const code = 'aaaa bbbb\ncccc\n';
  const map = {
    sources: ['a.js', 'b.js'],
    mappings: mappings([
      [
        [0, 0],
        [5, 1],
      ],
      [[0, 0]],
    ]),
  };
  const { bytes, unmapped, sources } = attributeCode(code, map);
  assert.equal(bytes, 15);
  assert.deepEqual(Object.fromEntries(sources), { 'a.js': 9, 'b.js': 4 });
  // Two line breaks.
  assert.equal(unmapped, 2);
});

test('a segment with no source ends the one before it, and bytes count as UTF-8', () => {
  // "é" is one UTF-16 unit and two UTF-8 bytes; "€" one unit and three bytes.
  const code = 'é€xyz;rest';
  const map = { sources: ['a.js'], mappings: mappings([[[0, 0], [5], [6, 0]]]) };
  const { bytes, unmapped, sources } = attributeCode(code, map);
  assert.equal(bytes, Buffer.byteLength(code));
  assert.equal(sources.get('a.js'), 2 + 3 + 3 + 4);
  assert.equal(unmapped, 1);
});

test('mappings past the code, or on a null source, count nothing', () => {
  const map = {
    sources: [null, 'a.js'],
    mappings: mappings([
      [
        [0, 0],
        [2, 1],
      ],
      [[0, 1]],
    ]),
  };
  const { bytes, unmapped, sources } = attributeCode('abcd', map);
  assert.equal(bytes, 4);
  assert.deepEqual(Object.fromEntries(sources), { 'a.js': 2 });
  assert.equal(unmapped, 2);
});

test('a CRLF line break counts as unmapped, both bytes', () => {
  const map = { sources: ['a.js'], mappings: mappings([[[0, 0]], [[0, 0]]]) };
  const { unmapped, sources } = attributeCode('ab\r\ncd', map);
  assert.equal(sources.get('a.js'), 4);
  assert.equal(unmapped, 2);
});

test('sources lose their bundler prefixes', () => {
  assert.equal(
    normalizeSource('turbopack:///[project]/packages/kit/src/a.ts'),
    'packages/kit/src/a.ts',
  );
  assert.equal(
    normalizeSource('webpack://_N_E/../../packages/kit/src/a.ts?abc'),
    'packages/kit/src/a.ts',
  );
  assert.equal(
    normalizeSource('turbopack:///[turbopack]/browser/runtime.ts'),
    '[turbopack]/browser/runtime.ts',
  );
  assert.equal(
    normalizeSource('file:///./apps/web/src/app/(site)/page.tsx'),
    'apps/web/src/app/(site)/page.tsx',
  );
  assert.equal(normalizeSource('[project]/apps/web/src/a%20b.ts'), 'apps/web/src/a b.ts');
  assert.equal(normalizeSource('bad%E0%A4%A.ts'), 'bad%E0%A4%A.ts');
});

test('a source belongs to the npm package after its last node_modules, a workspace package, or an app', () => {
  const workspace = { kit: '@portfolio/kit' };
  const cases = [
    ['node_modules/.pnpm/next@16.2.4_react@19/node_modules/next/dist/client/index.js', 'next'],
    ['node_modules/.pnpm/next@16.2.4/node_modules/next/src/client/app-index.tsx', 'next'],
    // React's packages, which Next vendors, count as themselves.
    ['node_modules/next/dist/compiled/react/cjs/react.production.js', 'react'],
    ['node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.production.js', 'react-dom'],
    ['node_modules/next/dist/compiled/react-dom-experimental/cjs/client.js', 'react-dom'],
    ['node_modules/next/dist/compiled/scheduler/cjs/scheduler.production.js', 'scheduler'],
    // Anything else Next vendors is Next's.
    ['node_modules/next/dist/compiled/react-server-dom-turbopack/client.js', 'next'],
    ['node_modules/next/dist/compiled/process/browser.js', 'next'],
    // The helpers Next's compiled client imports are Next's runtime.
    ['node_modules/.pnpm/@swc+helpers@0.5/node_modules/@swc/helpers/esm/a.js', 'next'],
    ['apps/web/node_modules/react-dom/cjs/react-dom.production.js', 'react-dom'],
    ['node_modules/.pnpm/scheduler@0.27/node_modules/scheduler/index.js', 'scheduler'],
    ['packages/kit/src/sections/hero.tsx', '@portfolio/kit'],
    ['packages/unknown/src/a.ts', 'packages/unknown'],
    ['apps/web/src/lib/render-composition.tsx', 'apps/web'],
    ['[turbopack]/browser/runtime/base.ts', 'next'],
    ['[next]/entry/page-loader.ts', 'next'],
    ['src/loose.ts', '(other)'],
    ['node_modules/.pnpm', '(other)'],
  ];
  for (const [source, expected] of cases)
    assert.equal(packageOf(source, workspace), expected, source);
});

test("the workspace's packages are named by their directory", () => {
  const names = workspacePackages(REPO_ROOT);
  assert.equal(names.kit, '@portfolio/kit');
  assert.equal(names['fallback-composition'], '@portfolio/fallback-composition');
});

test('a chunk splits into modules and packages, gzip shared out by raw share', () => {
  const code = `${'a'.repeat(600)}${'b'.repeat(300)}${'c'.repeat(100)}`;
  const map = {
    sources: [
      'turbopack:///[project]/node_modules/.pnpm/react-dom@19/node_modules/react-dom/a.js',
      'turbopack:///[project]/packages/kit/src/b.ts',
      'turbopack:///[project]/packages/kit/src/c.ts',
    ],
    mappings: mappings([[[0, 0], [600, 1], [900], [950, 2]]]),
  };
  const chunk = attributeChunk({
    url: 'http://127.0.0.1/x.js',
    code,
    map,
    workspace: { kit: '@portfolio/kit' },
  });
  assert.equal(chunk.bytes, 1000);
  assert.equal(chunk.gzipBytes, gzipSync(code, { level: 9 }).length);
  assert.equal(chunk.unmappedBytes, 50);
  assert.deepEqual(
    chunk.modules.map(({ source, package: name, bytes }) => [source, name, bytes]),
    [
      ['node_modules/.pnpm/react-dom@19/node_modules/react-dom/a.js', 'react-dom', 600],
      ['packages/kit/src/b.ts', '@portfolio/kit', 300],
      ['packages/kit/src/c.ts', '@portfolio/kit', 50],
    ],
  );
  assert.deepEqual(
    chunk.packages.map(({ package: name, bytes }) => [name, bytes]),
    [
      ['react-dom', 600],
      ['@portfolio/kit', 350],
      [UNMAPPED, 50],
    ],
  );
  const shared = chunk.packages.reduce((total, row) => total + row.gzipBytes, 0);
  assert.ok(
    Math.abs(shared - chunk.gzipBytes) <= chunk.packages.length,
    `${shared} vs ${chunk.gzipBytes}`,
  );
  assert.equal(chunk.packages[0].gzipBytes, Math.round((chunk.gzipBytes * 600) / 1000));
});

test('package totals add up across chunks, largest first', () => {
  assert.deepEqual(
    sumPackages([
      { package: 'next', bytes: 10, gzipBytes: 4 },
      { package: 'react-dom', bytes: 30, gzipBytes: 9 },
      { package: 'next', bytes: 25, gzipBytes: 8 },
    ]),
    [
      { package: 'next', bytes: 35, gzipBytes: 12 },
      { package: 'react-dom', bytes: 30, gzipBytes: 9 },
    ],
  );
});

test("a chunk's map is its last sourceMappingURL comment, resolved against the chunk", () => {
  const chunk = 'http://127.0.0.1:4000/_next/static/chunks/a.js';
  assert.equal(
    sourceMapUrl('x;\n//# sourceMappingURL=a.js.map', chunk),
    'http://127.0.0.1:4000/_next/static/chunks/a.js.map',
  );
  assert.equal(
    sourceMapUrl('a{}\n/*# sourceMappingURL=../css/a.css.map */', chunk),
    'http://127.0.0.1:4000/_next/static/css/a.css.map',
  );
  assert.equal(
    sourceMapUrl('//# sourceMappingURL=old.map\nx;\n//@ sourceMappingURL=new.map\n', chunk),
    'http://127.0.0.1:4000/_next/static/chunks/new.map',
  );
  assert.equal(sourceMapUrl('no map here', chunk), null);
});

test('an inline map decodes from base64 or percent-encoding, and any other URL is none', () => {
  const map = { version: 3, sources: ['a.js'], mappings: 'AAAA' };
  const base64 = Buffer.from(JSON.stringify(map)).toString('base64');
  assert.deepEqual(inlineSourceMap(`data:application/json;charset=utf-8;base64,${base64}`), map);
  assert.deepEqual(
    inlineSourceMap(`data:application/json,${encodeURIComponent(JSON.stringify(map))}`),
    map,
  );
  assert.equal(inlineSourceMap('http://127.0.0.1/a.js.map'), null);
});

/** About 47 KB of code-like text, the same every run, that gzip compresses differently at each level. */
function codeLikeText() {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const words = ['const', 'return', 'function', 'export', 'import', 'await', 'async', 'value'];
  words.push('props', 'state', 'render', 'children', 'className', 'useEffect', 'window');
  words.push('document', 'length', 'index', 'null', 'undefined');
  let text = '';
  for (let i = 0; i < 5000; i += 1) {
    const word = words[Math.floor(random() * words.length)];
    const after =
      random() < 0.1 ? '\n' : random() < 0.5 ? `(${Math.floor(random() * 1000)});` : ' ';
    text += word + after;
  }
  return text;
}

test('gzip bytes are level 9, which this text tells apart from the default level 6', () => {
  const text = codeLikeText();
  const [level6, level9] = [6, 9].map((level) => gzipSync(text, { level }).length);
  assert.ok(level9 < level6, `level 9 (${level9}) beats level 6 (${level6}) on this text`);
  assert.equal(gzipBytes(text), level9);
  assert.equal(gzipBytes(Buffer.from(text)), level9, 'a Buffer counts the same');
});

test('a surrogate pair counts its 4 bytes once, and a lone surrogate 3, as UTF-8 has them', () => {
  // "😀" is two UTF-16 units and four UTF-8 bytes. Mappings land on either half.
  const code = 'a😀b\ud800c😀';
  const map = {
    sources: ['a.js', 'b.js'],
    mappings: mappings([
      [
        [0, 0],
        [2, 1],
        [5, 0],
      ],
    ]),
  };
  const { bytes, unmapped, sources } = attributeCode(code, map);
  assert.equal(bytes, Buffer.byteLength(code));
  assert.equal(unmapped, 0);
  // a.js: "a" and the first half of the pair, which carries its 4 bytes, then "c😀".
  assert.deepEqual(Object.fromEntries(sources), { 'a.js': 1 + 4 + 1 + 4, 'b.js': 1 + 3 });
});

test('an astral character is 4 bytes, all to the source whose mapping holds its first half', () => {
  // U+1F600, U+20000, and U+1D11E: each two UTF-16 units and four UTF-8
  // bytes. Each character has a mapping of its own, the sources alternate,
  // and the line ends on a.js, so a pair counted short moves bytes from b.js
  // to a.js rather than hiding in the line's last mapping.
  const code = 'x😀y𠀀z𝄞w';
  const columns = [0, 1, 3, 4, 6, 7, 9];
  const map = {
    sources: ['a.js', 'b.js'],
    mappings: mappings([columns.map((column, k) => [column, k % 2])]),
  };
  const { bytes, unmapped, sources } = attributeCode(code, map);
  assert.equal(bytes, Buffer.byteLength(code));
  assert.equal(unmapped, 0);
  assert.deepEqual(Object.fromEntries(sources), { 'a.js': 4, 'b.js': 12 });

  // A mapping that starts on a pair's second half gets none of its bytes.
  const split = {
    sources: ['a.js', 'b.js'],
    mappings: mappings([
      [
        [0, 0],
        [2, 1],
      ],
    ]),
  };
  assert.deepEqual(Object.fromEntries(attributeCode('p😀q', split).sources), {
    'a.js': 1 + 4,
    'b.js': 1,
  });
  // A lone second half is 3 bytes, as a lone first half is.
  const lone = {
    sources: ['a.js', 'b.js'],
    mappings: mappings([
      [
        [0, 0],
        [1, 1],
        [2, 0],
      ],
    ]),
  };
  assert.deepEqual(Object.fromEntries(attributeCode('a\udc00b', lone).sources), {
    'a.js': 2,
    'b.js': 3,
  });
});

test('a long non-ASCII line attributes in one pass, not one pass per mapping', () => {
  // 1,200,000 UTF-16 units, 2,388,000 UTF-8 bytes, and a mapping every 100 units.
  const unit = `${'é'.repeat(99)}x`;
  const code = unit.repeat(12000);
  const segments = Array.from({ length: 12000 }, (_, k) => [k * 100, k % 2]);
  const map = { sources: ['a.js', 'b.js'], mappings: mappings([segments]) };
  const started = performance.now();
  const { bytes, unmapped, sources } = attributeCode(code, map);
  const elapsed = performance.now() - started;
  assert.equal(bytes, Buffer.byteLength(code));
  assert.equal(unmapped, 0);
  assert.equal(sources.get('a.js'), 6000 * Buffer.byteLength(unit));
  assert.equal(sources.get('b.js'), 6000 * Buffer.byteLength(unit));
  // Reading each mapping's column from the line start again takes seconds here.
  assert.ok(elapsed < 500, `took ${Math.round(elapsed)} ms`);
});
