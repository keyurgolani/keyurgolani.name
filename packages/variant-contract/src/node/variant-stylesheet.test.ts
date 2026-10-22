import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ASSET_URL,
  compileVariantStylesheet,
  VARIANT_URL,
  type VariantStylesheetOptions,
} from './variant-stylesheet';

// A variant's compiled stylesheet (#6, Slice 2, item 2): the layer order
// first, every rule in variant-layout after the shared stylesheets, local
// imports inlined, remote ones hoisted into the layer, url() targets copied
// by content hash, and a problem, never a throw, for what can't be served.
// Every file is written under a temporary directory, never the host's public/.

const LAYER_ORDER =
  '@layer reset, scheme, language, typography, variant-layout, utilities, accessibility;';

const made: string[] = [];
test.after(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A package directory holding `files`, by path, under a fresh temporary directory. */
function packageDir(files: Readonly<Record<string, string | Uint8Array>>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-variant-css-'));
  made.push(root);
  const dir = path.join(root, 'pkg');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function compile(dir: string, extra: Partial<VariantStylesheetOptions> = {}) {
  return compileVariantStylesheet({
    id: 'acme',
    source: { dir, file: path.join(dir, 'styles.css') },
    layerOrder: LAYER_ORDER,
    layer: 'variant-layout',
    ...extra,
  });
}

function compiled(dir: string, extra: Partial<VariantStylesheetOptions> = {}) {
  const result = compile(dir, extra);
  assert.ok(result.ok, JSON.stringify(!result.ok && result.problems));
  return { ...result, css: new TextDecoder().decode(result.stylesheet.bytes) };
}

function problems(dir: string, extra: Partial<VariantStylesheetOptions> = {}) {
  const result = compile(dir, extra);
  assert.ok(!result.ok, 'it compiled');
  return result.problems;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const pngName = `${createHash('sha256').update(PNG).digest('hex').slice(0, 12)}.png`;

test('the file starts with the layer order, and every rule sits in variant-layout after the shared stylesheets', () => {
  const kit = packageDir({ 'sections.css': ':where([data-variant] p) { margin: 0; }\n' });
  const dir = packageDir({
    'styles.css': "/* a comment */\n[data-variant='acme'] { display: block; }\n",
  });
  const { css, stylesheet } = compiled(dir, {
    shared: [{ dir: kit, file: path.join(kit, 'sections.css') }],
  });
  assert.equal(
    css,
    `${LAYER_ORDER}\n@layer variant-layout {\n:where([data-variant] p) { margin: 0; }\n` +
      `[data-variant='acme'] { display: block; }\n}\n`,
  );
  const sha256 = createHash('sha256').update(stylesheet.bytes).digest('hex');
  assert.equal(stylesheet.sha256, sha256);
  assert.equal(stylesheet.name, `acme.${sha256.slice(0, 12)}.css`);
  assert.equal(stylesheet.url, `${VARIANT_URL}${stylesheet.name}`);
});

test('two compilations of the same files give the same bytes', () => {
  const dir = packageDir({
    'styles.css': "@import './more.css';\n[data-variant='acme'] { background: url(./a.png); }\n",
    'more.css': "[data-variant='acme'] p { margin: 0; }\n",
    'a.png': PNG,
  });
  const first = compiled(dir);
  const second = compiled(dir);
  assert.deepEqual(first.stylesheet, second.stylesheet);
  assert.deepEqual(first.assets, second.assets);
});

test('a relative @import is inlined where it stands, and one with a media query inside @media', () => {
  const dir = packageDir({
    'styles.css': [
      '@charset "utf-8";',
      "@import './base.css';",
      '@import url("./parts/wide.css") screen and (min-width: 40em);',
      "[data-variant='acme'] { display: block; }",
      '',
    ].join('\n'),
    'base.css': "[data-variant='acme'] .a { margin: 0; }\n",
    'parts/wide.css': "[data-variant='acme'] .b { padding: 0; }\n",
  });
  const { css, inputs } = compiled(dir);
  assert.equal(
    css,
    `${LAYER_ORDER}\n@layer variant-layout {\n[data-variant='acme'] .a { margin: 0; }\n` +
      `@media screen and (min-width: 40em) {\n[data-variant='acme'] .b { padding: 0; }\n}\n` +
      `[data-variant='acme'] { display: block; }\n}\n`,
  );
  assert.deepEqual(
    inputs.map((file) => path.relative(fs.realpathSync(dir), file)),
    ['base.css', path.join('parts', 'wide.css'), 'styles.css'],
  );
});

test("a relative @import that isn't marked relative still needs ./", () => {
  const dir = packageDir({
    'styles.css': '@import url(parts/wide.css);\n',
    'parts/wide.css': 'a {}\n',
  });
  const found = problems(dir);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /imports parts\/wide\.css, which isn't a file in the package/);
});

test('a remote @import is hoisted into the layer, with its media query', () => {
  const dir = packageDir({
    'styles.css':
      "@import url('https://fonts.example.invalid/a.css') print;\n@import \"//cdn.example.invalid/b.css\";\n[data-variant='acme'] {}\n",
  });
  const { css } = compiled(dir);
  assert.equal(
    css,
    `${LAYER_ORDER}\n` +
      '@import url("https://fonts.example.invalid/a.css") layer(variant-layout) print;\n' +
      '@import url("//cdn.example.invalid/b.css") layer(variant-layout);\n' +
      "@layer variant-layout {\n[data-variant='acme'] {}\n}\n",
  );
});

test('each url() target in the package is copied by content hash, and only those', () => {
  const dir = packageDir({
    'styles.css': [
      "[data-variant='acme'] .a { background: url(./img/a.png) no-repeat; }",
      "[data-variant='acme'] .b { background: url( 'img/a.png' ); }",
      '[data-variant=\'acme\'] .c { mask: url("./icons.svg#star"); }',
      "[data-variant='acme'] .d { background: url(data:image/png;base64,AAAA), url(#paint), url(/x.png), url(https://cdn.example.invalid/x.png); }",
      "[data-variant='acme'] .e { background-image: image-set('./img/a.png' 1x, url(./img/a.png) 2x); }",
      "[data-variant='acme'] .f { content: './img/a.png'; }",
      '',
    ].join('\n'),
    'img/a.png': PNG,
    'icons.svg': '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="star"/></svg>',
  });
  const { css, assets, inputs } = compiled(dir);
  const svg = assets.find((asset) => asset.name.endsWith('.svg'))!;
  assert.deepEqual(
    assets.map(({ name, url }) => ({ name, url })),
    [
      { name: pngName, url: `${ASSET_URL}${pngName}` },
      { name: svg.name, url: `${ASSET_URL}${svg.name}` },
    ].sort((a, b) => (a.name < b.name ? -1 : 1)),
  );
  assert.deepEqual(assets.find((asset) => asset.name === pngName)!.bytes, PNG);
  const png = `${ASSET_URL}${pngName}`;
  assert.ok(css.includes(`.a { background: url("${png}") no-repeat; }`), css);
  assert.ok(css.includes(`.b { background: url("${png}"); }`), css);
  assert.ok(css.includes(`.c { mask: url("${ASSET_URL}${svg.name}#star"); }`), css);
  assert.ok(
    css.includes(
      '.d { background: url(data:image/png;base64,AAAA), url(#paint), url(/x.png), url(https://cdn.example.invalid/x.png); }',
    ),
    css,
  );
  assert.ok(
    css.includes(`.e { background-image: image-set("${png}" 1x, url("${png}") 2x); }`),
    css,
  );
  assert.ok(css.includes(".f { content: './img/a.png'; }"), 'a plain string stays a string');
  assert.deepEqual(
    inputs.map((file) => path.relative(fs.realpathSync(dir), file)),
    ['icons.svg', path.join('img', 'a.png'), 'styles.css'],
  );
});

test('a url() in an imported file resolves from that file', () => {
  const dir = packageDir({
    'styles.css': "@import './parts/more.css';\n",
    'parts/more.css': "[data-variant='acme'] { background: url(../img/a.png); }\n",
    'img/a.png': PNG,
  });
  const { css } = compiled(dir);
  assert.ok(css.includes(`url("${ASSET_URL}${pngName}")`), css);
});

test('comments go, and a string that looks like one stays', () => {
  const dir = packageDir({
    'styles.css': "[data-variant='acme'] .a::before { content: '/* kept */'; } /* gone */\n",
  });
  const { css } = compiled(dir);
  assert.ok(css.includes("content: '/* kept */';"), css);
  assert.ok(!css.includes('gone'), css);
});

test("each reference the compiled file couldn't serve is a problem at its line and column", () => {
  const outside = packageDir({ 'theirs.css': 'a {}\n', 'their.png': PNG });
  const dir = packageDir({
    'styles.css': [
      "@import '@acme/other/styles.css';",
      "@import '/abs.css';",
      "@import './missing.css';",
      "@import './layered.css' layer(extra);",
      "@import './supported.css' supports(display: grid);",
      '@import url(https://cdn.example.invalid/x.css) layer(theirs);',
      "[data-variant='acme'] .a { background: url(./nowhere.png); }",
      "[data-variant='acme'] .b { background: url(./notes.txt); }",
      "[data-variant='acme'] .c { background: url(./linked/their.png); }",
      "@import './late.css';",
      '',
    ].join('\n'),
    'layered.css': 'a {}\n',
    'supported.css': 'a {}\n',
    'notes.txt': 'not an image',
    'late.css': 'a {}\n',
  });
  fs.symlinkSync(outside, path.join(dir, 'linked'));
  const found = problems(dir).map(({ file, line, column, message }) => ({
    file: path.basename(file),
    line,
    column,
    message,
  }));
  assert.deepEqual(found, [
    {
      file: 'styles.css',
      line: 1,
      column: 1,
      message:
        "imports @acme/other/styles.css, which isn't a file in the package by relative path.",
    },
    {
      file: 'styles.css',
      line: 2,
      column: 1,
      message: "imports /abs.css, which isn't a file in the package by relative path.",
    },
    {
      file: 'styles.css',
      line: 3,
      column: 1,
      message: "imports missing.css, which the package doesn't have.",
    },
    {
      file: 'styles.css',
      line: 4,
      column: 1,
      message:
        "imports ./layered.css with a layer() or supports() condition, which the compiled file can't keep.",
    },
    {
      file: 'styles.css',
      line: 5,
      column: 1,
      message:
        "imports ./supported.css with a layer() or supports() condition, which the compiled file can't keep.",
    },
    {
      file: 'styles.css',
      line: 6,
      column: 1,
      message:
        'imports https://cdn.example.invalid/x.css into a layer of its own, and every rule goes in variant-layout.',
    },
    {
      file: 'styles.css',
      line: 7,
      column: 40,
      message: "names ./nowhere.png, which the package doesn't have.",
    },
    {
      file: 'styles.css',
      line: 8,
      column: 40,
      message:
        "names ./notes.txt, and a variant's stylesheet ships only images: avif, gif, jpeg, jpg, png, svg, webp.",
    },
    {
      file: 'styles.css',
      line: 9,
      column: 40,
      message: "names ./linked/their.png, which isn't a file in the package.",
    },
    {
      file: 'styles.css',
      line: 10,
      column: 1,
      message: 'has an @import after a rule, which a browser ignores.',
    },
  ]);
});

test('an import that leaves the package, or comes back around, is a problem', () => {
  const outside = packageDir({ 'theirs.css': 'a {}\n' });
  const dir = packageDir({
    'styles.css': "@import './a.css';\n@import './linked/theirs.css';\n",
    'a.css': "@import './b.css';\n",
    'b.css': "@import './a.css';\n",
  });
  fs.symlinkSync(outside, path.join(dir, 'linked'));
  const found = problems(dir).map(({ file, line, message }) => ({
    file: path.basename(file),
    line,
    message,
  }));
  assert.deepEqual(found, [
    { file: 'b.css', line: 1, message: 'imports a.css, which imports it back.' },
    { file: 'styles.css', line: 2, message: 'reaches theirs.css, which is outside the package.' },
  ]);
});

test('braces that would move rules out of the layer are a problem', () => {
  for (const [text, message] of [
    ["[data-variant='acme'] {}\n}\n[data-variant='acme'] .a {}\n", 'has a } with no { before it.'],
    ["[data-variant='acme'] { display: block;\n", 'has a { the file never closes.'],
  ] as const) {
    const found = problems(packageDir({ 'styles.css': text }));
    assert.deepEqual(
      found.map((problem) => problem.message),
      [message],
      text,
    );
  }
});

test("a stylesheet the package doesn't have is a problem, not a throw", () => {
  const dir = packageDir({ 'other.css': 'a {}\n' });
  const found = problems(dir);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.message, "names styles.css, which the package doesn't have.");
});
